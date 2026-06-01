# Project Log — ApplyPilot Server

Chronological record of every change, bug, and fix. Newest entries at the top.

---

## Session 5 — 2026-06-01

### Feature: Dashboard redesign — pipeline funnel + tracker chart + source breakdown

**What was built:**

- **`BarRow` component** — reusable horizontal bar row (label, filled bar, value, %) used across all charts
- **KPI row** — 4 top-line stat cards: Total Discovered, Scored, Tailored, Applied
- **Pipeline Funnel** — full-width 2-column bar chart: Discovered → Enriched → Scored → Tailored → Cover Letters → Ready → Applied, each showing count + % of total. Shows a CTA hint when jobs exist but haven't been scored.
- **Score Distribution** — existing chart, now sorted high→low with consistent BarRow style
- **Application Tracker** — bar chart of all 7 Kanban statuses (counts pulled from new `/tracker/stats` endpoint). Shows overdue alert if any. Graceful empty state if no applications tracked yet.
- **Jobs by Source** — upgraded from tag chips to a 2-column bar chart sorted by count (top 16 sources)
- **Date header** — shows current date in Singapore locale

**Backend change:** Added `GET /tracker/stats` to `tracker.py` — lightweight endpoint returning `{counts: {status: N}, total, overdue}` without loading full job + notes data.

**Files changed:** `tracker.py`, `App.jsx`

---

## Session 4 — 2026-06-01

### Feature: Tracker tab — Kanban board for application tracking

**What was built:**

**Backend (`tracker.py`):**
- `tracking` table — one row per job (status, dates, contact, salary offered)
- `tracking_notes` table — activity log (note, email, call, interview, offer, status_change)
- `GET /tracker/board` — all jobs grouped by 7 statuses, joined with job details + notes
- `POST /tracker/upsert` — create or update tracking record; auto-logs status changes
- `POST /tracker/notes` — add activity entry
- `DELETE /tracker/notes/{id}` — remove activity entry
- `GET /tracker/alerts` — overdue follow-ups (7+ days no update) + upcoming interviews (48h)
- `_auto_sync()` — on every board load, pulls all `applied_at` jobs into tracking if not already there

**Frontend (`TrackerTab` in App.jsx):**
- 7 Kanban columns: Applied → Awaiting Response → Response Received → Interviewing → Offered → Rejected → Closed
- Each column has color-coded header + card count badge
- Cards show: title, site, score, days since last update, note count, interview indicator
- Alert bar at top: overdue follow-ups (yellow) + upcoming interviews (purple)
- **Job drawer** (right-side panel):
  - Status pills — click to change status instantly
  - Date fields: follow-up date, interview date (datetime), offer deadline (datetime)
  - Contact: name, email, salary offered
  - Save Changes button
  - Activity log: note type selector (📝 Note, ✉️ Email, 📞 Call, 🎯 Interview, 💼 Offer)
  - Note timeline with delete button per entry
  - Status changes auto-logged as non-deletable entries

**Files created/changed:** `tracker.py` (new), `main.py`, `App.jsx`

---

## Session 3 — 2026-06-01 (continued)

### Feature: Rate limiting for remote LLM APIs

**Problem:** Gemini free tier allows 15 RPM. With 320 jobs × 3 AI stages = ~960 API calls, the pipeline would hammer the API and get 429s.

**Solution:**
- Patched `applypilot/llm.py` — added `_PROACTIVE_DELAY` that reads `APPLYPILOT_LLM_DELAY` env var and sleeps before each `chat()` call
- In `runner.py` `_make_env()`: auto-detects provider from user's `.env` and sets appropriate delay:
  - Local LLM (`LLM_URL` set) → 0 s
  - Gemini (`GEMINI_API_KEY`) → 4 s (15 RPM = 4 s/call)
  - OpenAI (`OPENAI_API_KEY`) → 0.5 s
- `LlmRateInfo` component in Pipeline Options shows active provider + delay + ETA estimate

