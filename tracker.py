"""
Tracker backend — full 8-stage application pipeline tracker.

New tables added to applypilot.db:
  job_pipeline      — one row per job, carries pipeline-stage fields
  applications      — one row per application attempt (many per job)
  interview_rounds  — one row per interview round (many per application)
  offers            — offer details, one per application
  activity_notes    — notes on any entity (pipeline/application/interview/offer)
  prep_checklist    — prep checklist items, one set per application

Old tracking / tracking_notes tables are left in place (no data loss).
"""
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user

router = APIRouter(prefix="/tracker", tags=["tracker"])

# Injected by main.py after import
DATA_ROOT: Path = None  # type: ignore


# ── DB setup ─────────────────────────────────────────────────────────────────

def _get_db(user_dir: Path) -> sqlite3.Connection:
    db_path = user_dir / "applypilot.db"
    if not db_path.exists():
        raise HTTPException(status_code=400, detail="No job database found — run the pipeline first.")
    conn = sqlite3.connect(str(db_path), timeout=5)
    conn.row_factory = sqlite3.Row
    _init_tables(conn)
    return conn


def _init_tables(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS job_pipeline (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            job_url           TEXT UNIQUE,
            stage             TEXT DEFAULT 'queue',
            queue_notes       TEXT,
            fit_notes         TEXT,
            resume_version    TEXT,
            cover_notes       TEXT,
            target_salary     TEXT,
            referral_contact  TEXT,
            channel           TEXT,
            apply_deadline    TEXT,
            rejected_at_stage TEXT,
            rejection_reason  TEXT,
            rejection_notes   TEXT,
            created_at        TEXT,
            updated_at        TEXT
        );

        CREATE TABLE IF NOT EXISTS applications (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            pipeline_id       INTEGER,
            job_url           TEXT,
            channel           TEXT DEFAULT 'portal',
            resume_version    TEXT,
            applied_at        TEXT,
            followup_date     TEXT,
            app_status        TEXT DEFAULT 'applied',
            app_stage         TEXT DEFAULT 'applied',
            response_type     TEXT,
            response_date     TEXT,
            contact_name      TEXT,
            contact_email     TEXT,
            interview_booked  TEXT,
            interview_format  TEXT,
            interviewer_names TEXT,
            created_at        TEXT,
            updated_at        TEXT,
            FOREIGN KEY (pipeline_id) REFERENCES job_pipeline(id)
        );

        CREATE TABLE IF NOT EXISTS interview_rounds (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            application_id    INTEGER,
            round_number      INTEGER,
            round_type        TEXT DEFAULT 'technical',
            scheduled_at      TEXT,
            interviewer_names TEXT,
            outcome           TEXT DEFAULT 'pending',
            tasks             TEXT,
            notes             TEXT,
            created_at        TEXT,
            FOREIGN KEY (application_id) REFERENCES applications(id)
        );

        CREATE TABLE IF NOT EXISTS offers (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            application_id    INTEGER UNIQUE,
            base_salary       TEXT,
            bonus             TEXT,
            equity            TEXT,
            benefits          TEXT,
            start_date        TEXT,
            offer_deadline    TEXT,
            tc_notes          TEXT,
            negotiation_notes TEXT,
            decision          TEXT DEFAULT 'pending',
            created_at        TEXT,
            updated_at        TEXT,
            FOREIGN KEY (application_id) REFERENCES applications(id)
        );

        CREATE TABLE IF NOT EXISTS activity_notes (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_type TEXT,
            entity_id   INTEGER,
            note        TEXT,
            note_type   TEXT DEFAULT 'note',
            created_at  TEXT
        );

        CREATE TABLE IF NOT EXISTS prep_checklist (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            application_id INTEGER,
            item           TEXT,
            done           INTEGER DEFAULT 0,
            created_at     TEXT,
            FOREIGN KEY (application_id) REFERENCES applications(id)
        );
    """)
    conn.commit()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _auto_sync(conn: sqlite3.Connection) -> None:
    """Import jobs applied via the pipeline into the tracker (applied stage)."""
    now = _now()
    followup = (datetime.now(timezone.utc) + timedelta(days=7)).date().isoformat()

    new_jobs = conn.execute("""
        SELECT j.url, j.applied_at FROM jobs j
        WHERE j.applied_at IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM job_pipeline p WHERE p.job_url = j.url)
    """).fetchall()

    for job in new_jobs:
        cur = conn.execute(
            "INSERT INTO job_pipeline (job_url, stage, created_at, updated_at) VALUES (?,?,?,?)",
            (job["url"], "applied", now, now),
        )
        pid = cur.lastrowid
        conn.execute("""
            INSERT INTO applications
              (pipeline_id, job_url, channel, applied_at, followup_date,
               app_stage, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?)
        """, (pid, job["url"], "pipeline", job["applied_at"] or now, followup,
              "applied", now, now))

    conn.commit()


def _row(conn, table, id_):
    r = conn.execute(f"SELECT * FROM {table} WHERE id = ?", (id_,)).fetchone()
    if not r:
        raise HTTPException(status_code=404, detail=f"{table} {id_} not found")
    return r


def _add_note(conn, entity_type: str, entity_id: int, note: str, note_type: str = "status_change"):
    conn.execute(
        "INSERT INTO activity_notes (entity_type, entity_id, note, note_type, created_at) VALUES (?,?,?,?,?)",
        (entity_type, entity_id, note, note_type, _now()),
    )


def _job_info(conn, url: str) -> dict:
    row = conn.execute(
        "SELECT title, location, site, fit_score, salary FROM jobs WHERE url = ?", (url,)
    ).fetchone()
    return dict(row) if row else {}


# ── Board ─────────────────────────────────────────────────────────────────────

def _enrich_pipeline_rows(conn, rows: list) -> list:
    out = []
    for r in rows:
        d = dict(r)
        d.update(_job_info(conn, d["job_url"]))
        d["app_count"] = conn.execute(
            "SELECT COUNT(*) FROM applications WHERE pipeline_id = ?", (d["id"],)
        ).fetchone()[0]
        out.append(d)
    return out


def _enrich_app_rows(conn, rows: list) -> list:
    out = []
    for r in rows:
        d = dict(r)
        d.update(_job_info(conn, d["job_url"]))
        rounds = conn.execute(
            "SELECT outcome FROM interview_rounds WHERE application_id = ?", (d["id"],)
        ).fetchall()
        d["rounds_total"]   = len(rounds)
        d["rounds_passed"]  = sum(1 for x in rounds if x["outcome"] == "passed")
        d["rounds_pending"] = sum(1 for x in rounds if x["outcome"] == "pending")
        out.append(d)
    return out


@router.get("/board")
def get_board(current_user: dict = Depends(get_current_user)):
    uid = current_user["uid"]
    conn = _get_db(DATA_ROOT / uid)
    _auto_sync(conn)

    board: dict = {}

    for stage in ("queue", "qualified", "ready"):
        rows = conn.execute(
            "SELECT * FROM job_pipeline WHERE stage = ? ORDER BY updated_at DESC", (stage,)
        ).fetchall()
        board[stage] = _enrich_pipeline_rows(conn, rows)

    for stage in ("applied", "response", "interview", "offer", "rejected", "canceled"):
        rows = conn.execute(
            "SELECT * FROM applications WHERE app_stage = ? ORDER BY updated_at DESC", (stage,)
        ).fetchall()
        board[stage] = _enrich_app_rows(conn, rows)

    # Pipeline-level discards (rejected before first application)
    pipe_rejected = conn.execute(
        "SELECT * FROM job_pipeline WHERE stage = 'rejected' ORDER BY updated_at DESC"
    ).fetchall()
    board["rejected"] = _enrich_pipeline_rows(conn, pipe_rejected) + board.get("rejected", [])

    conn.close()
    return board


# ── Pipeline record routes ────────────────────────────────────────────────────

@router.get("/pipeline/{pid}")
def get_pipeline(pid: int, current_user: dict = Depends(get_current_user)):
    uid = current_user["uid"]
    conn = _get_db(DATA_ROOT / uid)
    p = _row(conn, "job_pipeline", pid)
    d = dict(p)

    job = conn.execute("SELECT * FROM jobs WHERE url = ?", (d["job_url"],)).fetchone()
    d["job"] = dict(job) if job else {}

    apps = conn.execute(
        "SELECT * FROM applications WHERE pipeline_id = ? ORDER BY created_at DESC", (pid,)
    ).fetchall()
    d["applications"] = [dict(a) for a in apps]

    notes = conn.execute(
        "SELECT * FROM activity_notes WHERE entity_type='pipeline' AND entity_id=? ORDER BY created_at DESC",
        (pid,),
    ).fetchall()
    d["notes"] = [dict(n) for n in notes]

    conn.close()
    return d


@router.post("/pipeline/add")
def add_to_queue(data: dict, current_user: dict = Depends(get_current_user)):
    """Manually add job URLs to the queue (from Jobs tab)."""
    uid = current_user["uid"]
    conn = _get_db(DATA_ROOT / uid)
    urls = data.get("urls", [])
    if isinstance(urls, str):
        urls = [urls]
    now = _now()
    added = 0
    for url in urls:
        try:
            conn.execute(
                "INSERT OR IGNORE INTO job_pipeline (job_url, stage, created_at, updated_at) VALUES (?,?,?,?)",
                (url, "queue", now, now),
            )
            if conn.total_changes:
                added += 1
        except Exception:
            pass
    conn.commit()
    conn.close()
    return {"added": added}


@router.patch("/pipeline/{pid}")
def update_pipeline(pid: int, data: dict, current_user: dict = Depends(get_current_user)):
    uid = current_user["uid"]
    conn = _get_db(DATA_ROOT / uid)
    _row(conn, "job_pipeline", pid)
    allowed = {
        "queue_notes", "fit_notes", "resume_version", "cover_notes",
        "target_salary", "referral_contact", "channel", "apply_deadline",
        "rejection_reason", "rejection_notes",
    }
    updates = {k: v for k, v in data.items() if k in allowed}
    if updates:
        sets = ", ".join(f"{k}=?" for k in updates) + ", updated_at=?"
        conn.execute(f"UPDATE job_pipeline SET {sets} WHERE id=?",
                     [*updates.values(), _now(), pid])
        conn.commit()
    conn.close()
    return {"ok": True}


@router.post("/pipeline/{pid}/qualify")
def qualify(pid: int, current_user: dict = Depends(get_current_user)):
    uid = current_user["uid"]
    conn = _get_db(DATA_ROOT / uid)
    p = _row(conn, "job_pipeline", pid)
    if p["stage"] != "queue":
        raise HTTPException(400, "Job must be in queue to qualify")
    conn.execute("UPDATE job_pipeline SET stage='qualified', updated_at=? WHERE id=?", (_now(), pid))
    _add_note(conn, "pipeline", pid, "queue → qualified")
    conn.commit()
    conn.close()
    return {"ok": True}


@router.post("/pipeline/{pid}/discard")
def discard(pid: int, data: dict = None, current_user: dict = Depends(get_current_user)):
    if data is None:
        data = {}
    uid = current_user["uid"]
    conn = _get_db(DATA_ROOT / uid)
    p = _row(conn, "job_pipeline", pid)
    reason = data.get("reason", "")
    conn.execute("""
        UPDATE job_pipeline
        SET stage='rejected', rejected_at_stage=?, rejection_reason=?, updated_at=?
        WHERE id=?
    """, (p["stage"], reason, _now(), pid))
    _add_note(conn, "pipeline", pid, f"discarded from {p['stage']}: {reason or 'no reason'}")
    conn.commit()
    conn.close()
    return {"ok": True}


@router.post("/pipeline/{pid}/send-back")
def send_back_to_queue(pid: int, current_user: dict = Depends(get_current_user)):
    uid = current_user["uid"]
    conn = _get_db(DATA_ROOT / uid)
    p = _row(conn, "job_pipeline", pid)
    if p["stage"] not in ("qualified", "ready"):
        raise HTTPException(400, "Can only send back from qualified or ready")
    prev = p["stage"]
    conn.execute("UPDATE job_pipeline SET stage='queue', updated_at=? WHERE id=?", (_now(), pid))
    _add_note(conn, "pipeline", pid, f"{prev} → queue")
    conn.commit()
    conn.close()
    return {"ok": True}


@router.post("/pipeline/{pid}/ready")
def mark_ready(pid: int, current_user: dict = Depends(get_current_user)):
    uid = current_user["uid"]
    conn = _get_db(DATA_ROOT / uid)
    p = _row(conn, "job_pipeline", pid)
    if p["stage"] != "qualified":
        raise HTTPException(400, "Job must be qualified first")
    conn.execute("UPDATE job_pipeline SET stage='ready', updated_at=? WHERE id=?", (_now(), pid))
    _add_note(conn, "pipeline", pid, "qualified → ready to send")
    conn.commit()
    conn.close()
    return {"ok": True}


@router.post("/pipeline/{pid}/apply")
def apply_job(pid: int, data: dict, current_user: dict = Depends(get_current_user)):
    """Create an application record and advance pipeline to 'applied'."""
    uid = current_user["uid"]
    conn = _get_db(DATA_ROOT / uid)
    p = _row(conn, "job_pipeline", pid)
    now = _now()
    followup = (datetime.now(timezone.utc) + timedelta(days=7)).date().isoformat()

    cur = conn.execute("""
        INSERT INTO applications
          (pipeline_id, job_url, channel, resume_version, applied_at,
           followup_date, app_stage, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)
    """, (
        pid, p["job_url"],
        data.get("channel", "portal"),
        data.get("resume_version", ""),
        now, followup, "applied", now, now,
    ))
    app_id = cur.lastrowid
    conn.execute("UPDATE job_pipeline SET stage='applied', updated_at=? WHERE id=?", (now, pid))
    _add_note(conn, "pipeline", pid, f"applied via {data.get('channel', 'portal')}")
    _add_note(conn, "application", app_id, "application created", "status_change")
    conn.commit()
    conn.close()
    return {"ok": True, "application_id": app_id}


# ── Application routes ────────────────────────────────────────────────────────

@router.get("/application/{aid}")
def get_application(aid: int, current_user: dict = Depends(get_current_user)):
    uid = current_user["uid"]
    conn = _get_db(DATA_ROOT / uid)
    a = _row(conn, "applications", aid)
    d = dict(a)

    job = conn.execute("SELECT * FROM jobs WHERE url = ?", (d["job_url"],)).fetchone()
    d["job"] = dict(job) if job else {}

    p = conn.execute("SELECT * FROM job_pipeline WHERE id = ?", (d["pipeline_id"],)).fetchone()
    d["pipeline"] = dict(p) if p else {}

    rounds = conn.execute(
        "SELECT * FROM interview_rounds WHERE application_id = ? ORDER BY round_number", (aid,)
    ).fetchall()
    d["rounds"] = [dict(r) for r in rounds]

    offer = conn.execute("SELECT * FROM offers WHERE application_id = ?", (aid,)).fetchone()
    d["offer"] = dict(offer) if offer else None

    checklist = conn.execute(
        "SELECT * FROM prep_checklist WHERE application_id = ? ORDER BY created_at", (aid,)
    ).fetchall()
    d["checklist"] = [dict(c) for c in checklist]

    notes = conn.execute(
        "SELECT * FROM activity_notes WHERE entity_type='application' AND entity_id=? ORDER BY created_at DESC",
        (aid,),
    ).fetchall()
    d["notes"] = [dict(n) for n in notes]

    conn.close()
    return d


@router.patch("/application/{aid}")
def update_application(aid: int, data: dict, current_user: dict = Depends(get_current_user)):
    uid = current_user["uid"]
    conn = _get_db(DATA_ROOT / uid)
    _row(conn, "applications", aid)
    allowed = {
        "channel", "resume_version", "followup_date", "app_status",
        "response_type", "response_date", "contact_name", "contact_email",
        "interview_booked", "interview_format", "interviewer_names",
    }
    updates = {k: v for k, v in data.items() if k in allowed}
    if updates:
        sets = ", ".join(f"{k}=?" for k in updates) + ", updated_at=?"
        conn.execute(f"UPDATE applications SET {sets} WHERE id=?",
                     [*updates.values(), _now(), aid])
        conn.commit()
    conn.close()
    return {"ok": True}


@router.post("/application/{aid}/apply-again")
def apply_again(aid: int, data: dict, current_user: dict = Depends(get_current_user)):
    uid = current_user["uid"]
    conn = _get_db(DATA_ROOT / uid)
    orig = _row(conn, "applications", aid)
    now = _now()
    followup = (datetime.now(timezone.utc) + timedelta(days=7)).date().isoformat()
    cur = conn.execute("""
        INSERT INTO applications
          (pipeline_id, job_url, channel, resume_version, applied_at,
           followup_date, app_stage, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)
    """, (
        orig["pipeline_id"], orig["job_url"],
        data.get("channel", orig["channel"] or "portal"),
        data.get("resume_version", orig["resume_version"] or ""),
        now, followup, "applied", now, now,
    ))
    new_id = cur.lastrowid
    _add_note(conn, "application", new_id, "re-applied (new attempt)", "status_change")
    conn.commit()
    conn.close()
    return {"ok": True, "application_id": new_id}


@router.post("/application/{aid}/response")
def move_to_response(aid: int, data: dict = None, current_user: dict = Depends(get_current_user)):
    if data is None:
        data = {}
    uid = current_user["uid"]
    conn = _get_db(DATA_ROOT / uid)
    a = _row(conn, "applications", aid)
    if a["app_stage"] != "applied":
        raise HTTPException(400, "Application must be in applied stage")
    now = _now()
    conn.execute(
        "UPDATE applications SET app_stage='response', response_date=?, updated_at=? WHERE id=?",
        (data.get("response_date", now), now, aid),
    )
    _add_note(conn, "application", aid, "applied → response received")
    conn.commit()
    conn.close()
    return {"ok": True}


@router.post("/application/{aid}/interview")
def move_to_interview(aid: int, current_user: dict = Depends(get_current_user)):
    uid = current_user["uid"]
    conn = _get_db(DATA_ROOT / uid)
    a = _row(conn, "applications", aid)
    if a["app_stage"] != "response":
        raise HTTPException(400, "Application must be in response stage")
    now = _now()
    conn.execute("UPDATE applications SET app_stage='interview', updated_at=? WHERE id=?", (now, aid))
    # Auto-create round 1
    conn.execute("""
        INSERT INTO interview_rounds
          (application_id, round_number, round_type, outcome, created_at)
        VALUES (?, 1, 'hr', 'pending', ?)
    """, (aid, now))
    _add_note(conn, "application", aid, "response → interview (round 1 created)")
    conn.commit()
    conn.close()
    return {"ok": True}


@router.post("/application/{aid}/offer")
def move_to_offer(aid: int, current_user: dict = Depends(get_current_user)):
    uid = current_user["uid"]
    conn = _get_db(DATA_ROOT / uid)
    a = _row(conn, "applications", aid)
    if a["app_stage"] not in ("interview", "response"):
        raise HTTPException(400, "Must be in interview or response stage")
    now = _now()
    conn.execute("UPDATE applications SET app_stage='offer', updated_at=? WHERE id=?", (now, aid))
    conn.execute("""
        INSERT OR IGNORE INTO offers (application_id, decision, created_at, updated_at)
        VALUES (?, 'pending', ?, ?)
    """, (aid, now, now))
    _add_note(conn, "application", aid, f"{a['app_stage']} → offer received")
    conn.commit()
    conn.close()
    return {"ok": True}


@router.post("/application/{aid}/reject")
def reject_application(aid: int, data: dict = None, current_user: dict = Depends(get_current_user)):
    if data is None:
        data = {}
    uid = current_user["uid"]
    conn = _get_db(DATA_ROOT / uid)
    a = _row(conn, "applications", aid)
    now = _now()
    reason = data.get("reason", "")
    prev = a["app_stage"]
    conn.execute("UPDATE applications SET app_stage='rejected', updated_at=? WHERE id=?", (now, aid))
    _add_note(conn, "application", aid, f"{prev} → rejected: {reason or 'no reason given'}")
    conn.commit()
    conn.close()
    return {"ok": True}


@router.post("/application/{aid}/cancel")
def cancel_application(aid: int, data: dict = None, current_user: dict = Depends(get_current_user)):
    if data is None:
        data = {}
    uid = current_user["uid"]
    conn = _get_db(DATA_ROOT / uid)
    a = _row(conn, "applications", aid)
    now = _now()
    reason = data.get("reason", "")
    conn.execute("UPDATE applications SET app_stage='canceled', updated_at=? WHERE id=?", (now, aid))
    _add_note(conn, "application", aid, f"{a['app_stage']} → canceled: {reason}")
    conn.commit()
    conn.close()
    return {"ok": True}


# ── Interview rounds ──────────────────────────────────────────────────────────

@router.post("/application/{aid}/rounds")
def add_round(aid: int, data: dict, current_user: dict = Depends(get_current_user)):
    uid = current_user["uid"]
    conn = _get_db(DATA_ROOT / uid)
    _row(conn, "applications", aid)
    max_round = conn.execute(
        "SELECT COALESCE(MAX(round_number), 0) FROM interview_rounds WHERE application_id=?", (aid,)
    ).fetchone()[0]
    now = _now()
    cur = conn.execute("""
        INSERT INTO interview_rounds
          (application_id, round_number, round_type, scheduled_at,
           interviewer_names, outcome, tasks, notes, created_at)
        VALUES (?,?,?,?,?,?,?,?,?)
    """, (
        aid, max_round + 1,
        data.get("round_type", "technical"),
        data.get("scheduled_at", ""),
        data.get("interviewer_names", ""),
        data.get("outcome", "pending"),
        data.get("tasks", ""),
        data.get("notes", ""),
        now,
    ))
    _add_note(conn, "application", aid,
              f"round {max_round + 1} added ({data.get('round_type', 'technical')})")
    conn.commit()
    conn.close()
    return {"ok": True, "round_id": cur.lastrowid}


@router.patch("/round/{rid}")
def update_round(rid: int, data: dict, current_user: dict = Depends(get_current_user)):
    uid = current_user["uid"]
    conn = _get_db(DATA_ROOT / uid)
    r = _row(conn, "interview_rounds", rid)
    allowed = {"round_type", "scheduled_at", "interviewer_names", "outcome", "tasks", "notes"}
    updates = {k: v for k, v in data.items() if k in allowed}
    if updates:
        sets = ", ".join(f"{k}=?" for k in updates)
        conn.execute(f"UPDATE interview_rounds SET {sets} WHERE id=?", [*updates.values(), rid])
        if "outcome" in updates:
            _add_note(conn, "application", r["application_id"],
                      f"round {r['round_number']} → {updates['outcome']}")
        conn.commit()
    conn.close()
    return {"ok": True}


@router.delete("/round/{rid}")
def delete_round(rid: int, current_user: dict = Depends(get_current_user)):
    uid = current_user["uid"]
    conn = _get_db(DATA_ROOT / uid)
    conn.execute("DELETE FROM interview_rounds WHERE id=?", (rid,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ── Offer routes ──────────────────────────────────────────────────────────────

@router.patch("/offer/{oid}")
def update_offer(oid: int, data: dict, current_user: dict = Depends(get_current_user)):
    uid = current_user["uid"]
    conn = _get_db(DATA_ROOT / uid)
    o = _row(conn, "offers", oid)
    allowed = {
        "base_salary", "bonus", "equity", "benefits",
        "start_date", "offer_deadline", "tc_notes", "negotiation_notes", "decision",
    }
    updates = {k: v for k, v in data.items() if k in allowed}
    if updates:
        now = _now()
        sets = ", ".join(f"{k}=?" for k in updates) + ", updated_at=?"
        conn.execute(f"UPDATE offers SET {sets} WHERE id=?", [*updates.values(), now, oid])
        if "decision" in updates:
            _add_note(conn, "application", o["application_id"],
                      f"offer decision: {updates['decision']}")
        conn.commit()
    conn.close()
    return {"ok": True}


# ── Notes ─────────────────────────────────────────────────────────────────────

@router.post("/notes")
def add_note(data: dict, current_user: dict = Depends(get_current_user)):
    uid = current_user["uid"]
    conn = _get_db(DATA_ROOT / uid)
    entity_type = data.get("entity_type", "pipeline")
    entity_id   = data.get("entity_id")
    note        = data.get("note", "").strip()
    note_type   = data.get("note_type", "note")
    if not note or not entity_id:
        raise HTTPException(400, "entity_id and note required")
    conn.execute(
        "INSERT INTO activity_notes (entity_type, entity_id, note, note_type, created_at) VALUES (?,?,?,?,?)",
        (entity_type, entity_id, note, note_type, _now()),
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@router.delete("/notes/{nid}")
def delete_note(nid: int, current_user: dict = Depends(get_current_user)):
    uid = current_user["uid"]
    conn = _get_db(DATA_ROOT / uid)
    conn.execute("DELETE FROM activity_notes WHERE id=?", (nid,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ── Checklist ─────────────────────────────────────────────────────────────────

@router.post("/checklist")
def add_checklist(data: dict, current_user: dict = Depends(get_current_user)):
    uid = current_user["uid"]
    conn = _get_db(DATA_ROOT / uid)
    app_id = data.get("application_id")
    item   = data.get("item", "").strip()
    if not app_id or not item:
        raise HTTPException(400, "application_id and item required")
    cur = conn.execute(
        "INSERT INTO prep_checklist (application_id, item, done, created_at) VALUES (?,?,0,?)",
        (app_id, item, _now()),
    )
    conn.commit()
    conn.close()
    return {"ok": True, "id": cur.lastrowid}


@router.patch("/checklist/{cid}")
def toggle_checklist(cid: int, data: dict, current_user: dict = Depends(get_current_user)):
    uid = current_user["uid"]
    conn = _get_db(DATA_ROOT / uid)
    done = 1 if data.get("done") else 0
    conn.execute("UPDATE prep_checklist SET done=? WHERE id=?", (done, cid))
    conn.commit()
    conn.close()
    return {"ok": True}


@router.delete("/checklist/{cid}")
def delete_checklist(cid: int, current_user: dict = Depends(get_current_user)):
    uid = current_user["uid"]
    conn = _get_db(DATA_ROOT / uid)
    conn.execute("DELETE FROM prep_checklist WHERE id=?", (cid,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ── Stats / Alerts ────────────────────────────────────────────────────────────

@router.get("/stats")
def get_stats(current_user: dict = Depends(get_current_user)):
    uid = current_user["uid"]
    db_path = DATA_ROOT / uid / "applypilot.db"
    if not db_path.exists():
        return {"counts": {}, "total": 0, "overdue": 0}

    conn = sqlite3.connect(str(db_path), timeout=5)
    conn.row_factory = sqlite3.Row
    _init_tables(conn)
    _auto_sync(conn)

    counts: dict = {}
    for stage in ("queue", "qualified", "ready"):
        counts[stage] = conn.execute(
            "SELECT COUNT(*) FROM job_pipeline WHERE stage=?", (stage,)
        ).fetchone()[0]
    for stage in ("applied", "response", "interview", "offer", "rejected", "canceled"):
        counts[stage] = conn.execute(
            "SELECT COUNT(*) FROM applications WHERE app_stage=?", (stage,)
        ).fetchone()[0]

    overdue = conn.execute("""
        SELECT COUNT(*) FROM applications
        WHERE app_stage='applied' AND followup_date < date('now')
    """).fetchone()[0]

    conn.close()
    return {"counts": counts, "total": sum(counts.values()), "overdue": overdue}


@router.get("/alerts")
def get_alerts(current_user: dict = Depends(get_current_user)):
    uid = current_user["uid"]
    db_path = DATA_ROOT / uid / "applypilot.db"
    if not db_path.exists():
        return {"overdue": [], "interview_soon": []}

    conn = sqlite3.connect(str(db_path), timeout=5)
    conn.row_factory = sqlite3.Row
    _init_tables(conn)

    overdue = conn.execute("""
        SELECT a.id, a.job_url, a.followup_date, j.title, j.site
        FROM applications a
        LEFT JOIN jobs j ON j.url = a.job_url
        WHERE a.app_stage = 'applied' AND a.followup_date < date('now')
        ORDER BY a.followup_date ASC
    """).fetchall()

    upcoming = conn.execute("""
        SELECT a.id, a.job_url, a.interview_booked, j.title, j.site
        FROM applications a
        LEFT JOIN jobs j ON j.url = a.job_url
        WHERE a.interview_booked IS NOT NULL
          AND a.interview_booked BETWEEN datetime('now') AND datetime('now', '+48 hours')
        ORDER BY a.interview_booked ASC
    """).fetchall()

    conn.close()
    return {
        "overdue":        [dict(r) for r in overdue],
        "interview_soon": [dict(r) for r in upcoming],
    }
