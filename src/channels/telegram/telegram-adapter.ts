// PawnButler Telegram Adapter - grammY-based bidirectional Telegram messaging

import { ChannelAdapter } from '../channel-adapter.js';
import type {
  Channel,
  OutgoingMessage,
  IncomingMessage,
  TelegramChannelConfig,
} from '../types.js';

export class TelegramAdapter extends ChannelAdapter {
  public readonly channel: Channel = 'telegram';
  private config: TelegramChannelConfig;
  private bot: unknown = null;

  constructor(config: TelegramChannelConfig) {
    super();
    this.config = config;
  }

  async connect(): Promise<void> {
    if (!this.config.enabled) {
      throw new Error('Telegram channel is not enabled');
    }

    this.setStatus('reconnecting');

    try {
      const { Bot } = await import('grammy');

      const bot = new Bot(this.config.botToken);

      bot.on('message', (ctx) => {
        const msg = ctx.message;
        if (!msg) return;

        let text = '';
        if (msg.text) text = msg.text;
        else if (msg.caption) text = msg.caption;

        const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';

        const incoming: IncomingMessage = {
          id: String(msg.message_id),
          channel: 'telegram',
          senderId: String(msg.from?.id ?? msg.chat.id),
          senderName: msg.from?.username ?? msg.from?.first_name ?? 'Unknown',
          text,
          groupId: isGroup ? String(msg.chat.id) : undefined,
          replyTo: msg.reply_to_message
            ? String(msg.reply_to_message.message_id)
            : undefined,
          timestamp: msg.date * 1000,
        };

        this.dispatchIncoming(incoming);
      });

      bot.catch((err) => {
        this.emit('error', err);
        this.setStatus('error');
      });

      // Start polling (non-blocking)
      bot.start({
        onStart: () => {
          this.setStatus('connected');
        },
      });

      this.bot = bot;
    } catch (error) {
      this.setStatus('error');
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.bot) {
      const bot = this.bot as { stop: () => void };
      bot.stop();
      this.bot = null;
    }
    this.setStatus('disconnected');
  }

  async sendMessage(msg: OutgoingMessage): Promise<string> {
    if (!this.bot || this.status !== 'connected') {
      throw new Error('Telegram bot not connected');
    }

    const bot = this.bot as {
      api: {
        sendMessage: (chatId: string, text: string, options?: Record<string, unknown>) => Promise<{ message_id: number }>;
        sendChatAction: (chatId: string, action: string) => Promise<void>;
        sendDocument: (chatId: string, doc: unknown, options?: Record<string, unknown>) => Promise<{ message_id: number }>;
        sendPhoto: (chatId: string, photo: unknown, options?: Record<string, unknown>) => Promise<{ message_id: number }>;
      };
    };

    // Send typing indicator
    await bot.api.sendChatAction(msg.recipientId, 'typing');

    const options: Record<string, unknown> = {
      parse_mode: 'Markdown',
    };

    if (msg.replyTo) {
      options.reply_to_message_id = Number(msg.replyTo);
    }

    let result: { message_id: number };

    if (msg.media) {
      const source = msg.media.url ?? msg.media.buffer;
      if (msg.media.type === 'image') {
        options.caption = this.formatForChannel(msg.text);
        result = await bot.api.sendPhoto(msg.recipientId, source, options);
      } else {
        options.caption = this.formatForChannel(msg.text);
        result = await bot.api.sendDocument(msg.recipientId, source, options);
      }
    } else {
      result = await bot.api.sendMessage(
        msg.recipientId,
        this.formatForChannel(msg.text),
        options,
      );
    }

    return String(result.message_id);
  }

  formatForChannel(text: string): string {
    // Telegram supports Markdown: *bold*, _italic_, `code`, ```code block```, [link](url)
    return text;
  }
}
