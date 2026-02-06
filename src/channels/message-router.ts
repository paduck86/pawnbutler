// PawnButler Message Router - Routes messages between channels and the Butler agent
// CRITICAL: All outgoing messages require user review before sending

import { EventEmitter } from 'node:events';
import type {
  Channel,
  IncomingMessage,
  OutgoingMessage,
} from './types.js';
import type { ChannelAdapter } from './channel-adapter.js';
import { SenderAllowlist } from './allowlist.js';

export interface PendingOutgoing {
  id: string;
  message: OutgoingMessage;
  inReplyTo?: IncomingMessage;
  createdAt: number;
  status: 'pending' | 'approved' | 'rejected' | 'sent';
}

export interface AuditRecord {
  timestamp: number;
  direction: 'incoming' | 'outgoing';
  channel: Channel;
  senderId?: string;
  senderName?: string;
  recipientId?: string;
  text: string;
  status: 'received' | 'pending_review' | 'approved' | 'rejected' | 'sent' | 'blocked';
  reason?: string;
}

export class MessageRouter extends EventEmitter {
  private adapters: Map<Channel, ChannelAdapter> = new Map();
  private allowlist: SenderAllowlist;
  private messageQueue: IncomingMessage[] = [];
  private pendingOutgoing: Map<string, PendingOutgoing> = new Map();
  private auditLog: AuditRecord[] = [];
  private outgoingIdCounter = 0;

  constructor(allowlist: SenderAllowlist) {
    super();
    this.allowlist = allowlist;
  }

  registerAdapter(adapter: ChannelAdapter): void {
    this.adapters.set(adapter.channel, adapter);
    adapter.onMessage((msg) => this.handleIncoming(msg));
  }

  unregisterAdapter(channel: Channel): void {
    const adapter = this.adapters.get(channel);
    if (adapter) {
      this.adapters.delete(channel);
    }
  }

  getAdapter(channel: Channel): ChannelAdapter | undefined {
    return this.adapters.get(channel);
  }

  private handleIncoming(message: IncomingMessage): void {
    // Check allowlist
    if (!this.allowlist.isAllowed(message.channel, message.senderId)) {
      // Generate pairing code for unknown sender
      const code = this.allowlist.generatePairingCode(
        message.channel,
        message.senderId,
        message.senderName,
      );

      this.logAudit({
        timestamp: Date.now(),
        direction: 'incoming',
        channel: message.channel,
        senderId: message.senderId,
        senderName: message.senderName,
        text: message.text,
        status: 'blocked',
        reason: `Unknown sender. Pairing code: ${code}`,
      });

      this.emit('pairing:required', { message, code });
      return;
    }

    // Log incoming
    this.logAudit({
      timestamp: Date.now(),
      direction: 'incoming',
      channel: message.channel,
      senderId: message.senderId,
      senderName: message.senderName,
      text: message.text,
      status: 'received',
    });

    this.messageQueue.push(message);
    this.emit('incoming', message);

    // Emit typing indicator on the channel
    this.emit('typing', { channel: message.channel, recipientId: message.senderId });
  }

  queueOutgoing(message: OutgoingMessage, inReplyTo?: IncomingMessage): PendingOutgoing {
    const id = `out_${++this.outgoingIdCounter}_${Date.now()}`;
    const pending: PendingOutgoing = {
      id,
      message,
      inReplyTo,
      createdAt: Date.now(),
      status: 'pending',
    };

    this.pendingOutgoing.set(id, pending);

    this.logAudit({
      timestamp: Date.now(),
      direction: 'outgoing',
      channel: message.channel,
      recipientId: message.recipientId,
      text: message.text,
      status: 'pending_review',
    });

    // CRITICAL: Emit for user review before sending
    this.emit('outgoing:pending', pending);

    return pending;
  }

  async approveOutgoing(id: string, editedText?: string): Promise<boolean> {
    const pending = this.pendingOutgoing.get(id);
    if (!pending || pending.status !== 'pending') return false;

    if (editedText !== undefined) {
      pending.message.text = editedText;
    }

    pending.status = 'approved';

    const adapter = this.adapters.get(pending.message.channel);
    if (!adapter) {
      pending.status = 'rejected';
      return false;
    }

    try {
      await adapter.sendMessage(pending.message);
      pending.status = 'sent';

      this.logAudit({
        timestamp: Date.now(),
        direction: 'outgoing',
        channel: pending.message.channel,
        recipientId: pending.message.recipientId,
        text: pending.message.text,
        status: 'sent',
      });

      this.emit('outgoing:sent', pending);
      this.pendingOutgoing.delete(id);
      return true;
    } catch {
      pending.status = 'rejected';
      return false;
    }
  }

  rejectOutgoing(id: string, reason?: string): boolean {
    const pending = this.pendingOutgoing.get(id);
    if (!pending || pending.status !== 'pending') return false;

    pending.status = 'rejected';

    this.logAudit({
      timestamp: Date.now(),
      direction: 'outgoing',
      channel: pending.message.channel,
      recipientId: pending.message.recipientId,
      text: pending.message.text,
      status: 'rejected',
      reason,
    });

    this.emit('outgoing:rejected', pending);
    this.pendingOutgoing.delete(id);
    return true;
  }

  getPendingOutgoing(): PendingOutgoing[] {
    return [...this.pendingOutgoing.values()];
  }

  getMessageQueue(): IncomingMessage[] {
    return [...this.messageQueue];
  }

  dequeueMessage(): IncomingMessage | undefined {
    return this.messageQueue.shift();
  }

  getAuditLog(): AuditRecord[] {
    return [...this.auditLog];
  }

  private logAudit(record: AuditRecord): void {
    this.auditLog.push(record);
    this.emit('audit', record);
  }
}
