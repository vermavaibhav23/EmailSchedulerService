import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Check,
  ChevronDown,
  Clock,
  Inbox,
  LogOut,
  Mail,
  Plus,
  Search,
  Send,
  Slack,
  Upload,
  X,
} from "lucide-react";
import Papa from "papaparse";
import { api, setCsrf, type User, type Sender, type Email } from "./api";
import "./styles.css";
type Settings = {
  minDelayMs: number;
  maxHourlyLimit: number;
  maxRecipients: number;
};
function Login({ initialError }: { initialError: string }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/auth/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, email, password, ...(mode === "register" ? { name } : {}) }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({ error: "Sign-in failed. Please try again." }));
        throw new Error(result.error);
      }
      window.location.assign("/");
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <main className="login">
    <div className="login-brand">ONB<span>OUTBOX LABS</span></div>
    <section className="login-card" aria-labelledby="login-title">
      <div className="login-icon"><Mail size={25} /></div>
      <h1 id="login-title">{mode === "login" ? "Login" : "Create an account"}</h1>
      <p>{mode === "login" ? "Welcome back to your email workspace" : "Your email workspace starts here"}</p>
      <a className="google" href="/auth/google"><strong className="google-g">G</strong> Login with Google</a>
      <div className="divider"><span>or continue with email</span></div>
      <form className="email-login" onSubmit={submit}>
        {mode === "register" && <label htmlFor="login-name">Full name<input id="login-name" autoComplete="name" value={name} onChange={e => setName(e.target.value)} required maxLength={100} disabled={busy} placeholder="Your name" /></label>}
        <label htmlFor="login-email">Email address<input id="login-email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required maxLength={254} disabled={busy} placeholder="you@example.com" /></label>
        <label htmlFor="login-password">Password<input id="login-password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={e => setPassword(e.target.value)} required minLength={12} maxLength={128} disabled={busy} placeholder="Enter your password" aria-describedby={mode === "register" ? "password-hint" : undefined} /></label>
        {mode === "register" && <span id="password-hint" className="password-hint">Use at least 12 characters.</span>}
        {error && <div className="error" role="alert">{error}</div>}
        <button className="email-submit" type="submit" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Log in with email" : "Create account"}<ArrowRight size={15} /></button>
      </form>
      <p className="account-switch">{mode === "login" ? "New here?" : "Already have an account?"} <button type="button" disabled={busy} onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); setPassword(""); }}>{mode === "login" ? "Create an account" : "Log in"}</button></p>
    </section>
    <footer>Email scheduling, made simple.</footer>
  </main>;
}
function App() {
  const [user, setUser] = useState<User | null>(null),
    [boot, setBoot] = useState(true),
    [authError, setAuthError] = useState(""),
    [view, setView] = useState<"scheduled" | "sent">("scheduled"),
    [compose, setCompose] = useState(false),
    [senders, setSenders] = useState<Sender[]>([]),
    [settings, setSettings] = useState<Settings>({
      minDelayMs: 2000,
      maxHourlyLimit: 200,
      maxRecipients: 10000,
    }),
    [emails, setEmails] = useState<Email[]>([]),
    [stats, setStats] = useState({ scheduled: 0, sent: 0 }),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [query, setQuery] = useState(""),
    [debounced, setDebounced] = useState(""),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [slack, setSlack] = useState<{
      team_name: string;
      channel_name: string;
    } | null>(null),
    [admin, setAdmin] = useState(false),
    [selected, setSelected] = useState<Email | null>(null),
    [creating, setCreating] = useState(false);
  useEffect(() => {
    api<{ user: User; csrfToken: string; admin: boolean }>("/me")
      .then((data) => {
        setUser(data.user);
        setCsrf(data.csrfToken);
        setAdmin(data.admin);
      })
      .catch((e) => {
        if (e.message !== "Please sign in") setAuthError(e.message);
      })
      .finally(() => setBoot(false));
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(query);
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (!user) return;
    Promise.all([
      api<{ senders: Sender[] }>("/senders"),
      api<Settings>("/settings"),
      api<{ connection: typeof slack }>("/slack"),
    ])
      .then(([s, c, n]) => {
        setSenders(s.senders);
        setSettings(c);
        setSlack(n.connection);
      })
      .catch((e) => setError(e.message));
  }, [user]);
  useEffect(() => {
    if (!user) return;
    let alive = true;
    let first = true;
    async function load() {
      if (first) setLoading(true);
      try {
        const [list, count] = await Promise.all([
          api<{ emails: Email[]; total: number }>(
            `/emails?view=${view}&page=${page}&q=${encodeURIComponent(debounced)}`,
          ),
          api<typeof stats>("/stats"),
        ]);
        if (alive) {
          setEmails(list.emails);
          setTotal(list.total);
          setStats(count);
          setError("");
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
        first = false;
      }
    }
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [user, view, page, debounced, compose]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  async function addSender() {
    setCreating(true);
    try {
      const { sender } = await api<{ sender: Sender }>("/senders/ethereal", {
        method: "POST",
        body: JSON.stringify({ name: `Sender ${senders.length + 1}` }),
      });
      setSenders((s) => [...s, sender]);
      setToast("Ethereal sender connected");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }
  if (boot)
    return (
      <div className="center">
        <span className="spinner" />
        Loading your workspace…
      </div>
    );
  if (!user)
    return <Login initialError={authError} />;
  return (
    <div className="workspace">
      <aside>
        <a className="brand" href="/">
          ONB<span>OUTBOX LABS</span>
        </a>
        <div className="profile">
          {user.avatar ? <img src={user.avatar} referrerPolicy="no-referrer" alt="" /> : <span className="avatar-fallback">{user.name.slice(0, 2).toUpperCase()}</span>}
          <div>
            <strong>{user.name}</strong>
            <span title={user.email}>{user.email}</span>
          </div>
          <ChevronDown size={14} />
        </div>
        <button className="compose-button" onClick={() => setCompose(true)}>
          <Plus size={17} />
          Compose New Email
        </button>
        <div className="nav-title">WORKSPACE</div>
        <button
          className={`nav ${view === "scheduled" ? "active" : ""}`}
          onClick={() => {
            setView("scheduled");
            setPage(1);
          }}
        >
          <Clock size={17} />
          Scheduled<span>{stats.scheduled}</span>
        </button>
        <button
          className={`nav ${view === "sent" ? "active" : ""}`}
          onClick={() => {
            setView("sent");
            setPage(1);
          }}
        >
          <Send size={17} />
          Sent<span>{stats.sent}</span>
        </button>
        <div className="sidebar-bottom">
          <div className="connection">
            <span className="dot" />
            Persistent scheduling
          </div>
          <p>Powered by BullMQ & Redis</p>
          {admin && (
            <a
              className="queue-link"
              href="/admin/queues"
              target="_blank"
              rel="noreferrer"
            >
              Open queue dashboard <ArrowRight size={13} />
            </a>
          )}
          <button
            className="nav"
            onClick={() =>
              api("/logout", { method: "POST" })
                .then(() => setUser(null))
                .catch((e) => setError(e.message))
            }
          >
            <LogOut size={16} />
            Log out
          </button>
        </div>
      </aside>
      <div className="main">
        <header>
          <div className="search">
            <Search size={17} />
            <input
              placeholder="Search email, subject or message"
              aria-label="Search emails"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd>⌕</kbd>
          </div>
          <div className="header-actions">
            {slack ? (
              <button
                className="slack"
                onClick={() =>
                  api("/slack", { method: "DELETE" })
                    .then(() => setSlack(null))
                    .catch((e) => setError(e.message))
                }
              >
                <Slack size={16} />
                {slack.channel_name}
                <span>Disconnect</span>
              </button>
            ) : (
              <a className="slack" href="/integrations/slack/connect">
                <Slack size={16} />
                Connect Slack
              </a>
            )}
            {user.avatar ? (
              <img
                className="avatar"
                src={user.avatar}
                referrerPolicy="no-referrer"
                alt={user.name}
              />
            ) : (
              <span className="avatar avatar-fallback" aria-label={user.name}>
                {user.name.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>
        </header>
        <main className="content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">YOUR OUTBOX</p>
              <h1>
                {view === "scheduled" ? "Scheduled Emails" : "Sent Emails"}
              </h1>
              <p>
                {view === "scheduled"
                  ? "Your next conversations, ready to go."
                  : "A record of every email and its delivery status."}
              </p>
            </div>
            <button className="outline" onClick={() => setCompose(true)}>
              <Plus size={16} />
              Compose New Email
            </button>
          </div>
          <div className="list-caption">
            <span>
              {total} {view === "scheduled" ? "scheduled" : "completed"} emails
            </span>
            <span>
              <span className="dot" />
              Updates every 5 seconds
            </span>
          </div>
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          <div className="email-table">
            <div className="table-head">
              <span>Recipient</span>
              <span>Subject</span>
              <span>{view === "scheduled" ? "Scheduled for" : "Sent at"}</span>
              <span>Status</span>
            </div>
            {loading ? (
              <div className="empty">
                <span className="spinner" />
                <p>Loading emails…</p>
              </div>
            ) : emails.length === 0 ? (
              <div className="empty">
                <div className="empty-icon">
                  <Inbox size={29} />
                </div>
                <h2>
                  {query
                    ? "No matching emails"
                    : view === "scheduled"
                      ? "Your outbox is all clear"
                      : "No sent emails yet"}
                </h2>
                <p>
                  {query
                    ? "Try a different email address or subject."
                    : "Compose your first email and we’ll take care of the timing."}
                </p>
                {!query && (
                  <button className="primary" onClick={() => setCompose(true)}>
                    <Plus size={16} />
                    Compose New Email
                  </button>
                )}
              </div>
            ) : (
              emails.map((e) => (
                <button
                  className="email-row"
                  key={e.id}
                  onClick={() => setSelected(e)}
                >
                  <span className="recipient">
                    <span className="recipient-avatar">
                      {e.recipient[0].toUpperCase()}
                    </span>
                    {e.recipient}
                  </span>
                  <span className="subject">
                    <strong>{e.subject}</strong>
                    <span>{e.body}</span>
                  </span>
                  <span className="date">
                    {formatDate(e.sent_at || e.scheduled_at)}
                  </span>
                  <span className={`badge ${e.status}`}>
                    <span />
                    {e.status}
                  </span>
                </button>
              ))
            )}
          </div>
          {total > 25 && (
            <div className="pagination">
              <button
                className="outline"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </button>
              <span>
                Page {page} of {Math.ceil(total / 25)}
              </span>
              <button
                className="outline"
                disabled={page * 25 >= total}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          )}
        </main>
      </div>
      {compose && (
        <Compose
          user={user}
          senders={senders}
          settings={settings}
          creating={creating}
          addSender={addSender}
          close={() => setCompose(false)}
          done={(n) => {
            setCompose(false);
            setView("scheduled");
            setPage(1);
            setToast(`${n} emails scheduled successfully`);
          }}
        />
      )}
      {selected && (
        <div className="modal-backdrop">
          <section className="detail modal">
            <button
              className="icon-button close"
              onClick={() => setSelected(null)}
              aria-label="Close"
            >
              <X />
            </button>
            <p className="eyebrow">EMAIL DETAILS</p>
            <h2>{selected.subject}</h2>
            <p>To {selected.recipient}</p>
            <span className={`badge ${selected.status}`}>
              {selected.status}
            </span>
            <pre>{selected.body}</pre>
            {selected.error && <div className="error">{selected.error}</div>}
            {selected.preview_url && (
              <a
                className="outline"
                href={selected.preview_url}
                target="_blank"
                rel="noreferrer"
              >
                View in Ethereal <ArrowRight size={15} />
              </a>
            )}
          </section>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}
function Compose({
  user,
  senders,
  settings,
  creating,
  addSender,
  close,
  done,
}: {
  user: User;
  senders: Sender[];
  settings: Settings;
  creating: boolean;
  addSender: () => Promise<void>;
  close: () => void;
  done: (n: number) => void;
}) {
  const [senderId, setSenderId] = useState(senders[0]?.id || ""),
    [recipients, setRecipients] = useState<string[]>([]),
    [subject, setSubject] = useState(""),
    [body, setBody] = useState(""),
    [start, setStart] = useState(localDate(new Date(Date.now() + 120000))),
    [delay, setDelay] = useState(settings.minDelayMs / 1000),
    [limit, setLimit] = useState(settings.maxHourlyLimit),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [key, setKey] = useState(crypto.randomUUID()),
    [fileName, setFileName] = useState(""),
    [manual, setManual] = useState("");
  useEffect(() => {
    if (!senderId && senders.length) setSenderId(senders.at(-1)!.id);
  }, [senders, senderId]);
  function parse(text: string) {
    const cells = Papa.parse<string[]>(text, {
      skipEmptyLines: true,
    }).data.flat();
    const addresses = cells
      .flatMap((cell) => cell.split(/[\s;,]+/))
      .map((s) => s.trim().toLowerCase())
      .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
    return [...new Set(addresses)];
  }
  const detected = [...new Set([...recipients, ...parse(manual)])];
  async function upload(file?: File) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError("Upload a file smaller than 2 MB");
      return;
    }
    setRecipients(parse(await file.text()));
    setFileName(file.name);
    setKey(crypto.randomUUID());
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!senderId || !detected.length) {
      setError("Choose a sender and add at least one valid recipient");
      return;
    }
    if (detected.length > settings.maxRecipients) {
      setError(`Maximum ${settings.maxRecipients} recipients per campaign`);
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ count: number }>("/campaigns", {
        method: "POST",
        headers: { "idempotency-key": key },
        body: JSON.stringify({
          senderId,
          recipients: detected,
          subject,
          body,
          startAt: new Date(start).toISOString(),
          delayMs: Math.round(delay * 1000),
          hourlyLimit: limit,
        }),
      });
      done(result.count || detected.length);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="compose-overlay">
      <form
        className="compose-page"
        onSubmit={submit}
        onChange={() => setKey(crypto.randomUUID())}
      >
        <div className="compose-top">
          <button
            type="button"
            className="back"
            disabled={busy}
            onClick={close}
          >
            <ArrowLeft size={18} />
            Compose New Email
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Scheduling…" : "Schedule"}
            <CalendarClock size={16} />
          </button>
        </div>
        <div className="compose-body">
          <div className="form-line">
            <label htmlFor="from">From</label>
            <input
              id="from"
              value={`${user.name} <${user.email}>`}
              readOnly
              aria-readonly="true"
            />
          </div>
          <div className="form-line">
            <label htmlFor="sender">Delivery</label>
            <select
              id="sender"
              value={senderId}
              onChange={(e) => setSenderId(e.target.value)}
            >
              {!senders.length && <option value="">Select a sender</option>}
              {senders.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} &lt;{s.email}&gt;
                </option>
              ))}
            </select>
            <button
              type="button"
              className="text-button"
              disabled={creating || busy}
              onClick={addSender}
            >
              {creating ? "Connecting…" : "+ Add Ethereal sender"}
            </button>
          </div>
          <div className="form-line">
            <label htmlFor="recipients">To</label>
            <input
              id="recipients"
              placeholder="Add email addresses, separated by commas"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
            />
            <label className="upload">
              <Upload size={14} />
              Upload list
              <input
                type="file"
                accept=".csv,.txt"
                onChange={(e) => void upload(e.target.files?.[0])}
              />
            </label>
          </div>
          {(fileName || detected.length > 0) && (
            <div className="lead-count">
              <Check size={14} />
              {detected.length} unique email addresses detected
              {fileName && ` · ${fileName}`}
            </div>
          )}
          <div className="form-line">
            <label htmlFor="subject">Subject</label>
            <input
              id="subject"
              required
              maxLength={998}
              placeholder="Enter a subject for your email"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
          <div className="schedule-options">
            <label>
              Start time
              <input
                type="datetime-local"
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
              <small>
                Your local timezone ·{" "}
                {Intl.DateTimeFormat().resolvedOptions().timeZone}
              </small>
            </label>
            <label>
              Delay between emails
              <div className="unit-input">
                <input
                  type="number"
                  min={settings.minDelayMs / 1000}
                  max={86400}
                  step="0.1"
                  required
                  value={delay}
                  onChange={(e) => setDelay(Number(e.target.value))}
                />
                <span>seconds</span>
              </div>
            </label>
            <label>
              Hourly limit
              <div className="unit-input">
                <input
                  type="number"
                  min={1}
                  max={settings.maxHourlyLimit}
                  required
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                />
                <span>/ sender</span>
              </div>
            </label>
          </div>
          <label className="body-label" htmlFor="body">
            Message
          </label>
          <div className="editor">
            <div className="editor-toolbar">
              <Mail size={15} />
              <span>Plain text email</span>
            </div>
            <textarea
              id="body"
              required
              maxLength={100000}
              placeholder="Write your message here…"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          <div className="compose-note">
            <Clock size={14} />
            Emails stay queued when the hourly limit is reached. Ethereal
            previews are available after sending.
          </div>
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
function localDate(d: Date) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
function formatDate(v: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(v));
}
createRoot(document.getElementById("root")!).render(<App />);