**Files changed:** `applypilot/llm.py` (patched), `runner.py`, `App.jsx`

---

### Feature: Jobs tab — search, filter, pagination, row selection, delete

**Changes:**
- **Pagination:** 25 jobs/page, numbered page buttons, first/last shortcuts. Loads up to 1000 jobs client-side.
- **Search:** Live filter by title/location/site name
- **Filters:** Site dropdown (auto-populated) + score threshold (9+, 8+, 7+, 5+)
- **Row selection:** Checkbox per row + select-all for current page
- **Selection action bar:** Opens when rows selected — "Open in tabs", "Run next stage" (navigates to Pipeline with correct stage pre-selected), "Delete N" (with confirm)
- **Apply count column:** Shows `2×` etc. from `apply_attempts` DB column
- **Stage counts:** Badge on each filter tab showing how many jobs are in that stage
- **Refresh button**

**Backend changes:**
- Added `POST /jobs/delete` endpoint — accepts `{urls: [...]}`, deletes by PRIMARY KEY
- Updated `list_jobs_for_user` query to include `apply_attempts` column
- Added `apply_attempts` field to `JobRow` Pydantic model

**Files changed:** `App.jsx`, `main.py`, `runner.py`, `models.py`

---

### Feature: Pipeline tab redesign — progress bar, quick-run, stage picker

**Changes:**
- **Stage progress bar:** Parses live log output (`STAGE: discover`, `Stage 'discover' completed`) to show step-by-step progress with colored circles and connector lines
- **Quick Run shortcuts:** "Full pipeline", "Re-run AI stages" (score+tailor+cover+pdf), "Discover only"
- **Stage flow picker:** Visual `discover → enrich → …` clickable chips — clicking deselects "all" and toggles that stage
- **Navigation from Jobs:** "Run next stage" button pre-selects contextually correct stages (e.g., from "enriched" → score)
- **Run button label:** Shows active stages e.g. "▶ Run score + tailor + cover + pdf"
- **`initialStages` prop:** PipelineTab accepts initial stage selection from parent (App passes `pipelineStages` state)

**Problem fixed:** Individual stage checkboxes were `disabled` when "all" was selected — confusing UX. Removed `disabled`, clicking any stage now automatically deselects "all".

**Files changed:** `App.jsx`

---

### Feature: Interactive onboarding tour

**Changes:**
- `TourModal` component — 6-step modal overlay with blur backdrop
- Auto-shows on first login (tracks `ap_tour_done` in localStorage)
- Steps: Welcome → Setup → API key → Pipeline → Jobs → Done
- Each step has body text, optional tip callout, optional CTA button that navigates to a tab
- Progress dots (clickable to jump to step), Back/Next navigation
- "? How it works" button added to sidebar — replays tour any time

**Files changed:** `App.jsx`

---

### Feature: Setup tab redesign — step wizard + demo profile + location picker

**Changes:**
- **8-step wizard:** Replaced horizontal tab buttons with vertical numbered stepper (checkmarks when complete)
- **Progress bar:** Shows N/8 steps complete at top
- **Instruction banners:** Each step has a green left-border callout explaining WHY the data is needed
- **Save & Continue →** / **← Previous** navigation
- **⚡ Load Demo Profile:** Fills all fields with realistic Singapore SWE data (Alex Johnson, Python/React/Go, $125k)
- **Location multi-select:** Chip buttons — Singapore, Bangkok, KL, Jakarta, HCMC, Remote (Asia). Clicking chips regenerates searches.yaml automatically
- **Job title chips:** Toggle predefined titles + custom title input
- **Site selector:** Indeed / LinkedIn only (others blocked)
- **YAML preview:** `<details>` collapsible for power users who want to edit raw YAML
- **Auto YAML generation:** `buildSearchYaml()` generates correct applypilot format from selections

**Files changed:** `App.jsx`

---

### Bug: searches.yaml wrong schema → 0 jobs discovered

**Problem:** Pipeline discover stage logged "0 search combinations". applypilot uses its own YAML schema, not python-jobspy's direct format.

