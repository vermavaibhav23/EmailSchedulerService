import { useEffect, useState } from "react";
import { Check, Plus } from "lucide-react";
import { api, setCsrf, type Email, type Sender, type User } from "./api";
import { AppHeader } from "./components/AppHeader";
import { Compose } from "./components/Compose";
import { EmailDetailModal } from "./components/EmailDetailModal";
import { EmailTable } from "./components/EmailTable";
import { Login } from "./components/Login";
import { Sidebar } from "./components/Sidebar";
import { ErrorMessage } from "./components/ui/ErrorMessage";
import type { Settings, SlackConnection, Stats, View } from "./types";

const defaultSettings: Settings = {
  minDelayMs: 2000,
  maxHourlyLimit: 200,
  maxRecipients: 10000,
};

const emptyStats: Stats = { scheduled: 0, sent: 0 };

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);
  const [authError, setAuthError] = useState("");
  const [view, setView] = useState<View>("scheduled");
  const [composeOpen, setComposeOpen] = useState(false);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [emails, setEmails] = useState<Email[]>([]);
  const [stats, setStats] = useState<Stats>(emptyStats);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [slack, setSlack] = useState<SlackConnection | null>(null);
  const [admin, setAdmin] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [creatingSender, setCreatingSender] = useState(false);

  useEffect(() => {
    api<{ user: User; csrfToken: string; admin: boolean }>("/me")
      .then((data) => {
        setUser(data.user);
        setCsrf(data.csrfToken);
        setAdmin(data.admin);
      })
      .catch((caught) => {
        if (caught.message !== "Please sign in") setAuthError(caught.message);
      })
      .finally(() => setBooting(false));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      api<{ senders: Sender[] }>("/senders"),
      api<Settings>("/settings"),
      api<{ connection: SlackConnection | null }>("/slack"),
    ])
      .then(([senderData, settingsData, slackData]) => {
        setSenders(senderData.senders);
        setSettings(settingsData);
        setSlack(slackData.connection);
      })
      .catch((caught) => setError(caught.message));
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
            `/emails?view=${view}&page=${page}&q=${encodeURIComponent(debouncedQuery)}`,
          ),
          api<Stats>("/stats"),
        ]);
        if (alive) {
          setEmails(list.emails);
          setTotal(list.total);
          setStats(count);
          setError("");
        }
      } catch (caught) {
        if (alive) setError((caught as Error).message);
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
  }, [user, view, page, debouncedQuery, composeOpen]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function addSender() {
    setCreatingSender(true);
    try {
      const { sender } = await api<{ sender: Sender }>("/senders/ethereal", {
        method: "POST",
        body: JSON.stringify({ name: `Sender ${senders.length + 1}` }),
      });
      setSenders((current) => [...current, sender]);
      setToast("Ethereal sender connected");
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setCreatingSender(false);
    }
  }

  function changeView(nextView: View) {
    setView(nextView);
    setPage(1);
  }

  function logout() {
    api("/logout", { method: "POST" })
      .then(() => setUser(null))
      .catch((caught) => setError(caught.message));
  }

  function disconnectSlack() {
    api("/slack", { method: "DELETE" })
      .then(() => setSlack(null))
      .catch((caught) => setError(caught.message));
  }

  if (booting) {
    return (
      <div className="center">
        <span className="spinner" />
        Loading your workspace…
      </div>
    );
  }
  if (!user) return <Login initialError={authError} />;

  return (
    <div className="workspace">
      <Sidebar
        user={user}
        view={view}
        stats={stats}
        admin={admin}
        onCompose={() => setComposeOpen(true)}
        onViewChange={changeView}
        onLogout={logout}
      />
      <div className="main">
        <AppHeader
          user={user}
          query={query}
          slack={slack}
          onQueryChange={setQuery}
          onDisconnectSlack={disconnectSlack}
        />
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
            <button className="outline" onClick={() => setComposeOpen(true)}>
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
          <ErrorMessage message={error} />
          <EmailTable
            emails={emails}
            view={view}
            query={query}
            loading={loading}
            onCompose={() => setComposeOpen(true)}
            onSelect={setSelectedEmail}
          />
          {total > 25 && (
            <div className="pagination">
              <button
                className="outline"
                disabled={page === 1}
                onClick={() => setPage((current) => current - 1)}
              >
                Previous
              </button>
              <span>
                Page {page} of {Math.ceil(total / 25)}
              </span>
              <button
                className="outline"
                disabled={page * 25 >= total}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
              </button>
            </div>
          )}
        </main>
      </div>
      {composeOpen && (
        <Compose
          user={user}
          senders={senders}
          settings={settings}
          creating={creatingSender}
          addSender={addSender}
          close={() => setComposeOpen(false)}
          done={(count) => {
            setComposeOpen(false);
            setView("scheduled");
            setPage(1);
            setToast(`${count} emails scheduled successfully`);
          }}
        />
      )}
      {selectedEmail && (
        <EmailDetailModal
          email={selectedEmail}
          onClose={() => setSelectedEmail(null)}
        />
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
