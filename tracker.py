"""
Tracker backend — Kanban board for job application status tracking.

Adds two tables to the user's existing applypilot.db:
  tracking        — one row per tracked job, status + dates + contact
  tracking_notes  — activity log entries per job

Auto-syncs applied jobs from the jobs table on every board load.
"""

import os
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user

router = APIRouter(prefix="/tracker", tags=["tracker"])

# Injected by main.py after import
DATA_ROOT: Path = None  # type: ignore

STATUSES = [
    "applied",
    "awaiting_response",
    "response_received",
    "interviewing",
    "offered",
    "rejected",
    "closed",
]


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def _get_db(user_dir: Path) -> sqlite3.Connection:
    db_path = user_dir / "applypilot.db"
    if not db_path.exists():
        raise HTTPException(status_code=400, detail="No job database found — run the pipeline first.")
    conn = sqlite3.connect(str(db_path), timeout=5)
    conn.row_factory = sqlite3.Row
    _init_tables(conn)
    return conn


def _init_tables(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS tracking (
            job_url        TEXT PRIMARY KEY,
            status         TEXT DEFAULT 'applied',
            followup_date  TEXT,
            interview_date TEXT,
            offer_deadline TEXT,
            contact_name   TEXT,
            contact_email  TEXT,
            salary_offered TEXT,
            updated_at     TEXT,
            created_at     TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS tracking_notes (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            job_url    TEXT,
            note       TEXT,
            note_type  TEXT DEFAULT 'note',
            created_at TEXT
        )
    """)
    conn.commit()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _auto_sync(conn: sqlite3.Connection) -> None:
    """Pull any applied jobs from jobs table that aren't tracked yet."""
    now = _now()
    conn.execute("""
        INSERT OR IGNORE INTO tracking (job_url, status, created_at, updated_at)
        SELECT url, 'applied', ?, ?
        FROM jobs
        WHERE applied_at IS NOT NULL
    """, (now, now))
    conn.commit()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/board")
def get_board(current_user: dict = Depends(get_current_user)):
    """Return all tracked jobs grouped by status, with job details and notes."""
    uid = current_user["uid"]
    conn = _get_db(DATA_ROOT / uid)
    _auto_sync(conn)

    rows = conn.execute("""
        SELECT
            t.job_url, t.status, t.followup_date, t.interview_date,
            t.offer_deadline, t.contact_name, t.contact_email,
            t.salary_offered, t.updated_at, t.created_at,
            j.title, j.location, j.site, j.fit_score,
            j.salary, j.application_url, j.applied_at
        FROM tracking t
        LEFT JOIN jobs j ON j.url = t.job_url
        ORDER BY t.updated_at DESC
    """).fetchall()

    notes_rows = conn.execute(
        "SELECT * FROM tracking_notes ORDER BY created_at DESC"
    ).fetchall()
    conn.close()

    notes_by_url: dict = {}
    for n in notes_rows:
        url = n["job_url"]
        notes_by_url.setdefault(url, []).append(dict(n))

    board: dict = {s: [] for s in STATUSES}
    for row in rows:
        d = dict(row)
        d["notes"] = notes_by_url.get(d["job_url"], [])
        status = d.get("status") or "applied"
        if status in board:
            board[status].append(d)

    return board


@router.post("/upsert")
def upsert_tracking(data: dict, current_user: dict = Depends(get_current_user)):
    """Create or update a tracking record. Pass job_url + any fields in body."""
    uid = current_user["uid"]
    conn = _get_db(DATA_ROOT / uid)

    url: str = data.get("job_url", "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="job_url required")

    now = _now()
    allowed = {
        "status", "followup_date", "interview_date",
        "offer_deadline", "contact_name", "contact_email", "salary_offered",
    }
    updates = {k: v for k, v in data.items() if k in allowed}

    existing = conn.execute(
        "SELECT status FROM tracking WHERE job_url = ?", (url,)
    ).fetchone()

    if existing:
        old_status = existing["status"]
        if updates:
            set_parts = [f"{k} = ?" for k in updates] + ["updated_at = ?"]
            vals = list(updates.values()) + [now, url]
            conn.execute(
                f"UPDATE tracking SET {', '.join(set_parts)} WHERE job_url = ?", vals
            )
    else:
        old_status = None
        conn.execute(
            """INSERT INTO tracking
               (job_url, status, followup_date, interview_date, offer_deadline,
                contact_name, contact_email, salary_offered, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (
                url,
                updates.get("status", "applied"),
                updates.get("followup_date"),
                updates.get("interview_date"),
                updates.get("offer_deadline"),
                updates.get("contact_name"),
                updates.get("contact_email"),
                updates.get("salary_offered"),
                now, now,
            ),
        )

    # Auto-log status changes
    new_status = updates.get("status")
    if new_status and new_status != old_status:
        label = f"Status: {old_status or 'new'} → {new_status}"
        conn.execute(
            "INSERT INTO tracking_notes (job_url, note, note_type, created_at) VALUES (?,?,?,?)",
            (url, label, "status_change", now),
        )

    conn.commit()
    conn.close()
    return {"ok": True}


@router.post("/notes")
def add_note(data: dict, current_user: dict = Depends(get_current_user)):
    """Add an activity log entry."""
    uid = current_user["uid"]
    conn = _get_db(DATA_ROOT / uid)

    url = data.get("job_url", "").strip()
    note = data.get("note", "").strip()
    note_type = data.get("note_type", "note")

    if not url or not note:
        raise HTTPException(status_code=400, detail="job_url and note required")

    conn.execute(
        "INSERT INTO tracking_notes (job_url, note, note_type, created_at) VALUES (?,?,?,?)",
        (url, note, note_type, _now()),
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@router.delete("/notes/{note_id}")
def delete_note(note_id: int, current_user: dict = Depends(get_current_user)):
    uid = current_user["uid"]
    conn = _get_db(DATA_ROOT / uid)
    conn.execute("DELETE FROM tracking_notes WHERE id = ?", (note_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


@router.get("/stats")
def get_stats(current_user: dict = Depends(get_current_user)):
    """Lightweight summary — counts per status + overdue count. Used by Dashboard."""
    uid = current_user["uid"]
    user_dir = DATA_ROOT / uid
    db_path = user_dir / "applypilot.db"
    if not db_path.exists():
        return {"counts": {s: 0 for s in STATUSES}, "total": 0, "overdue": 0}

    conn = sqlite3.connect(str(db_path), timeout=5)
    conn.row_factory = sqlite3.Row
    _init_tables(conn)
    _auto_sync(conn)

    counts = {}
    for status in STATUSES:
        row = conn.execute("SELECT COUNT(*) FROM tracking WHERE status = ?", (status,)).fetchone()
        counts[status] = row[0] if row else 0

    overdue = conn.execute("""
        SELECT COUNT(*) FROM tracking
        WHERE status IN ('applied','awaiting_response') AND updated_at < ?
    """, ((datetime.now(timezone.utc) - timedelta(days=7)).isoformat(),)).fetchone()[0]

    conn.close()
    return {"counts": counts, "total": sum(counts.values()), "overdue": overdue}


@router.get("/alerts")
def get_alerts(current_user: dict = Depends(get_current_user)):
    """Return overdue follow-ups (7+ days) and upcoming interviews (within 48h)."""
    uid = current_user["uid"]
    conn = _get_db(DATA_ROOT / uid)
    _auto_sync(conn)

    now = datetime.now(timezone.utc)
    cutoff_overdue   = (now - timedelta(days=7)).isoformat()
    cutoff_interview = (now + timedelta(hours=48)).isoformat()

    overdue = conn.execute("""
        SELECT t.job_url, j.title, j.site, t.status, t.updated_at
        FROM tracking t LEFT JOIN jobs j ON j.url = t.job_url
        WHERE t.status IN ('applied','awaiting_response')
          AND t.updated_at < ?
    """, (cutoff_overdue,)).fetchall()

    upcoming = conn.execute("""
        SELECT t.job_url, j.title, j.site, t.interview_date
        FROM tracking t LEFT JOIN jobs j ON j.url = t.job_url
        WHERE t.interview_date IS NOT NULL
          AND t.interview_date > ?
          AND t.interview_date <= ?
        ORDER BY t.interview_date ASC
    """, (now.isoformat(), cutoff_interview)).fetchall()

    conn.close()
    return {
        "overdue":         [dict(r) for r in overdue],
        "interview_soon":  [dict(r) for r in upcoming],
    }
