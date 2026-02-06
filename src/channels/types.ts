// PawnButler Channels - Full bidirectional messaging types

export type Channel = 'whatsapp' | 'telegram' | 'discord' | 'slack';

export type ChannelStatus = 'connected' | 'disconnected' | 'reconnecting' | 'error';

export interface IncomingMessage {
  id: string;
  channel: Channel;
  senderId: string;
  senderName: string;
  text: string;
  media?: MediaAttachment;
  replyTo?: string;
  groupId?: string;
  timestamp: number;
}

export interface OutgoingMessage {
  channel: Channel;
  recipientId: string;
  text: string;
  media?: MediaAttachment;
  replyTo?: string;
}

export interface MediaAttachment {
  type: 'image' | 'document' | 'audio' | 'video';
  url?: string;
  buffer?: Buffer;
  mimeType: string;
  filename?: string;
}

export interface WhatsAppChannelConfig {
  enabled: boolean;
  sessionPath: string;
}

export interface TelegramChannelConfig {
  enabled: boolean;
  botToken: string;
}

export interface DiscordChannelConfig {
  enabled: boolean;
  botToken: string;
  guildId?: string;
}

export interface SlackChannelConfig {
  enabled: boolean;
  botToken: string;
  appToken: string;
  signingSecret: string;
}

export interface ChannelsConfig {
  whatsapp?: WhatsAppChannelConfig;
  telegram?: TelegramChannelConfig;
  discord?: DiscordChannelConfig;
  slack?: SlackChannelConfig;
  allowedSenders: AllowedSendersConfig;
}

export interface AllowedSendersConfig {
  whatsapp: string[];
  telegram: string[];
  discord: string[];
  slack: string[];
}

export interface PairingRequest {
  code: string;
  channel: Channel;
  senderId: string;
  senderName: string;
  createdAt: number;
  expiresAt: number;
}

export type MessageCallback = (message: IncomingMessage) => void;
