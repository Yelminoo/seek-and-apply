"""
JobRunner: wraps ApplyPilot CLI as a subprocess per user.

Each user gets their own APPLYPILOT_DIR so data is fully isolated.
Logs are buffered in memory and streamed via SSE.
"""

import os
import sqlite3
import subprocess
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


class JobRunner:
    def __init__(self, user_id: str, user_dir: Path):
        self.user_id = user_id
        self.user_dir = user_dir
        self.job_id = str(uuid.uuid4())
        self.current_stage: Optional[str] = None
        self.started_at: Optional[str] = None
        self._logs: list[str] = []
        self._running = False
        self._proc: Optional[subprocess.Popen] = None
        self._lock = threading.Lock()

    def is_running(self) -> bool:
        return self._running

    def get_logs(self) -> list[str]:
        with self._lock:
            return list(self._logs)

    def _append_log(self, line: str):
        with self._lock:
            self._logs.append(line)

    def stop(self):
        self._running = False
        if self._proc and self._proc.poll() is None:
            self._proc.terminate()
            try:
                self._proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._proc.kill()

    # LLM stages that consume API quota
    _LLM_STAGES = {"score", "tailor", "cover", "all"}

    @property
    def _cooldown_path(self) -> Path:
        return self.user_dir / ".llm_last_run"

    def _read_cooldown(self) -> Optional[float]:
        """Return Unix timestamp of last LLM run completion, or None."""
        try:
            return float(self._cooldown_path.read_text(encoding="utf-8").strip())
        except Exception:
            return None

    def _write_cooldown(self) -> None:
        try:
            self._cooldown_path.write_text(str(time.time()), encoding="utf-8")
        except Exception:
            pass

    def _gemini_startup_wait(self, stages: list[str]) -> None:
        """If last LLM run was within 75s, wait out the rolling window.

        Gemini free tier = 15 RPM = 1 req / 4s. The rolling window is 60s.
        If the previous run consumed requests in the last <75s, a new run
        starting immediately risks a 429 on the very first call.
        """
        has_llm_stage = any(s in self._LLM_STAGES for s in stages)
        if not has_llm_stage:
            return
        last = self._read_cooldown()
        if last is None:
            return
        elapsed = time.time() - last
        window = 75  # 60s rolling window + 15s buffer
        if elapsed < window:
            wait = int(window - elapsed)
            self._append_log(
                f"[Rate limit] Gemini cooldown: previous LLM run was {int(elapsed)}s ago. "
                f"Waiting {wait}s to clear the 60-second rolling window..."
            )
            for remaining in range(wait, 0, -5):
                if not self._running:
                    return
                self._append_log(f"[Rate limit] Starting in {remaining}s...")
                time.sleep(min(5, remaining))

    def _make_env(self) -> dict:
        """Build subprocess env with APPLYPILOT_DIR pointing to this user's dir."""
        env = os.environ.copy()
        env["APPLYPILOT_DIR"] = str(self.user_dir)

        # Load user's .env file into the environment
        env_file = self.user_dir / ".env"
        if env_file.exists():
            for line in env_file.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if "=" in line and not line.startswith("#"):
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip()

        # Auto-set proactive rate-limit delay based on LLM provider.
        # Local LLMs (LLM_URL set) run at full speed.
        # Gemini free tier: 15 RPM → 5s/call (12 RPM, leaves 3 RPM headroom).
        # OpenAI tier-1: 500 RPM → no meaningful delay needed.
        if not env.get("APPLYPILOT_LLM_DELAY"):
            has_local  = bool(env.get("LLM_URL"))
            has_gemini = bool(env.get("GEMINI_API_KEY"))
            has_openai = bool(env.get("OPENAI_API_KEY"))
            if has_local:
                env["APPLYPILOT_LLM_DELAY"] = "0"
            elif has_gemini:
                env["APPLYPILOT_LLM_DELAY"] = "5"   # 12 RPM — 3 RPM headroom vs 15 RPM limit
            elif has_openai:
                env["APPLYPILOT_LLM_DELAY"] = "0.5" # tier-1 is generous
            else:
                env["APPLYPILOT_LLM_DELAY"] = "0"

        return env

    def _run_cmd(self, cmd: list[str]) -> int:
        """Run a command, stream output to log buffer, return exit code."""
        env = self._make_env()
        try:
            self._proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                env=env,
            )
            for line in self._proc.stdout:
                self._append_log(line.rstrip())
            self._proc.wait()
            return self._proc.returncode or 0
        except FileNotFoundError:
            self._append_log(f"[ERROR] Command not found: {cmd[0]}")
            self._append_log("[ERROR] Is applypilot installed? Run: pip install applypilot")
            return 1
        except Exception as e:
            self._append_log(f"[ERROR] {e}")
            return 1

    # Columns each stage uses to find unprocessed jobs.
    # A sentinel value here blocks that job from being picked up.
    _STAGE_FILTER: dict = {
        "score":  ("fit_score",           -9999),
        "enrich": ("full_description",     "__FILTERED__"),
        "tailor": ("tailored_resume_path", "__FILTERED__"),
        "cover":  ("cover_letter_path",    "__FILTERED__"),
    }

    def _clear_sentinels(self) -> None:
        """Remove any stale sentinel values left by a previously interrupted run.

        Called at the start of every pipeline run. Guards against server
        restarts or kill-9 that skip the finally-block cleanup in _unblock_non_selected,
        which would leave jobs permanently stuck with non-NULL sentinel values and
        silently skipped by score/tailor/cover on all future runs.
        """
        db_path = self.user_dir / "applypilot.db"
        if not db_path.exists():
            return
        conn = sqlite3.connect(str(db_path))
        cleared = 0
        try:
            cur = conn.execute("UPDATE jobs SET fit_score = NULL WHERE fit_score = -9999")
            cleared += cur.rowcount
            for col in ("full_description", "tailored_resume_path", "cover_letter_path"):
                cur = conn.execute(f"UPDATE jobs SET {col} = NULL WHERE {col} = '__FILTERED__'")
                cleared += cur.rowcount
            conn.commit()
        finally:
            conn.close()
        if cleared:
            self._append_log(
                f"[ApplyPilot Server] Cleared {cleared} stale filter sentinel(s) from a previous interrupted run."
            )

    def _block_non_selected(self, stages: list[str], url_filter: list[str]) -> list[tuple[str, str]]:
        """Set sentinel values on non-selected jobs so the CLI skips them.
        Returns (column, url) pairs that must be restored afterward."""
        db_path = self.user_dir / "applypilot.db"
        if not db_path.exists() or not url_filter:
            return []

        effective = list(self._STAGE_FILTER) if "all" in stages else [
            s for s in stages if s in self._STAGE_FILTER
        ]
        if not effective:
            return []

        conn = sqlite3.connect(str(db_path))
        blocked: list[tuple[str, str]] = []
        ph = ",".join("?" * len(url_filter))
        try:
            for stage in effective:
                col, sentinel = self._STAGE_FILTER[stage]
                rows = conn.execute(
                    f"SELECT url FROM jobs WHERE {col} IS NULL AND url NOT IN ({ph})",
                    url_filter,
                ).fetchall()
                urls = [r[0] for r in rows]
                if urls:
                    uh = ",".join("?" * len(urls))
                    conn.execute(
                        f"UPDATE jobs SET {col} = ? WHERE url IN ({uh})",
                        [sentinel] + urls,
                    )
                    blocked.extend((col, u) for u in urls)
            conn.commit()
        finally:
            conn.close()

        self._append_log(
            f"[ApplyPilot Server] URL filter active: {len(url_filter)} selected, "
            f"{len(blocked)} non-selected jobs temporarily blocked."
        )
        return blocked

    def _unblock_non_selected(self, blocked: list[tuple[str, str]]) -> None:
        """Restore sentinel values back to NULL."""
        if not blocked:
            return
        db_path = self.user_dir / "applypilot.db"
        if not db_path.exists():
            return
        conn = sqlite3.connect(str(db_path))
        by_col: dict[str, list[str]] = {}
        for col, url in blocked:
            by_col.setdefault(col, []).append(url)
        try:
            for col, urls in by_col.items():
                ph = ",".join("?" * len(urls))
                conn.execute(f"UPDATE jobs SET {col} = NULL WHERE url IN ({ph})", urls)
            conn.commit()
        finally:
            conn.close()
        self._append_log("[ApplyPilot Server] URL filter restored.")

    def run_pipeline(
        self,
        stages: list[str],
        min_score: int = 7,
        workers: int = 1,
        validation: str = "normal",
        url_filter: list[str] = None,
    ):
        """Run pipeline stages in a background thread."""
        self._running = True
        self._logs = []
        self.started_at = datetime.now(timezone.utc).isoformat()

        blocked: list[tuple[str, str]] = []
        has_llm = any(s in self._LLM_STAGES for s in stages)
        try:
            # Clean up any sentinels left by a previously interrupted URL-filtered run
            self._clear_sentinels()

            self._append_log(f"[ApplyPilot Server] Starting pipeline: {stages}")
            self._append_log(f"[ApplyPilot Server] User dir: {self.user_dir}")
            self._append_log(f"[ApplyPilot Server] Min score: {min_score} | Workers: {workers}")
            if url_filter:
                self._append_log(f"[ApplyPilot Server] Job filter: {len(url_filter)} URL(s)")
            self._append_log("")

            # Gemini free tier: enforce rolling-window cooldown between runs
            env_check = self._make_env()
            if env_check.get("GEMINI_API_KEY") and not env_check.get("LLM_URL"):
                self._gemini_startup_wait(stages)

            # Block non-selected jobs before running
            if url_filter:
                blocked = self._block_non_selected(stages, url_filter)

            cmd = [
                "applypilot", "run",
                "--min-score", str(min_score),
                "--workers", str(workers),
                "--validation", validation,
            ]
            if "all" not in stages:
                cmd.extend(stages)

            self.current_stage = "running"
            rc = self._run_cmd(cmd)

            if rc == 0:
                self._append_log("")
                self._append_log("[ApplyPilot Server] Pipeline completed successfully.")
            else:
                self._append_log("")
                self._append_log(f"[ApplyPilot Server] Pipeline exited with code {rc}")

        except Exception as e:
            self._append_log(f"[ApplyPilot Server] Unexpected error: {e}")
        finally:
            # Always restore blocked jobs even if pipeline crashed
            self._unblock_non_selected(blocked)
            # Record completion time so next run can compute cooldown
            if has_llm:
                self._write_cooldown()
            self._running = False
            self.current_stage = None


