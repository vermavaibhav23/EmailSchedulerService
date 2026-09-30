import {
  ArrowRight,
  ChevronDown,
  Clock,
  LogOut,
  Plus,
  Send,
} from "lucide-react";
import type { User } from "../api";
import type { Stats, View } from "../types";
import { UserAvatar } from "./ui/UserAvatar";

type SidebarProps = {
  user: User;
  view: View;
  stats: Stats;
  admin: boolean;
  onCompose: () => void;
  onViewChange: (view: View) => void;
  onLogout: () => void;
};

export function Sidebar({
  user,
  view,
  stats,
  admin,
  onCompose,
  onViewChange,
  onLogout,
}: SidebarProps) {
  return (
    <aside>
      <div className="profile">
        <UserAvatar user={user} />
        <div>
          <strong>{user.name}</strong>
          <span title={user.email}>{user.email}</span>
        </div>
        <ChevronDown size={14} />
      </div>
      <button className="compose-button" onClick={onCompose}>
        <Plus size={17} />
        Compose New Email
      </button>
      <div className="nav-title">WORKSPACE</div>
      <button
        className={`nav ${view === "scheduled" ? "active" : ""}`}
        onClick={() => onViewChange("scheduled")}
      >
        <Clock size={17} />
        Scheduled<span>{stats.scheduled}</span>
      </button>
      <button
        className={`nav ${view === "sent" ? "active" : ""}`}
        onClick={() => onViewChange("sent")}
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
        <button className="nav" onClick={onLogout}>
          <LogOut size={16} />
          Log out
        </button>
      </div>
    </aside>
  );
}