**Wrong format (what we had):**
```yaml
searches:
  - query: "Software Engineer"
    location: "Remote"
    site_name: [linkedin, indeed]
```

**Correct format:**
```yaml
queries:
  - query: "Software Engineer"
    tier: 1
locations:
  - location: "Singapore"
    remote: false
sites:            # NOT "boards" — that key is silently ignored
  - indeed
  - linkedin
defaults:
  results_per_site: 25
  hours_old: 72
```

**Root cause:** Confused python-jobspy's own API format with applypilot's wrapper format. Found by reading `applypilot/discovery/jobspy.py` and the example file at `applypilot/config/searches.example.yaml`.

**Fix:** Updated `DEMO_SEARCHES` in `App.jsx`, default in `main.py`, and re-wrote the existing user's `searches.yaml` on disk.

**Files changed:** `App.jsx`, `main.py`, user's `searches.yaml` on disk

---

### Bug: ZipRecruiter returns 403

**Problem:** ZipRecruiter actively blocks all automated requests. Including it in `sites` always results in `403 forbidden`.

**Fix:** Removed `zip_recruiter` from all YAML templates. Default sites are now `[indeed, linkedin]`.

**Note:** Glassdoor also frequently blocks scrapers. Only use `indeed` and `linkedin` reliably.

**Files changed:** `App.jsx`, `main.py`, user's `searches.yaml`

---

### Bug: Pipeline stuck running — smart extract too slow

**Problem:** Smart extract (Playwright-based) scrapes 30 job sites sequentially with 1 worker. Takes 20–40 minutes for the discover stage alone.

**Solution:**
- Killed the subprocess via `Stop-Process -Id <PID> -Force`
- Recommended: use 3–4 workers for smart extract
- For users with existing jobs: use "Re-run AI stages" to skip discover entirely

**Note:** Smart extract is what makes the discover stage slow. JobSpy (LinkedIn/Indeed) is fast but smart extract adds 30 more sites via Playwright browser automation.

---

### Bug: Pipeline UTF-8 decode error

**Problem:** Pipeline ran, but score/tailor/cover stages all crashed with:
```
'utf-8' codec can't decode byte 0x96 in position 1577: invalid start byte
```

**Root cause:** On Windows, `Path.write_text()` defaults to `encoding='cp1252'` (the system locale). applypilot reads all files as UTF-8. The resume was extracted from PDF and saved as cp1252, then applypilot tried to read it as UTF-8 → crash.

**Fix:** Added `encoding="utf-8"` to every `write_text()` and `read_text()` call in `main.py` and `runner.py`.

**Files changed:** `main.py` (8 calls fixed), `runner.py` (1 call fixed)

**Scope:** Any file the server writes: `users.json`, `profile.json`, `resume.txt`, `.env`, `searches.yaml`

---

## Session 2 — 2026-06-01 (morning)

### Setup: Playwright browsers

**Problem:** Smart extract stage failed:
```
BrowserType.launch: Executable doesn't exist at ...chrome-headless-shell.exe
```

**Fix:**
```bash
playwright install chromium
```

**Note:** Must be run in the same Python environment as the project.

---

### Feature: nodemon for auto-reload

**Changes:**
- Added `nodemon` and `concurrently` as devDependencies
- Created `nodemon.json` — watches `*.py`, ignores `__pycache__` and `*.db`, runs uvicorn on port 8000
- Updated `package.json` scripts:
  - `npm run dev` → starts both backend (nodemon) and frontend (vite) concurrently
  - `npm run dev:backend` → backend only
  - `npm run dev:frontend` → frontend only

**Files changed:** `package.json`, `nodemon.json`

---

### Bug: CORS error — frontend calling backend directly

**Problem:** Frontend had `const API = "http://localhost:8000"` hardcoded. Browser blocked cross-origin requests with:
```
Access-Control-Allow-Origin header is not present
```

