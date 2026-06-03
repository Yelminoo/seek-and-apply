"""
JobRunner: wraps ApplyPilot CLI as a subprocess per user.

Each user gets their own APPLYPILOT_DIR so data is fully isolated.
Logs are buffered in memory and streamed via SSE.
"""

import json as _json
import os
import sqlite3
import subprocess
import threading
import time
import urllib.error
import urllib.request
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

    def _wait_for_gemini_quota(self, stages: list[str]) -> None:
        """Guarantee Gemini quota is available before the CLI makes its first call.

        Two layers:
        1. File-based fast path: if the last LLM run finished <75s ago, wait
           out the remainder without spending a request.
        2. Quota probe: send a 1-token request. 200 → proceed immediately.
           429 → wait 65s and probe again (loop until success or pipeline stopped).

        Layer 2 is the critical one: it handles server restarts, first-ever runs,
        and cases where the cooldown file is stale. Prevents 190 seconds of
        guaranteed-to-fail internal applypilot retries (10+20+40+60+60s backoff).
        """
        if not any(s in self._LLM_STAGES for s in stages):
            return
        env = self._make_env()
        if not env.get("GEMINI_API_KEY") or env.get("LLM_URL"):
            return  # local LLM or no key — skip

        # Layer 1: file-based cooldown (no request cost)
        last = self._read_cooldown()
        if last is not None:
            elapsed = time.time() - last
            if elapsed < 75:
                wait = int(75 - elapsed)
                self._append_log(
                    f"[Rate limit] Gemini cooldown: last run was {int(elapsed)}s ago, "
                    f"waiting {wait}s to clear the 60s rolling window..."
                )
                for remaining in range(wait, 0, -5):
                    if not self._running:
                        return
                    self._append_log(f"[Rate limit] Starting in {remaining}s...")
                    time.sleep(min(5, remaining))

        # Layer 2: live quota probe (costs 1 request, confirms quota is ready)
        model   = env.get("LLM_MODEL", "gemini-2.0-flash")
        api_key = env["GEMINI_API_KEY"]
        probe_url = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
        payload = _json.dumps({
            "model": model,
            "messages": [{"role": "user", "content": "1"}],
            "max_tokens": 1,
        }).encode()
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        }

        attempt = 0
        while self._running:
            try:
                req = urllib.request.Request(probe_url, data=payload, headers=headers, method="POST")
                with urllib.request.urlopen(req, timeout=15):
                    pass
                if attempt > 0:
                    self._append_log("[Rate limit] Gemini quota available — starting pipeline.")
                return  # 200 OK: quota confirmed
            except urllib.error.HTTPError as e:
                if e.code != 429:
                    return  # auth error or other — let CLI surface it
                attempt += 1
                self._append_log(
                    f"[Rate limit] Gemini quota probe: 429 (attempt {attempt}). "
                    f"Waiting 65s for the rolling window to clear..."
                )
                for remaining in range(65, 0, -5):
                    if not self._running:
                        return
                    self._append_log(f"[Rate limit] Probe retry in {remaining}s...")
                    time.sleep(min(5, remaining))
            except Exception:
                return  # network error — let CLI proceed and handle it

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
                env["APPLYPILOT_LLM_DELAY"] = "5"
            elif has_openai:
                env["APPLYPILOT_LLM_DELAY"] = "0.5"
            else:
                env["APPLYPILOT_LLM_DELAY"] = "0"

        # Force plain-text output from Rich so logs are readable in our pipe.
        # Without these, Rich renders box-drawing characters and ANSI codes.
        env["NO_COLOR"]          = "1"
        env["TERM"]              = "dumb"
        env["PYTHONIOENCODING"]  = "utf-8"
        env["PYTHONUNBUFFERED"]  = "1"

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
        """Remove stale sentinels and reset LLM-error scores so they re-queue.

        Called at the start of every pipeline run.
        - Sentinel values (-9999 / __FILTERED__) are left by interrupted
          URL-filtered runs when the server is killed before the finally block.
        - fit_score=0 with an LLM error in score_reasoning means the API call
          failed (e.g. 429). applypilot stores 0 instead of NULL, which
          permanently prevents re-scoring and re-tailoring. Reset to NULL so
          the score stage picks them up again.
        """
        db_path = self.user_dir / "applypilot.db"
        if not db_path.exists():
            return
        conn = sqlite3.connect(str(db_path))
        cleared = 0
        failed_reset = 0
        try:
            cur = conn.execute("UPDATE jobs SET fit_score = NULL WHERE fit_score = -9999")
            cleared += cur.rowcount
            for col in ("full_description", "tailored_resume_path", "cover_letter_path"):
                cur = conn.execute(f"UPDATE jobs SET {col} = NULL WHERE {col} = '__FILTERED__'")
                cleared += cur.rowcount
            # Reset jobs where scoring failed with an LLM error (API 429, timeout, etc.)
            # score_reasoning stores the raw error string in these cases
            cur = conn.execute(
                "UPDATE jobs SET fit_score = NULL, score_reasoning = NULL "
                "WHERE fit_score = 0 AND score_reasoning LIKE '%LLM error%'"
            )
            failed_reset = cur.rowcount
            conn.commit()
        finally:
            conn.close()
        if cleared:
            self._append_log(
                f"[ApplyPilot Server] Cleared {cleared} stale filter sentinel(s) from a previous interrupted run."
            )
        if failed_reset:
            self._append_log(
                f"[ApplyPilot Server] Reset {failed_reset} job(s) with score=0 (LLM API error) → will be re-scored."
            )

    def _log_db_summary(self, stages: list[str], min_score: int) -> None:
        """Log eligible job counts for each requested stage before the CLI runs.

        Makes it immediately obvious when a stage will process 0 jobs and why
        (e.g. no scored jobs → tailor finds nothing, or all jobs already tailored).
        """
        db_path = self.user_dir / "applypilot.db"
        if not db_path.exists():
            return
        conn = sqlite3.connect(str(db_path))

        def q(sql):
            try:
                return conn.execute(sql).fetchone()[0]
            except Exception:
                return "?"

        try:
            total   = q("SELECT COUNT(*) FROM jobs")
            scored  = q("SELECT COUNT(*) FROM jobs WHERE fit_score IS NOT NULL AND fit_score != -9999")
            above   = q(f"SELECT COUNT(*) FROM jobs WHERE fit_score >= {min_score}")
            tailored = q("SELECT COUNT(*) FROM jobs WHERE tailored_resume_path IS NOT NULL AND tailored_resume_path != '__FILTERED__'")
            covered = q("SELECT COUNT(*) FROM jobs WHERE cover_letter_path IS NOT NULL AND cover_letter_path != '__FILTERED__'")
            enriched = q("SELECT COUNT(*) FROM jobs WHERE full_description IS NOT NULL AND full_description != '__FILTERED__'")

            self._append_log(f"[ApplyPilot Server] DB: {total} jobs, {enriched} pending enrichment")

            run_all = "all" in stages
            if run_all or "score" in stages:
                pending_score = q("SELECT COUNT(*) FROM jobs WHERE fit_score IS NULL")
                self._append_log(f"[ApplyPilot Server]   score  → {pending_score} pending (of {total} total)")

            if run_all or "tailor" in stages:
                pending_tailor = q(
                    f"SELECT COUNT(*) FROM jobs "
                    f"WHERE fit_score >= {min_score} AND tailored_resume_path IS NULL"
                )
                self._append_log(
                    f"[ApplyPilot Server]   tailor → {pending_tailor} pending "
                    f"(scored≥{min_score}: {above}, already tailored: {tailored})"
                )

            if run_all or "cover" in stages:
                pending_cover = q(
                    f"SELECT COUNT(*) FROM jobs "
                    f"WHERE fit_score >= {min_score} AND cover_letter_path IS NULL"
                )
                self._append_log(
                    f"[ApplyPilot Server]   cover  → {pending_cover} pending "
                    f"(scored≥{min_score}: {above}, already covered: {covered})"
                )
        finally:
            conn.close()

        self._append_log("=" * 70)

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

    def _find_error_scored_urls(self) -> list[str]:
        """Return URLs of jobs that have fit_score=0 due to LLM API errors."""
        db_path = self.user_dir / "applypilot.db"
        if not db_path.exists():
            return []
        conn = sqlite3.connect(str(db_path))
        try:
            rows = conn.execute(
                "SELECT url FROM jobs WHERE fit_score = 0 AND score_reasoning LIKE '%LLM error%'"
            ).fetchall()
            return [r[0] for r in rows]
        finally:
            conn.close()

    def _reset_error_scores(self, urls: list[str]) -> None:
        """Set fit_score back to NULL for failed jobs so they re-queue."""
        if not urls:
            return
        db_path = self.user_dir / "applypilot.db"
        conn = sqlite3.connect(str(db_path))
        ph = ",".join("?" * len(urls))
        try:
            conn.execute(
                f"UPDATE jobs SET fit_score = NULL, score_reasoning = NULL WHERE url IN ({ph})",
                urls,
            )
            conn.commit()
        finally:
            conn.close()

    def _score_retry_loop(
        self,
        min_score: int,
        workers: int,
        validation: str,
        max_retries: int = 3,
    ) -> None:
        """After main pipeline, retry any jobs that failed scoring due to API errors.

        Resets failed jobs to NULL, waits for the Gemini rate-limit window to
        clear, then re-runs the score stage scoped to only those URLs. Repeats
        up to max_retries times or until no failures remain.
        """
        env = self._make_env()
        is_gemini = bool(env.get("GEMINI_API_KEY")) and not env.get("LLM_URL")

        for attempt in range(1, max_retries + 1):
            if not self._running:
                return

            failed_urls = self._find_error_scored_urls()
            if not failed_urls:
                return

            self._append_log("")
            self._append_log(
                f"[ApplyPilot Server] {len(failed_urls)} job(s) failed scoring (API error). "
                f"Retry {attempt}/{max_retries}."
            )

            # Reset failed scores to NULL so score stage picks them up
            self._reset_error_scores(failed_urls)

            if not self._running:
                return

            # Probe quota before re-running (reuses the same layer-1+2 probe)
            self._wait_for_gemini_quota(["score"])
            if not self._running:
                return

            # Scope the retry to only the failed URLs
            blocked = self._block_non_selected(["score"], failed_urls)
            try:
                cmd = [
                    "applypilot", "run",
                    "--min-score", str(min_score),
                    "--workers", str(workers),
                    "--validation", validation,
                    "score",
                ]
                rc = self._run_cmd(cmd)
                if rc != 0:
                    self._append_log(f"[ApplyPilot Server] Score retry {attempt} exited with code {rc}")
                else:
                    self._append_log(f"[ApplyPilot Server] Score retry {attempt} completed.")
            finally:
                self._unblock_non_selected(blocked)

            if is_gemini:
                self._write_cooldown()

        # Final check — report any still-failing jobs
        still_failed = self._find_error_scored_urls()
        if still_failed:
            self._append_log(
                f"[ApplyPilot Server] ⚠ {len(still_failed)} job(s) still failed after {max_retries} retries. "
                f"They will be reset and retried on the next pipeline run."
            )
            self._reset_error_scores(still_failed)

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
        run_score = "all" in stages or "score" in stages
        try:
            # Clean up any sentinels left by a previously interrupted URL-filtered run
            self._clear_sentinels()

            self._append_log(f"[ApplyPilot Server] Starting pipeline: {stages}")
            self._append_log(f"[ApplyPilot Server] User dir: {self.user_dir}")
            self._append_log(f"[ApplyPilot Server] Min score: {min_score} | Workers: {workers}")
            if url_filter:
                self._append_log(f"[ApplyPilot Server] Job filter: {len(url_filter)} URL(s)")
            self._append_log("")

            # Probe Gemini quota before handing off to the CLI
            self._wait_for_gemini_quota(stages)

            # Log eligible job counts so the user can see exactly what each stage will process
            self._log_db_summary(stages, min_score)

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

            # Auto-retry any jobs that failed scoring due to API errors (429, timeout, etc.)
            if run_score and self._running:
                self._score_retry_loop(min_score, workers, validation)

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


    def run_apply(
        self,
        limit: int = 5,
        min_score: int = 7,
        workers: int = 1,
        model: str = "sonnet",
        dry_run: bool = False,
        headless: bool = True,
        url_filter: list = None,
    ):
        """Run the auto-apply stage (Claude Code + Chrome + Playwright MCP).

        If url_filter is provided, applies only to those specific URLs
        using `applypilot apply --url <url>` for each one.
        """
        self._running = True
        self._logs = []
        self.started_at = datetime.now(timezone.utc).isoformat()

        def _base_flags():
            flags = ["--model", model]
            if dry_run:   flags.append("--dry-run")
            if headless:  flags.append("--headless")
            return flags

        def _check_tailored(urls):
            """Return which of the given URLs have tailored resumes."""
            db_path = self.user_dir / "applypilot.db"
            if not db_path.exists():
                return []
            conn = sqlite3.connect(str(db_path))
            try:
                ph = ",".join("?" * len(urls))
                rows = conn.execute(
                    f"SELECT url, tailored_resume_path, application_url FROM jobs WHERE url IN ({ph})",
                    urls,
                ).fetchall()
                return rows
            finally:
                conn.close()

        def _apply_result_summary(urls_before_statuses):
            """Read DB after apply run and log what changed per URL."""
            db_path = self.user_dir / "applypilot.db"
            if not db_path.exists():
                return
            conn = sqlite3.connect(str(db_path))
            try:
                ph = ",".join("?" * len(urls_before_statuses))
                rows = conn.execute(
                    f"SELECT url, title, apply_status, apply_error, apply_attempts FROM jobs WHERE url IN ({ph})",
                    list(urls_before_statuses.keys()),
                ).fetchall()
                applied = failed = skipped = 0
                self._append_log("[ApplyPilot Server] ─── Result summary ───────────────────────")
                for url, title, status, error, attempts in rows:
                    prev = urls_before_statuses.get(url)
                    label = (title or url)[:55]
                    if status == "applied":
                        self._append_log(f"  ✓  APPLIED    {label}")
                        applied += 1
                    elif status == "failed":
                        self._append_log(f"  ✗  FAILED     {label} — {error or 'unknown'}")
                        failed += 1
                    elif status == "captcha":
                        self._append_log(f"  ⚠  CAPTCHA    {label}")
                        failed += 1
                    elif status == "manual":
                        self._append_log(f"  ⊘  MANUAL ATS {label} — needs human")
                        skipped += 1
                    elif status == prev or status is None:
                        self._append_log(f"  –  NO CHANGE  {label} — job may not be tailored yet")
                        skipped += 1
                    else:
                        self._append_log(f"  ?  {status.upper():<10} {label}")
                        skipped += 1
                self._append_log(
                    f"[ApplyPilot Server] Applied: {applied} | Failed/CAPTCHA: {failed} | Skipped: {skipped}"
                )
                if skipped > 0 and applied == 0:
                    self._append_log(
                        "[ApplyPilot Server] ⚠ Nothing was applied. Common reasons:"
                    )
                    self._append_log("[ApplyPilot Server]   • Job doesn't have a tailored resume yet — run score → tailor → pdf first")
                    self._append_log("[ApplyPilot Server]   • Job is on a blocked/CAPTCHA-heavy site")
                    self._append_log("[ApplyPilot Server]   • Job listing has expired")
            finally:
                conn.close()

        try:
            self._append_log("[ApplyPilot Server] Starting auto-apply agent")
            self._append_log(f"[ApplyPilot Server] User dir: {self.user_dir}")
            if url_filter:
                self._append_log(f"[ApplyPilot Server] Targeted apply: {len(url_filter)} selected job(s)")
            else:
                self._append_log(f"[ApplyPilot Server] Limit: {limit} | Min score: {min_score} | Model: {model}")
            if dry_run:
                self._append_log("[ApplyPilot Server] DRY RUN — will not actually submit forms")
            self._append_log("")

            self.current_stage = "apply"

            if url_filter:
                targets = url_filter[:limit] if limit else url_filter
                total = len(targets)

                # Pre-flight: warn about jobs without tailored resumes
                rows = _check_tailored(targets)
                not_tailored = [r[0] for r in rows if not r[1]]
                not_ready    = [r[0] for r in rows if not r[2]]
                if not_tailored:
                    self._append_log(
                        f"[ApplyPilot Server] ⚠ {len(not_tailored)}/{total} selected jobs have NO tailored resume. "
                        f"Run score → tailor → pdf first."
                    )
                if not_ready:
                    self._append_log(
                        f"[ApplyPilot Server] ⚠ {len(not_ready)}/{total} selected jobs have no apply URL — enrich stage needed."
                    )
                self._append_log("")

                # Record status before running so we can diff after
                prev_statuses = {r[0]: None for r in rows}

                for i, url in enumerate(targets, 1):
                    if not self._running:
                        break
                    self._append_log(f"[ApplyPilot Server] [{i}/{total}] → {url[:80]}")
                    cmd = ["applypilot", "apply", "--url", url] + _base_flags()
                    self._run_cmd(cmd)
                    self._append_log("")

                _apply_result_summary(prev_statuses)

            else:
                cmd = [
                    "applypilot", "apply",
                    "--limit",     str(limit),
                    "--min-score", str(min_score),
                    "--workers",   str(workers),
                ] + _base_flags()
                rc = self._run_cmd(cmd)
                self._append_log("")
                if rc == 0:
                    self._append_log("[ApplyPilot Server] Auto-apply finished.")
                else:
                    self._append_log(f"[ApplyPilot Server] Auto-apply exited with code {rc}")

        except Exception as e:
            self._append_log(f"[ApplyPilot Server] Unexpected error: {e}")
        finally:
            self._running = False
            self.current_stage = None


