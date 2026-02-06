// PawnButler WhatsApp Provider - WhatsApp Business API integration

import { ChannelProvider } from './channel-provider.js';
import type { WhatsAppConfig } from './types.js';
import type { ApprovalNotification, ApprovalResponse } from './types.js';

export class WhatsAppProvider extends ChannelProvider {
  private phoneNumberId: string;
  private accessToken: string;
  private recipientPhone: string;
  private baseUrl = 'https://graph.facebook.com/v18.0';
  private pendingResponses: Map<string, (response: ApprovalResponse) => void> = new Map();

  constructor(config: WhatsAppConfig, defaultTimeout?: number) {
    super(defaultTimeout);
    this.phoneNumberId = config.phoneNumberId;
    this.accessToken = config.accessToken;
    this.recipientPhone = config.recipientPhone;
  }

  formatMessage(notification: ApprovalNotification): string {
    const params = Object.entries(notification.params)
      .map(([k, v]) => `  ${k}: ${String(v)}`)
      .join('\n');

    return [
      `⚠️ PawnButler Approval Request`,
      '',
      `Request ID: ${notification.requestId}`,
      `Agent: ${notification.agentName}`,
      `Action: ${notification.actionType}`,
      `Safety Level: ${notification.safetyLevel}`,
      `Description: ${notification.description}`,
      '',
      `Parameters:`,
      params || '  (none)',
      '',
      `Reply YES to approve or NO to reject.`,
    ].join('\n');
  }

  async sendApprovalRequest(notification: ApprovalNotification): Promise<string> {
    const body = {
      messaging_product: 'whatsapp',
      to: this.recipientPhone,
      type: 'interactive',
      interactive: {
        type: 'button',
        header: { type: 'text', text: 'PawnButler Approval Request' },
        body: { text: this.formatMessage(notification) },
        action: {
          buttons: [
            {
              type: 'reply',
              reply: { id: `approve:${notification.requestId}`, title: 'Approve' },
            },
            {
              type: 'reply',
              reply: { id: `reject:${notification.requestId}`, title: 'Reject' },
            },
          ],
        },
      },
    };

    const response = await fetch(
      `${this.baseUrl}/${this.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.accessToken}`,
        },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to send WhatsApp approval request: ${response.status}`);
    }

    const result = await response.json() as { messages?: Array<{ id: string }> };
    return result.messages?.[0]?.id ?? notification.requestId;
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

  handleIncomingMessage(message: {
    from: string;
    type: string;
    text?: { body: string };
    interactive?: { button_reply: { id: string; title: string } };
  }): void {
    // Handle interactive button reply
    if (message.type === 'interactive' && message.interactive?.button_reply) {
      const replyId = message.interactive.button_reply.id;
      const [action, requestId] = replyId.split(':');
      const resolver = this.pendingResponses.get(requestId);

      if (resolver) {
        resolver({
          requestId,
          approved: action === 'approve',
          respondedBy: message.from,
          respondedAt: Date.now(),
          reason: action === 'reject' ? 'Rejected by user' : undefined,
        });
      }
      return;
    }

    // Handle text-based YES/NO response
    if (message.type === 'text' && message.text?.body) {
      const text = message.text.body.trim().toUpperCase();
      if (text !== 'YES' && text !== 'NO') return;

      // Resolve the most recent pending request
      const entries = [...this.pendingResponses.entries()];
      if (entries.length === 0) return;

      const [requestId, resolver] = entries[entries.length - 1];
      resolver({
        requestId,
        approved: text === 'YES',
        respondedBy: message.from,
        respondedAt: Date.now(),
        reason: text === 'NO' ? 'Rejected by user' : undefined,
      });
    }
  }

  async sendAlert(message: string): Promise<void> {
    const body = {
      messaging_product: 'whatsapp',
      to: this.recipientPhone,
      type: 'text',
      text: { body: `🚨 PawnButler Alert\n\n${message}` },
    };

    await fetch(`${this.baseUrl}/${this.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify(body),
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
