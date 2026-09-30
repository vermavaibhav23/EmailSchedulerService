import { Inbox, Plus } from "lucide-react";
import type { Email } from "../api";
import type { View } from "../types";
import { formatDate } from "../utils/dates";
import { StatusBadge } from "./ui/StatusBadge";

type EmailTableProps = {
  emails: Email[];
  view: View;
  query: string;
  loading: boolean;
  onCompose: () => void;
  onSelect: (email: Email) => void;
};

export function EmailTable({
  emails,
  view,
  query,
  loading,
  onCompose,
  onSelect,
}: EmailTableProps) {
  return (
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
            <button className="primary" onClick={onCompose}>
              <Plus size={16} />
              Compose New Email
            </button>
          )}
        </div>
      ) : (
        emails.map((email) => (
          <button
            className="email-row"
            key={email.id}
            onClick={() => onSelect(email)}
          >
            <span className="recipient">
              <span className="recipient-avatar">
                {email.recipient[0].toUpperCase()}
              </span>
              {email.recipient}
            </span>
            <span className="subject">
              <strong>{email.subject}</strong>
              <span>{email.body}</span>
            </span>
            <span className="date">
              {formatDate(email.sent_at || email.scheduled_at)}
            </span>
            <StatusBadge status={email.status} />
          </button>
        ))
      )}
    </div>
  );
}