def check_apply_prereqs(user_dir: Path, min_score: int = 1) -> dict:
    """Check whether auto-apply can run: Claude CLI, Chrome, available jobs."""
    import shutil

    claude_path = shutil.which("claude")
    claude_ok   = claude_path is not None

    chrome_candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        "/usr/bin/google-chrome", "/usr/bin/chromium-browser",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ]
    chrome_ok = any(Path(p).exists() for p in chrome_candidates)

    tailored = ready = ready_any_score = applied = failed = 0
    max_score = min_available_score = None
    db_path = user_dir / "applypilot.db"
    if db_path.exists():
        conn = sqlite3.connect(str(db_path))
        try:
            tailored = conn.execute(
                "SELECT COUNT(*) FROM jobs WHERE tailored_resume_path IS NOT NULL"
            ).fetchone()[0]
            # Jobs ready at the requested threshold
            ready = conn.execute(
                "SELECT COUNT(*) FROM jobs "
                "WHERE tailored_resume_path IS NOT NULL "
                "AND application_url IS NOT NULL "
                "AND (apply_status IS NULL OR apply_status = 'failed') "
                "AND (fit_score IS NULL OR fit_score >= ?)",
                (min_score,),
            ).fetchone()[0]
            # Jobs ready at ANY score (so we can warn about threshold mismatch)
            ready_any_score = conn.execute(
                "SELECT COUNT(*) FROM jobs "
                "WHERE tailored_resume_path IS NOT NULL "
                "AND application_url IS NOT NULL "
                "AND (apply_status IS NULL OR apply_status = 'failed')"
            ).fetchone()[0]
            # Lowest available score among tailored jobs
            row = conn.execute(
                "SELECT MIN(fit_score), MAX(fit_score) FROM jobs "
                "WHERE tailored_resume_path IS NOT NULL AND fit_score IS NOT NULL"
            ).fetchone()
            if row and row[0] is not None:
                min_available_score, max_score = row[0], row[1]
            applied = conn.execute(
                "SELECT COUNT(*) FROM jobs WHERE apply_status = 'applied'"
            ).fetchone()[0]
            failed = conn.execute(
                "SELECT COUNT(*) FROM jobs WHERE apply_status = 'failed'"
            ).fetchone()[0]
        finally:
            conn.close()

    threshold_warning = (
        ready == 0 and ready_any_score > 0 and min_available_score is not None
        and min_available_score < min_score
    )

    return {
        "claude_ok":          claude_ok,
        "claude_path":        claude_path,
        "chrome_ok":          chrome_ok,
        "tailored":           tailored,
        "ready":              ready,
        "ready_any_score":    ready_any_score,
        "applied":            applied,
        "failed":             failed,
        "min_available_score": min_available_score,
        "max_score":           max_score,
        "threshold_warning":  threshold_warning,
        "can_run":            claude_ok and chrome_ok and (ready > 0 or ready_any_score > 0),
    }


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
