# ApplyPilot Server — Project Context & Feature Spec

Feed this document to Claude when continuing development on this project.

---

## What this project is

A multi-user web wrapper around [ApplyPilot](https://github.com/Pickle-Pixel/ApplyPilot) — an open-source AI job application pipeline. The server adds JWT auth, per-user data isolation, a React dashboard, and a job application tracker on top of ApplyPilot's CLI.

---

## Tech stack

| Layer | Tech |
|-------|------|
| Backend | FastAPI (Python 3.11), Uvicorn |
| Auth | JWT via `python-jose`, bcrypt via `passlib` |
| Database | SQLite per user (ApplyPilot's own `applypilot.db`) |
| Frontend | React 18, Vite, plain CSS-in-JS (no Tailwind, no component library) |
| Deployment | DigitalOcean droplet, systemd, Nginx reverse proxy |
| Container | `docker-compose.yml` exists but not currently used |

---

## Project file structure

```
applypilot-server/
├── backend/
│   ├── main.py         FastAPI app — all routes (auth, setup, pipeline, jobs)
│   ├── auth.py         JWT token creation/validation, bcrypt
│   ├── models.py       Pydantic schemas for all request/response types
│   ├── runner.py       Subprocess wrapper for applypilot CLI + SQLite reader
│   ├── tracker.py      Job tracking routes + DB logic
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.jsx     Main app — auth screen, sidebar, all tabs
│   │   ├── Tracker.jsx Kanban board + job drawer + notes
│   │   └── main.jsx    React entry point
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── docker-compose.yml  (ready but not in use)
└── README.md
```

---

## Per-user data isolation

Each user gets their own directory:

```
$APPLYPILOT_DATA/{user_id}/
├── profile.json          personal info, work auth, compensation, skills
├── resume.txt            plain text resume (required for AI stages)
├── resume.pdf            uploaded PDF
├── searches.yaml         job search queries and board config
├── .env                  GEMINI_API_KEY, OPENAI_API_KEY, etc.
├── applypilot.db         SQLite — jobs table + tracking tables
├── tailored_resumes/     per-job tailored resumes
└── cover_letters/        per-job cover letters
```

The `APPLYPILOT_DATA` env var is injected per subprocess call so pipelines never interfere.

---

## Backend API routes

### Auth
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/auth/register` | Create account → returns JWT |
| POST | `/auth/login` | Login → returns JWT |
| GET | `/auth/me` | Returns current user info |

### Setup
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/setup/status` | Returns what's configured (profile, resume, env keys) |
| POST | `/setup/profile` | Save full profile JSON |
| POST | `/setup/resume` | Upload PDF or TXT resume |
| POST | `/setup/env` | Save API keys to user's `.env` |
| GET/POST | `/setup/searches` | Get/save searches.yaml |

### Pipeline
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/pipeline/run` | Start pipeline stages in background |
| POST | `/pipeline/stop` | Kill running pipeline |
| GET | `/pipeline/status` | Running status + current stage |
| GET | `/pipeline/logs` | SSE stream of live logs |

### Jobs
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/jobs?stage=scored&limit=50` | List jobs filtered by stage |
| GET | `/stats` | Pipeline stats + score distribution |
| DELETE | `/jobs/reset` | Wipe user's job database |

### Tracker
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/tracker/board` | All tracked jobs grouped by status |
| PATCH | `/tracker/{url}/status` | Update status, dates, contact info |
| POST | `/tracker/{url}/notes` | Add note/activity log entry |
| DELETE | `/tracker/{url}/notes/{id}` | Delete a note |
| GET | `/tracker/alerts` | Overdue follow-ups + upcoming interviews |

---

## Database schema

### `jobs` table (owned by ApplyPilot, read-only from our side)
```sql
url, title, location, site, salary, full_description,
fit_score, apply_status, applied_at,
tailored_resume_path, cover_letter_path,
application_url, discovered_at
```

### `tracking` table (our addition)
```sql
job_url TEXT PRIMARY KEY,
status TEXT,              -- applied | awaiting_response | response_received
                          -- interviewing | offered | rejected | closed
followup_date TEXT,       -- ISO date
interview_date TEXT,      -- ISO datetime
offer_deadline TEXT,      -- ISO datetime
contact_name TEXT,
contact_email TEXT,
salary_offered TEXT,
updated_at TEXT,
created_at TEXT
```

### `tracking_notes` table
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT,
job_url TEXT,
note TEXT,
note_type TEXT,           -- note | email | call | interview | offer | status_change
created_at TEXT
```

---

## Frontend tabs

| Tab | Component | What it does |
|-----|-----------|-------------|
| Dashboard | `DashboardTab` | Stats overview, score distribution bar chart, jobs by source |
| Setup | `SetupTab` | 8-section wizard: personal, work auth, compensation, experience, skills, API keys, resume upload, searches YAML |
| Pipeline | `PipelineTab` | Stage selector, options (min score, workers, validation mode), live SSE log stream |
| Jobs | `JobsTab` | Filterable table of jobs by stage (discovered/enriched/scored/tailored/ready/applied) |
| Tracker | `Tracker` + `JobCard` + `JobDrawer` | Kanban board across 7 status columns, click-to-open drawer with status selector, date pickers, contact fields, activity log |

---

## Design system

- Font: IBM Plex Mono (monospace throughout)
- Theme: dark terminal aesthetic
- No external component libraries — all CSS-in-JS via inline style objects
- Color tokens defined as `const C = { bg, surface, border, accent, ... }`
- No Tailwind, no styled-components, no Material UI

### Color tokens
```js
C.bg       = "#0a0b0f"   // page background
C.surface  = "#111318"   // card/panel background
C.border   = "#1e2230"   // borders
C.accent   = "#4ade80"   // green — primary action, success
C.text     = "#e2e8f0"   // body text
C.muted    = "#64748b"   // secondary text, labels
C.warn     = "#facc15"   // yellow — warnings, pending
C.danger   = "#f87171"   // red — errors, rejected
C.blue     = "#60a5fa"   // info, links, site tags
C.purple   = "#a78bfa"   // interviews, calls
C.orange   = "#fb923c"   // (available for use)
```

---

## ApplyPilot pipeline stages

| Stage | What it does |
|-------|-------------|
| discover | Scrapes LinkedIn, Indeed, Glassdoor, ZipRecruiter, Workday, 30+ direct sites |
| enrich | Fetches full job descriptions |
| score | AI rates each job 1-10 against your resume |
| tailor | Rewrites resume per job — adds keywords, reorders experience |
| cover | Generates targeted cover letter per job |
| pdf | Converts tailored resumes & cover letters to PDF |

The `apply` stage (auto-submit via Claude Code + Playwright) is CLI-only — not exposed in the web UI.

---

## Tracker status flow

```
applied → awaiting_response → response_received → interviewing → offered → rejected
                                                                          → closed
```

Auto-behaviors:
- Jobs from `jobs.applied_at` are auto-synced into `tracking` on board load
- Jobs in `applied` or `awaiting_response` with no update for **7 days** → flagged as overdue
- Jobs with `interview_date` within **48 hours** → flagged as `interview_soon`

---

## Features built (updated 2026-06-01)

- [x] Interactive onboarding tour (6-step modal, auto-shows on first login, replayable from sidebar)
- [x] Setup wizard with step-by-step progress, instruction banners, Save & Continue navigation
- [x] Demo profile (⚡ Load Demo Profile fills all 8 steps instantly)
- [x] Location multi-select chips for Singapore / Bangkok / KL / Jakarta / HCMC / Remote
- [x] Job title chips + custom title input
- [x] Site selector (Indeed / LinkedIn — others blocked)
- [x] Pipeline progress bar (parsed from live logs — shows stage-by-stage flow)
- [x] Quick-run shortcuts (Full pipeline, Re-run AI stages, Discover only)
- [x] Visual stage flow picker (clickable chips, deselects "all" when individual clicked)
- [x] Jobs tab search + filter + pagination (25/page)
- [x] Row selection + bulk actions (open tabs, run next stage, delete)
- [x] Apply count column (tracks repeated applications)
- [x] Auto rate limiting (Gemini free → 4s/call, local LLM → unlimited)
- [x] LLM provider badge in Pipeline Options
- [x] nodemon auto-reload for backend
- [x] Vite proxy (no more CORS issues)

## Known limitations / not yet built

- [x] **Tracker tab** — Kanban board (7 status columns, drawer with dates/contact/notes, auto-sync from applied jobs, overdue + interview alerts)
- [ ] Email notifications for reminders (follow-up due, interview tomorrow)
- [ ] Bulk status update (select multiple cards, move at once)
- [ ] Export to CSV (jobs + tracking data)
- [ ] Search across notes
- [ ] Auto-apply stage exposed in UI (requires Claude Code + Chrome on server)
- [ ] OAuth login (Google/GitHub)
- [ ] HTTPS setup / Let's Encrypt instructions
- [ ] Mobile-responsive layout
- [ ] Dark/light theme toggle
- [ ] Webhook on status change (e.g. post to Slack when you get an interview)

---

## How to continue development

When starting a new Claude session with this doc:

1. Paste this file into the conversation
2. Describe what you want to add or change
3. Claude will know the full stack, file structure, DB schema, API routes, and design system

Example prompts:
- *"Add email notifications using SendGrid when a follow-up is overdue"*
- *"Add a CSV export button on the Jobs tab"*
- *"Add pagination to the Jobs table — 20 per page with next/prev"*
- *"Build a bulk status update — checkboxes on kanban cards, move all selected at once"*
- *"Add a search bar that searches across job titles and notes"*
- *"Make the layout mobile responsive"*
- *"Add a Slack webhook that fires when a job moves to interviewing or offered"*
