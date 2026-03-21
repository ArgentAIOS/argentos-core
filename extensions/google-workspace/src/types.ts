/** Plugin config from argent.plugin.json configSchema */
export type PluginConfig = {
  serviceAccountKeyPath: string;
  adminEmail: string;
  domain: string;
};

/** Daily per-user email usage metrics from Reports API */
export type EmailUsageReport = {
  date: string;
  email: string;
  sent: number;
  received: number;
  spam: number;
};

/** Individual Gmail activity event from Activities API */
export type GmailActivityEvent = {
  timestamp: string;
  actor: string;
  eventType: string;
  subject?: string;
  recipient?: string;
  messageId?: string;
};

/** User directory entry from Admin Directory API */
export type WorkspaceUser = {
  email: string;
  name: string;
  orgUnit: string;
  lastLogin: string;
  suspended: boolean;
  isAdmin: boolean;
  creationTime: string;
};

/** Aggregated email summary for a date range */
export type EmailSummary = {
  startDate: string;
  endDate: string;
  totalSent: number;
  totalReceived: number;
  totalSpam: number;
  userCount: number;
  topSenders: Array<{ email: string; sent: number }>;
  topReceivers: Array<{ email: string; received: number }>;
};
