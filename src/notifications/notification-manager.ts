// PawnButler Notification Manager - Orchestrates external messaging for approval

import { ChannelProvider } from './channel-provider.js';
import { TelegramProvider } from './telegram.js';
import { SlackProvider } from './slack.js';
import { DiscordProvider } from './discord.js';
import { WhatsAppProvider } from './whatsapp.js';
import type {
  NotificationConfig,
  ApprovalNotification,
  ApprovalResponse,
} from './types.js';

export class NotificationManager {
  private provider: ChannelProvider;
  private config: NotificationConfig;

  constructor(config: NotificationConfig) {
    this.config = config;
    this.provider = this.createProvider(config);
  }

  async requestApproval(notification: ApprovalNotification): Promise<ApprovalResponse> {
    await this.provider.sendApprovalRequest(notification);
    return this.provider.listenForResponse(
      notification.requestId,
      this.config.approvalTimeoutMs,
    );
  }

  async notifyBlocked(actionType: string, reason: string): Promise<void> {
    if (!this.config.notifyOnBlocked) return;
    await this.provider.sendAlert(
      `Blocked action: ${actionType}\nReason: ${reason}`,
    );
  }

  async sendAlert(message: string): Promise<void> {
    await this.provider.sendAlert(message);
  }

  getProvider(): ChannelProvider {
    return this.provider;
  }

  destroy(): void {
    this.provider.destroy();
  }

  private createProvider(config: NotificationConfig): ChannelProvider {
    const timeout = config.approvalTimeoutMs;
    const channelConfig = config.channelConfig;

    switch (channelConfig.channel) {
      case 'telegram':
        return new TelegramProvider(channelConfig, timeout);
      case 'slack':
        return new SlackProvider(channelConfig, timeout);
      case 'discord':
        return new DiscordProvider(channelConfig, timeout);
      case 'whatsapp':
        return new WhatsAppProvider(channelConfig, timeout);
      default:
        throw new Error(`Unsupported notification channel: ${(channelConfig as { channel: string }).channel}`);
    }
  }
}
