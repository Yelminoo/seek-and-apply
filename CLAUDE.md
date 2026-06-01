# CLAUDE.md — ApplyPilot Server

Read this file at the start of every development session. It reflects the **current actual state** of the codebase, not the original spec.

---

## What this project is

A multi-user web server wrapping [ApplyPilot](https://github.com/Pickle-Pixel/ApplyPilot) — an open-source AI job-application pipeline CLI. The server adds JWT auth, per-user data isolation, a React dashboard, and a job tracker on top of ApplyPilot's CLI.

**Target users:** Job seekers in Singapore and Thailand (primary market). The default search config targets Singapore, Bangkok, and Remote (Asia).

---

## How to run locally

```powershell
# Start both servers (auto-reload on file change)
npm run dev

# Or separately:
npm run dev:backend    # FastAPI on :8000 via nodemon
npm run dev:frontend   # Vite React on :5173
```

**nodemon** watches `*.py` and restarts uvicorn. **Vite** HMR handles frontend.

---

## Actual file structure

All files are **flat in the project root** (not backend/frontend subdirs as the original spec described):

```
acv-bot/
├── main.py                   FastAPI app — all routes
├── auth.py                   JWT + bcrypt helpers
├── models.py                 Pydantic request/response schemas
├── runner.py                 Subprocess wrapper for applypilot CLI + SQLite reader
├── requirements.txt          Python deps
├── App.jsx                   React app — all tabs and components
├── main.jsx                  React entry point
├── index.html                Vite HTML entry (script src="/main.jsx")
├── vite.config.js            Vite config — proxies /api → localhost:8000
├── package.json              npm scripts + deps (vite, nodemon, concurrently)
├── nodemon.json              Nodemon config — watches *.py, runs uvicorn
├── backend.Dockerfile
├── frontend.Dockerfile
├── nginx.conf
├── docker-compose.yml        (exists, not currently in use)
├── CLAUDE.md                 ← this file
├── project-log.md            Change log / issue tracker
└── applypilot-server-context.md  Original spec (partially outdated)
```

---

## Tech stack

| Layer | Tech | Notes |
|-------|------|-------|
| Backend | FastAPI + Uvicorn | Python 3.12 |
| Auth | `python-jose` (JWT) + `passlib` + `bcrypt==4.0.1` | bcrypt MUST stay at 4.x — passlib incompatible with 5.x |
| Database | SQLite per user (`applypilot.db`) | Owned by applypilot CLI, read-only from our side |
| Users DB | `~/.applypilot-server/users.json` | Flat JSON file, bcrypt-hashed passwords |
| Frontend | React 18 + Vite | No component library — all CSS-in-JS inline styles |
| Font | IBM Plex Mono | Loaded from Google Fonts |
| Dev tooling | nodemon + concurrently | Single `npm run dev` starts both servers |

---

## Design system

```js
const C = {
  bg:        "#0a0b0f",   // page background
  surface:   "#111318",   // card/panel background
  border:    "#1e2230",   // borders
  accent:    "#4ade80",   // green — primary action, success
  accentDim: "#22c55e40", // green with low opacity
  text:      "#e2e8f0",   // body text
  muted:     "#64748b",   // secondary text, labels
  warn:      "#facc15",   // yellow — warnings, in-progress
  danger:    "#f87171",   // red — errors, delete
  blue:      "#60a5fa",   // info, links, site tags
};
```

**Rules:**
- No Tailwind, no styled-components, no UI library
- All styles via inline objects using `css.*` helper constants
- IBM Plex Mono everywhere — monospace terminal aesthetic

---

## API routes (current)

### Auth
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/auth/register` | Create account → JWT |
| POST | `/auth/login` | Login → JWT |
| GET | `/auth/me` | Current user info |

### Setup
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/setup/status` | Profile/resume/env key status |
| POST | `/setup/profile` | Save profile JSON |
| POST | `/setup/resume` | Upload PDF or TXT resume |
| POST | `/setup/env` | Save API keys to user `.env` |
| GET/POST | `/setup/searches` | Get/save searches.yaml |

### Pipeline
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/pipeline/run` | Start stages in background thread |
| POST | `/pipeline/stop` | Kill running pipeline |
| GET | `/pipeline/status` | Running + current stage |
| GET | `/pipeline/logs` | SSE stream of live log output |

### Jobs
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/jobs?stage=&limit=` | Jobs filtered by pipeline stage |
| GET | `/stats` | Counts + score distribution |
| POST | `/jobs/delete` | Delete jobs by URL list |
| DELETE | `/jobs/reset` | Wipe entire jobs DB |

---

## Data storage

```
~/.applypilot-server/
├── users.json                     ← all accounts (username, hashed password, user_id)
└── users/{user_id}/
    ├── profile.json               ← setup data (personal, work auth, comp, skills)
    ├── resume.pdf                 ← uploaded PDF
    ├── resume.txt                 ← extracted text (UTF-8, what AI actually reads)
    ├── searches.yaml              ← job search config (applypilot format)
    ├── .env                       ← GEMINI_API_KEY, OPENAI_API_KEY, etc.
    ├── applypilot.db              ← SQLite — all job data
    ├── tailored_resumes/          ← per-job .txt and .pdf
    ├── cover_letters/             ← per-job .txt and .pdf
    ├── logs/                      ← applypilot run logs
    ├── chrome-workers/            ← Playwright browser state
    └── apply-workers/             ← auto-apply state
```

**All file writes must use `encoding="utf-8"` explicitly** — Windows defaults to cp1252 and applypilot reads as UTF-8. This caused the scoring stage to crash with UnicodeDecodeError (fixed, see project-log.md).

---

## ApplyPilot integration

### searches.yaml format (CRITICAL — wrong format = 0 jobs found)

applypilot uses its own schema, **not** python-jobspy's format:

```yaml
queries:
  - query: "Senior Software Engineer"
    tier: 1                          # tier 1 = high priority
  - query: "Backend Engineer"
    tier: 2

locations:
  - location: "Singapore"
    remote: false
  - location: "Remote"
    remote: true

location:
  accept_patterns:
    - "Singapore"
    - "Remote"
  reject_patterns:
    - "United States only"

country: "singapore"

sites:                               # NOT "boards" — that key is ignored
  - indeed
  - linkedin
  # zip_recruiter and glassdoor return 403 — do not add them

defaults:
  results_per_site: 25
  hours_old: 72

exclude_titles:
  - "intern"
  - "VP "
```

### Deduplication

- `url` is the SQLite PRIMARY KEY → same URL is never inserted twice
- Re-running discover: existing URLs → `IntegrityError` → silently skipped (counted as "dupe")
- Re-running score/tailor/cover: stages use NULL-checks to find unprocessed jobs → safe to re-run
- `apply_attempts` column accumulates (not reset) — shows how many times a job was applied to

### Rate limiting

Configured via `APPLYPILOT_LLM_DELAY` env var (set automatically in `runner.py`):

| Provider | Auto delay | Why |
|----------|-----------|-----|
| `LLM_URL` set (local) | 0 s | No rate limit |
| `GEMINI_API_KEY` | 4 s | Free tier = 15 RPM |
| `OPENAI_API_KEY` | 0.5 s | Tier-1 = 500 RPM |

applypilot's `llm.py` was patched to read this env var and sleep before each call. It also has reactive retry with exponential backoff (10→20→40→60s) on 429/503.

### Playwright (smart extract stage)

Playwright Chromium must be installed for the smart-extract stage:
```
playwright install chromium
```

Smart extract scrapes 30 job sites with Playwright — **very slow** with 1 worker (20–40 min). Set workers to 3–4 for parallel scraping.

---

## Frontend components (App.jsx)

All in one file. Key components:

| Component | Purpose |
|-----------|---------|
| `AuthScreen` | Login/register page |
| `Sidebar` | Nav tabs + "? How it works" tour button + Sign Out |
| `DashboardTab` | Stats cards, score distribution bar, jobs by source |
| `SetupTab` | 8-step wizard with progress bar, demo profile, location picker |
| `PipelineTab` | Quick-run shortcuts, stage flow picker, progress bar, SSE logs |
| `JobsTab` | Search + filter + paginated table + row selection + bulk actions |
| `TourModal` | 6-step onboarding overlay (auto-shows on first login) |
| `LlmRateInfo` | Shows active LLM provider + delay in Pipeline options |

### SetupTab special features
- **⚡ Load Demo Profile** — fills all 8 steps with realistic Singapore SWE data
- **Location multi-select** — chip buttons for Singapore, Bangkok, KL, Jakarta, HCMC, Remote
- **Job title chips** — toggle predefined titles + custom input
- **Site selector** — Indeed / LinkedIn (others block scrapers)
- **YAML preview** — `<details>` collapsible for raw YAML editing

### PipelineTab special features
- **Quick Run** — "Full pipeline", "Re-run AI stages", "Discover only" shortcuts
- **Stage flow picker** — visual `discover → enrich → score → …` clickable chips
- **Progress bar** — parses live log output to track which stages are done/running
- When navigated from Jobs tab, pre-selects the contextually correct stages

### JobsTab special features
- **Counts** — badge on each stage filter showing job count
- **Search** — live filter by title/location/site
- **Filters** — site dropdown + score threshold
- **Pagination** — 25/page, numbered buttons
- **Row selection** — checkbox per row, select-all page
- **Selection actions** — Open all in tabs, Run next stage (navigates to Pipeline), Delete
- **Apply count** — shows `2×` etc. when a job was applied to multiple times

---

## Known platform issues (Windows-specific)

1. **bcrypt** — must stay at `4.0.1`. bcrypt 5.x removed `__about__.__version__` which passlib reads.
2. **File encoding** — ALL `write_text()`/`read_text()` calls must specify `encoding="utf-8"`. Windows default is cp1252.
3. **npm scripts** — `npm` is a `.ps1` script on this machine. Use `node path/to/npm-cli.js` or bash to run it.
4. **Port conflicts** — uvicorn `--reload` spawns two processes. Use `Get-NetTCPConnection -LocalPort 8000` to find and kill stale processes.

---

## Planned features (not yet built)

From `applypilot-server-context.md` spec:

- [ ] **Tracker tab** — Kanban board (applied → interviewing → offered → rejected). Schema defined in spec, backend (`tracker.py`) and frontend (`Tracker.jsx`) not yet created.
- [ ] Email notifications (follow-up reminders, interview alerts)
- [ ] CSV export (jobs + tracking data)
- [ ] Webhook on status change (Slack)
- [ ] OAuth login (Google/GitHub)
- [ ] Mobile-responsive layout
- [ ] HTTPS / Let's Encrypt instructions
- [ ] Search across notes
- [ ] Bulk status update in Tracker
- [ ] Auto-apply UI (currently CLI-only via `applypilot apply`)

### Next priority: Tracker tab

The Tracker is described in the spec but not built. It requires:
1. `tracker.py` — new FastAPI routes (`/tracker/*`)
2. `tracking` + `tracking_notes` tables added to `applypilot.db` on first access
3. `Tracker.jsx` component (or inline in `App.jsx`) — Kanban board
4. Auto-sync from `jobs.applied_at` into tracking on board load
5. Overdue detection: applied/awaiting with no update for 7 days
6. Interview soon alert: `interview_date` within 48 hours

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | `change-me-in-production-please` | Sign JWT tokens — change in production |
| `APPLYPILOT_DATA` | `~/.applypilot-server/users` | Root for user data dirs |
| `APPLYPILOT_LLM_DELAY` | auto-set by runner | Seconds between LLM calls (0 = local, 4 = Gemini free) |
