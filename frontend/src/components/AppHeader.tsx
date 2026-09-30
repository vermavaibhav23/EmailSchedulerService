import { Search, Slack } from "lucide-react";
import type { User } from "../api";
import type { SlackConnection } from "../types";
import { UserAvatar } from "./ui/UserAvatar";

type AppHeaderProps = {
  user: User;
  query: string;
  slack: SlackConnection | null;
  onQueryChange: (value: string) => void;
  onDisconnectSlack: () => void;
};

export function AppHeader({
  user,
  query,
  slack,
  onQueryChange,
  onDisconnectSlack,
}: AppHeaderProps) {
  return (
    <header>
      <div className="search">
        <Search size={17} />
        <input
          placeholder="Search email, subject or message"
          aria-label="Search emails"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        <kbd>⌕</kbd>
      </div>
      <div className="header-actions">
        {slack ? (
          <button className="slack" onClick={onDisconnectSlack}>
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
        <UserAvatar user={user} className="avatar" />
      </div>
    </header>
  );
}