**Fix:** Changed to `const API = "/api"` — requests now go through Vite's proxy (`/api → localhost:8000`), which is same-origin.

**Vite config already had:**
```js
proxy: { '/api': { target: 'http://localhost:8000', changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') } }
```

**Files changed:** `App.jsx` line 3

---

### Bug: 500 on register — bcrypt 5.x incompatible with passlib

**Problem:** Registration returned 500. Backend log showed:
```
(trapped) error reading bcrypt version
AttributeError: module 'bcrypt' has no attribute '__about__'
```

**Root cause:** `passlib` reads `bcrypt.__about__.__version__` which was removed in bcrypt 5.0. The latest bcrypt (`pip install bcrypt`) installs 5.x.

**Fix:**
```bash
pip install "bcrypt==4.0.1"
```

**IMPORTANT:** Do not upgrade bcrypt past 4.x until passlib releases a compatible version (project appears unmaintained as of 2026).

**Files changed:** None (pip package version)

---

## Session 1 — Initial setup

### Bug: SyntaxError in runner.py

**Problem:** Backend failed to start. Traceback pointed to `runner.py` line 231:
```python
result = [dict(zip([d[0] for d in rows[0].description if rows else []], row)) if hasattr(row, 'description') else dict(row) for row in rows]
```

**Root cause:** `if rows else []` was written as a list comprehension filter condition instead of a ternary in the iterable. Invalid Python syntax.

**Fix:** Since `conn.row_factory = sqlite3.Row` was already set (line 145), `sqlite3.Row` objects support `dict()` directly:
```python
result = [dict(row) for row in rows]
```

**Files changed:** `runner.py` line 231

---

### Bug: index.html pointed to wrong script path

**Problem:** Browser showed `GET /src/main.jsx 404 (Not Found)`.

**Root cause:** Files are flat in the project root, but `index.html` referenced `/src/main.jsx` (the standard Vite `src/` layout).

**Fix:** Changed script src in `index.html`:
```html
<!-- Before -->
<script type="module" src="/src/main.jsx"></script>
<!-- After -->
<script type="module" src="/main.jsx"></script>
```

**Files changed:** `index.html`

---

### Initial install

**Python dependencies:**
```bash
pip install -r requirements.txt
pip install applypilot
pip install --no-deps python-jobspy
pip install pydantic tls-client requests markdownify regex
pip install "bcrypt==4.0.1"   # MUST pin to 4.x
playwright install chromium
```

**Node dependencies:**
```bash
npm install
```

**Dependency conflicts (non-blocking):**
- `python-jobspy` expects `markdownify<0.14` and `numpy==1.26.3` — newer versions installed, no runtime impact for our usage
- `regex` version conflict — newer version works fine

---

## Issues outstanding / watch list

| Issue | Status | Notes |
|-------|--------|-------|
| bcrypt pinned to 4.0.1 | Active | Do not upgrade — will break auth |
| smart extract slowness | Known | Use 3–4 workers; or skip with "Re-run AI stages" |
| ZipRecruiter/Glassdoor 403 | Known | Only use indeed + linkedin |
| Gemini free tier 429 | Mitigated | 4s proactive delay auto-set; exponential retry backoff |
| applypilot.db-wal large | Benign | WAL checkpoint happens automatically on next DB open |
| Windows cp1252 encoding | Fixed | All file I/O now specifies utf-8 explicitly |
| Tracker tab not built | Planned | See CLAUDE.md planned features section |

---

## Upcoming features (priority order)

1. **Tracker tab** — Kanban board (applied → interviewing → offered → rejected). Spec exists in `applypilot-server-context.md`. Needs `tracker.py` routes and `Tracker` component.
2. **Email notifications** — Follow-up reminders when no update for 7 days, interview alerts 48h before
3. **CSV export** — Export jobs table + tracking data
4. **Mobile responsive** — Current layout breaks below ~900px
5. **Slack webhook** — Fire when job moves to `interviewing` or `offered`
6. **OAuth** — Google/GitHub login instead of username/password
