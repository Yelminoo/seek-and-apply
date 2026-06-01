# ApplyPilot Server

A multi-user web wrapper around [ApplyPilot](https://github.com/Pickle-Pixel/ApplyPilot).
Share a single hosted instance with friends — each user gets completely isolated
data, pipeline, resume, and API keys.

```
Browser (you / friend)
       ↓  JWT auth
  FastAPI backend
       ↓  APPLYPILOT_DIR per user
  applypilot CLI (subprocess)
       ↓
  Gemini / OpenAI API  +  job boards
```

---

## Quick Start (local, no Docker)

### 1. Backend

```bash
cd backend
pip install -r requirements.txt
pip install applypilot
pip install --no-deps python-jobspy && pip install pydantic tls-client requests markdownify regex

uvicorn main:app --reload --port 8000
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev       # → http://localhost:5173
```

### 3. Open the app

Go to `http://localhost:5173`, register an account, complete Setup, then run the pipeline.

---

## Docker (production / sharing)

```bash
# Set a real secret before deploying
export JWT_SECRET="your-random-secret-here"

docker compose up --build -d
```

- Frontend → `http://your-server:3000`
- Backend API → `http://your-server:8000`

Share `http://your-server:3000` with your friend. They register their own account.

---

## Per-user isolation

Each user's data lives at:
```
~/.applypilot-server/users/{user_id}/
├── profile.json          ← personal info, work auth, compensation
├── resume.txt            ← plain text resume (for AI stages)
├── resume.pdf            ← uploaded PDF
├── searches.yaml         ← job search queries
├── .env                  ← GEMINI_API_KEY, OPENAI_API_KEY, etc.
├── applypilot.db         ← SQLite job database
├── tailored_resumes/     ← per-job tailored resumes
└── cover_letters/        ← per-job cover letters
```

The `APPLYPILOT_DIR` env var is set per subprocess call, so pipelines
never interfere with each other.

---

## Setup flow

1. **Personal Info** — name, email, phone, address, LinkedIn, GitHub
2. **Work Authorization** — work permit type, sponsorship needed
3. **Compensation** — salary expectation, currency, range
4. **Experience** — years, education, target role
5. **Skills** — languages, frameworks, tools (comma-separated)
6. **API Keys** — Gemini (free) or OpenAI key; optional CapSolver
7. **Resume** — upload PDF or plain text
8. **Search Config** — YAML: job titles, locations, boards, filters

---

## Pipeline stages

| Stage    | What it does |
|----------|-------------|
| discover | Scrapes Indeed, LinkedIn, Glassdoor, ZipRecruiter, Workday, 30+ direct sites |
| enrich   | Fetches full job descriptions |
| score    | AI rates each job 1-10 against your resume |
| tailor   | Rewrites resume per job — adds keywords, reorders experience |
| cover    | Generates targeted cover letter per job |
| pdf      | Converts tailored resumes & cover letters to PDF |

Run all stages with **all**, or pick specific ones.

---

## Auto-apply (optional)

Auto-apply requires Claude Code CLI and Chrome installed on the **server machine**:

```bash
# Install Claude Code CLI
npm install -g @anthropic-ai/claude-code

# Verify
claude --version
```

Then use `applypilot apply` from the CLI on the server.
The web UI covers stages 1-6 (discovery through PDF). Auto-apply is a
CLI-only operation for now — the browser session needs to run interactively.

---

## Security notes

- Change `JWT_SECRET` in production (set env var or edit docker-compose.yml)
- API keys are stored server-side in each user's `.env` file — use HTTPS
- This is designed for trusted users (friends, small team), not public internet
- User passwords are bcrypt-hashed; job site passwords in profile.json are stored plaintext (used only to fill application forms)

---

## Environment variables

| Variable            | Default                          | Description |
|---------------------|----------------------------------|-------------|
| `JWT_SECRET`        | `change-me-in-production`        | Sign JWT tokens — change this |
| `APPLYPILOT_DATA`   | `~/.applypilot-server/users`     | Root dir for all user data |

---

## Project structure

```
applypilot-server/
├── backend/
│   ├── main.py           API routes (auth, setup, pipeline, jobs)
│   ├── auth.py           JWT + bcrypt
│   ├── models.py         Pydantic schemas
│   ├── runner.py         Subprocess wrapper + DB reader
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── App.jsx       Full React dashboard
│   │   └── main.jsx      Entry point
│   ├── index.html
│   ├── vite.config.js
│   ├── package.json
│   ├── nginx.conf
│   └── Dockerfile
├── docker-compose.yml
└── README.md
```
