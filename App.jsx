import { useState, useEffect, useRef, useCallback, useMemo } from "react";

const API = "/api";

// ─── API helpers ────────────────────────────────────────────────────────────

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function api(method, path, body, token) {
  const opts = { method, headers: authHeaders(token) };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Request failed");
  }
  return res.json();
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

function useAuth() {
  const [token, setToken] = useState(() => localStorage.getItem("ap_token"));
  const [user, setUser]   = useState(() => {
    const u = localStorage.getItem("ap_user");
    return u ? JSON.parse(u) : null;
  });

  const login  = (t, u) => { localStorage.setItem("ap_token", t); localStorage.setItem("ap_user", JSON.stringify(u)); setToken(t); setUser(u); };
  const logout = ()     => { localStorage.removeItem("ap_token"); localStorage.removeItem("ap_user"); setToken(null); setUser(null); };

  return { token, user, login, logout, authed: !!token };
}

// ─── Design tokens ───────────────────────────────────────────────────────────

const C = {
  bg:       "#0a0b0f",
  surface:  "#111318",
  border:   "#1e2230",
  accent:   "#4ade80",
  accentDim:"#22c55e40",
  text:     "#e2e8f0",
  muted:    "#64748b",
  warn:     "#facc15",
  danger:   "#f87171",
  blue:     "#60a5fa",
};

const css = {
  app: {
    fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
    background: C.bg,
    color: C.text,
    minHeight: "100vh",
    fontSize: 13,
  },
  card: {
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: "20px 24px",
  },
  input: {
    background: "#0d0f15",
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    color: C.text,
    padding: "8px 12px",
    fontSize: 13,
    fontFamily: "inherit",
    width: "100%",
    boxSizing: "border-box",
    outline: "none",
  },
  btn: (variant = "primary") => ({
    background: variant === "primary" ? C.accent : "transparent",
    color: variant === "primary" ? "#0a0b0f" : C.accent,
    border: `1px solid ${variant === "primary" ? C.accent : C.accent}`,
    borderRadius: 6,
    padding: "8px 18px",
    fontSize: 13,
    fontFamily: "inherit",
    fontWeight: 700,
    cursor: "pointer",
    letterSpacing: "0.05em",
  }),
  btnDanger: {
    background: "transparent",
    color: C.danger,
    border: `1px solid ${C.danger}`,
    borderRadius: 6,
    padding: "8px 18px",
    fontSize: 13,
    fontFamily: "inherit",
    cursor: "pointer",
  },
  label: {
    color: C.muted,
    fontSize: 11,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    display: "block",
    marginBottom: 6,
  },
  tag: (color = C.accent) => ({
    background: color + "22",
    color,
    border: `1px solid ${color}44`,
    borderRadius: 4,
    padding: "2px 8px",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.08em",
  }),
};

// ─── Auth screen ─────────────────────────────────────────────────────────────

function AuthScreen({ onAuth }) {
  const [mode, setMode]   = useState("login");
  const [form, setForm]   = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(""); setLoading(true);
    try {
      const endpoint = mode === "login" ? "/auth/login" : "/auth/register";
      const data = await api("POST", endpoint, form, null);
      onAuth(data.access_token, { username: data.username, user_id: data.user_id });
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh", background: C.bg, fontFamily: css.app.fontFamily }}>
      <div style={{ width: 380 }}>
        {/* Logo */}
        <div style={{ marginBottom: 32, textAlign: "center" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.3em", color: C.accent, marginBottom: 8 }}>◈ APPLYPILOT SERVER</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.text }}>Autonomous Job Engine</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>Multi-user job application pipeline</div>
        </div>

        <div style={css.card}>
          {/* Tab */}
          <div style={{ display:"flex", marginBottom: 24, gap: 8 }}>
            {["login","register"].map(m => (
              <button key={m} onClick={() => setMode(m)} style={{
                ...css.btn(mode === m ? "primary" : "outline"),
                flex: 1, padding: "7px 0",
              }}>{m === "login" ? "Sign In" : "Register"}</button>
            ))}
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={css.label}>Username</label>
            <input style={css.input} value={form.username}
              onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
              onKeyDown={e => e.key === "Enter" && submit()}
              placeholder="username" autoFocus />
          </div>
          <div style={{ marginBottom: 24 }}>
            <label style={css.label}>Password</label>
            <input style={css.input} type="password" value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              onKeyDown={e => e.key === "Enter" && submit()}
              placeholder="••••••••" />
          </div>

          {error && <div style={{ color: C.danger, fontSize: 12, marginBottom: 16 }}>⚠ {error}</div>}

          <button onClick={submit} disabled={loading} style={{ ...css.btn(), width: "100%" }}>
            {loading ? "..." : mode === "login" ? "→ Sign In" : "→ Create Account"}
          </button>
        </div>

        <div style={{ textAlign:"center", marginTop:16, fontSize:11, color: C.muted }}>
          Each user gets isolated data & pipeline
        </div>
      </div>
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: "◈" },
  { id: "setup",     label: "Setup",     icon: "⚙" },
  { id: "pipeline",  label: "Pipeline",  icon: "▶" },
  { id: "jobs",      label: "Jobs",      icon: "◉" },
  { id: "tracker",   label: "Tracker",   icon: "⬡" },
];

function Sidebar({ tab, setTab, user, onLogout, onTour }) {
  return (
    <div style={{ width: 200, minHeight: "100vh", background: C.surface, borderRight: `1px solid ${C.border}`, display:"flex", flexDirection:"column", padding: "24px 0" }}>
      <div style={{ padding: "0 20px", marginBottom: 32 }}>
        <div style={{ fontSize: 10, letterSpacing: "0.3em", color: C.accent, marginBottom: 4 }}>◈ APPLYPILOT</div>
        <div style={{ fontSize: 13, color: C.muted }}>{user?.username}</div>
      </div>

      <nav style={{ flex: 1 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            display: "flex", alignItems: "center", gap: 10,
            width: "100%", padding: "10px 20px",
            background: tab === t.id ? C.accentDim : "transparent",
            border: "none", borderLeft: `2px solid ${tab === t.id ? C.accent : "transparent"}`,
            color: tab === t.id ? C.accent : C.muted,
            cursor: "pointer", fontSize: 13, fontFamily: "inherit",
            textAlign: "left", letterSpacing: "0.03em",
          }}>
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
      </nav>

      <div style={{ padding: "0 20px", display:"flex", flexDirection:"column", gap: 8 }}>
        <button onClick={onTour} style={{
          background:"transparent", border:`1px solid ${C.border}`, borderRadius:6,
          color:C.muted, cursor:"pointer", fontSize:11, fontFamily:"inherit",
          padding:"7px 0", letterSpacing:"0.05em",
        }}>
          ? How it works
        </button>
        <button onClick={onLogout} style={{ ...css.btnDanger, width: "100%", padding: "8px 0", fontSize: 12 }}>
          Sign Out
        </button>
      </div>
    </div>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, color = C.accent }) {
  return (
    <div style={{ ...css.card, flex: 1, minWidth: 100 }}>
      <div style={{ fontSize: 28, fontWeight: 700, color, letterSpacing: "-0.02em" }}>{value}</div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 4, letterSpacing: "0.1em", textTransform: "uppercase" }}>{label}</div>
    </div>
  );
}

// ─── Dashboard tab ────────────────────────────────────────────────────────────

function BarRow({ label, value, max, color, suffix = "", labelWidth = 140 }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom: 3 }}>
        <span style={{ fontSize:11, color: value > 0 ? C.text : C.muted, width: labelWidth, flexShrink:0,
          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{label}</span>
        <span style={{ fontSize:11, color: value > 0 ? color : C.muted, fontWeight:700, minWidth:40, textAlign:"right" }}>
          {value}{suffix}
        </span>
      </div>
      <div style={{ height:7, background:C.border, borderRadius:4, overflow:"hidden" }}>
        <div style={{ width:`${pct}%`, height:"100%", background: value > 0 ? color : "transparent",
          borderRadius:4, transition:"width 0.7s ease" }} />
      </div>
    </div>
  );
}

