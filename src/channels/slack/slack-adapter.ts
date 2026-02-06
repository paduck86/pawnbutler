// PawnButler Slack Adapter - Bolt-based bidirectional Slack messaging (Socket Mode)

import { ChannelAdapter } from '../channel-adapter.js';
import type {
  Channel,
  OutgoingMessage,
  IncomingMessage,
  SlackChannelConfig,
} from '../types.js';

export class SlackAdapter extends ChannelAdapter {
  public readonly channel: Channel = 'slack';
  private config: SlackChannelConfig;
  private app: unknown = null;

  constructor(config: SlackChannelConfig) {
    super();
    this.config = config;
  }

  async connect(): Promise<void> {
    if (!this.config.enabled) {
      throw new Error('Slack channel is not enabled');
    }

    this.setStatus('reconnecting');

    try {
      const bolt = await import('@slack/bolt');
      const { App } = bolt;

      const app = new App({
        token: this.config.botToken,
        appToken: this.config.appToken,
        signingSecret: this.config.signingSecret,
        socketMode: true,
      });

      app.message(async ({ message }) => {
        const msg = message as Record<string, unknown>;

        // Ignore bot messages
        if (msg.subtype === 'bot_message' || msg.bot_id) return;

        const incoming: IncomingMessage = {
          id: msg.ts as string,
          channel: 'slack',
          senderId: msg.user as string,
          senderName: msg.user as string,
          text: (msg.text as string) ?? '',
          groupId: msg.channel as string,
          replyTo: msg.thread_ts as string | undefined,
          timestamp: Math.floor(parseFloat(msg.ts as string) * 1000),
        };

        this.dispatchIncoming(incoming);
      });

      app.error(async (error) => {
        this.emit('error', error);
        this.setStatus('error');
      });

      await app.start();
      this.app = app;
      this.setStatus('connected');
    } catch (error) {
      this.setStatus('error');
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.app) {
      const app = this.app as { stop: () => Promise<void> };
      await app.stop();
      this.app = null;
    }
    this.setStatus('disconnected');
  }

  async sendMessage(msg: OutgoingMessage): Promise<string> {
    if (!this.app || this.status !== 'connected') {
      throw new Error('Slack app not connected');
    }

    const app = this.app as {
      client: {
        chat: {
          postMessage: (args: Record<string, unknown>) => Promise<{ ts: string }>;
        };
        files: {
          uploadV2: (args: Record<string, unknown>) => Promise<{ file: { id: string } }>;
        };
      };
    };

    const args: Record<string, unknown> = {
      channel: msg.recipientId,
      text: this.formatForChannel(msg.text),
    };

    if (msg.replyTo) {
      args.thread_ts = msg.replyTo;
    }

    // Block Kit formatting for richer messages
    args.blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: this.formatForChannel(msg.text),
        },
      },
    ];

    if (msg.media) {
      // Upload file first if there's media
      const uploadArgs: Record<string, unknown> = {
        channel_id: msg.recipientId,
        filename: msg.media.filename ?? 'file',
      };

      if (msg.media.buffer) {
        uploadArgs.file = msg.media.buffer;
      } else if (msg.media.url) {
        // Slack needs the file content, not a URL
        uploadArgs.filename = msg.media.filename ?? msg.media.url;
      }

      if (msg.replyTo) {
        uploadArgs.thread_ts = msg.replyTo;
      }

      await app.client.files.uploadV2(uploadArgs);
    }

    const result = await app.client.chat.postMessage(args);
    return result.ts;
  }

  formatForChannel(text: string): string {
    // Slack uses mrkdwn: *bold*, _italic_, ~strikethrough~, `code`, ```code block```
    // Convert standard markdown bold (**text**) to Slack bold (*text*)
    return text.replace(/\*\*(.+?)\*\*/g, '*$1*');
  }
}
