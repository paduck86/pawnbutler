// PawnButler Discord Provider - Discord Bot API integration

import { ChannelProvider } from './channel-provider.js';
import type { DiscordConfig } from './types.js';
import type { ApprovalNotification, ApprovalResponse } from './types.js';

interface DiscordInteraction {
  id: string;
  type: number;
  data?: {
    custom_id: string;
    component_type: number;
  };
  member?: { user: { id: string; username: string } };
  user?: { id: string; username: string };
}

export class DiscordProvider extends ChannelProvider {
  private botToken: string;
  private channelId: string;
  private applicationId: string;
  private baseUrl = 'https://discord.com/api/v10';
  private pendingResponses: Map<string, (response: ApprovalResponse) => void> = new Map();

  constructor(config: DiscordConfig, defaultTimeout?: number) {
    super(defaultTimeout);
    this.botToken = config.botToken;
    this.channelId = config.channelId;
    this.applicationId = config.applicationId;
  }

  formatMessage(notification: ApprovalNotification): string {
    const safetyEmoji =
      notification.safetyLevel === 'dangerous' ? '⚠️' : '🔴';
    const params = Object.entries(notification.params)
      .map(([k, v]) => `  ${k}: ${String(v)}`)
      .join('\n');

    return [
      `${safetyEmoji} **PawnButler Approval Request**`,
      '',
      `**Request ID:** \`${notification.requestId}\``,
      `**Agent:** ${notification.agentName}`,
      `**Action:** ${notification.actionType}`,
      `**Safety Level:** ${notification.safetyLevel}`,
      `**Description:** ${notification.description}`,
      '',
      `**Parameters:**`,
      '```',
      params || '  (none)',
      '```',
    ].join('\n');
  }

  async sendApprovalRequest(notification: ApprovalNotification): Promise<string> {
    const body = {
      content: this.formatMessage(notification),
      components: [
        {
          type: 1, // ACTION_ROW
          components: [
            {
              type: 2, // BUTTON
              style: 3, // SUCCESS
              label: 'Approve',
              custom_id: `approve:${notification.requestId}`,
            },
            {
              type: 2, // BUTTON
              style: 4, // DANGER
              label: 'Reject',
              custom_id: `reject:${notification.requestId}`,
            },
          ],
        },
      ],
    };

    const response = await fetch(`${this.baseUrl}/channels/${this.channelId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bot ${this.botToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Failed to send Discord approval request: ${response.status}`);
    }

    const result = await response.json() as { id: string };
    return result.id;
  }

  async listenForResponse(requestId: string, timeout?: number): Promise<ApprovalResponse> {
    const timeoutMs = timeout ?? this.defaultTimeout;

    return new Promise<ApprovalResponse>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingResponses.delete(requestId);
        resolve(this.createTimeoutRejection(requestId));
      }, timeoutMs);

      this.pendingResponses.set(requestId, (response) => {
        clearTimeout(timer);
        this.pendingResponses.delete(requestId);
        resolve(response);
      });
    });
  }

  handleInteraction(interaction: DiscordInteraction): void {
    if (interaction.type !== 3 || !interaction.data) return; // MESSAGE_COMPONENT

    const customId = interaction.data.custom_id;
    const [action, requestId] = customId.split(':');
    const resolver = this.pendingResponses.get(requestId);

    if (resolver) {
      const user = interaction.member?.user ?? interaction.user;
      resolver({
        requestId,
        approved: action === 'approve',
        respondedBy: user?.username ?? 'unknown',
        respondedAt: Date.now(),
        reason: action === 'reject' ? 'Rejected by user' : undefined,
      });
    }
  }

  async sendAlert(message: string): Promise<void> {
    await fetch(`${this.baseUrl}/channels/${this.channelId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bot ${this.botToken}`,
      },
      body: JSON.stringify({
        content: `🚨 **PawnButler Alert**\n\n${message}`,
      }),
    });
  }

  destroy(): void {
    for (const [requestId] of this.pendingResponses) {
      const resolver = this.pendingResponses.get(requestId);
      if (resolver) {
        resolver(this.createTimeoutRejection(requestId));
      }
    }
    this.pendingResponses.clear();
  }
}
