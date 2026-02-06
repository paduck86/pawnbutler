// PawnButler Telegram Provider - Telegram Bot API integration

import { ChannelProvider } from './channel-provider.js';
import type { TelegramConfig } from './types.js';
import type { ApprovalNotification, ApprovalResponse } from './types.js';

interface TelegramUpdate {
  update_id: number;
  callback_query?: {
    id: string;
    data?: string;
    from: { id: number; first_name: string; username?: string };
  };
}

export class TelegramProvider extends ChannelProvider {
  private botToken: string;
  private chatId: string;
  private baseUrl: string;
  private pollingActive = false;
  private lastUpdateId = 0;

  constructor(config: TelegramConfig, defaultTimeout?: number) {
    super(defaultTimeout);
    this.botToken = config.botToken;
    this.chatId = config.chatId;
    this.baseUrl = `https://api.telegram.org/bot${this.botToken}`;
  }

  formatMessage(notification: ApprovalNotification): string {
    const safetyEmoji =
      notification.safetyLevel === 'dangerous' ? '⚠️' : '🔴';
    const params = Object.entries(notification.params)
      .map(([k, v]) => `  ${k}: ${String(v)}`)
      .join('\n');

    return [
      `${safetyEmoji} *PawnButler Approval Request*`,
      '',
      `*Request ID:* \`${notification.requestId}\``,
      `*Agent:* ${notification.agentName}`,
      `*Action:* ${notification.actionType}`,
      `*Safety Level:* ${notification.safetyLevel}`,
      `*Description:* ${notification.description}`,
      '',
      `*Parameters:*`,
      '```',
      params || '  (none)',
      '```',
    ].join('\n');
  }

  async sendApprovalRequest(notification: ApprovalNotification): Promise<string> {
    const text = this.formatMessage(notification);

    const body = {
      chat_id: this.chatId,
      text,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Approve', callback_data: `approve:${notification.requestId}` },
            { text: '❌ Reject', callback_data: `reject:${notification.requestId}` },
          ],
        ],
      },
    };

    const response = await fetch(`${this.baseUrl}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const result = await response.json() as { ok: boolean; result?: { message_id: number } };
    if (!result.ok) {
      throw new Error('Failed to send Telegram approval request');
    }

    return String(result.result?.message_id ?? '');
  }

  async listenForResponse(requestId: string, timeout?: number): Promise<ApprovalResponse> {
    const timeoutMs = timeout ?? this.defaultTimeout;
    const deadline = Date.now() + timeoutMs;
    this.pollingActive = true;

    try {
      while (this.pollingActive && Date.now() < deadline) {
        const updates = await this.getUpdates();

        for (const update of updates) {
          if (!update.callback_query?.data) continue;

          const data = update.callback_query.data;
          const [action, reqId] = data.split(':');

          if (reqId === requestId) {
            await this.answerCallbackQuery(update.callback_query.id);

            return {
              requestId,
              approved: action === 'approve',
              respondedBy: update.callback_query.from.username ?? update.callback_query.from.first_name,
              respondedAt: Date.now(),
              reason: action === 'reject' ? 'Rejected by user' : undefined,
            };
          }
        }

        // Short delay before next poll
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } finally {
      this.pollingActive = false;
    }

    return this.createTimeoutRejection(requestId);
  }

  async sendAlert(message: string): Promise<void> {
    const body = {
      chat_id: this.chatId,
      text: `🚨 *PawnButler Alert*\n\n${message}`,
      parse_mode: 'Markdown',
    };

    await fetch(`${this.baseUrl}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  destroy(): void {
    this.pollingActive = false;
  }

  private async getUpdates(): Promise<TelegramUpdate[]> {
    const params = new URLSearchParams({
      offset: String(this.lastUpdateId + 1),
      timeout: '5',
      allowed_updates: JSON.stringify(['callback_query']),
    });

    const response = await fetch(`${this.baseUrl}/getUpdates?${params}`);
    const result = await response.json() as { ok: boolean; result?: TelegramUpdate[] };

    if (!result.ok || !result.result) return [];

    for (const update of result.result) {
      if (update.update_id > this.lastUpdateId) {
        this.lastUpdateId = update.update_id;
      }
    }

    return result.result;
  }

  private async answerCallbackQuery(callbackQueryId: string): Promise<void> {
    await fetch(`${this.baseUrl}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId }),
    });
  }
}
