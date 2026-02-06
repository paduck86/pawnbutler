// PawnButler Notification Types - External messaging approval system

export type NotificationChannel = 'telegram' | 'slack' | 'discord' | 'whatsapp';

export interface TelegramConfig {
  channel: 'telegram';
  botToken: string;
  chatId: string;
}

export interface SlackConfig {
  channel: 'slack';
  webhookUrl: string;
  signingSecret?: string;
}

export interface DiscordConfig {
  channel: 'discord';
  botToken: string;
  channelId: string;
  applicationId: string;
}

export interface WhatsAppConfig {
  channel: 'whatsapp';
  phoneNumberId: string;
  accessToken: string;
  recipientPhone: string;
}

export type NotificationChannelConfig =
  | TelegramConfig
  | SlackConfig
  | DiscordConfig
  | WhatsAppConfig;

export interface NotificationConfig {
  enabled: boolean;
  channelConfig: NotificationChannelConfig;
  approvalTimeoutMs: number;
  notifyOnBlocked: boolean;
}

export interface ApprovalNotification {
  requestId: string;
  agentName: string;
  actionType: string;
  safetyLevel: string;
  description: string;
  params: Record<string, unknown>;
}

export interface ApprovalResponse {
  requestId: string;
  approved: boolean;
  respondedBy: string;
  respondedAt: number;
  reason?: string;
}
