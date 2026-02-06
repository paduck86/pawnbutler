// PawnButler WhatsApp Adapter - Baileys-based bidirectional WhatsApp messaging

import { ChannelAdapter } from '../channel-adapter.js';
import { WhatsAppAuthManager } from './whatsapp-auth.js';
import type {
  Channel,
  OutgoingMessage,
  IncomingMessage,
  WhatsAppChannelConfig,
} from '../types.js';

export class WhatsAppAdapter extends ChannelAdapter {
  public readonly channel: Channel = 'whatsapp';
  private authManager: WhatsAppAuthManager;
  private config: WhatsAppChannelConfig;
  private socket: unknown = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor(config: WhatsAppChannelConfig) {
    super();
    this.config = config;
    this.authManager = new WhatsAppAuthManager(config.sessionPath);
  }

  async connect(): Promise<void> {
    if (!this.config.enabled) {
      throw new Error('WhatsApp channel is not enabled');
    }

    this.setStatus('reconnecting');

    try {
      // Dynamic import to avoid hard dependency when not using WhatsApp
      const baileys = await import('@whiskeysockets/baileys');
      const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = baileys;

      const { state, saveCreds } = await useMultiFileAuthState(this.config.sessionPath);

      const socket = makeWASocket({
        auth: state,
        printQRInTerminal: false,
      });

      socket.ev.on('creds.update', saveCreds);

      socket.ev.on('connection.update', (update: Record<string, unknown>) => {
        const { connection, lastDisconnect, qr } = update as {
          connection?: string;
          lastDisconnect?: { error?: { output?: { statusCode?: number } } };
          qr?: string;
        };

        if (qr) {
          this.emit('qr', qr);
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          if (shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            this.setStatus('reconnecting');
            setTimeout(() => this.connect(), 3000 * this.reconnectAttempts);
          } else {
            this.setStatus('disconnected');
          }
        } else if (connection === 'open') {
          this.reconnectAttempts = 0;
          this.setStatus('connected');
        }
      });

      socket.ev.on('messages.upsert', (upsert: { messages: Array<Record<string, unknown>>; type: string }) => {
        if (upsert.type !== 'notify') return;

        for (const msg of upsert.messages) {
          if ((msg as Record<string, unknown>).key &&
              ((msg as Record<string, unknown>).key as Record<string, unknown>).fromMe) continue;

          const incoming = this.parseIncomingMessage(msg);
          if (incoming) {
            // Send read receipt
            const key = (msg as Record<string, unknown>).key as Record<string, unknown>;
            socket.readMessages([key as never]).catch(() => {});

            this.dispatchIncoming(incoming);
          }
        }
      });

      this.socket = socket;
    } catch (error) {
      this.setStatus('error');
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.socket) {
      const sock = this.socket as { end: (reason: undefined) => void };
      sock.end(undefined);
      this.socket = null;
    }
    this.setStatus('disconnected');
  }

  async sendMessage(msg: OutgoingMessage): Promise<string> {
    if (!this.socket || this.status !== 'connected') {
      throw new Error('WhatsApp not connected');
    }

    const sock = this.socket as {
      sendMessage: (jid: string, content: Record<string, unknown>) => Promise<{ key: { id: string } }>;
      sendPresenceUpdate: (type: string, jid: string) => Promise<void>;
    };

    // Send typing indicator
    await sock.sendPresenceUpdate('composing', msg.recipientId);

    const content: Record<string, unknown> = {};

    if (msg.media) {
      content[msg.media.type] = msg.media.url
        ? { url: msg.media.url }
        : msg.media.buffer;
      content.mimetype = msg.media.mimeType;
      if (msg.media.filename) content.fileName = msg.media.filename;
      if (msg.text) content.caption = this.formatForChannel(msg.text);
    } else {
      content.text = this.formatForChannel(msg.text);
    }

    const result = await sock.sendMessage(msg.recipientId, content);

    // Clear typing indicator
    await sock.sendPresenceUpdate('paused', msg.recipientId);

    return result.key.id;
  }

  formatForChannel(text: string): string {
    // WhatsApp supports basic markdown: *bold*, _italic_, ~strikethrough~, ```code```
    return text;
  }

  private parseIncomingMessage(raw: Record<string, unknown>): IncomingMessage | null {
    const key = raw.key as Record<string, unknown> | undefined;
    const message = raw.message as Record<string, unknown> | undefined;
    if (!key || !message) return null;

    const remoteJid = key.remoteJid as string;
    const participant = key.participant as string | undefined;
    const isGroup = remoteJid.endsWith('@g.us');

    let text = '';
    const conversation = message.conversation as string | undefined;
    const extendedText = message.extendedTextMessage as Record<string, unknown> | undefined;
    const imageMsg = message.imageMessage as Record<string, unknown> | undefined;
    const documentMsg = message.documentMessage as Record<string, unknown> | undefined;

    if (conversation) {
      text = conversation;
    } else if (extendedText?.text) {
      text = extendedText.text as string;
    } else if (imageMsg?.caption) {
      text = imageMsg.caption as string;
    } else if (documentMsg?.caption) {
      text = documentMsg.caption as string;
    }

    const senderId = isGroup ? (participant ?? remoteJid) : remoteJid;
    const pushName = raw.pushName as string | undefined;

    return {
      id: key.id as string,
      channel: 'whatsapp',
      senderId,
      senderName: pushName ?? senderId,
      text,
      groupId: isGroup ? remoteJid : undefined,
      replyTo: extendedText?.contextInfo
        ? ((extendedText.contextInfo as Record<string, unknown>).stanzaId as string | undefined)
        : undefined,
      timestamp: (raw.messageTimestamp as number) ?? Date.now(),
    };
  }

  getAuthManager(): WhatsAppAuthManager {
    return this.authManager;
  }
}
