export type View = "scheduled" | "sent";

export type Settings = {
  minDelayMs: number;
  maxHourlyLimit: number;
  maxRecipients: number;
};

export type Stats = {
  scheduled: number;
  sent: number;
};

export type SlackConnection = {
  team_name: string;
  channel_name: string;
};
