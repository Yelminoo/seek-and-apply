"""
ApplyPilot Server — multi-user FastAPI wrapper around the ApplyPilot CLI.

Each user gets an isolated data directory: DATA_ROOT/{user_id}/
Pipeline stages run as subprocesses with APPLYPILOT_DIR pointed at that directory.
"""

import asyncio
import json
import os
import shutil
import subprocess
import uuid
from pathlib import Path
from typing import AsyncGenerator

from fastapi import (
    BackgroundTasks, Depends, FastAPI, File, HTTPException,
    Query, UploadFile, status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse

from auth import create_token, get_current_user, hash_password, verify_password
from models import (
    ApplyRunRequest, JobRow, LoginRequest, PipelineRunRequest, ProfileIn,
    RegisterRequest, StatusResponse, TokenResponse, UserOut,
)
from runner import JobRunner, check_apply_prereqs, get_stats_for_user, list_jobs_for_user
import tracker as tracker_module
from tracker import router as tracker_router

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DATA_ROOT = Path(os.environ.get("APPLYPILOT_DATA", Path.home() / ".applypilot-server" / "users"))
USERS_DB = Path(os.environ.get("APPLYPILOT_DATA", Path.home() / ".applypilot-server")) / "users.json"
DATA_ROOT.mkdir(parents=True, exist_ok=True)
USERS_DB.parent.mkdir(parents=True, exist_ok=True)

# Inject DATA_ROOT into tracker module
tracker_module.DATA_ROOT = DATA_ROOT

app = FastAPI(title="ApplyPilot Server", version="1.0.0")
app.include_router(tracker_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory user store backed by a JSON file (simple, no DB dep required)
def _load_users() -> dict:
    if USERS_DB.exists():
        return json.loads(USERS_DB.read_text(encoding="utf-8"))
    return {}

def _save_users(users: dict) -> None:
    USERS_DB.write_text(json.dumps(users, indent=2), encoding="utf-8")

# Active runners: user_id -> JobRunner
_runners: dict[str, JobRunner] = {}

# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------

@app.post("/auth/register", response_model=TokenResponse)
def register(req: RegisterRequest):
    users = _load_users()
    if req.username in users:
        raise HTTPException(status_code=400, detail="Username already taken")

    user_id = str(uuid.uuid4())
    users[req.username] = {
        "id": user_id,
        "username": req.username,
        "password_hash": hash_password(req.password),
    }
    _save_users(users)

    # Bootstrap user data directory
    user_dir = DATA_ROOT / user_id
    user_dir.mkdir(parents=True, exist_ok=True)

    token = create_token({"sub": req.username, "uid": user_id})
    return TokenResponse(access_token=token, username=req.username, user_id=user_id)


@app.post("/auth/login", response_model=TokenResponse)
def login(req: LoginRequest):
    users = _load_users()
    user = users.get(req.username)
    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_token({"sub": req.username, "uid": user["id"]})
    return TokenResponse(
        access_token=token,
        username=req.username,
        user_id=user["id"],
    )


@app.get("/auth/me", response_model=UserOut)
def me(current_user: dict = Depends(get_current_user)):
    return UserOut(username=current_user["username"], user_id=current_user["uid"])


# ---------------------------------------------------------------------------
# Setup routes (profile, resume, .env)
# ---------------------------------------------------------------------------

@app.get("/setup/status")
def setup_status(current_user: dict = Depends(get_current_user)):
    """Return what's been configured for this user."""
    uid = current_user["uid"]
    user_dir = DATA_ROOT / uid

    profile_path = user_dir / "profile.json"
    resume_txt = user_dir / "resume.txt"
    resume_pdf = user_dir / "resume.pdf"
    env_path = user_dir / ".env"
    searches_path = user_dir / "searches.yaml"

    env_keys = {}
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                env_keys[k.strip()] = bool(v.strip())

    return {
        "has_profile": profile_path.exists(),
        "has_resume_txt": resume_txt.exists(),
        "has_resume_pdf": resume_pdf.exists(),
        "has_searches": searches_path.exists(),
        "env_keys": env_keys,
        "profile": json.loads(profile_path.read_text(encoding="utf-8")) if profile_path.exists() else None,
    }


@app.post("/setup/profile")
def save_profile(profile: ProfileIn, current_user: dict = Depends(get_current_user)):
    uid = current_user["uid"]
    user_dir = DATA_ROOT / uid
    user_dir.mkdir(parents=True, exist_ok=True)
    profile_path = user_dir / "profile.json"
    profile_path.write_text(json.dumps(profile.model_dump(), indent=2), encoding="utf-8")
    return {"ok": True}


@app.post("/setup/resume")
async def upload_resume(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    uid = current_user["uid"]
    user_dir = DATA_ROOT / uid
    user_dir.mkdir(parents=True, exist_ok=True)

    content = await file.read()
    ext = Path(file.filename or "resume.pdf").suffix.lower()

    if ext == ".pdf":
        (user_dir / "resume.pdf").write_bytes(content)
        # Try to extract text using pdfminer if available
        try:
            from pdfminer.high_level import extract_text
            import io
            text = extract_text(io.BytesIO(content))
            (user_dir / "resume.txt").write_text(text, encoding="utf-8")
        except Exception:
            pass
        return {"ok": True, "type": "pdf"}

    elif ext in (".txt", ".md"):
        (user_dir / "resume.txt").write_text(content.decode("utf-8", errors="replace"), encoding="utf-8")
        return {"ok": True, "type": "text"}

    raise HTTPException(status_code=400, detail="Upload a .pdf or .txt resume")


@app.post("/setup/env")
def save_env(
    data: dict,
    current_user: dict = Depends(get_current_user),
):
    """Save API keys to the user's .env file."""
    uid = current_user["uid"]
    user_dir = DATA_ROOT / uid
    user_dir.mkdir(parents=True, exist_ok=True)

    allowed_keys = {"GEMINI_API_KEY", "OPENAI_API_KEY", "LLM_URL", "LLM_MODEL", "CAPSOLVER_API_KEY"}
    lines = []
    for key in allowed_keys:
        val = data.get(key, "")
        if val:
            lines.append(f"{key}={val}")

    (user_dir / ".env").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return {"ok": True}


@app.post("/setup/searches")
def save_searches(
    data: dict,
    current_user: dict = Depends(get_current_user),
):
    """Save searches.yaml content."""
    import yaml
    uid = current_user["uid"]
    user_dir = DATA_ROOT / uid
    content = data.get("yaml", "")
    (user_dir / "searches.yaml").write_text(content, encoding="utf-8")
    return {"ok": True}


@app.get("/setup/searches")
def get_searches(current_user: dict = Depends(get_current_user)):
    uid = current_user["uid"]
    searches_path = DATA_ROOT / uid / "searches.yaml"
    if not searches_path.exists():
        # Return a sensible default
        default = """queries:
  - query: "software engineer"
    tier: 1
  - query: "backend engineer"
    tier: 2

locations:
  - location: "Remote"
    remote: true

location:
  accept_patterns:
    - "Remote"
    - "Anywhere"
    - "United States"
  reject_patterns: []

country: "USA"

sites:
  - indeed
  - linkedin

defaults:
  results_per_site: 50
  hours_old: 72

exclude_titles:
  - "intern"
  - "internship"
"""
        return {"yaml": default}
    return {"yaml": searches_path.read_text(encoding="utf-8")}


# ---------------------------------------------------------------------------
# Pipeline routes
# ---------------------------------------------------------------------------

@app.post("/pipeline/run")
def run_pipeline(
    req: PipelineRunRequest,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
):
    uid = current_user["uid"]
    user_dir = DATA_ROOT / uid

    # Validate user is set up
    if not (user_dir / "profile.json").exists():
        raise HTTPException(status_code=400, detail="Complete setup first (profile required)")
    if not (user_dir / "resume.txt").exists():
        raise HTTPException(status_code=400, detail="Upload resume first")

    # Kill existing runner for this user if running
    if uid in _runners and _runners[uid].is_running():
        raise HTTPException(status_code=409, detail="Pipeline already running. Stop it first.")

    runner = JobRunner(user_id=uid, user_dir=user_dir)
    _runners[uid] = runner
    background_tasks.add_task(runner.run_pipeline, req.stages, req.min_score, req.workers, req.validation, req.url_filter or None)

    return {"ok": True, "job_id": runner.job_id}


@app.post("/pipeline/stop")
def stop_pipeline(current_user: dict = Depends(get_current_user)):
    uid = current_user["uid"]
    runner = _runners.get(uid)
    if runner:
        runner.stop()
    return {"ok": True}


@app.get("/pipeline/status")
def pipeline_status(current_user: dict = Depends(get_current_user)):
    uid = current_user["uid"]
    runner = _runners.get(uid)
    return {
        "running": runner.is_running() if runner else False,
        "job_id": runner.job_id if runner else None,
        "stage": runner.current_stage if runner else None,
        "started_at": runner.started_at if runner else None,
    }


@app.get("/pipeline/logs")
async def stream_logs(
    current_user: dict = Depends(get_current_user),
    tail: int = Query(default=100),
):
    """SSE stream of pipeline logs for the current user."""
    uid = current_user["uid"]

    async def event_generator() -> AsyncGenerator[str, None]:
        runner = _runners.get(uid)
        if not runner:
            yield "data: No pipeline running\n\n"
            return

        sent = 0
        # Stream buffered logs first
        while True:
            logs = runner.get_logs()
            while sent < len(logs):
                line = logs[sent].rstrip()
                yield f"data: {line}\n\n"
                sent += 1
                await asyncio.sleep(0)

            if not runner.is_running() and sent >= len(logs):
                yield "data: [DONE]\n\n"
                break

            await asyncio.sleep(0.3)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# ---------------------------------------------------------------------------
# Jobs / stats routes
# ---------------------------------------------------------------------------

@app.get("/jobs", response_model=list[JobRow])
def list_jobs(
    stage: str = Query(default="discovered"),
    limit: int = Query(default=50),
    current_user: dict = Depends(get_current_user),
):
    uid = current_user["uid"]
    user_dir = DATA_ROOT / uid
    return list_jobs_for_user(user_dir, stage=stage, limit=limit)


@app.get("/stats", response_model=StatusResponse)
def get_stats(current_user: dict = Depends(get_current_user)):
    uid = current_user["uid"]
    user_dir = DATA_ROOT / uid
    return get_stats_for_user(user_dir)


def _job_file_response(user_dir: Path, job_url: str, column: str, preferred_suffix: str, media_type: str, fallback_suffix: str = ".txt"):
    """Shared helper: find a generated file for a job and return it as a download."""
    jobs = list_jobs_for_user(user_dir, stage="tailored", limit=2000)
    job = next((j for j in jobs if j.get("url") == job_url), None)
    if not job or not job.get(column):
        raise HTTPException(status_code=404, detail=f"{column} not found for this job")

    base = Path(job[column])
    preferred = base.with_suffix(preferred_suffix)
    fallback  = base.with_suffix(fallback_suffix)

    if preferred.exists():
        return FileResponse(str(preferred), media_type=media_type, filename=preferred.name)
    if fallback.exists():
        return FileResponse(str(fallback), media_type="text/plain; charset=utf-8", filename=fallback.name)
    raise HTTPException(status_code=404, detail=f"File not found (tried {preferred.name} and {fallback.name})")


@app.get("/jobs/{job_url:path}/resume")
def download_resume(job_url: str, current_user: dict = Depends(get_current_user)):
    """Download tailored resume — PDF if generated, otherwise .txt."""
    return _job_file_response(DATA_ROOT / current_user["uid"], job_url,
                              "tailored_resume_path", ".pdf", "application/pdf")


@app.get("/jobs/{job_url:path}/cover")
def download_cover(job_url: str, current_user: dict = Depends(get_current_user)):
    """Download cover letter — PDF if generated, otherwise .txt."""
    return _job_file_response(DATA_ROOT / current_user["uid"], job_url,
                              "cover_letter_path", ".pdf", "application/pdf")


@app.delete("/jobs/reset")
def reset_jobs(current_user: dict = Depends(get_current_user)):
    """Wipe the user's job database and start fresh."""
    uid = current_user["uid"]
    db_path = DATA_ROOT / uid / "applypilot.db"
    if db_path.exists():
        db_path.unlink()
    return {"ok": True}


@app.get("/apply/status")
def apply_status(
    min_score: int = Query(default=1),
    current_user: dict = Depends(get_current_user),
):
    """Check auto-apply prerequisites and available job counts."""
    uid = current_user["uid"]
    return check_apply_prereqs(DATA_ROOT / uid, min_score=min_score)


@app.post("/apply/run")
def run_apply(
    req: ApplyRunRequest,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
):
    uid = current_user["uid"]
    user_dir = DATA_ROOT / uid

    prereqs = check_apply_prereqs(user_dir)
    if not prereqs["claude_ok"]:
        raise HTTPException(status_code=400, detail="Claude CLI not found. Run: npm install -g @anthropic-ai/claude-code")
    if not prereqs["chrome_ok"]:
        raise HTTPException(status_code=400, detail="Chrome not found. Install Google Chrome on the server.")
    if prereqs["ready_any_score"] == 0 and not req.dry_run and not req.url_filter:
        raise HTTPException(status_code=400, detail="No jobs ready to apply to. Run tailor + pdf stages first.")

    if uid in _runners and _runners[uid].is_running():
        raise HTTPException(status_code=409, detail="Pipeline already running. Stop it first.")

    runner = JobRunner(user_id=uid, user_dir=user_dir)
    _runners[uid] = runner
    background_tasks.add_task(
        runner.run_apply, req.limit, req.min_score, req.workers,
        req.model, req.dry_run, req.headless, req.url_filter or None,
    )
    return {"ok": True, "job_id": runner.job_id}


@app.post("/jobs/mark-applied")
def mark_applied(data: dict, current_user: dict = Depends(get_current_user)):
    """Mark jobs as manually applied. Accepts channel + resume_version for tracker records."""
    import sqlite3 as _sqlite3
    from datetime import datetime, timedelta, timezone
    uid = current_user["uid"]
    db_path = DATA_ROOT / uid / "applypilot.db"
    urls: list = data.get("urls", [])
    if not urls or not db_path.exists():
        return {"marked": 0}

    channel        = data.get("channel", "portal")
    resume_version = data.get("resume_version", "original")
    now            = datetime.now(timezone.utc).isoformat()
    followup       = (datetime.now(timezone.utc) + timedelta(days=7)).date().isoformat()

    conn = _sqlite3.connect(str(db_path))
    conn.row_factory = _sqlite3.Row

    # Ensure tracker tables exist
    import tracker as _tracker
    _tracker._init_tables(conn)

    marked = 0
    for url in urls:
        # Update jobs table
        conn.execute(
            "UPDATE jobs SET apply_status='applied', applied_at=? WHERE url=? AND applied_at IS NULL",
            (now, url),
        )
        if conn.total_changes:
            marked += 1

        # Upsert pipeline record (stage='applied')
        existing = conn.execute("SELECT id FROM job_pipeline WHERE job_url=?", (url,)).fetchone()
        if existing:
            pid = existing["id"]
            conn.execute("UPDATE job_pipeline SET stage='applied', updated_at=? WHERE id=?", (now, pid))
        else:
            cur = conn.execute(
                "INSERT INTO job_pipeline (job_url, stage, created_at, updated_at) VALUES (?,?,?,?)",
                (url, "applied", now, now),
            )
            pid = cur.lastrowid

        # Create application record if none yet for this manual apply
        existing_app = conn.execute(
            "SELECT id FROM applications WHERE pipeline_id=? AND channel=? AND applied_at=?",
            (pid, channel, now),
        ).fetchone()
        if not existing_app:
            conn.execute("""
                INSERT INTO applications
                  (pipeline_id, job_url, channel, resume_version, applied_at,
                   followup_date, app_stage, created_at, updated_at)
                VALUES (?,?,?,?,?,?,?,?,?)
            """, (pid, url, channel, resume_version, now, followup, "applied", now, now))

    conn.commit()
    conn.close()
    return {"marked": marked}


@app.post("/jobs/delete")
def delete_jobs(data: dict, current_user: dict = Depends(get_current_user)):
    """Delete specific jobs by URL."""
    import sqlite3
    uid = current_user["uid"]
    db_path = DATA_ROOT / uid / "applypilot.db"
    urls: list = data.get("urls", [])
    if not urls or not db_path.exists():
        return {"deleted": 0}
    conn = sqlite3.connect(str(db_path))
    conn.executemany("DELETE FROM jobs WHERE url = ?", [(u,) for u in urls])
    deleted = conn.total_changes
    conn.commit()
    conn.close()
    return {"deleted": deleted}
