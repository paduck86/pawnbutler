// PawnButler Slack Provider - Slack Incoming Webhook integration

import { ChannelProvider } from './channel-provider.js';
import type { SlackConfig } from './types.js';
import type { ApprovalNotification, ApprovalResponse } from './types.js';

export class SlackProvider extends ChannelProvider {
  private webhookUrl: string;
  private pendingResponses: Map<string, (response: ApprovalResponse) => void> = new Map();

  constructor(config: SlackConfig, defaultTimeout?: number) {
    super(defaultTimeout);
    this.webhookUrl = config.webhookUrl;
  }

  formatMessage(notification: ApprovalNotification): string {
    const params = Object.entries(notification.params)
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join('\n');

    return [
      `*PawnButler Approval Request*`,
      `Request ID: \`${notification.requestId}\``,
      `Agent: ${notification.agentName}`,
      `Action: ${notification.actionType}`,
      `Safety Level: ${notification.safetyLevel}`,
      `Description: ${notification.description}`,
      `Parameters:\n\`\`\`${params || '(none)'}\`\`\``,
    ].join('\n');
  }

  async sendApprovalRequest(notification: ApprovalNotification): Promise<string> {
    const safetyEmoji =
      notification.safetyLevel === 'dangerous' ? ':warning:' : ':red_circle:';

    const blocks = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${safetyEmoji} PawnButler Approval Request` },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Request ID:*\n\`${notification.requestId}\`` },
          { type: 'mrkdwn', text: `*Agent:*\n${notification.agentName}` },
          { type: 'mrkdwn', text: `*Action:*\n${notification.actionType}` },
          { type: 'mrkdwn', text: `*Safety Level:*\n${notification.safetyLevel}` },
        ],
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*Description:*\n${notification.description}` },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Parameters:*\n\`\`\`${JSON.stringify(notification.params, null, 2)}\`\`\``,
        },
      },
      {
        type: 'actions',
        block_id: `approval_${notification.requestId}`,
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Approve' },
            style: 'primary',
            action_id: 'approve',
            value: notification.requestId,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Reject' },
            style: 'danger',
            action_id: 'reject',
            value: notification.requestId,
          },
        ],
      },
    ];

    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks, text: this.formatMessage(notification) }),
    });

    if (!response.ok) {
      throw new Error(`Failed to send Slack approval request: ${response.status}`);
    }

    return notification.requestId;
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

  handleActionPayload(payload: {
    actions: Array<{ action_id: string; value: string }>;
    user: { id: string; name: string };
  }): void {
    for (const action of payload.actions) {
      const resolver = this.pendingResponses.get(action.value);
      if (resolver) {
        resolver({
          requestId: action.value,
          approved: action.action_id === 'approve',
          respondedBy: payload.user.name,
          respondedAt: Date.now(),
          reason: action.action_id === 'reject' ? 'Rejected by user' : undefined,
        });
      }
    }
  }

  async sendAlert(message: string): Promise<void> {
    await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `:rotating_light: *PawnButler Alert*\n\n${message}`,
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
