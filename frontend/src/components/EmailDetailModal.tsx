import { ArrowRight, X } from "lucide-react";
import type { Email } from "../api";
import { ErrorMessage } from "./ui/ErrorMessage";
import { StatusBadge } from "./ui/StatusBadge";

export function EmailDetailModal({
  email,
  onClose,
}: {
  email: Email;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <section className="detail modal">
        <button
          className="icon-button close"
          onClick={onClose}
          aria-label="Close"
        >
          <X />
        </button>
        <p className="eyebrow">EMAIL DETAILS</p>
        <h2>{email.subject}</h2>
        <p>To {email.recipient}</p>
        <StatusBadge status={email.status} showDot={false} />
        <pre>{email.body}</pre>
        <ErrorMessage message={email.error || ""} />
        {email.preview_url && (
          <a
            className="outline"
            href={email.preview_url}
            target="_blank"
            rel="noreferrer"
          >
            View in Ethereal <ArrowRight size={15} />
          </a>
        )}
      </section>
    </div>
  );
}
