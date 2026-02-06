// PawnButler Discord Adapter - discord.js-based bidirectional Discord messaging

import { ChannelAdapter } from '../channel-adapter.js';
import type {
  Channel,
  OutgoingMessage,
  IncomingMessage,
  DiscordChannelConfig,
} from '../types.js';

export class DiscordAdapter extends ChannelAdapter {
  public readonly channel: Channel = 'discord';
  private config: DiscordChannelConfig;
  private client: unknown = null;

  constructor(config: DiscordChannelConfig) {
    super();
    this.config = config;
  }

  async connect(): Promise<void> {
    if (!this.config.enabled) {
      throw new Error('Discord channel is not enabled');
    }

    this.setStatus('reconnecting');

    try {
      const discord = await import('discord.js');
      const { Client, GatewayIntentBits, Events } = discord;

      const client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.DirectMessages,
          GatewayIntentBits.MessageContent,
        ],
      });

      client.once(Events.ClientReady, () => {
        this.setStatus('connected');
      });

      client.on(Events.MessageCreate, (message) => {
        // Ignore bot's own messages
        if (message.author.bot) return;

        const isGuild = message.guild !== null;

        const incoming: IncomingMessage = {
          id: message.id,
          channel: 'discord',
          senderId: message.author.id,
          senderName: message.author.username,
          text: message.content,
          groupId: isGuild ? message.channelId : undefined,
          replyTo: message.reference?.messageId ?? undefined,
          timestamp: message.createdTimestamp,
        };

        this.dispatchIncoming(incoming);
      });

      client.on(Events.Error, (err) => {
        this.emit('error', err);
        this.setStatus('error');
      });

      await client.login(this.config.botToken);
      this.client = client;
    } catch (error) {
      this.setStatus('error');
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      const client = this.client as { destroy: () => Promise<void> };
      await client.destroy();
      this.client = null;
    }
    this.setStatus('disconnected');
  }

  async sendMessage(msg: OutgoingMessage): Promise<string> {
    if (!this.client || this.status !== 'connected') {
      throw new Error('Discord bot not connected');
    }

    const client = this.client as {
      channels: {
        fetch: (id: string) => Promise<{
          isTextBased: () => boolean;
          send: (content: Record<string, unknown>) => Promise<{ id: string }>;
          sendTyping: () => Promise<void>;
        } | null>;
      };
      users: {
        fetch: (id: string) => Promise<{
          send: (content: Record<string, unknown>) => Promise<{ id: string }>;
        } | null>;
      };
    };

    const content: Record<string, unknown> = {};
    content.content = this.formatForChannel(msg.text);

    if (msg.replyTo) {
      content.reply = { messageReference: msg.replyTo };
    }

    if (msg.media) {
      content.files = [{
        attachment: msg.media.url ?? msg.media.buffer,
        name: msg.media.filename ?? 'file',
      }];
    }

    // Try channel first (server/group), then DM
    let result: { id: string };
    try {
      const channel = await client.channels.fetch(msg.recipientId);
      if (channel && channel.isTextBased()) {
        await channel.sendTyping();
        result = await channel.send(content);
      } else {
        throw new Error('Not a text channel');
      }
    } catch {
      // Fall back to DM
      const user = await client.users.fetch(msg.recipientId);
      if (!user) throw new Error(`Cannot find Discord user/channel: ${msg.recipientId}`);
      result = await user.send(content);
    }

    return result.id;
  }

  formatForChannel(text: string): string {
    // Discord supports Markdown: **bold**, *italic*, `code`, ```code block```, ~~strikethrough~~
    // Also supports embeds but we use plain text for simplicity
    return text;
  }
}