function DashboardTab({ token }) {
  const [stats, setStats]         = useState(null);
  const [trackerStats, setTracker] = useState(null);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    Promise.all([
      api("GET", "/stats", null, token),
      api("GET", "/tracker/stats", null, token).catch(() => null),
    ]).then(([s, t]) => { setStats(s); setTracker(t); })
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <Loader />;
  if (!stats)  return <div style={{ color:C.muted }}>Could not load stats.</div>;

  const s = stats.stats;

  const funnel = [
    { label:"Discovered",    value: s.total,             color: C.blue   },
    { label:"Enriched",      value: s.with_description,  color: C.blue   },
    { label:"Scored",        value: s.scored,            color: C.accent  },
    { label:"Tailored",      value: s.tailored,          color: C.accent  },
    { label:"Cover Letters", value: s.with_cover_letter, color:"#34d399" },
    { label:"Ready to Apply",value: s.ready_to_apply,    color: C.warn   },
    { label:"Applied",       value: s.applied,           color:"#fb923c" },
  ];

  const trackerRows = [
    { id:"queue",     label:"Queue",      color: C.muted  },
    { id:"qualified", label:"Qualified",  color: C.blue   },
    { id:"ready",     label:"Ready",      color:"#34d399" },
    { id:"applied",   label:"Applied",    color: C.blue   },
    { id:"response",  label:"Response",   color: C.warn   },
    { id:"interview", label:"Interview",  color:"#a78bfa" },
    { id:"offer",     label:"Offer",      color:"#fb923c" },
    { id:"rejected",  label:"Rejected",   color: C.danger },
  ];

  const funnelMax   = s.total || 1;
  const trackerMax  = trackerStats ? Math.max(...Object.values(trackerStats.counts), 1) : 1;
  const scoreMax    = s.score_distribution.length > 0
    ? Math.max(...s.score_distribution.map(r => r[1])) : 1;
  const sourceMax   = s.by_site.length > 0 ? s.by_site[0][1] : 1;

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
        <SectionTitle>Dashboard</SectionTitle>
        <span style={{ fontSize:11, color:C.muted }}>
          {new Date().toLocaleDateString("en-SG", { weekday:"short", day:"numeric", month:"short", year:"numeric" })}
        </span>
      </div>

      {!stats.setup_complete && (
        <div style={{ ...css.card, borderColor:C.warn+"55", color:C.warn, marginBottom:20, fontSize:12, padding:"10px 16px" }}>
          ⚠ Setup incomplete — go to the Setup tab to add your profile, resume, and API keys.
        </div>
      )}

      {/* KPI row */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:12, marginBottom:20 }}>
        <StatCard label="Total Discovered" value={s.total}            color={C.blue} />
        <StatCard label="Scored"           value={s.scored}           color={C.accent} />
        <StatCard label="Tailored"         value={s.tailored}         color={C.accent} />
        <StatCard label="Applied"          value={s.applied}          color="#fb923c" />
      </div>

      {/* Pipeline Funnel (full width) */}
      <div style={{ ...css.card, marginBottom:16 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:16 }}>
          <div style={{ fontSize:11, color:C.muted, letterSpacing:"0.1em", textTransform:"uppercase" }}>Pipeline Funnel</div>
          {s.total > 0 && s.scored === 0 && (
            <div style={{ fontSize:11, color:C.warn }}>
              ↗ {s.total} jobs waiting to be scored — run AI stages in Pipeline
            </div>
          )}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px 32px" }}>
          {funnel.map(({ label, value, color }) => (
            <BarRow key={label} label={label} value={value} max={funnelMax}
              color={color} suffix={` (${funnelMax > 0 ? Math.round((value/funnelMax)*100) : 0}%)`}
              labelWidth={120} />
          ))}
        </div>
      </div>

      {/* Middle row: score distribution + tracker */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:16 }}>

        {/* Score distribution */}
        <div style={css.card}>
          <div style={{ fontSize:11, color:C.muted, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:14 }}>
            Score Distribution
          </div>
          {s.score_distribution.length === 0 ? (
            <div style={{ color:C.muted, fontSize:12 }}>No scored jobs yet. Run the score stage first.</div>
          ) : (
            [...s.score_distribution].sort((a, b) => b[0] - a[0]).map(([score, count]) => {
              const color = score >= 7 ? C.accent : score >= 5 ? C.warn : C.danger;
              return (
                <div key={score} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:6 }}>
                  <span style={{ width:14, color, fontWeight:700, fontSize:12, textAlign:"right", flexShrink:0 }}>
                    {score}
                  </span>
                  <div style={{ flex:1, height:8, background:C.border, borderRadius:4, overflow:"hidden" }}>
                    <div style={{ width:`${(count/scoreMax)*100}%`, height:"100%", background:color,
                      borderRadius:4, transition:"width 0.6s ease" }} />
                  </div>
                  <span style={{ width:28, color:C.muted, fontSize:11, textAlign:"right", flexShrink:0 }}>{count}</span>
                </div>
              );
            })
          )}
        </div>

        {/* Application Tracker status */}
        <div style={css.card}>
          <div style={{ fontSize:11, color:C.muted, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:14 }}>
            Application Tracker
            {trackerStats?.total > 0 && (
              <span style={{ marginLeft:8, color:C.accent, fontWeight:700 }}>{trackerStats.total} tracked</span>
            )}
          </div>
          {!trackerStats || trackerStats.total === 0 ? (
            <div style={{ color:C.muted, fontSize:12 }}>
              No tracked applications yet. Jobs you apply to will appear here automatically.
            </div>
          ) : (
            <>
              {trackerRows.map(({ id, label, color }) => (
                <BarRow key={id} label={label}
                  value={trackerStats.counts[id] || 0}
                  max={trackerMax} color={color} labelWidth={150} />
              ))}
              {trackerStats.overdue > 0 && (
                <div style={{ marginTop:10, fontSize:11, color:C.warn, borderTop:`1px solid ${C.border}`, paddingTop:10 }}>
                  ⚠ {trackerStats.overdue} overdue follow-up{trackerStats.overdue > 1 ? "s" : ""} — check Tracker tab
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Bottom: jobs by source (full width bar chart) */}
      {s.by_site.length > 0 && (
        <div style={css.card}>
          <div style={{ fontSize:11, color:C.muted, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:14 }}>
            Jobs by Source
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"4px 32px" }}>
            {s.by_site.slice(0, 16).map(([site, count]) => (
              <BarRow key={site} label={site} value={count} max={sourceMax} color={C.blue} labelWidth={160} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Setup tab ────────────────────────────────────────────────────────────────

const PROFILE_DEFAULTS = {
  personal: { full_name:"", preferred_name:"", email:"", password:"", phone:"", address:"", city:"", province_state:"", country:"", postal_code:"", linkedin_url:"", github_url:"", portfolio_url:"", website_url:"" },
  work_authorization: { legally_authorized_to_work:"Yes", require_sponsorship:"No", work_permit_type:"" },
  availability: { earliest_start_date:"Immediately", available_for_full_time:"Yes", available_for_contract:"No" },
  compensation: { salary_expectation:"85000", salary_currency:"USD", salary_range_min:"80000", salary_range_max:"100000", currency_conversion_note:"" },
  experience: { years_of_experience_total:"3", education_level:"Bachelor's Degree", current_job_title:"", current_company:"", target_role:"software engineer" },
  skills_boundary: { languages:[], frameworks:[], devops:[], databases:[], tools:[] },
  resume_facts: { preserved_companies:[], preserved_projects:[], preserved_school:"", real_metrics:[] },
  eeo_voluntary: { gender:"Decline to self-identify", race_ethnicity:"Decline to self-identify", veteran_status:"I am not a protected veteran", disability_status:"I do not wish to answer" },
};

const DEMO_PROFILE = {
  personal: {
    full_name:"Alex Johnson", preferred_name:"Alex",
    email:"alex.johnson@example.com", password:"",
    phone:"+1 (555) 234-5678", address:"123 Market St",
    city:"San Francisco", province_state:"CA",
    country:"United States", postal_code:"94105",
    linkedin_url:"https://linkedin.com/in/alexjohnson",
    github_url:"https://github.com/alexjohnson",
    portfolio_url:"", website_url:"",
  },
  work_authorization: { legally_authorized_to_work:"Yes", require_sponsorship:"No", work_permit_type:"US Citizen" },
  availability: { earliest_start_date:"Immediately", available_for_full_time:"Yes", available_for_contract:"No" },
  compensation: { salary_expectation:"125000", salary_currency:"USD", salary_range_min:"110000", salary_range_max:"150000", currency_conversion_note:"" },
  experience: { years_of_experience_total:"5", education_level:"Bachelor's Degree", current_job_title:"Software Engineer", current_company:"", target_role:"Senior Software Engineer" },
  skills_boundary: {
    languages:["Python","JavaScript","TypeScript","Go"],
    frameworks:["React","FastAPI","Node.js","Next.js"],
    devops:["Docker","Kubernetes","GitHub Actions","AWS"],
    databases:["PostgreSQL","Redis","MongoDB"],
    tools:["Git","VS Code","Figma"],
  },
  resume_facts: { preserved_companies:[], preserved_projects:[], preserved_school:"", real_metrics:[] },
  eeo_voluntary: { gender:"Decline to self-identify", race_ethnicity:"Decline to self-identify", veteran_status:"I am not a protected veteran", disability_status:"I do not wish to answer" },
};

const STEP_INFO = {
  personal:     { title:"Step 1 — Who are you?",            description:"Your name and contact details are auto-filled into job applications. Add LinkedIn and GitHub so the AI can reference them in cover letters. The Job Site Password is used to log in to job boards during auto-apply." },
  work_auth:    { title:"Step 2 — Work Authorization",      description:"Required by nearly every employer. This tells the AI which jobs you're eligible for. If you need sponsorship, roles that don't offer it will score lower so you stop wasting time on them." },
  compensation: { title:"Step 3 — Compensation",            description:"Sets your salary target so you don't waste time on low-paying roles. The AI factors this into scoring — jobs well outside your range receive a penalty." },
  experience:   { title:"Step 4 — Experience",              description:"Your seniority and target role guide discovery and scoring. The 'Target Role' field is the job title the AI searches for and optimises your resume toward." },
  skills:       { title:"Step 5 — Skills",                  description:"The AI matches your skills against job requirements to produce fit scores. Add every language, framework, and tool you're comfortable with — the more complete, the more accurate the scores." },
  api_keys:     { title:"Step 6 — AI API Keys",             description:"At least one LLM key is required for scoring, tailoring, and cover letters. Gemini is free at aistudio.google.com. Keys are stored only in your isolated .env file on the server — never shared with other users." },
  resume:       { title:"Step 7 — Your Resume",             description:"Upload your current resume as a PDF or plain text file. The AI extracts the text and uses it as the base for every tailored version. A strong base resume here means better tailored outputs." },
  searches:     { title:"Step 8 — Search Configuration",    description:"Define which job titles, locations, and boards to scrape. YAML format lets you run multiple searches in one pipeline run. The demo values are a good starting point — tune the query and results_wanted to control volume." },
};

const SETUP_STEPS = [
  { id:"personal",     label:"Personal Info" },
  { id:"work_auth",    label:"Work Auth" },
  { id:"compensation", label:"Compensation" },
  { id:"experience",   label:"Experience" },
  { id:"skills",       label:"Skills" },
  { id:"api_keys",     label:"API Keys" },
  { id:"resume",       label:"Resume" },
  { id:"searches",     label:"Search Config" },
];

const LOCATION_OPTIONS = [
  { label:"Singapore",            value:"Singapore",            country:"singapore", remote:false },
  { label:"Bangkok, Thailand",    value:"Bangkok, Thailand",    country:"singapore", remote:false },
  { label:"Remote (Asia)",        value:"Remote",               country:"singapore", remote:true  },
  { label:"Kuala Lumpur, Malaysia", value:"Kuala Lumpur, Malaysia", country:"singapore", remote:false },
  { label:"Jakarta, Indonesia",   value:"Jakarta, Indonesia",   country:"singapore", remote:false },
  { label:"Ho Chi Minh City, Vietnam", value:"Ho Chi Minh City, Vietnam", country:"singapore", remote:false },
];

const TITLE_OPTIONS = [
  "Senior Software Engineer","Software Engineer","Full Stack Engineer",
  "Backend Engineer","Frontend Engineer","DevOps Engineer",
  "Data Engineer","ML Engineer","Cloud Engineer","Platform Engineer",
];

const SITE_OPTIONS = [
  { label:"Indeed",   value:"indeed" },
  { label:"LinkedIn", value:"linkedin" },
];

function buildSearchYaml(titles, locations, sites) {
  const queries = titles.map((t, i) =>
    `  - query: "${t}"\n    tier: ${i < Math.ceil(titles.length / 2) ? 1 : 2}`
  ).join("\n");

  const locs = locations.map(l => {
    const opt = LOCATION_OPTIONS.find(o => o.value === l);
    return `  - location: "${l}"\n    remote: ${opt?.remote ? "true" : "false"}`;
  }).join("\n");

  const accepts = [...new Set([
    ...locations.map(l => `    - "${l.split(",")[0].trim()}"`),
    '    - "Remote"', '    - "Anywhere"', '    - "Asia"', '    - "Southeast Asia"',
  ])].join("\n");

  const sitesYaml = sites.map(s => `  - ${s}`).join("\n");

  return `queries:\n${queries}\n\nlocations:\n${locs}\n\nlocation:\n  accept_patterns:\n${accepts}\n  reject_patterns:\n    - "United States only"\n    - "US only"\n    - "onsite only"\n\ncountry: "singapore"\n\nsites:\n${sitesYaml}\n\ndefaults:\n  results_per_site: 25\n  hours_old: 72\n\nexclude_titles:\n  - "intern"\n  - "internship"\n  - "VP "\n  - "vice president"\n  - "chief"\n`;
}

function SetupTab({ token }) {
  const [profile, setProfile]   = useState(PROFILE_DEFAULTS);
  const [envKeys, setEnvKeys]   = useState({ GEMINI_API_KEY:"", OPENAI_API_KEY:"", CAPSOLVER_API_KEY:"", LLM_URL:"" });
  const [searches, setSearches] = useState("");
  const [status, setStatus]     = useState(null);
  const [saving, setSaving]     = useState("");
  const [msg, setMsg]           = useState(null);
  const [activeSection, setActiveSection] = useState("personal");
  const [completedSteps, setCompletedSteps] = useState(new Set());

  // Search builder state
  const [selLocations, setSelLocations] = useState(["Singapore","Bangkok, Thailand","Remote"]);
  const [selTitles,    setSelTitles]    = useState(["Senior Software Engineer","Full Stack Engineer","Backend Engineer","Software Engineer"]);
  const [selSites,     setSelSites]     = useState(["indeed","linkedin"]);
  const [customTitle,  setCustomTitle]  = useState("");
  const [yamlDirty,    setYamlDirty]   = useState(false);

  useEffect(() => {
    api("GET", "/setup/status", null, token).then(s => {
      setStatus(s);
      if (s.profile) setProfile(p => ({ ...p, ...s.profile }));
      const done = new Set();
      if (s.has_profile) { ["personal","work_auth","compensation","experience","skills"].forEach(id => done.add(id)); }
      if (s.env_keys?.GEMINI_API_KEY || s.env_keys?.OPENAI_API_KEY) done.add("api_keys");
      if (s.has_resume_txt) done.add("resume");
      if (s.has_searches) done.add("searches");
      setCompletedSteps(done);
    });
    api("GET", "/setup/searches", null, token).then(s => setSearches(s.yaml));
  }, [token]);

  // Regenerate YAML whenever selections change (unless user manually edited it)
  useEffect(() => {
    if (!yamlDirty) setSearches(buildSearchYaml(selTitles, selLocations, selSites));
  }, [selLocations, selTitles, selSites, yamlDirty]);

  const toggleLoc   = (v) => setSelLocations(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);
  const toggleTitle = (v) => setSelTitles(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);
  const toggleSite  = (v) => setSelSites(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);
  const addCustomTitle = () => {
    const t = customTitle.trim();
    if (t && !selTitles.includes(t)) setSelTitles(p => [t, ...p]);
    setCustomTitle("");
  };

  const flash = (text, ok = true) => { setMsg({ text, ok }); setTimeout(() => setMsg(null), 3500); };
  const markDone = (ids) => setCompletedSteps(prev => { const n = new Set(prev); [].concat(ids).forEach(id => n.add(id)); return n; });

  const stepIdx   = SETUP_STEPS.findIndex(s => s.id === activeSection);
  const canGoPrev = stepIdx > 0;
  const canGoNext = stepIdx < SETUP_STEPS.length - 1;
  const goNext    = () => canGoNext && setActiveSection(SETUP_STEPS[stepIdx + 1].id);
  const goPrev    = () => canGoPrev && setActiveSection(SETUP_STEPS[stepIdx - 1].id);

  const saveProfile = async (andNext = false) => {
    setSaving("profile");
    try {
      await api("POST", "/setup/profile", profile, token);
      markDone(["personal","work_auth","compensation","experience","skills"]);
      flash("✓ Profile saved");
      if (andNext) goNext();
    } catch (e) { flash("✗ " + e.message, false); }
    finally { setSaving(""); }
  };

  const saveEnv = async (andNext = false) => {
    setSaving("env");
    try {
      await api("POST", "/setup/env", envKeys, token);
      if (envKeys.GEMINI_API_KEY || envKeys.OPENAI_API_KEY) markDone("api_keys");
      flash("✓ API keys saved");
      if (andNext) goNext();
    } catch (e) { flash("✗ " + e.message, false); }
    finally { setSaving(""); }
  };

  const saveSearches = async (andNext = false) => {
    setSaving("searches");
    try {
      await api("POST", "/setup/searches", { yaml: searches }, token);
      markDone("searches");
      flash("✓ Searches saved");
      if (andNext) goNext();
    } catch (e) { flash("✗ " + e.message, false); }
    finally { setSaving(""); }
  };

  const uploadResume = async (file) => {
    setSaving("resume");
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch(`${API}/setup/resume`, { method:"POST", headers:{ Authorization:`Bearer ${token}` }, body:fd });
      if (!res.ok) throw new Error("Upload failed");
      markDone("resume");
      flash("✓ Resume uploaded — continue to the next step");
    } catch (e) { flash("✗ " + e.message, false); }
    finally { setSaving(""); }
  };

  const loadDemo = () => {
    setProfile(DEMO_PROFILE);
    setSelLocations(["Singapore","Bangkok, Thailand","Remote"]);
    setSelTitles(["Senior Software Engineer","Full Stack Engineer","Backend Engineer","Software Engineer"]);
    setSelSites(["indeed","linkedin"]);
    setYamlDirty(false);
    flash("✓ Demo profile loaded — click 'Save & Continue' through each step, then add your API key in Step 6");
  };

  const setField     = (section, key, val) => setProfile(p => ({ ...p, [section]: { ...p[section], [key]: val } }));
  const setListField = (section, key, val) => setField(section, key, val.split(",").map(s => s.trim()).filter(Boolean));

  const profileSections = ["personal","work_auth","compensation","experience","skills"];
  const handleSaveAndNext = () => {
    if (profileSections.includes(activeSection)) saveProfile(true);
    else if (activeSection === "api_keys")        saveEnv(true);
    else if (activeSection === "searches")        saveSearches(true);
    else goNext();
  };

  const doneCount = completedSteps.size;

  return (
    <div>
      {/* Header row */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom: 20 }}>
        <SectionTitle>Setup</SectionTitle>
        <button onClick={loadDemo} style={{ ...css.btn("outline"), fontSize:11, padding:"6px 14px" }}>
          ⚡ Load Demo Profile
        </button>
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ height:4, background:C.border, borderRadius:2, overflow:"hidden" }}>
          <div style={{ height:"100%", background:C.accent, width:`${(doneCount/8)*100}%`, borderRadius:2, transition:"width 0.5s ease" }} />
        </div>
        <div style={{ fontSize:11, color:C.muted, marginTop:6 }}>
          {doneCount} of 8 steps complete
          {doneCount === 8 && <span style={{ color:C.accent, marginLeft:12 }}>✓ All done — head to Pipeline to run</span>}
        </div>
      </div>

      {/* Toast message */}
      {msg && (
        <div style={{ ...css.card, borderColor:(msg.ok ? C.accent : C.danger)+"55", color:msg.ok ? C.accent : C.danger, marginBottom:16, fontSize:12, padding:"10px 16px" }}>
          {msg.text}
        </div>
      )}

      <div style={{ display:"flex", gap:20 }}>
        {/* Left: step list */}
        <div style={{ width:176, flexShrink:0 }}>
          {SETUP_STEPS.map((s, i) => {
            const done   = completedSteps.has(s.id);
            const active = activeSection === s.id;
            return (
              <div key={s.id} onClick={() => setActiveSection(s.id)} style={{
                display:"flex", alignItems:"center", gap:10,
                padding:"9px 12px", borderRadius:6, cursor:"pointer",
                background: active ? C.accentDim : "transparent",
                marginBottom:2,
              }}>
                <div style={{
                  width:22, height:22, borderRadius:"50%", flexShrink:0,
                  display:"flex", alignItems:"center", justifyContent:"center",
                  background: done ? C.accent : "transparent",
                  color: done ? "#0a0b0f" : active ? C.accent : C.muted,
                  border:`1px solid ${done ? C.accent : active ? C.accent : C.border}`,
                  fontSize:10, fontWeight:700,
                }}>
                  {done ? "✓" : i + 1}
                </div>
                <span style={{ fontSize:12, color: active ? C.accent : done ? C.text : C.muted }}>
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Right: step content */}
        <div style={{ flex:1, minWidth:0 }}>
          {/* Instruction banner */}
          <div style={{ background:C.surface, border:`1px solid ${C.accent}22`, borderLeft:`3px solid ${C.accent}`, borderRadius:6, padding:"12px 16px", marginBottom:16 }}>
            <div style={{ fontSize:12, fontWeight:700, color:C.accent, marginBottom:4 }}>
              {STEP_INFO[activeSection].title}
            </div>
            <div style={{ fontSize:11, color:C.muted, lineHeight:1.75 }}>
              {STEP_INFO[activeSection].description}
            </div>
          </div>

          {/* Form */}
          <div style={css.card}>
            {activeSection === "personal" && (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
                {[["full_name","Full Name"],["preferred_name","Preferred Name"],["email","Email"],["password","Job Site Password"],["phone","Phone"],["address","Street Address"],["city","City"],["province_state","State / Province"],["country","Country"],["postal_code","Postal Code"],["linkedin_url","LinkedIn URL"],["github_url","GitHub URL"],["portfolio_url","Portfolio URL"]].map(([k,l]) => (
                  <Field key={k} label={l} value={profile.personal[k]} onChange={v => setField("personal", k, v)} type={k==="password"?"password":"text"} />
                ))}
              </div>
            )}

            {activeSection === "work_auth" && (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
                {[["legally_authorized_to_work","Authorized to Work? (Yes/No)"],["require_sponsorship","Requires Sponsorship? (Yes/No)"],["work_permit_type","Permit Type (e.g. US Citizen, H-1B)"]].map(([k,l]) => (
                  <Field key={k} label={l} value={profile.work_authorization[k]} onChange={v => setField("work_authorization", k, v)} />
                ))}
              </div>
            )}

            {activeSection === "compensation" && (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
                {[["salary_expectation","Target Salary"],["salary_currency","Currency (e.g. USD)"],["salary_range_min","Range Min"],["salary_range_max","Range Max"]].map(([k,l]) => (
                  <Field key={k} label={l} value={profile.compensation[k]} onChange={v => setField("compensation", k, v)} />
                ))}
              </div>
            )}

            {activeSection === "experience" && (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
                {[["years_of_experience_total","Years of Experience"],["education_level","Education Level"],["current_job_title","Current Job Title"],["target_role","Target Role (searched & optimised toward)"]].map(([k,l]) => (
                  <Field key={k} label={l} value={profile.experience[k]} onChange={v => setField("experience", k, v)} />
                ))}
              </div>
            )}

            {activeSection === "skills" && (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
                <div style={{ gridColumn:"1/-1", fontSize:11, color:C.muted, marginBottom:4 }}>Comma-separated values for each category.</div>
                {[["languages","Languages"],["frameworks","Frameworks"],["devops","DevOps / Cloud"],["databases","Databases"],["tools","Tools"]].map(([k,l]) => (
                  <Field key={k} label={l} value={(profile.skills_boundary[k]||[]).join(", ")} onChange={v => setListField("skills_boundary", k, v)} />
                ))}
              </div>
            )}

            {activeSection === "api_keys" && (
              <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                {[["GEMINI_API_KEY","Gemini API Key (free — aistudio.google.com)"],["OPENAI_API_KEY","OpenAI API Key (optional)"],["CAPSOLVER_API_KEY","CapSolver API Key (optional, for CAPTCHAs)"],["LLM_URL","Local LLM URL (optional, e.g. http://localhost:11434/v1)"]].map(([k,l]) => (
                  <Field key={k} label={l} value={envKeys[k]} onChange={v => setEnvKeys(e => ({ ...e, [k]:v }))} type="password" />
                ))}
              </div>
            )}

            {activeSection === "resume" && (
              <div>
                <div style={{ fontSize:12, color:C.muted, marginBottom:16 }}>
                  Status:{" "}
                  {status?.has_resume_txt
                    ? <span style={{ color:C.accent }}>✓ Resume on file</span>
                    : <span style={{ color:C.warn }}>⚠ No resume yet</span>}
                </div>
                <label style={{ display:"block", padding:"40px 32px", border:`2px dashed ${C.border}`, borderRadius:8, textAlign:"center", cursor:"pointer", color:C.muted, fontSize:12 }}>
                  <input type="file" accept=".pdf,.txt,.md" style={{ display:"none" }}
                    onChange={e => e.target.files[0] && uploadResume(e.target.files[0])} />
                  <div style={{ fontSize:28, marginBottom:10, color:C.border }}>↑</div>
                  {saving === "resume" ? "Uploading..." : "Click or drag resume here  (.pdf or .txt)"}
                </label>
              </div>
            )}

            {activeSection === "searches" && (
              <div style={{ display:"flex", flexDirection:"column", gap:20 }}>

                {/* Locations */}
                <div>
                  <label style={css.label}>Target Locations</label>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginTop:4 }}>
                    {LOCATION_OPTIONS.map(opt => {
                      const on = selLocations.includes(opt.value);
                      return (
                        <button key={opt.value} onClick={() => toggleLoc(opt.value)} style={{
                          padding:"6px 14px", borderRadius:20, fontSize:11, fontFamily:"inherit",
                          cursor:"pointer", fontWeight: on ? 700 : 400,
                          background: on ? C.accent : "transparent",
                          color: on ? "#0a0b0f" : C.muted,
                          border:`1px solid ${on ? C.accent : C.border}`,
                          transition:"all 0.15s",
                        }}>
                          {on ? "✓ " : ""}{opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Job titles */}
                <div>
                  <label style={css.label}>Job Titles</label>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginTop:4, marginBottom:10 }}>
                    {TITLE_OPTIONS.map(t => {
                      const on = selTitles.includes(t);
                      return (
                        <button key={t} onClick={() => toggleTitle(t)} style={{
                          padding:"6px 14px", borderRadius:20, fontSize:11, fontFamily:"inherit",
                          cursor:"pointer", fontWeight: on ? 700 : 400,
                          background: on ? C.accentDim : "transparent",
                          color: on ? C.accent : C.muted,
                          border:`1px solid ${on ? C.accent : C.border}`,
                          transition:"all 0.15s",
                        }}>
                          {on ? "✓ " : ""}{t}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ display:"flex", gap:8 }}>
                    <input
                      style={{ ...css.input, flex:1 }}
                      placeholder="Add custom title..."
                      value={customTitle}
                      onChange={e => setCustomTitle(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && addCustomTitle()}
                    />
                    <button onClick={addCustomTitle} style={{ ...css.btn("outline"), padding:"8px 14px", fontSize:11 }}>+ Add</button>
                  </div>
                </div>

                {/* Sites */}
                <div>
                  <label style={css.label}>Job Boards</label>
                  <div style={{ display:"flex", gap:8, marginTop:4 }}>
                    {SITE_OPTIONS.map(opt => {
                      const on = selSites.includes(opt.value);
                      return (
                        <button key={opt.value} onClick={() => toggleSite(opt.value)} style={{
                          padding:"6px 16px", borderRadius:20, fontSize:11, fontFamily:"inherit",
                          cursor:"pointer", fontWeight: on ? 700 : 400,
                          background: on ? C.accentDim : "transparent",
                          color: on ? C.accent : C.muted,
                          border:`1px solid ${on ? C.accent : C.border}`,
                          transition:"all 0.15s",
                        }}>
                          {on ? "✓ " : ""}{opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* YAML preview — advanced */}
                <details>
                  <summary style={{ fontSize:11, color:C.muted, cursor:"pointer", userSelect:"none", marginBottom:8 }}>
                    Advanced — edit raw YAML
                  </summary>
                  <textarea value={searches} onChange={e => { setSearches(e.target.value); setYamlDirty(true); }} style={{
                    ...css.input, height:220, resize:"vertical", whiteSpace:"pre", fontFamily:"inherit", marginTop:8,
                  }} />
                  <div style={{ fontSize:10, color:C.muted, marginTop:4 }}>
                    Manual edits here override the dropdowns above. Reload the page to reset.
                  </div>
                </details>

              </div>
            )}
          </div>

          {/* Navigation buttons */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:14 }}>
            <button onClick={goPrev} disabled={!canGoPrev} style={{ ...css.btn("outline"), opacity:canGoPrev?1:0.3, cursor:canGoPrev?"pointer":"default" }}>
              ← Previous
            </button>
            <button onClick={handleSaveAndNext} disabled={!!saving} style={css.btn()}>
              {saving ? "Saving..." : activeSection === "resume" ? (canGoNext ? "Continue →" : "✓ Done") : canGoNext ? "Save & Continue →" : "✓ Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }) {
  return (
    <div>
      <label style={css.label}>{label}</label>
      <input style={css.input} type={type} value={value || ""} onChange={e => onChange(e.target.value)} />
    </div>
  );
}

// ─── LLM rate-limit info badge ───────────────────────────────────────────────

function LlmRateInfo({ token }) {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    api("GET", "/setup/status", null, token).then(s => {
      const keys = s.env_keys || {};
      if (keys.LLM_URL)        setInfo({ type:"local",  delay:0,   label:"Local LLM",    color:C.accent, tip:"No rate limit — running at full speed" });
      else if (keys.GEMINI_API_KEY) setInfo({ type:"gemini", delay:4,   label:"Gemini (free)", color:C.warn,   tip:"4 s delay between calls — stays under 15 RPM free tier" });
      else if (keys.OPENAI_API_KEY) setInfo({ type:"openai", delay:0.5, label:"OpenAI",        color:C.blue,   tip:"0.5 s delay — generous tier-1 limits" });
      else setInfo(null);
    }).catch(() => {});
  }, [token]);

  if (!info) return null;
  return (
    <div style={{ background: info.color + "11", border:`1px solid ${info.color}33`, borderRadius:6, padding:"8px 12px", fontSize:11 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:2 }}>
        <span style={{ color:info.color, fontWeight:700 }}>AI Provider: {info.label}</span>
        <span style={{ color:C.muted }}>{info.delay > 0 ? `${info.delay}s/call` : "unlimited"}</span>
      </div>
      <div style={{ color:C.muted, fontSize:10 }}>{info.tip}</div>
      {info.type === "gemini" && (
        <div style={{ color:C.muted, fontSize:10, marginTop:4 }}>
          320 jobs × 3 stages ≈ ~64 min at free tier. Upgrade to paid for ~5 min.
        </div>
      )}
    </div>
  );
}

// ─── Pipeline tab ─────────────────────────────────────────────────────────────

const STAGES = ["discover", "enrich", "score", "tailor", "cover", "pdf"];
const STAGE_DESC = {
  discover: "Scrapes LinkedIn & Indeed using your search config",
  enrich:   "Fetches full job descriptions + apply URLs",
  score:    "AI rates each job 1–10 against your resume",
  tailor:   "Rewrites resume per job (only jobs ≥ min score)",
  cover:    "Generates a targeted cover letter per job",
  pdf:      "Converts tailored resumes & cover letters to PDF",
};
const STAGE_ICON = { discover:"🔍", enrich:"📄", score:"⭐", tailor:"✏️", cover:"📝", pdf:"📦" };

const QUICK_RUNS = [
  { label:"Full pipeline",    stages:["all"],                           desc:"Discover → … → PDF" },
  { label:"Re-run AI stages", stages:["score","tailor","cover","pdf"],  desc:"Skip discover/enrich, re-score existing jobs" },
  { label:"Discover only",    stages:["discover"],                      desc:"Find new jobs without scoring" },
  { label:"Score → PDF",      stages:["score","tailor","cover","pdf"],  desc:"Same as Re-run AI stages" },
];

function PipelineTab({ token, initialStages, initialUrls }) {
  const [selectedStages, setSelectedStages] = useState(initialStages || ["all"]);
  const [urlFilter, setUrlFilter]           = useState(initialUrls || []);

  useEffect(() => { if (initialStages) setSelectedStages(initialStages); }, [initialStages?.join(",")]);
  useEffect(() => { setUrlFilter(initialUrls || []); }, [initialUrls?.join(",")]);
  const [minScore, setMinScore]   = useState(7);
  const [workers, setWorkers]     = useState(1);
  const [validation, setValidation] = useState("normal");
  const [pipelineStatus, setPipelineStatus] = useState(null);
  const [logs, setLogs]   = useState([]);
  const [error, setError] = useState("");
  const logsEndRef = useRef(null);

  const toggleStage = (s) => {
    if (s === "all") { setSelectedStages(["all"]); return; }
    // Clicking any individual stage always deselects "all" and toggles that stage
    setSelectedStages(prev => {
      const without = prev.filter(x => x !== "all");
      const next = without.includes(s) ? without.filter(x => x !== s) : [...without, s];
      return next.length === 0 ? ["all"] : next;
    });
  };

  const fetchStatus = useCallback(async () => {
    try { const s = await api("GET", "/pipeline/status", null, token); setPipelineStatus(s); }
    catch {}
  }, [token]);

  useEffect(() => { fetchStatus(); const id = setInterval(fetchStatus, 2000); return () => clearInterval(id); }, [fetchStatus]);
  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

  const streamLogs = async (tok) => {
    const res = await fetch(`${API}/pipeline/logs`, { headers: authHeaders(tok) });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop();
      for (const part of parts) {
        const line = part.replace(/^data: /, "");
        if (line === "[DONE]") return;
        if (line) setLogs(l => [...l, line]);
      }
    }
  };

  const run = async (stages = selectedStages) => {
    setError(""); setLogs([]);
    try {
      await api("POST", "/pipeline/run", { stages, min_score: minScore, workers, validation, url_filter: urlFilter.length > 0 ? urlFilter : undefined }, token);
      fetchStatus();
      streamLogs(token);
    } catch (e) { setError(e.message); }
  };

  const stop = async () => { await api("POST", "/pipeline/stop", null, token).catch(() => {}); fetchStatus(); };

  const running = pipelineStatus?.running;
  const allSelected = selectedStages.includes("all");

  // Parse logs to track which stages are done / currently running
  const stageProgress = useMemo(() => {
    const completed = [];
    let current = null;
    for (const line of logs) {
      const startMatch = line.match(/STAGE:\s+(\w+)/i);
      const doneMatch  = line.match(/Stage '(\w+)' completed/i);
      if (startMatch) current = startMatch[1].toLowerCase();
      if (doneMatch)  { completed.push(doneMatch[1].toLowerCase()); current = null; }
    }
    return { completed, current };
  }, [logs]);

  const pct = ((stageProgress.completed.length + (stageProgress.current ? 0.5 : 0)) / STAGES.length) * 100;

  return (
    <div>
      <SectionTitle>Pipeline</SectionTitle>

      {/* ── Stage progress bar ── */}
      {(running || stageProgress.completed.length > 0 || stageProgress.current) && (
        <div style={{ ...css.card, marginBottom:20 }}>
          {/* Step indicators */}
          <div style={{ display:"flex", alignItems:"flex-start" }}>
            {STAGES.map((s, i) => {
              const done   = stageProgress.completed.includes(s);
              const active = stageProgress.current === s;
              const isLast = i === STAGES.length - 1;
              return (
                <div key={s} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", position:"relative" }}>
                  {i > 0 && (
                    <div style={{
                      position:"absolute", top:13, right:"50%", left:"-50%", height:2,
                      background: done || active ? C.accent : C.border, transition:"background 0.4s",
                    }} />
                  )}
                  {!isLast && (
                    <div style={{
                      position:"absolute", top:13, left:"50%", right:"-50%", height:2,
                      background: done ? C.accent : C.border, transition:"background 0.4s",
                    }} />
                  )}
                  <div style={{
                    width:26, height:26, borderRadius:"50%", zIndex:1,
                    display:"flex", alignItems:"center", justifyContent:"center",
                    fontSize:10, fontWeight:700,
                    background: done ? C.accent : active ? C.bg : C.border,
                    border:`2px solid ${done ? C.accent : active ? C.accent : C.border}`,
                    color: done ? "#0a0b0f" : active ? C.accent : C.muted,
                    boxShadow: active ? `0 0 0 5px ${C.accent}33` : "none",
                    transition:"all 0.3s",
                  }}>
                    {done ? "✓" : active ? "●" : i + 1}
                  </div>
                  <div style={{ fontSize:10, marginTop:5, color: done ? C.accent : active ? C.accent : C.muted, letterSpacing:"0.04em" }}>
                    {s}
                  </div>
                  <div style={{ fontSize:9, color: done ? C.accent+"99" : active ? C.warn : "transparent", marginTop:1 }}>
                    {done ? "done" : active ? "running…" : "·"}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Overall fill bar */}
          <div style={{ marginTop:16, height:3, background:C.border, borderRadius:2, overflow:"hidden" }}>
            <div style={{ height:"100%", background:C.accent, borderRadius:2, width:`${pct}%`, transition:"width 0.6s ease" }} />
          </div>
          <div style={{ marginTop:6, fontSize:11, color:C.muted, display:"flex", justifyContent:"space-between" }}>
            <span>{stageProgress.completed.length} / {STAGES.length} stages complete</span>
            {stageProgress.current && <span style={{ color:C.warn }}>● {stageProgress.current} in progress</span>}
            {!running && stageProgress.completed.length === STAGES.length && <span style={{ color:C.accent }}>✓ Pipeline finished</span>}
          </div>
        </div>
      )}

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:24 }}>
        {/* Left: config */}
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>

          {/* Quick-run shortcuts */}
          <div style={css.card}>
            <div style={{ fontSize:11, color:C.muted, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:12 }}>Quick Run</div>
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {QUICK_RUNS.slice(0,3).map(q => (
                <button key={q.label} onClick={() => run(q.stages)} disabled={running} style={{
                  ...css.btn(q.stages.includes("all") ? "primary" : "outline"),
                  textAlign:"left", padding:"9px 14px", display:"flex", justifyContent:"space-between", alignItems:"center",
                }}>
                  <span>{q.label}</span>
                  <span style={{ fontSize:10, opacity:0.7, fontWeight:400 }}>{q.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Stage picker */}
          <div style={css.card}>
            <div style={{ fontSize:11, color:C.muted, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:12 }}>Custom Stage Selection</div>

            {/* Flow diagram */}
            <div style={{ display:"flex", alignItems:"center", flexWrap:"wrap", gap:4, marginBottom:14 }}>
              {STAGES.map((s, i) => {
                const on = allSelected || selectedStages.includes(s);
                return (
                  <span key={s} style={{ display:"flex", alignItems:"center", gap:4 }}>
                    <button onClick={() => toggleStage(s)} style={{
                      padding:"5px 10px", borderRadius:6, fontSize:11, fontFamily:"inherit",
                      cursor:"pointer", fontWeight: on ? 700 : 400,
                      background: on ? C.accentDim : "transparent",
                      color: on ? C.accent : C.muted,
                      border:`1px solid ${on ? C.accent : C.border}`,
                      transition:"all 0.15s",
                    }}>
                      {STAGE_ICON[s]} {s}
                    </button>
                    {i < STAGES.length - 1 && <span style={{ color:C.border, fontSize:10 }}>→</span>}
                  </span>
                );
              })}
            </div>

            {/* Stage detail for selected */}
            <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
              {STAGES.filter(s => allSelected || selectedStages.includes(s)).map(s => (
                <div key={s} style={{ display:"flex", gap:8, fontSize:11 }}>
                  <span style={{ color:C.accent, width:55, flexShrink:0 }}>{s}</span>
                  <span style={{ color:C.muted }}>{STAGE_DESC[s]}</span>
                </div>
              ))}
            </div>

            <div style={{ marginTop:12, fontSize:10, color:C.muted }}>
              Click stages above to select/deselect. Click a selected stage again to deselect.
              {!allSelected && (
                <button onClick={() => setSelectedStages(["all"])} style={{ background:"none", border:"none", color:C.accent, cursor:"pointer", fontSize:10, fontFamily:"inherit", marginLeft:8 }}>
                  Reset to all →
                </button>
              )}
            </div>
          </div>

          {/* Options */}
          <div style={css.card}>
            <div style={{ fontSize:11, color:C.muted, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:12 }}>Options</div>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              <div>
                <label style={css.label}>Min Score (1–10)</label>
                <input style={css.input} type="number" min={1} max={10} value={minScore} onChange={e => setMinScore(+e.target.value)} />
              </div>
              <div>
                <label style={css.label}>Workers (parallel threads)</label>
                <input style={css.input} type="number" min={1} max={8} value={workers} onChange={e => setWorkers(+e.target.value)} />
              </div>
              <div>
                <label style={css.label}>Validation Mode</label>
                <select style={css.input} value={validation} onChange={e => setValidation(e.target.value)}>
                  <option value="lenient">lenient — fastest, fewest API calls</option>
                  <option value="normal">normal — recommended</option>
                  <option value="strict">strict — most thorough</option>
                </select>
              </div>
              <LlmRateInfo token={token} />
            </div>
          </div>

          {error && <div style={{ ...css.card, borderColor:C.danger+"55", color:C.danger, fontSize:12 }}>⚠ {error}</div>}

          {urlFilter.length > 0 ? (
            <div style={{
              ...css.card, borderColor:C.blue+"55", color:C.blue,
              padding:"8px 14px", display:"flex", justifyContent:"space-between", alignItems:"center", fontSize:11,
            }}>
              <span>▸ Scoped to {urlFilter.length} selected job{urlFilter.length > 1 ? "s" : ""} from Jobs tab</span>
              <button onClick={() => setUrlFilter([])} style={{
                background:"none", border:"none", color:C.muted, cursor:"pointer", fontSize:11, fontFamily:"inherit",
              }}>✕ Run all</button>
            </div>
          ) : null}

          <div style={{ display:"flex", gap:10 }}>
            <button onClick={() => run()} disabled={running} style={{ ...css.btn(), flex:1 }}>
              {running ? "◉ Running..." : `▶ Run ${allSelected ? "All Stages" : selectedStages.join(" + ")}${urlFilter.length > 0 ? ` (${urlFilter.length} jobs)` : ""}`}
            </button>
            {running && <button onClick={stop} style={css.btnDanger}>■ Stop</button>}
          </div>
        </div>

        {/* Right: logs */}
        <div style={{ ...css.card, display:"flex", flexDirection:"column" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <div style={{ fontSize:11, color:C.muted, letterSpacing:"0.1em", textTransform:"uppercase" }}>
              Live Logs
              {running && <span style={{ color:C.accent, marginLeft:10 }}>● LIVE</span>}
            </div>
            <button onClick={() => setLogs([])} style={{ ...css.btn("outline"), padding:"3px 10px", fontSize:10 }}>Clear</button>
          </div>
          <div style={{
            flex:1, minHeight:400, maxHeight:520, overflowY:"auto",
            background:"#08090d", borderRadius:6, padding:12,
            fontSize:12, lineHeight:1.6,
          }}>
            {logs.length === 0 && <div style={{ color:C.muted }}>Logs will appear here when pipeline runs...</div>}
            {logs.map((line, i) => (
              <div key={i} style={{
                color: line.includes("ERROR") ? C.danger
                     : line.includes("✓") || line.includes(" ok") ? C.accent
                     : line.includes("WARN") || line.includes("WARNING") ? C.warn
                     : line.startsWith("===") || line.startsWith("STAGE") ? C.blue
                     : "#94a3b8",
                fontFamily:"inherit",
              }}>{line}</div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Jobs tab ─────────────────────────────────────────────────────────────────

const STAGE_FILTERS = ["discovered","enriched","scored","tailored","ready","applied"];
const PAGE_SIZE = 25;

// What stage to suggest running next from each stage view
const NEXT_STAGE = {
  discovered: ["enrich"],
  enriched:   ["score"],
  scored:     ["tailor","cover","pdf"],
  tailored:   ["cover","pdf"],
  ready:      ["pdf"],
};

const KANBAN_COLS = [
  { id:"discovered", label:"Discovered", color:C.blue,     desc:"Found by scraper — not yet enriched" },
  { id:"enriched",   label:"Enriched",   color:"#38bdf8",  desc:"Full description fetched" },
  { id:"scored",     label:"Scored",     color:C.accent,   desc:"AI fit score assigned" },
  { id:"tailored",   label:"Tailored",   color:"#34d399",  desc:"Resume tailored by AI" },
  { id:"ready",      label:"Ready",      color:C.warn,     desc:"Apply URL available — ready to send" },
  { id:"applied",    label:"Applied",    color:"#fb923c",  desc:"Drop here to mark as applied ↓" },
];

function classifyJob(job) {
  if (job.applied_at || job.apply_status === "applied") return "applied";
  if (job.tailored_resume_path && job.has_apply_url)    return "ready";
  if (job.tailored_resume_path)                         return "tailored";
  if (job.fit_score != null)                            return "scored";
  if (job.has_description)                              return "enriched";
  return "discovered";
}

function JobsKanban({ jobs, loading, token, onRefresh }) {
  const [dragUrl, setDragUrl]       = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [toast, setToast]           = useState(null);

  const showToast = (msg, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const handleDrop = async (colId) => {
    setDropTarget(null);
    if (!dragUrl) return;
    if (colId !== "applied") {
      showToast("Run the pipeline to advance jobs between stages — only drag to Applied works here.", false);
      setDragUrl(null);
      return;
    }
    const job = jobs.find(j => j.url === dragUrl);
    if (!job) { setDragUrl(null); return; }
    try {
      await api("POST", "/jobs/mark-applied", { urls: [dragUrl] }, token);
      await api("POST", "/tracker/upsert", { job_url: dragUrl, status: "applied" }, token);
      showToast(`✓ "${job.title || "Job"}" marked as applied — added to Tracker`);
      onRefresh();
    } catch (e) { showToast("Failed: " + e.message, false); }
    setDragUrl(null);
  };

  // Group jobs into columns
  const grouped = useMemo(() => {
    const g = Object.fromEntries(KANBAN_COLS.map(c => [c.id, []]));
    for (const job of jobs) {
      const stage = classifyJob(job);
      if (g[stage]) g[stage].push(job);
    }
    return g;
  }, [jobs]);

  if (loading) return <Loader />;

  return (
    <div style={{ position:"relative" }}>
      {/* Toast */}
      {toast && (
        <div style={{
          position:"fixed", bottom:24, left:"50%", transform:"translateX(-50%)",
          background: toast.ok ? C.accent : C.danger, color:"#0a0b0f",
          borderRadius:8, padding:"10px 20px", fontSize:12, fontWeight:700,
          zIndex:300, boxShadow:"0 8px 32px rgba(0,0,0,0.4)", fontFamily:"inherit",
        }}>{toast.msg}</div>
      )}

      {/* Columns */}
      <div style={{ display:"flex", gap:12, overflowX:"auto", paddingBottom:16, alignItems:"flex-start" }}>
        {KANBAN_COLS.map(col => {
          const colJobs = grouped[col.id] || [];
          const isTarget = dropTarget === col.id;
          const isApplied = col.id === "applied";

          return (
            <div key={col.id}
              style={{ minWidth:210, width:210, flexShrink:0 }}
              onDragOver={e => { e.preventDefault(); setDropTarget(col.id); }}
              onDragLeave={() => setDropTarget(null)}
              onDrop={() => handleDrop(col.id)}>

              {/* Column header */}
              <div style={{
                padding:"8px 12px", borderRadius:"6px 6px 0 0",
                background: isTarget ? col.color+"44" : col.color+"22",
                borderBottom:`2px solid ${col.color}`,
                transition:"background 0.15s",
              }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ fontSize:11, fontWeight:700, color:col.color, letterSpacing:"0.06em" }}>
                    {col.label.toUpperCase()}
                  </span>
                  <span style={{ fontSize:10, color:col.color, background:col.color+"33", borderRadius:10, padding:"1px 7px", fontWeight:700 }}>
                    {colJobs.length}
                  </span>
                </div>
                <div style={{ fontSize:9, color:col.color+"99", marginTop:2 }}>{col.desc}</div>
              </div>

              {/* Drop zone */}
              <div style={{
                minHeight:120, paddingTop:8, paddingBottom:8,
                background: isTarget && isApplied ? col.color+"18" : "transparent",
                border: isTarget && isApplied ? `2px dashed ${col.color}` : "2px solid transparent",
                borderTop:"none", borderRadius:"0 0 6px 6px",
                transition:"all 0.15s",
                display:"flex", flexDirection:"column", gap:8,
              }}>
                {colJobs.length === 0 && !isTarget && (
                  <div style={{ fontSize:11, color:C.muted, textAlign:"center", paddingTop:20 }}>
                    {isApplied ? "Drag jobs here" : "—"}
                  </div>
                )}
                {isTarget && isApplied && (
                  <div style={{ fontSize:11, color:col.color, textAlign:"center", paddingTop:16, fontWeight:700 }}>
                    ↓ Drop to mark applied
                  </div>
                )}
                {colJobs.map(job => (
                  <div key={job.url}
                    draggable
                    onDragStart={() => setDragUrl(job.url)}
                    onDragEnd={() => { setDragUrl(null); setDropTarget(null); }}
                    style={{
                      ...css.card, padding:"10px 12px",
                      borderLeft:`3px solid ${col.color}`,
                      cursor:"grab", opacity: dragUrl === job.url ? 0.4 : 1,
                      transition:"opacity 0.15s",
                    }}>
                    <div style={{ fontSize:12, color:C.text, fontWeight:600, lineHeight:1.3, marginBottom:4,
                      overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>
                      <a href={job.url} target="_blank" rel="noreferrer"
                        style={{ color:C.blue, textDecoration:"none" }}
                        onClick={e => e.stopPropagation()}>
                        {job.title || "Untitled"}
                      </a>
                    </div>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <span style={{ fontSize:10, color:C.muted }}>{job.site || "—"}</span>
                      {job.fit_score != null && (
                        <span style={{ ...css.tag(job.fit_score >= 7 ? C.accent : job.fit_score >= 5 ? C.warn : C.danger), fontSize:9 }}>
                          {job.fit_score}/10
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize:10, color:C.muted, marginTop:3 }}>
                      {job.discovered_at ? new Date(job.discovered_at).toLocaleDateString() : ""}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function JobsTab({ token, onGoToPipeline }) {
  const [view, setView]         = useState("list");  // "list" | "kanban"
  const [allJobs, setAllJobs]   = useState([]);
  const [kanbanJobs, setKanbanJobs] = useState([]);
  const [kanbanLoading, setKanbanLoading] = useState(false);
  const [stage, setStage]       = useState("discovered");
  const [loading, setLoading]   = useState(false);
  const [counts, setCounts]     = useState({});
  const [search, setSearch]     = useState("");
  const [filterSite, setFilterSite]   = useState("");
  const [filterScore, setFilterScore] = useState("");
  const [page, setPage]         = useState(0);
  const [selected, setSelected] = useState(new Set());

  const loadKanban = async () => {
    setKanbanLoading(true);
    try { setKanbanJobs(await api("GET", "/jobs?stage=discovered&limit=2000", null, token)); }
    finally { setKanbanLoading(false); }
  };

  useEffect(() => { if (view === "kanban") loadKanban(); }, [view, token]);

  const load = async (s) => {
    setLoading(true); setSelected(new Set()); setPage(0);
    try { setAllJobs(await api("GET", `/jobs?stage=${s}&limit=1000`, null, token)); }
    finally { setLoading(false); }
  };

  const loadCounts = async () => {
    const results = await Promise.all(
      STAGE_FILTERS.map(s => api("GET", `/jobs?stage=${s}&limit=1000`, null, token).then(r => [s, r.length]).catch(() => [s, 0]))
    );
    setCounts(Object.fromEntries(results));
  };

  useEffect(() => { load(stage); }, [stage, token]);
  useEffect(() => { loadCounts(); }, [token]);
  useEffect(() => { setPage(0); }, [search, filterSite, filterScore]);

  const sites = useMemo(() => [...new Set(allJobs.map(j => j.site).filter(Boolean))].sort(), [allJobs]);

  const filtered = useMemo(() => {
    let jobs = allJobs;
    if (search) {
      const q = search.toLowerCase();
      jobs = jobs.filter(j =>
        (j.title||"").toLowerCase().includes(q) ||
        (j.location||"").toLowerCase().includes(q) ||
        (j.site||"").toLowerCase().includes(q)
      );
    }
    if (filterSite)  jobs = jobs.filter(j => j.site === filterSite);
    if (filterScore) jobs = jobs.filter(j => j.fit_score != null && j.fit_score >= +filterScore);
    return jobs;
  }, [allJobs, search, filterSite, filterScore]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated  = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const allPageSelected = paginated.length > 0 && paginated.every(j => selected.has(j.url));
  const toggleAll = () => {
    setSelected(prev => {
      const n = new Set(prev);
      if (allPageSelected) paginated.forEach(j => n.delete(j.url));
      else paginated.forEach(j => n.add(j.url));
      return n;
    });
  };
  const toggleOne = (url) => setSelected(prev => {
    const n = new Set(prev); n.has(url) ? n.delete(url) : n.add(url); return n;
  });

  const openSelected = () => {
    allJobs.filter(j => selected.has(j.url)).forEach(j => window.open(j.url, "_blank"));
  };

  const nextStages = NEXT_STAGE[stage] || [];

  return (
    <div>
      {/* Header + view toggle */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <SectionTitle>Jobs</SectionTitle>
        <div style={{ display:"flex", gap:6, background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:3 }}>
          {[["list","≡ List"],["kanban","⬡ Kanban"]].map(([v, label]) => (
            <button key={v} onClick={() => setView(v)} style={{
              padding:"5px 14px", borderRadius:6, fontSize:11, fontFamily:"inherit", cursor:"pointer",
              background: view === v ? C.accent : "transparent",
              color: view === v ? "#0a0b0f" : C.muted,
              border:"none", fontWeight: view === v ? 700 : 400, transition:"all 0.15s",
            }}>{label}</button>
          ))}
        </div>
      </div>

      {/* Kanban view */}
      {view === "kanban" && (
        <JobsKanban jobs={kanbanJobs} loading={kanbanLoading} token={token}
          onRefresh={() => { loadKanban(); loadCounts(); }} />
      )}

      {/* List view */}
      {view === "list" && <>
      {/* Stage filter tabs */}
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:16 }}>
        {STAGE_FILTERS.map(s => (
          <button key={s} onClick={() => setStage(s)} style={{ ...css.btn(stage === s ? "primary" : "outline"), padding:"5px 14px", fontSize:11, display:"flex", alignItems:"center", gap:6 }}>
            {s}
            {counts[s] != null && (
              <span style={{
                background: stage === s ? "rgba(0,0,0,0.25)" : counts[s] > 0 ? C.accentDim : C.border,
                color: stage === s ? "#0a0b0f" : counts[s] > 0 ? C.accent : C.muted,
                borderRadius:10, padding:"1px 7px", fontSize:10, fontWeight:700,
              }}>{counts[s]}</span>
            )}
          </button>
        ))}
        <button onClick={() => { load(stage); loadCounts(); }} style={{ ...css.btn("outline"), padding:"5px 10px", fontSize:11, marginLeft:"auto" }}>↻ Refresh</button>
      </div>

      {/* Search + filter bar */}
      <div style={{ display:"flex", gap:8, marginBottom:12, flexWrap:"wrap" }}>
        <div style={{ flex:1, minWidth:180, position:"relative" }}>
          <input style={{ ...css.input, paddingLeft:28 }} placeholder="Search title, location, company…"
            value={search} onChange={e => setSearch(e.target.value)} />
          <span style={{ position:"absolute", left:9, top:"50%", transform:"translateY(-50%)", color:C.muted, fontSize:11, pointerEvents:"none" }}>🔍</span>
        </div>
        <select style={{ ...css.input, width:160 }} value={filterSite} onChange={e => setFilterSite(e.target.value)}>
          <option value="">All sites</option>
          {sites.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select style={{ ...css.input, width:150 }} value={filterScore} onChange={e => setFilterScore(e.target.value)}>
          <option value="">Any score</option>
          <option value="9">9+ excellent</option>
          <option value="8">8+ great</option>
          <option value="7">7+ good (≥min)</option>
          <option value="5">5+ fair</option>
        </select>
        {(search || filterSite || filterScore) && (
          <button onClick={() => { setSearch(""); setFilterSite(""); setFilterScore(""); }}
            style={{ ...css.btn("outline"), padding:"8px 12px", fontSize:11 }}>✕ Clear</button>
        )}
      </div>

      {/* Selection action bar */}
      {selected.size > 0 && (
        <div style={{ ...css.card, marginBottom:12, padding:"10px 16px", borderColor:C.accent+"44", display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
          <span style={{ fontSize:12, color:C.accent, fontWeight:700 }}>{selected.size} selected</span>
          <button onClick={openSelected} style={{ ...css.btn("outline"), padding:"5px 12px", fontSize:11 }}>
            ↗ Open in tabs
          </button>
          {nextStages.length > 0 && (
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ fontSize:11, color:C.muted }}>Run next stage:</span>
              {nextStages.map(s => (
                <button key={s} onClick={() => onGoToPipeline && onGoToPipeline([s], [...selected])}
                  style={{ ...css.btn(), padding:"5px 12px", fontSize:11 }}>
                  ▶ {s}
                </button>
              ))}
            </div>
          )}
          <button onClick={async () => {
            if (!confirm(`Delete ${selected.size} job(s)? This cannot be undone.`)) return;
            await api("POST", "/jobs/delete", { urls: [...selected] }, token);
            setSelected(new Set());
            load(stage);
            loadCounts();
          }} style={{ background:"transparent", border:`1px solid ${C.danger}`, borderRadius:6, color:C.danger, cursor:"pointer", fontSize:11, fontFamily:"inherit", padding:"5px 12px" }}>
            🗑 Delete {selected.size}
          </button>
          <button onClick={() => setSelected(new Set())} style={{ marginLeft:"auto", background:"none", border:"none", color:C.muted, cursor:"pointer", fontSize:11, fontFamily:"inherit" }}>
            ✕ Deselect all
          </button>
        </div>
      )}

      {/* Result count */}
      <div style={{ fontSize:11, color:C.muted, marginBottom:10 }}>
        {filtered.length} jobs{(search||filterSite||filterScore) ? ` (filtered from ${allJobs.length})` : ""}
        {" · "}page {page+1} of {totalPages}
        {selected.size > 0 && <span style={{ color:C.accent, marginLeft:8 }}>{selected.size} selected</span>}
      </div>

      {/* Table */}
      {loading ? <Loader /> : (
        <div style={{ ...css.card, padding:0, overflow:"hidden", marginBottom:14 }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
            <thead>
              <tr style={{ borderBottom:`1px solid ${C.border}` }}>
                <th style={{ padding:"10px 14px", width:32 }}>
                  <input type="checkbox" checked={allPageSelected} onChange={toggleAll} />
                </th>
                {["Title","Location","Site","Score","Status","Applied","Discovered"].map(h => (
                  <th key={h} style={{ padding:"10px 14px", color:C.muted, fontWeight:400, letterSpacing:"0.08em", textTransform:"uppercase", fontSize:10, textAlign:"left" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 && (
                <tr><td colSpan={8} style={{ padding:24, textAlign:"center", color:C.muted }}>
                  {allJobs.length > 0 ? "No jobs match your filters." : "No jobs found for this stage."}
                </td></tr>
              )}
              {paginated.map((job, i) => {
                const sel = selected.has(job.url);
                return (
                  <tr key={i}
                    style={{ borderBottom:`1px solid ${C.border}`, background: sel ? C.accentDim : "transparent", cursor:"pointer" }}
                    onClick={() => toggleOne(job.url)}
                    onMouseEnter={e => { if (!sel) e.currentTarget.style.background = C.surface; }}
                    onMouseLeave={e => { if (!sel) e.currentTarget.style.background = "transparent"; }}>
                    <td style={{ padding:"9px 14px" }} onClick={e => { e.stopPropagation(); toggleOne(job.url); }}>
                      <input type="checkbox" checked={sel} onChange={() => toggleOne(job.url)} />
                    </td>
                    <td style={{ padding:"9px 14px", maxWidth:240 }}>
                      <a href={job.url} target="_blank" rel="noreferrer"
                        style={{ color:C.blue, textDecoration:"none" }}
                        onClick={e => e.stopPropagation()}>
                        {job.title || "Untitled"}
                      </a>
                    </td>
                    <td style={{ padding:"9px 14px", color:C.muted, fontSize:11 }}>{job.location || "—"}</td>
                    <td style={{ padding:"9px 14px" }}><span style={css.tag(C.blue)}>{job.site || "—"}</span></td>
                    <td style={{ padding:"9px 14px" }}>
                      {job.fit_score != null
                        ? <span style={css.tag(job.fit_score >= 7 ? C.accent : job.fit_score >= 5 ? C.warn : C.danger)}>{job.fit_score}/10</span>
                        : <span style={{ color:C.border }}>—</span>}
                    </td>
                    <td style={{ padding:"9px 14px" }}>
                      {job.apply_status ? <span style={css.tag(job.apply_status === "applied" ? C.accent : C.warn)}>{job.apply_status}</span> : <span style={{ color:C.border }}>—</span>}
                    </td>
                    <td style={{ padding:"9px 14px" }}>
                      {job.apply_attempts > 0
                        ? <span style={css.tag(job.apply_attempts > 1 ? C.warn : C.muted)}>{job.apply_attempts}×</span>
                        : <span style={{ color:C.border }}>—</span>}
                    </td>
                    <td style={{ padding:"9px 14px", color:C.muted, fontSize:11 }}>
                      {job.discovered_at ? new Date(job.discovered_at).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
          <button onClick={() => setPage(0)} disabled={page===0}
            style={{ ...css.btn("outline"), padding:"5px 10px", fontSize:11, opacity:page===0?0.3:1 }}>«</button>
          <button onClick={() => setPage(p => Math.max(0, p-1))} disabled={page===0}
            style={{ ...css.btn("outline"), padding:"5px 10px", fontSize:11, opacity:page===0?0.3:1 }}>‹ Prev</button>

          {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
            let n;
            if (totalPages <= 7)            n = i;
            else if (page < 4)              n = i;
            else if (page > totalPages - 4) n = totalPages - 7 + i;
            else                            n = page - 3 + i;
            return (
              <button key={n} onClick={() => setPage(n)} style={{
                ...css.btn(n === page ? "primary" : "outline"),
                padding:"5px 0", fontSize:11, minWidth:30,
              }}>{n + 1}</button>
            );
          })}

          <button onClick={() => setPage(p => Math.min(totalPages-1, p+1))} disabled={page>=totalPages-1}
            style={{ ...css.btn("outline"), padding:"5px 10px", fontSize:11, opacity:page>=totalPages-1?0.3:1 }}>Next ›</button>
          <button onClick={() => setPage(totalPages-1)} disabled={page>=totalPages-1}
            style={{ ...css.btn("outline"), padding:"5px 10px", fontSize:11, opacity:page>=totalPages-1?0.3:1 }}>»</button>
        </div>
      )}
      </>}
    </div>
  );
}

// ─── Tracker tab ─────────────────────────────────────────────────────────────

const BOARD_STAGES = [
  { id:"queue",     label:"Queue",         color:C.muted,   type:"pipeline" },
  { id:"qualified", label:"Qualified",     color:C.blue,    type:"pipeline" },
  { id:"ready",     label:"Ready to Send", color:"#34d399", type:"pipeline" },
  { id:"applied",   label:"Applied",       color:C.blue,    type:"app"      },
  { id:"response",  label:"Response",      color:C.warn,    type:"app"      },
  { id:"interview", label:"Interview",     color:"#a78bfa", type:"app"      },
  { id:"offer",     label:"Offer",         color:"#fb923c", type:"app"      },
  { id:"rejected",  label:"Rejected",      color:C.danger,  type:"mixed"    },
  { id:"canceled",  label:"Canceled",      color:C.muted,   type:"app"      },
];

const ROUND_TYPES = [
  { id:"hr",            label:"HR Screen"     },
  { id:"technical",     label:"Technical"     },
  { id:"system_design", label:"System Design" },
  { id:"culture",       label:"Culture Fit"   },
  { id:"final",         label:"Final"         },
];

const CHANNELS = [
  { id:"linkedin", label:"LinkedIn" },
  { id:"portal",   label:"Portal"   },
  { id:"referral", label:"Referral" },
  { id:"email",    label:"Email"    },
];

const RESPONSE_TYPES = [
  { id:"hr_screen",   label:"HR Screen"   },
  { id:"tech_screen", label:"Tech Screen" },
  { id:"take_home",   label:"Take-Home"   },
  { id:"panel",       label:"Panel"       },
  { id:"offer",       label:"Offer"       },
];

const NOTE_TYPES = [
  { id:"note",          label:"Note",     icon:"📝" },
  { id:"email",         label:"Email",    icon:"✉️" },
  { id:"call",          label:"Call",     icon:"📞" },
  { id:"interview",     label:"Interview",icon:"🎯" },
  { id:"offer",         label:"Offer",    icon:"💼" },
  { id:"status_change", label:"Status",   icon:"🔄" },
];

function daysAgo(iso) {
  if (!iso) return null;
  const diff = Math.floor((Date.now() - new Date(iso)) / 86400000);
  return diff === 0 ? "today" : diff === 1 ? "1d ago" : `${diff}d ago`;
}

// ── Reusable tracker components (module-level per rerender-no-inline-components) ──

function ScoreBadge({ score }) {
  if (score == null) return null;
  const color = score >= 7 ? C.accent : score >= 5 ? C.warn : C.danger;
  return (
    <span style={{
      background:color+"22", border:`1px solid ${color}55`,
      borderRadius:4, padding:"1px 6px", fontSize:10, color, fontWeight:700,
    }}>{score}/10</span>
  );
}

function NoteTimeline({ notes, onDelete }) {
  if (!notes?.length) return <div style={{ fontSize:11, color:C.muted }}>No activity yet.</div>;
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
      {notes.map(n => {
        const nt = NOTE_TYPES.find(t => t.id === n.note_type) || NOTE_TYPES[0];
        const isStatus = n.note_type === "status_change";
        return (
          <div key={n.id} style={{
            borderLeft:`2px solid ${isStatus ? C.accent : C.border}`,
            paddingLeft:12, paddingTop:4, paddingBottom:4, position:"relative",
          }}>
            <div style={{ fontSize:10, color:C.muted, marginBottom:2 }}>
              {nt.icon} {nt.label} · {new Date(n.created_at).toLocaleString()}
            </div>
            <div style={{ fontSize:12, color:isStatus ? C.accent : C.text, lineHeight:1.5 }}>{n.note}</div>
            {!isStatus ? (
              <button onClick={() => onDelete(n.id)} style={{
                position:"absolute", top:4, right:0,
                background:"none", border:"none", color:C.muted, cursor:"pointer", fontSize:11,
              }}>✕</button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ActivityNoteInput({ entityType, entityId, token, onSaved }) {
  const [text, setText] = useState("");
  const [type, setType] = useState("note");
  const submit = async () => {
    if (!text.trim()) return;
    await api("POST", "/tracker/notes", { entity_type:entityType, entity_id:entityId, note:text.trim(), note_type:type }, token);
    setText("");
    onSaved();
  };
  return (
    <div>
      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:8 }}>
        {NOTE_TYPES.filter(n => n.id !== "status_change").map(n => (
          <button key={n.id} onClick={() => setType(n.id)} style={{
            padding:"3px 9px", borderRadius:12, fontSize:10, fontFamily:"inherit", cursor:"pointer",
            background:type===n.id ? C.accentDim : "transparent",
            color:type===n.id ? C.accent : C.muted,
            border:`1px solid ${type===n.id ? C.accent : C.border}`,
          }}>{n.icon} {n.label}</button>
        ))}
      </div>
      <div style={{ display:"flex", gap:8 }}>
        <textarea style={{ ...css.input, flex:1, height:60, resize:"vertical", fontSize:11 }}
          placeholder="Write a note, email, call outcome…"
          value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key==="Enter" && e.metaKey) submit(); }} />
        <button onClick={submit} style={{ ...css.btn(), padding:"8px 14px", fontSize:11, alignSelf:"flex-end" }}>+ Add</button>
      </div>
    </div>
  );
}

function ChecklistSection({ applicationId, checklist, token, onRefresh }) {
  const [newItem, setNewItem] = useState("");
  const add = async () => {
    if (!newItem.trim()) return;
    await api("POST", "/tracker/checklist", { application_id:applicationId, item:newItem.trim() }, token);
    setNewItem(""); onRefresh();
  };
  const toggle = async (id, done) => {
    await api("PATCH", `/tracker/checklist/${id}`, { done:!done }, token); onRefresh();
  };
  const remove = async (id) => {
    await api("DELETE", `/tracker/checklist/${id}`, null, token); onRefresh();
  };
  return (
    <div>
      <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:10 }}>
        {checklist.length === 0 ? (
          <div style={{ fontSize:11, color:C.muted }}>No prep items yet.</div>
        ) : checklist.map(item => (
          <div key={item.id} style={{ display:"flex", alignItems:"center", gap:8 }}>
            <input type="checkbox" checked={!!item.done} onChange={() => toggle(item.id, item.done)}
              style={{ accentColor:C.accent, cursor:"pointer" }} />
            <span style={{ fontSize:12, flex:1, color:item.done?C.muted:C.text,
              textDecoration:item.done?"line-through":"none" }}>{item.item}</span>
            <button onClick={() => remove(item.id)} style={{
              background:"none", border:"none", color:C.muted, cursor:"pointer", fontSize:11,
            }}>✕</button>
          </div>
        ))}
      </div>
      <div style={{ display:"flex", gap:8 }}>
        <input style={{ ...css.input, fontSize:11 }} placeholder="Add prep item…"
          value={newItem} onChange={e => setNewItem(e.target.value)}
          onKeyDown={e => { if (e.key==="Enter") add(); }} />
        <button onClick={add} style={{ ...css.btn("outline"), padding:"6px 12px", fontSize:11 }}>+</button>
      </div>
    </div>
  );
}

function RoundRow({ round, token, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    round_type:round.round_type, scheduled_at:round.scheduled_at||"",
    interviewer_names:round.interviewer_names||"", outcome:round.outcome,
    tasks:round.tasks||"", notes:round.notes||"",
  });
  const save = async () => {
    await api("PATCH", `/tracker/round/${round.id}`, form, token);
    setEditing(false); onUpdate();
  };
  const outcomeColor = round.outcome==="passed" ? C.accent : round.outcome==="failed" ? C.danger : C.warn;
  return (
    <div style={{ borderLeft:`3px solid ${outcomeColor}`, paddingLeft:12, marginBottom:12 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
        <span style={{ fontSize:12, fontWeight:700, color:C.text }}>
          Round {round.round_number} · {ROUND_TYPES.find(r=>r.id===round.round_type)?.label||round.round_type}
        </span>
        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          <span style={{ fontSize:10, color:outcomeColor, fontWeight:700 }}>{round.outcome}</span>
          <button onClick={() => setEditing(e=>!e)} style={{ background:"none", border:"none", color:C.muted, cursor:"pointer", fontSize:11 }}>
            {editing ? "✕" : "✎"}
          </button>
        </div>
      </div>
      {round.scheduled_at ? (
        <div style={{ fontSize:10, color:C.muted, marginBottom:4 }}>
          {new Date(round.scheduled_at).toLocaleString()}{round.interviewer_names ? ` · ${round.interviewer_names}` : ""}
        </div>
      ) : null}
      {round.tasks ? <div style={{ fontSize:11, color:C.text, marginBottom:4 }}>{round.tasks}</div> : null}
      {editing ? (
        <div style={{ display:"flex", flexDirection:"column", gap:8, marginTop:8 }}>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            {ROUND_TYPES.map(rt => (
              <button key={rt.id} onClick={() => setForm(f=>({...f,round_type:rt.id}))} style={{
                padding:"2px 8px", borderRadius:4, fontSize:10, fontFamily:"inherit", cursor:"pointer",
                background:form.round_type===rt.id ? C.accentDim : "transparent",
                color:form.round_type===rt.id ? C.accent : C.muted,
                border:`1px solid ${form.round_type===rt.id ? C.accent : C.border}`,
              }}>{rt.label}</button>
            ))}
          </div>
          <input type="datetime-local" style={{ ...css.input, fontSize:11 }}
            value={form.scheduled_at} onChange={e => setForm(f=>({...f,scheduled_at:e.target.value}))} />
          <input style={{ ...css.input, fontSize:11 }} placeholder="Interviewers"
            value={form.interviewer_names} onChange={e => setForm(f=>({...f,interviewer_names:e.target.value}))} />
          <textarea style={{ ...css.input, fontSize:11, height:48, resize:"vertical" }} placeholder="Tasks / questions"
            value={form.tasks} onChange={e => setForm(f=>({...f,tasks:e.target.value}))} />
          <textarea style={{ ...css.input, fontSize:11, height:48, resize:"vertical" }} placeholder="Notes"
            value={form.notes} onChange={e => setForm(f=>({...f,notes:e.target.value}))} />
          <div style={{ display:"flex", gap:6 }}>
            {["pending","passed","failed"].map(o => (
              <button key={o} onClick={() => setForm(f=>({...f,outcome:o}))} style={{
                padding:"4px 12px", borderRadius:4, fontSize:11, fontFamily:"inherit", cursor:"pointer",
                background:form.outcome===o ? (o==="passed"?C.accent:o==="failed"?C.danger:C.warn)+"33" : "transparent",
                color:o==="passed"?C.accent:o==="failed"?C.danger:C.warn,
                border:`1px solid ${form.outcome===o?(o==="passed"?C.accent:o==="failed"?C.danger:C.warn):C.border}`,
              }}>{o}</button>
            ))}
          </div>
          <button onClick={save} style={{ ...css.btn(), fontSize:11, padding:"6px 0" }}>✓ Save Round</button>
        </div>
      ) : null}
    </div>
  );
}

function OfferSection({ offer, token, onUpdate }) {
  const [form, setForm] = useState({
    base_salary:offer?.base_salary||"", bonus:offer?.bonus||"",
    equity:offer?.equity||"", benefits:offer?.benefits||"",
    start_date:offer?.start_date||"", offer_deadline:offer?.offer_deadline||"",
    tc_notes:offer?.tc_notes||"", negotiation_notes:offer?.negotiation_notes||"",
  });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try { await api("PATCH", `/tracker/offer/${offer.id}`, form, token); onUpdate(); }
    finally { setSaving(false); }
  };
  const decide = async (decision) => {
    await api("PATCH", `/tracker/offer/${offer.id}`, { decision }, token); onUpdate();
  };
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
      {[
        ["base_salary","Base salary","text"],["bonus","Bonus","text"],
        ["equity","Equity","text"],["benefits","Benefits","text"],
        ["start_date","Start date","date"],["offer_deadline","Offer deadline","date"],
      ].map(([k,label,type]) => (
        <div key={k} style={{ display:"flex", alignItems:"center", gap:10 }}>
          <label style={{ ...css.label, marginBottom:0, width:120, flexShrink:0 }}>{label}</label>
          <input type={type} style={{ ...css.input, fontSize:11 }}
            value={form[k]} onChange={e => setForm(f=>({...f,[k]:e.target.value}))} />
        </div>
      ))}
      <div>
        <label style={css.label}>T&C Notes</label>
        <textarea style={{ ...css.input, height:60, resize:"vertical", fontSize:11 }}
          value={form.tc_notes} onChange={e => setForm(f=>({...f,tc_notes:e.target.value}))} />
      </div>
      <div>
        <label style={css.label}>Negotiation Notes</label>
        <textarea style={{ ...css.input, height:60, resize:"vertical", fontSize:11 }}
          value={form.negotiation_notes} onChange={e => setForm(f=>({...f,negotiation_notes:e.target.value}))} />
      </div>
      <button onClick={save} disabled={saving} style={{ ...css.btn("outline"), fontSize:11 }}>
        {saving ? "Saving…" : "✓ Save Offer Details"}
      </button>
      {offer ? (
        <div>
          <div style={{ fontSize:10, color:C.muted, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:8 }}>
            Decision · current: <span style={{ color:offer.decision==="accepted"?C.accent:C.text }}>{offer.decision}</span>
          </div>
          <div style={{ display:"flex", gap:8 }}>
            {[{id:"accepted",label:"✓ Accept",color:C.accent},{id:"countered",label:"↔ Counter",color:C.warn},{id:"declined",label:"✕ Decline",color:C.danger}].map(d => (
              <button key={d.id} onClick={() => decide(d.id)} style={{
                flex:1, padding:"8px 0", borderRadius:6, fontSize:11, fontFamily:"inherit", cursor:"pointer", fontWeight:700,
                background:offer.decision===d.id ? d.color+"33" : "transparent",
                color:d.color, border:`1px solid ${offer.decision===d.id?d.color:C.border}`,
              }}>{d.label}</button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PipelineCard({ record, stageColor, onClick }) {
  return (
    <div onClick={onClick} style={{
      ...css.card, padding:"10px 12px", cursor:"pointer",
      borderLeft:`3px solid ${stageColor}`, transition:"background 0.15s",
    }}
      onMouseEnter={e => { e.currentTarget.style.background="#1a1d26"; }}
      onMouseLeave={e => { e.currentTarget.style.background=C.surface; }}>
      <div style={{ fontSize:12, fontWeight:600, color:C.text, lineHeight:1.3, marginBottom:4,
        overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>
        {record.title || record.job_url?.split("/").pop() || "Untitled"}
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:4 }}>
        <span style={{ fontSize:10, color:C.muted }}>{record.site||"—"}</span>
        <ScoreBadge score={record.fit_score} />
      </div>
      <div style={{ fontSize:10, color:C.muted, marginTop:4 }}>
        {daysAgo(record.updated_at)}
        {record.app_count > 0 ? <span style={{ marginLeft:6, color:C.blue }}>{record.app_count} app{record.app_count>1?"s":""}</span> : null}
      </div>
    </div>
  );
}

function ApplicationCard({ record, stageColor, onClick }) {
  return (
    <div onClick={onClick} style={{
      ...css.card, padding:"10px 12px", cursor:"pointer",
      borderLeft:`3px solid ${stageColor}`, transition:"background 0.15s",
    }}
      onMouseEnter={e => { e.currentTarget.style.background="#1a1d26"; }}
      onMouseLeave={e => { e.currentTarget.style.background=C.surface; }}>
      <div style={{ fontSize:12, fontWeight:600, color:C.text, lineHeight:1.3, marginBottom:4,
        overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>
        {record.title||"Untitled"}
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span style={{ fontSize:10, color:C.muted }}>{record.site||"—"}</span>
        <ScoreBadge score={record.fit_score} />
      </div>
      <div style={{ fontSize:10, color:C.muted, marginTop:4 }}>
        {record.channel ? <span style={{ marginRight:6 }}>{record.channel}</span> : null}
        {daysAgo(record.applied_at)}
      </div>
      {record.rounds_total > 0 ? (
        <div style={{ fontSize:10, color:"#a78bfa", marginTop:3 }}>
          {record.rounds_passed}/{record.rounds_total} rounds passed
          {record.rounds_pending > 0 ? ` · ${record.rounds_pending} pending` : ""}
        </div>
      ) : null}
    </div>
  );
}

function PipelineDrawer({ pid, token, onClose, onRefresh }) {
  const [detail, setDetail]       = useState(null);
  const [form, setForm]           = useState({});
  const [saving, setSaving]       = useState(false);
  const [applyChannel, setApplyChannel] = useState("portal");

  const load = useCallback(async () => {
    const d = await api("GET", `/tracker/pipeline/${pid}`, null, token);
    setDetail(d);
    setForm({
      queue_notes:d.queue_notes||"", fit_notes:d.fit_notes||"",
      resume_version:d.resume_version||"", cover_notes:d.cover_notes||"",
      target_salary:d.target_salary||"", referral_contact:d.referral_contact||"",
      channel:d.channel||"portal", apply_deadline:d.apply_deadline||"",
    });
  }, [pid, token]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try { await api("PATCH", `/tracker/pipeline/${pid}`, form, token); }
    finally { setSaving(false); }
  };

  const action = async (endpoint, body={}) => {
    await api("POST", endpoint, body, token); await load(); onRefresh();
  };

  if (!detail) return <div style={{ padding:24, color:C.muted }}>Loading…</div>;

  const { job, stage, notes, applications } = detail;
  const stageInfo = BOARD_STAGES.find(s => s.id===stage) || BOARD_STAGES[0];

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%" }}>
      <div style={{ padding:"20px 24px 16px", borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
          <div style={{ flex:1, marginRight:12 }}>
            <a href={detail.job_url} target="_blank" rel="noreferrer"
              style={{ color:C.blue, textDecoration:"none", fontSize:14, fontWeight:700, lineHeight:1.4, display:"block" }}>
              {job?.title||"Untitled"}
            </a>
            <div style={{ fontSize:11, color:C.muted, marginTop:4 }}>
              {job?.site}{job?.location ? ` · ${job.location}` : ""}
              {job?.fit_score != null ? <span style={{ marginLeft:8 }}>★ {job.fit_score}/10</span> : null}
            </div>
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", color:C.muted, cursor:"pointer", fontSize:18 }}>✕</button>
        </div>
        <div style={{ marginTop:10 }}>
          <span style={{
            display:"inline-block", padding:"3px 10px", borderRadius:12, fontSize:10, fontWeight:700,
            background:stageInfo.color+"22", color:stageInfo.color, border:`1px solid ${stageInfo.color}44`,
          }}>{stageInfo.label}</span>
        </div>
      </div>

      <div style={{ flex:1, overflowY:"auto", padding:"20px 24px", display:"flex", flexDirection:"column", gap:20 }}>
        <div>
          <label style={css.label}>Queue Notes</label>
          <textarea style={{ ...css.input, height:72, resize:"vertical", fontSize:11 }}
            placeholder="Why queued? Any red flags?" value={form.queue_notes}
            onChange={e => setForm(f=>({...f,queue_notes:e.target.value}))} />
        </div>

        {(stage==="qualified"||stage==="ready"||stage==="applied") ? (
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            <div style={{ fontSize:10, color:C.muted, letterSpacing:"0.1em", textTransform:"uppercase" }}>Qualification</div>
            <div>
              <label style={css.label}>Why I'm a good fit</label>
              <textarea style={{ ...css.input, height:72, resize:"vertical", fontSize:11 }}
                value={form.fit_notes} onChange={e => setForm(f=>({...f,fit_notes:e.target.value}))} />
            </div>
            {[["resume_version","Resume version","text"],["cover_notes","Cover letter notes","text"],
              ["target_salary","Target salary","text"],["referral_contact","Referral contact","text"]].map(([k,label,type]) => (
              <div key={k} style={{ display:"flex", alignItems:"center", gap:10 }}>
                <label style={{ ...css.label, marginBottom:0, width:140, flexShrink:0 }}>{label}</label>
                <input type={type} style={{ ...css.input, fontSize:11 }}
                  value={form[k]} onChange={e => setForm(f=>({...f,[k]:e.target.value}))} />
              </div>
            ))}
          </div>
        ) : null}

        {(stage==="ready"||stage==="applied") ? (
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            <div style={{ fontSize:10, color:C.muted, letterSpacing:"0.1em", textTransform:"uppercase" }}>Application Config</div>
            <div>
              <label style={css.label}>Channel</label>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                {CHANNELS.map(ch => (
                  <button key={ch.id} onClick={() => setForm(f=>({...f,channel:ch.id}))} style={{
                    padding:"4px 12px", borderRadius:6, fontSize:11, fontFamily:"inherit", cursor:"pointer",
                    background:form.channel===ch.id?C.accentDim:"transparent",
                    color:form.channel===ch.id?C.accent:C.muted,
                    border:`1px solid ${form.channel===ch.id?C.accent:C.border}`,
                  }}>{ch.label}</button>
                ))}
              </div>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <label style={{ ...css.label, marginBottom:0, width:140, flexShrink:0 }}>Apply-by deadline</label>
              <input type="date" style={{ ...css.input, fontSize:11 }}
                value={form.apply_deadline} onChange={e => setForm(f=>({...f,apply_deadline:e.target.value}))} />
            </div>
          </div>
        ) : null}

        <button onClick={save} disabled={saving} style={{ ...css.btn("outline"), fontSize:11 }}>
          {saving ? "Saving…" : "✓ Save"}
        </button>

        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <div style={{ fontSize:10, color:C.muted, letterSpacing:"0.1em", textTransform:"uppercase" }}>Actions</div>
          {stage==="queue" ? (
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={() => action(`/tracker/pipeline/${pid}/qualify`)} style={{ ...css.btn(), flex:1, fontSize:11 }}>Qualify →</button>
              <button onClick={() => action(`/tracker/pipeline/${pid}/discard`)} style={{ ...css.btnDanger, flex:1, fontSize:11 }}>Discard</button>
            </div>
          ) : null}
          {stage==="qualified" ? (
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={() => action(`/tracker/pipeline/${pid}/ready`)} style={{ ...css.btn(), flex:1, fontSize:11 }}>Mark Ready →</button>
              <button onClick={() => action(`/tracker/pipeline/${pid}/send-back`)} style={{ ...css.btn("outline"), flex:1, fontSize:11 }}>← Queue</button>
            </div>
          ) : null}
          {stage==="ready" ? (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              <div>
                <label style={css.label}>Apply via</label>
                <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:8 }}>
                  {CHANNELS.map(ch => (
                    <button key={ch.id} onClick={() => setApplyChannel(ch.id)} style={{
                      padding:"4px 12px", borderRadius:6, fontSize:11, fontFamily:"inherit", cursor:"pointer",
                      background:applyChannel===ch.id?C.accentDim:"transparent",
                      color:applyChannel===ch.id?C.accent:C.muted,
                      border:`1px solid ${applyChannel===ch.id?C.accent:C.border}`,
                    }}>{ch.label}</button>
                  ))}
                </div>
              </div>
              <button onClick={() => action(`/tracker/pipeline/${pid}/apply`, { channel:applyChannel })} style={{ ...css.btn(), fontSize:11 }}>Apply Now →</button>
              <button onClick={() => action(`/tracker/pipeline/${pid}/send-back`)} style={{ ...css.btn("outline"), fontSize:11 }}>← Qualified</button>
            </div>
          ) : null}
        </div>

        {applications?.length > 0 ? (
          <div>
            <div style={{ fontSize:10, color:C.muted, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:8 }}>
              Applications ({applications.length})
            </div>
            {applications.map(a => (
              <div key={a.id} style={{ fontSize:11, color:C.text, marginBottom:6, display:"flex", justifyContent:"space-between" }}>
                <span>{a.channel} · {a.app_stage}</span>
                <span style={{ color:C.muted }}>{daysAgo(a.applied_at)}</span>
              </div>
            ))}
          </div>
        ) : null}

        <div>
          <div style={{ fontSize:10, color:C.muted, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10 }}>Activity</div>
          <ActivityNoteInput entityType="pipeline" entityId={pid} token={token} onSaved={load} />
          <div style={{ marginTop:12 }}>
            <NoteTimeline notes={notes} onDelete={async id => { await api("DELETE",`/tracker/notes/${id}`,null,token); load(); }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ApplicationDrawer({ aid, token, onClose, onRefresh }) {
  const [detail, setDetail]       = useState(null);
  const [form, setForm]           = useState({});
  const [saving, setSaving]       = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async () => {
    const d = await api("GET", `/tracker/application/${aid}`, null, token);
    setDetail(d);
    setForm({
      contact_name:d.contact_name||"", contact_email:d.contact_email||"",
      followup_date:d.followup_date||"", response_type:d.response_type||"",
      response_date:d.response_date||"", interview_booked:d.interview_booked||"",
      interview_format:d.interview_format||"", interviewer_names:d.interviewer_names||"",
    });
  }, [aid, token]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try { await api("PATCH", `/tracker/application/${aid}`, form, token); }
    finally { setSaving(false); }
  };

  const transition = async (endpoint, body={}) => {
    await api("POST", endpoint, body, token); await load(); onRefresh();
  };

  if (!detail) return <div style={{ padding:24, color:C.muted }}>Loading…</div>;

  const { job, app_stage, rounds, offer, checklist, notes } = detail;
  const stageInfo = BOARD_STAGES.find(s => s.id===app_stage) || BOARD_STAGES[3];

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%" }}>
      <div style={{ padding:"20px 24px 16px", borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
          <div style={{ flex:1, marginRight:12 }}>
            <a href={detail.job_url} target="_blank" rel="noreferrer"
              style={{ color:C.blue, textDecoration:"none", fontSize:14, fontWeight:700, lineHeight:1.4, display:"block" }}>
              {job?.title||"Untitled"}
            </a>
            <div style={{ fontSize:11, color:C.muted, marginTop:4 }}>
              {job?.site}{job?.location ? ` · ${job.location}` : ""}
              {job?.fit_score != null ? <span style={{ marginLeft:8 }}>★ {job.fit_score}/10</span> : null}
            </div>
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", color:C.muted, cursor:"pointer", fontSize:18 }}>✕</button>
        </div>
        <div style={{ marginTop:10 }}>
          <span style={{
            display:"inline-block", padding:"3px 10px", borderRadius:12, fontSize:10, fontWeight:700,
            background:stageInfo.color+"22", color:stageInfo.color, border:`1px solid ${stageInfo.color}44`,
          }}>{stageInfo.label}</span>
          <span style={{ fontSize:10, color:C.muted, marginLeft:10 }}>
            via {detail.channel} · applied {daysAgo(detail.applied_at)}
          </span>
        </div>
      </div>

      <div style={{ flex:1, overflowY:"auto", padding:"20px 24px", display:"flex", flexDirection:"column", gap:20 }}>
        <div>
          <div style={{ fontSize:10, color:C.muted, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10 }}>Contact</div>
          {[["contact_name","Name","text"],["contact_email","Email","text"],["followup_date","Follow-up","date"]].map(([k,label,type]) => (
            <div key={k} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
              <label style={{ ...css.label, marginBottom:0, width:100, flexShrink:0 }}>{label}</label>
              <input type={type} style={{ ...css.input, fontSize:11 }}
                value={form[k]} onChange={e => setForm(f=>({...f,[k]:e.target.value}))} />
            </div>
          ))}
        </div>

        {(app_stage==="response"||app_stage==="interview"||app_stage==="offer") ? (
          <div>
            <div style={{ fontSize:10, color:C.muted, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10 }}>Response</div>
            <div style={{ marginBottom:8 }}>
              <label style={css.label}>Response type</label>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                {RESPONSE_TYPES.map(rt => (
                  <button key={rt.id} onClick={() => setForm(f=>({...f,response_type:rt.id}))} style={{
                    padding:"3px 10px", borderRadius:6, fontSize:10, fontFamily:"inherit", cursor:"pointer",
                    background:form.response_type===rt.id?C.accentDim:"transparent",
                    color:form.response_type===rt.id?C.accent:C.muted,
                    border:`1px solid ${form.response_type===rt.id?C.accent:C.border}`,
                  }}>{rt.label}</button>
                ))}
              </div>
            </div>
            {[["interview_booked","Interview date","datetime-local"],["interview_format","Format","text"],["interviewer_names","Interviewers","text"]].map(([k,label,type]) => (
              <div key={k} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
                <label style={{ ...css.label, marginBottom:0, width:120, flexShrink:0 }}>{label}</label>
                <input type={type} style={{ ...css.input, fontSize:11 }}
                  value={form[k]} onChange={e => setForm(f=>({...f,[k]:e.target.value}))} />
              </div>
            ))}
          </div>
        ) : null}

        <button onClick={save} disabled={saving} style={{ ...css.btn("outline"), fontSize:11 }}>
          {saving ? "Saving…" : "✓ Save"}
        </button>

        {app_stage==="response" ? (
          <div>
            <div style={{ fontSize:10, color:C.muted, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10 }}>Prep Checklist</div>
            <ChecklistSection applicationId={aid} checklist={checklist} token={token} onRefresh={load} />
          </div>
        ) : null}

        {(app_stage==="interview"||app_stage==="offer") ? (
          <div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <div style={{ fontSize:10, color:C.muted, letterSpacing:"0.1em", textTransform:"uppercase" }}>Interview Rounds</div>
              <button onClick={async () => { await api("POST",`/tracker/application/${aid}/rounds`,{round_type:"technical"},token); load(); }}
                style={{ ...css.btn("outline"), padding:"3px 10px", fontSize:10 }}>+ Add Round</button>
            </div>
            {rounds.length===0 ? (
              <div style={{ fontSize:11, color:C.muted }}>No rounds yet.</div>
            ) : rounds.map(r => <RoundRow key={r.id} round={r} token={token} onUpdate={load} />)}
          </div>
        ) : null}

        {app_stage==="offer" ? (
          <div>
            <div style={{ fontSize:10, color:C.muted, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10 }}>Offer Details</div>
            {offer ? <OfferSection offer={offer} token={token} onUpdate={load} /> : (
              <div style={{ fontSize:11, color:C.muted }}>Offer record loading…</div>
            )}
          </div>
        ) : null}

        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <div style={{ fontSize:10, color:C.muted, letterSpacing:"0.1em", textTransform:"uppercase" }}>Actions</div>
          {app_stage==="applied" ? (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              <button onClick={() => transition(`/tracker/application/${aid}/response`)} style={{ ...css.btn(), fontSize:11 }}>Got Response →</button>
              <button onClick={() => transition(`/tracker/application/${aid}/apply-again`,{channel:detail.channel})} style={{ ...css.btn("outline"), fontSize:11 }}>Apply Again (new attempt)</button>
            </div>
          ) : null}
          {app_stage==="response" ? (
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={() => transition(`/tracker/application/${aid}/interview`)} style={{ ...css.btn(), flex:1, fontSize:11 }}>Confirm Interview →</button>
              <button onClick={() => transition(`/tracker/application/${aid}/offer`)} style={{ ...css.btn("outline"), flex:1, fontSize:11 }}>Direct Offer →</button>
            </div>
          ) : null}
          {app_stage==="interview" ? (
            <button onClick={() => transition(`/tracker/application/${aid}/offer`)} style={{ ...css.btn(), fontSize:11, width:"100%" }}>Offer Received →</button>
          ) : null}
          {(app_stage!=="rejected"&&app_stage!=="canceled"&&app_stage!=="offer") ? (
            showReject ? (
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                <input style={{ ...css.input, fontSize:11 }} placeholder="Rejection reason (optional)"
                  value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
                <div style={{ display:"flex", gap:8 }}>
                  <button onClick={() => transition(`/tracker/application/${aid}/reject`,{reason:rejectReason})}
                    style={{ ...css.btnDanger, flex:1, fontSize:11 }}>Confirm Rejected</button>
                  <button onClick={() => setShowReject(false)} style={{ ...css.btn("outline"), flex:1, fontSize:11 }}>Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setShowReject(true)} style={{ ...css.btnDanger, fontSize:11 }}>Mark Rejected</button>
            )
          ) : null}
        </div>

        <div>
          <div style={{ fontSize:10, color:C.muted, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10 }}>Activity</div>
          <ActivityNoteInput entityType="application" entityId={aid} token={token} onSaved={load} />
          <div style={{ marginTop:12 }}>
            <NoteTimeline notes={notes} onDelete={async id => { await api("DELETE",`/tracker/notes/${id}`,null,token); load(); }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function TrackerTab({ token }) {
  const [board, setBoard]           = useState({});
  const [alerts, setAlerts]         = useState({ overdue:[], interview_soon:[] });
  const [loading, setLoading]       = useState(true);
  const [drawerType, setDrawerType] = useState(null);
  const [drawerId, setDrawerId]     = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [b, a] = await Promise.all([
        api("GET", "/tracker/board", null, token),
        api("GET", "/tracker/alerts", null, token).catch(() => ({ overdue:[], interview_soon:[] })),
      ]);
      setBoard(b);
      setAlerts(a);
    } catch (_) {}
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const openPipeline = (id) => { setDrawerType("pipeline"); setDrawerId(id); };
  const openApp      = (id) => { setDrawerType("app");      setDrawerId(id); };
  const closeDrawer  = ()   => { setDrawerType(null);       setDrawerId(null); };

  return (
    <div style={{ position:"relative" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <SectionTitle>Application Pipeline</SectionTitle>
        <button onClick={load} style={{ ...css.btn("outline"), fontSize:11, padding:"5px 12px" }}>↻ Refresh</button>
      </div>

      {(alerts.overdue.length > 0 || alerts.interview_soon.length > 0) ? (
        <div style={{ display:"flex", gap:10, marginBottom:16, flexWrap:"wrap" }}>
          {alerts.overdue.length > 0 ? (
            <div style={{ ...css.card, borderColor:C.warn+"55", padding:"10px 16px", fontSize:12, color:C.warn, flex:1 }}>
              ⚠ <strong>{alerts.overdue.length}</strong> overdue follow-up{alerts.overdue.length>1?"s":""} — no update in 7+ days
            </div>
          ) : null}
          {alerts.interview_soon.length > 0 ? (
            <div style={{ ...css.card, borderColor:"#a78bfa55", padding:"10px 16px", fontSize:12, color:"#a78bfa", flex:1 }}>
              🎯 <strong>{alerts.interview_soon.length}</strong> interview{alerts.interview_soon.length>1?"s":""} within 48 hours
            </div>
          ) : null}
        </div>
      ) : null}

      {loading ? <Loader /> : (
        <div style={{ display:"flex", gap:12, overflowX:"auto", paddingBottom:16, alignItems:"flex-start" }}>
          {BOARD_STAGES.map(stage => {
            const items = board[stage.id] || [];
            return (
              <div key={stage.id} style={{ minWidth:210, width:210, flexShrink:0 }}>
                <div style={{
                  padding:"8px 12px", borderRadius:"6px 6px 0 0",
                  background:stage.color+"22", borderBottom:`2px solid ${stage.color}`,
                  display:"flex", justifyContent:"space-between", alignItems:"center",
                }}>
                  <span style={{ fontSize:11, fontWeight:700, color:stage.color, letterSpacing:"0.06em" }}>
                    {stage.label.toUpperCase()}
                  </span>
                  <span style={{ fontSize:10, color:stage.color, background:stage.color+"33", borderRadius:10, padding:"1px 7px", fontWeight:700 }}>
                    {items.length}
                  </span>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:8, paddingTop:8, minHeight:80 }}>
                  {items.length === 0 ? (
                    <div style={{ fontSize:11, color:C.muted, textAlign:"center", padding:"16px 0" }}>empty</div>
                  ) : items.map(item => (
                    item.app_stage ? (
                      <ApplicationCard key={`app-${item.id}`} record={item} stageColor={stage.color} onClick={() => openApp(item.id)} />
                    ) : (
                      <PipelineCard key={`pipe-${item.id}`} record={item} stageColor={stage.color} onClick={() => openPipeline(item.id)} />
                    )
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {drawerId !== null ? (
        <>
          <div onClick={closeDrawer} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:200 }} />
          <div style={{
            position:"fixed", top:0, right:0, bottom:0, width:480,
            background:C.surface, borderLeft:`1px solid ${C.border}`,
            overflowY:"auto", zIndex:201,
            fontFamily:"'IBM Plex Mono','Courier New',monospace",
          }}>
            {drawerType==="pipeline" ? (
              <PipelineDrawer pid={drawerId} token={token} onClose={closeDrawer} onRefresh={load} />
            ) : (
              <ApplicationDrawer aid={drawerId} token={token} onClose={closeDrawer} onRefresh={load} />
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

// ─── Shared components ────────────────────────────────────────────────────────

function SectionTitle({ children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text, letterSpacing: "-0.01em" }}>{children}</h2>
      <div style={{ height: 2, width: 32, background: C.accent, borderRadius: 2, marginTop: 6 }} />
    </div>
  );
}

function Loader() {
  return <div style={{ color: C.muted, padding: 24 }}>Loading...</div>;
}

// ─── Onboarding tour ─────────────────────────────────────────────────────────

const TOUR_STEPS = [
  {
    icon: "◈",
    title: "Welcome to ApplyPilot Server",
    body: "Your autonomous job application engine. It scrapes LinkedIn, Indeed, Glassdoor and 30+ other boards — then uses AI to score every posting against your resume, tailor your CV, and write cover letters. All running in the background while you do other things.",
  },
  {
    icon: "⚙",
    title: "First: set up your profile",
    body: "The Setup tab walks you through 8 steps — personal info, work authorisation, compensation, skills, resume, and search config. Each step has a plain-English explanation of what it's used for.",
    tip: "Hit ⚡ Load Demo Profile at the top to fill in a complete software engineer profile with one click so you can try the pipeline right now.",
    action: { label: "Open Setup →", tab: "setup" },
  },
  {
    icon: "🔑",
    title: "Add a free Gemini API key",
    body: "The AI stages (score, tailor, cover letter) need an LLM. Get a free key at aistudio.google.com — takes about 2 minutes. Paste it into Setup → Step 6 (API Keys).",
    tip: "OpenAI and local LLMs via Ollama also work if you already have them.",
    action: { label: "Go to Step 6 — API Keys →", tab: "setup" },
  },
  {
    icon: "▶",
    title: "Run the Pipeline",
    body: "Once setup is complete, go to the Pipeline tab. Select which stages to run (or leave it on 'all'), then hit Run Pipeline. A live log streams every line of output so you can see exactly what's happening.",
    tip: "Start with just 'discover' to see what jobs are out there before running the heavier AI stages.",
    action: { label: "Open Pipeline →", tab: "pipeline" },
  },
  {
    icon: "◉",
    title: "Review your Jobs",
    body: "After the pipeline finishes, head to the Jobs tab. Filter by 'scored', 'tailored', or 'ready'. Click any job title to open the original listing. Jobs scoring 7 or above are strong matches — those get tailored resumes and cover letters by default.",
    action: { label: "Open Jobs →", tab: "jobs" },
  },
  {
    icon: "✓",
    title: "You're all set — happy hunting",
    body: "That's the full loop: Setup → Pipeline → Jobs. Run it daily or on a schedule to catch new postings. The more accurate your profile and resume, the better the AI scoring gets.",
    tip: "You can replay this tour any time by clicking the ? button in the sidebar.",
    finish: true,
  },
];

function TourModal({ onClose, onNavigate }) {
  const [step, setStep] = useState(0);
  const current = TOUR_STEPS[step];
  const isLast  = step === TOUR_STEPS.length - 1;

  const next = () => isLast ? onClose() : setStep(s => s + 1);
  const prev = () => step > 0 && setStep(s => s - 1);

  const handleAction = () => {
    onNavigate(current.action.tab);
    onClose();
  };

  return (
    <div style={{
      position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", backdropFilter:"blur(6px)",
      display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: C.surface, border:`1px solid ${C.border}`, borderRadius:14,
        width:500, padding:"40px 44px", boxShadow:"0 32px 80px rgba(0,0,0,0.7)",
        position:"relative", fontFamily:"'IBM Plex Mono','Courier New',monospace",
      }}>
        {/* Skip */}
        <button onClick={onClose} style={{
          position:"absolute", top:16, right:18,
          background:"none", border:"none", color:C.muted, cursor:"pointer",
          fontSize:11, fontFamily:"inherit", letterSpacing:"0.05em",
        }}>skip tour</button>

        {/* Step counter */}
        <div style={{ fontSize:10, color:C.muted, letterSpacing:"0.15em", textTransform:"uppercase", marginBottom:20 }}>
          {step + 1} / {TOUR_STEPS.length}
        </div>

        {/* Icon */}
        <div style={{ fontSize:40, color:C.accent, marginBottom:18, lineHeight:1 }}>{current.icon}</div>

        {/* Title */}
        <div style={{ fontSize:19, fontWeight:700, color:C.text, marginBottom:14, letterSpacing:"-0.01em", lineHeight:1.3 }}>
          {current.title}
        </div>

        {/* Body */}
        <div style={{ fontSize:13, color:C.muted, lineHeight:1.85, marginBottom:20 }}>
          {current.body}
        </div>

        {/* Tip callout */}
        {current.tip && (
          <div style={{
            background:C.accentDim, border:`1px solid ${C.accent}33`,
            borderRadius:6, padding:"10px 14px", marginBottom:24,
            fontSize:11, color:C.accent, lineHeight:1.75,
          }}>
            💡 {current.tip}
          </div>
        )}

        {/* Action CTA */}
        {current.action && (
          <button onClick={handleAction} style={{ ...css.btn("outline"), width:"100%", marginBottom:20, textAlign:"center" }}>
            {current.action.label}
          </button>
        )}

        {/* Progress dots + nav */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginTop: current.action ? 0 : 4 }}>
          <div style={{ display:"flex", gap:5 }}>
            {TOUR_STEPS.map((_, i) => (
              <div key={i} onClick={() => setStep(i)} style={{
                height:5, width: i === step ? 22 : 5, borderRadius:3,
                background: i === step ? C.accent : i < step ? C.accent+"55" : C.border,
                transition:"all 0.25s", cursor:"pointer",
              }} />
            ))}
          </div>
          <div style={{ display:"flex", gap:8 }}>
            {step > 0 && (
              <button onClick={prev} style={{ ...css.btn("outline"), padding:"7px 14px", fontSize:12 }}>← Back</button>
            )}
            <button onClick={next} style={{ ...css.btn(), padding:"7px 18px" }}>
              {isLast ? "✓ Let's go" : "Next →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── App root ─────────────────────────────────────────────────────────────────

export default function App() {
  const { token, user, login, logout, authed } = useAuth();
  const [tab, setTab]                   = useState("dashboard");
  const [showTour, setShowTour]         = useState(false);
  const [pipelineStages, setPipelineStages] = useState(["all"]);
  const [pipelineUrls, setPipelineUrls]     = useState([]);

  useEffect(() => {
    if (authed && !localStorage.getItem("ap_tour_done")) setShowTour(true);
  }, [authed]);

  const closeTour = () => { localStorage.setItem("ap_tour_done","1"); setShowTour(false); };
  const replayTour = () => setShowTour(true);

  const goToPipeline = (stages, urls = []) => { setPipelineStages(stages); setPipelineUrls(urls); setTab("pipeline"); };

  if (!authed) return <AuthScreen onAuth={login} />;

  const CONTENT = {
    dashboard: <DashboardTab token={token} />,
    setup:     <SetupTab token={token} />,
    pipeline:  <PipelineTab token={token} initialStages={pipelineStages} initialUrls={pipelineUrls} />,
    jobs:      <JobsTab token={token} onGoToPipeline={goToPipeline} />,
    tracker:   <TrackerTab token={token} />,
  };

  return (
    <div style={{ ...css.app, display:"flex" }}>
      <Sidebar tab={tab} setTab={setTab} user={user} onLogout={logout} onTour={replayTour} />
      <main style={{ flex:1, padding:"32px 36px", overflowY:"auto", maxHeight:"100vh" }}>
        {CONTENT[tab]}
      </main>
      {showTour && <TourModal onClose={closeTour} onNavigate={(t) => { setTab(t); closeTour(); }} />}
    </div>
  );
}