# ---------------------------------------------------------------------------
# Database helpers — read user's applypilot.db directly
# ---------------------------------------------------------------------------

def _get_db(user_dir: Path) -> Optional[sqlite3.Connection]:
    db_path = user_dir / "applypilot.db"
    if not db_path.exists():
        return None
    conn = sqlite3.connect(str(db_path), timeout=5)
    conn.row_factory = sqlite3.Row
    return conn


def get_stats_for_user(user_dir: Path) -> dict:
    conn = _get_db(user_dir)
    if not conn:
        from models import StatusResponse, StageStats
        return StatusResponse(stats=StageStats(), setup_complete=False).model_dump()

    profile_exists = (user_dir / "profile.json").exists()
    resume_exists = (user_dir / "resume.txt").exists()

    def q(sql, params=()):
        try:
            return conn.execute(sql, params).fetchone()[0]
        except Exception:
            return 0

    def qall(sql, params=()):
        try:
            return conn.execute(sql, params).fetchall()
        except Exception:
            return []

    stats = {
        "total": q("SELECT COUNT(*) FROM jobs"),
        "with_description": q("SELECT COUNT(*) FROM jobs WHERE full_description IS NOT NULL"),
        "scored": q("SELECT COUNT(*) FROM jobs WHERE fit_score IS NOT NULL"),
        "tailored": q("SELECT COUNT(*) FROM jobs WHERE tailored_resume_path IS NOT NULL"),
        "with_cover_letter": q("SELECT COUNT(*) FROM jobs WHERE cover_letter_path IS NOT NULL"),
        "applied": q("SELECT COUNT(*) FROM jobs WHERE applied_at IS NOT NULL"),
        "ready_to_apply": q(
            "SELECT COUNT(*) FROM jobs "
            "WHERE tailored_resume_path IS NOT NULL AND applied_at IS NULL "
            "AND application_url IS NOT NULL"
        ),
        "score_distribution": [
            (row[0], row[1])
            for row in qall(
                "SELECT fit_score, COUNT(*) FROM jobs "
                "WHERE fit_score IS NOT NULL "
                "GROUP BY fit_score ORDER BY fit_score DESC"
            )
        ],
        "by_site": [
            (row[0] or "Unknown", row[1])
            for row in qall(
                "SELECT site, COUNT(*) FROM jobs GROUP BY site ORDER BY COUNT(*) DESC"
            )
        ],
    }

    conn.close()

    from models import StatusResponse, StageStats
    return StatusResponse(
        stats=StageStats(**stats),
        setup_complete=profile_exists and resume_exists,
    ).model_dump()


def list_jobs_for_user(user_dir: Path, stage: str = "discovered", limit: int = 50) -> list[dict]:
    conn = _get_db(user_dir)
    if not conn:
        return []

    conditions = {
        "discovered": "1=1",
        "enriched": "full_description IS NOT NULL",
        "scored": "fit_score IS NOT NULL",
        "tailored": "tailored_resume_path IS NOT NULL",
        "applied": "applied_at IS NOT NULL",
        "ready": "tailored_resume_path IS NOT NULL AND applied_at IS NULL AND application_url IS NOT NULL",
    }
    where = conditions.get(stage, "1=1")

    try:
        rows = conn.execute(
            f"SELECT url, title, location, site, salary, fit_score, "
            f"apply_status, applied_at, apply_attempts, "
            f"tailored_resume_path, cover_letter_path, discovered_at, "
            f"(full_description IS NOT NULL) AS has_description, "
            f"(application_url IS NOT NULL) AS has_apply_url "
            f"FROM jobs WHERE {where} "
            f"ORDER BY fit_score DESC NULLS LAST, discovered_at DESC "
            f"LIMIT ?",
            (limit,),
        ).fetchall()
        result = [dict(row) for row in rows]
        conn.close()
        return result
    except Exception:
        conn.close()
        return []
