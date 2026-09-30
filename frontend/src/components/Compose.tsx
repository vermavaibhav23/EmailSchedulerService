import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  CalendarClock,
  Check,
  Clock,
  Mail,
  Upload,
} from "lucide-react";
import { api, type Sender, type User } from "../api";
import type { Settings } from "../types";
import { toLocalInputValue } from "../utils/dates";
import { parseRecipients } from "../utils/recipients";
import { ErrorMessage } from "./ui/ErrorMessage";

type ComposeProps = {
  user: User;
  senders: Sender[];
  settings: Settings;
  creating: boolean;
  addSender: () => Promise<void>;
  close: () => void;
  done: (count: number) => void;
};

export function Compose({
  user,
  senders,
  settings,
  creating,
  addSender,
  close,
  done,
}: ComposeProps) {
  const [senderId, setSenderId] = useState(senders[0]?.id || "");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [start, setStart] = useState(
    toLocalInputValue(new Date(Date.now() + 120000)),
  );
  const [delay, setDelay] = useState(settings.minDelayMs / 1000);
  const [limit, setLimit] = useState(settings.maxHourlyLimit);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(crypto.randomUUID());
  const [fileName, setFileName] = useState("");
  const [manual, setManual] = useState("");

  useEffect(() => {
    if (!senderId && senders.length) setSenderId(senders.at(-1)!.id);
  }, [senders, senderId]);

  const detected = [...new Set([...recipients, ...parseRecipients(manual)])];

  async function upload(file?: File) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError("Upload a file smaller than 2 MB");
      return;
    }
    setRecipients(parseRecipients(await file.text()));
    setFileName(file.name);
    setKey(crypto.randomUUID());
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
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
    } catch (caught) {
      setError((caught as Error).message);
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
              onChange={(event) => setSenderId(event.target.value)}
            >
              {!senders.length && <option value="">Select a sender</option>}
              {senders.map((sender) => (
                <option key={sender.id} value={sender.id}>
                  {sender.name} &lt;{sender.email}&gt;
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
              onChange={(event) => setManual(event.target.value)}
            />
            <label className="upload">
              <Upload size={14} />
              Upload list
              <input
                type="file"
                accept=".csv,.txt"
                onChange={(event) => void upload(event.target.files?.[0])}
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
              onChange={(event) => setSubject(event.target.value)}
            />
          </div>
          <div className="schedule-options">
            <label>
              Start time
              <input
                type="datetime-local"
                required
                value={start}
                onChange={(event) => setStart(event.target.value)}
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
                  onChange={(event) => setDelay(Number(event.target.value))}
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
                  onChange={(event) => setLimit(Number(event.target.value))}
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
              onChange={(event) => setBody(event.target.value)}
            />
          </div>
          <div className="compose-note">
            <Clock size={14} />
            Emails stay queued when the hourly limit is reached. Ethereal
            previews are available after sending.
          </div>
          <ErrorMessage message={error} />
        </div>
      </form>
    </div>
  );
}
