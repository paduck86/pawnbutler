// PawnButler Channels Test Suite - Bidirectional messaging channels

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  Channel,
  IncomingMessage,
  OutgoingMessage,
  ChannelsConfig,
  AllowedSendersConfig,
  PairingRequest,
  ChannelStatus,
  MediaAttachment,
} from '../src/channels/types.js';
import { ChannelAdapter } from '../src/channels/channel-adapter.js';
import { SenderAllowlist } from '../src/channels/allowlist.js';
import { MessageRouter, type PendingOutgoing, type AuditRecord } from '../src/channels/message-router.js';
import type { PawnButlerConfig, ChannelsConfig as CoreChannelsConfig } from '../src/core/types.js';
import { pawnButlerConfigSchema, validateConfig } from '../src/config/schema.js';
import { defaultConfig, DEFAULT_CHANNELS_CONFIG } from '../src/config/default-config.js';

// ============================================================
// Mock Channel Adapter for testing
// ============================================================

class MockAdapter extends ChannelAdapter {
  public readonly channel: Channel;
  public sentMessages: OutgoingMessage[] = [];
  public connectCalled = false;
  public disconnectCalled = false;

  constructor(channel: Channel) {
    super();
    this.channel = channel;
  }

  async connect(): Promise<void> {
    this.connectCalled = true;
    this.setStatus('connected');
  }

  async disconnect(): Promise<void> {
    this.disconnectCalled = true;
    this.setStatus('disconnected');
  }

  async sendMessage(msg: OutgoingMessage): Promise<string> {
    this.sentMessages.push(msg);
    return `msg_${Date.now()}`;
  }

  formatForChannel(text: string): string {
    return `[${this.channel}] ${text}`;
  }

  // Expose for testing
  simulateIncoming(message: IncomingMessage): void {
    this.dispatchIncoming(message);
  }

  simulateStatusChange(status: ChannelStatus): void {
    this.setStatus(status);
  }
}

// ============================================================
// Helper Functions
// ============================================================

function makeIncoming(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    id: 'msg_001',
    channel: 'telegram',
    senderId: 'user123',
    senderName: 'TestUser',
    text: 'Hello Butler',
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeOutgoing(overrides: Partial<OutgoingMessage> = {}): OutgoingMessage {
  return {
    channel: 'telegram',
    recipientId: 'user123',
    text: 'Hello from Butler',
    ...overrides,
  };
}

function makeAllowedSendersConfig(overrides: Partial<AllowedSendersConfig> = {}): AllowedSendersConfig {
  return {
    whatsapp: [],
    telegram: [],
    discord: [],
    slack: [],
    ...overrides,
  };
}

// ============================================================
// 1. Channel Adapter Base
// ============================================================

describe('ChannelAdapter', () => {
  let adapter: MockAdapter;

  beforeEach(() => {
    adapter = new MockAdapter('telegram');
  });

  it('starts in disconnected status', () => {
    expect(adapter.getStatus()).toBe('disconnected');
  });

  it('connects and changes status', async () => {
    await adapter.connect();
    expect(adapter.getStatus()).toBe('connected');
    expect(adapter.connectCalled).toBe(true);
  });

  it('disconnects and changes status', async () => {
    await adapter.connect();
    await adapter.disconnect();
    expect(adapter.getStatus()).toBe('disconnected');
    expect(adapter.disconnectCalled).toBe(true);
  });

  it('emits status events on status change', async () => {
    const statusEvents: Array<{ channel: Channel; status: ChannelStatus; previous: ChannelStatus }> = [];
    adapter.on('status', (event) => statusEvents.push(event));

    await adapter.connect();
    expect(statusEvents).toHaveLength(1);
    expect(statusEvents[0]).toEqual({
      channel: 'telegram',
      status: 'connected',
      previous: 'disconnected',
    });
  });

  it('does not emit status event when status unchanged', async () => {
    await adapter.connect();
    const statusEvents: unknown[] = [];
    adapter.on('status', (event) => statusEvents.push(event));

    adapter.simulateStatusChange('connected');
    expect(statusEvents).toHaveLength(0);
  });

  it('dispatches incoming messages to callbacks', () => {
    const received: IncomingMessage[] = [];
    adapter.onMessage((msg) => received.push(msg));

    const incoming = makeIncoming();
    adapter.simulateIncoming(incoming);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(incoming);
  });

  it('dispatches incoming messages as events', () => {
    const received: IncomingMessage[] = [];
    adapter.on('message', (msg) => received.push(msg));

    const incoming = makeIncoming();
    adapter.simulateIncoming(incoming);

    expect(received).toHaveLength(1);
  });

  it('supports multiple message callbacks', () => {
    const received1: IncomingMessage[] = [];
    const received2: IncomingMessage[] = [];
    adapter.onMessage((msg) => received1.push(msg));
    adapter.onMessage((msg) => received2.push(msg));

    adapter.simulateIncoming(makeIncoming());

    expect(received1).toHaveLength(1);
    expect(received2).toHaveLength(1);
  });

  it('can remove message callbacks', () => {
    const received: IncomingMessage[] = [];
    const cb = (msg: IncomingMessage) => received.push(msg);
    adapter.onMessage(cb);
    adapter.removeMessageCallback(cb);

    adapter.simulateIncoming(makeIncoming());
    expect(received).toHaveLength(0);
  });

  it('sends messages and returns message ID', async () => {
    await adapter.connect();
    const msg = makeOutgoing();
    const id = await adapter.sendMessage(msg);

    expect(id).toBeDefined();
    expect(adapter.sentMessages).toHaveLength(1);
    expect(adapter.sentMessages[0]).toEqual(msg);
  });

  it('formats text for channel', () => {
    const formatted = adapter.formatForChannel('Hello');
    expect(formatted).toBe('[telegram] Hello');
  });

  it('has correct channel property', () => {
    expect(adapter.channel).toBe('telegram');

    const whatsapp = new MockAdapter('whatsapp');
    expect(whatsapp.channel).toBe('whatsapp');
  });
});

// ============================================================
// 2. Sender Allowlist & Pairing
// ============================================================

describe('SenderAllowlist', () => {
  let allowlist: SenderAllowlist;

  beforeEach(() => {
    allowlist = new SenderAllowlist(makeAllowedSendersConfig({
      telegram: ['user123', 'user456'],
      whatsapp: ['phone1'],
    }));
  });

  it('allows configured senders', () => {
    expect(allowlist.isAllowed('telegram', 'user123')).toBe(true);
    expect(allowlist.isAllowed('telegram', 'user456')).toBe(true);
    expect(allowlist.isAllowed('whatsapp', 'phone1')).toBe(true);
  });

  it('blocks unknown senders', () => {
    expect(allowlist.isAllowed('telegram', 'unknown')).toBe(false);
    expect(allowlist.isAllowed('discord', 'anyone')).toBe(false);
    expect(allowlist.isAllowed('slack', 'anyone')).toBe(false);
  });

  it('generates 6-digit pairing codes', () => {
    const code = allowlist.generatePairingCode('telegram', 'newuser', 'New User');
    expect(code).toMatch(/^\d{6}$/);
  });

  it('validates pairing codes', () => {
    const code = allowlist.generatePairingCode('telegram', 'newuser', 'New User');
    const request = allowlist.validatePairingCode(code);

    expect(request).not.toBeNull();
    expect(request?.channel).toBe('telegram');
    expect(request?.senderId).toBe('newuser');
    expect(request?.senderName).toBe('New User');
  });

  it('rejects invalid pairing codes', () => {
    expect(allowlist.validatePairingCode('999999')).toBeNull();
    expect(allowlist.validatePairingCode('')).toBeNull();
  });

  it('rejects expired pairing codes', () => {
    // Create with 0ms TTL for instant expiration
    const shortAllowlist = new SenderAllowlist(
      makeAllowedSendersConfig(),
      0, // 0ms TTL
    );

    const code = shortAllowlist.generatePairingCode('telegram', 'newuser', 'New User');

    // Code should be expired immediately
    const request = shortAllowlist.validatePairingCode(code);
    expect(request).toBeNull();
  });

  it('confirms pairing and adds sender to allowlist', () => {
    const code = allowlist.generatePairingCode('discord', 'discorduser', 'Discord User');
    expect(allowlist.isAllowed('discord', 'discorduser')).toBe(false);

    const confirmed = allowlist.confirmPairing(code);
    expect(confirmed).toBe(true);
    expect(allowlist.isAllowed('discord', 'discorduser')).toBe(true);
  });

  it('does not confirm same code twice', () => {
    const code = allowlist.generatePairingCode('discord', 'discorduser', 'Discord User');
    allowlist.confirmPairing(code);
    expect(allowlist.confirmPairing(code)).toBe(false);
  });

  it('manually adds senders', () => {
    allowlist.addSender('slack', 'slackuser');
    expect(allowlist.isAllowed('slack', 'slackuser')).toBe(true);
  });

  it('manually removes senders', () => {
    expect(allowlist.isAllowed('telegram', 'user123')).toBe(true);
    allowlist.removeSender('telegram', 'user123');
    expect(allowlist.isAllowed('telegram', 'user123')).toBe(false);
  });

  it('lists allowed senders per channel', () => {
    const telegramAllowed = allowlist.getAllowed('telegram');
    expect(telegramAllowed).toContain('user123');
    expect(telegramAllowed).toContain('user456');
    expect(telegramAllowed).toHaveLength(2);
  });

  it('lists pending pairings', () => {
    allowlist.generatePairingCode('telegram', 'user_a', 'User A');
    allowlist.generatePairingCode('discord', 'user_b', 'User B');

    const pending = allowlist.getPendingPairings();
    expect(pending).toHaveLength(2);
  });

  it('clears expired pairings', () => {
    const shortAllowlist = new SenderAllowlist(
      makeAllowedSendersConfig(),
      0,
    );

    shortAllowlist.generatePairingCode('telegram', 'user_a', 'User A');
    const cleared = shortAllowlist.clearExpiredPairings();
    expect(cleared).toBe(1);
  });
});

// ============================================================
// 3. Message Router
// ============================================================

describe('MessageRouter', () => {
  let router: MessageRouter;
  let allowlist: SenderAllowlist;
  let adapter: MockAdapter;

  beforeEach(() => {
    allowlist = new SenderAllowlist(makeAllowedSendersConfig({
      telegram: ['user123'],
    }));
    router = new MessageRouter(allowlist);
    adapter = new MockAdapter('telegram');
    router.registerAdapter(adapter);
  });

  describe('incoming messages', () => {
    it('routes allowed sender messages to incoming event', () => {
      const received: IncomingMessage[] = [];
      router.on('incoming', (msg) => received.push(msg));

      adapter.simulateIncoming(makeIncoming({
        senderId: 'user123',
      }));

      expect(received).toHaveLength(1);
      expect(received[0].text).toBe('Hello Butler');
    });

    it('queues incoming messages', () => {
      adapter.simulateIncoming(makeIncoming({ senderId: 'user123' }));
      adapter.simulateIncoming(makeIncoming({ senderId: 'user123', id: 'msg_002', text: 'Second' }));

      const queue = router.getMessageQueue();
      expect(queue).toHaveLength(2);
    });

    it('dequeues messages in order', () => {
      adapter.simulateIncoming(makeIncoming({ senderId: 'user123', text: 'First' }));
      adapter.simulateIncoming(makeIncoming({ senderId: 'user123', text: 'Second' }));

      const first = router.dequeueMessage();
      expect(first?.text).toBe('First');

      const second = router.dequeueMessage();
      expect(second?.text).toBe('Second');

      expect(router.dequeueMessage()).toBeUndefined();
    });

    it('blocks unknown senders and generates pairing code', () => {
      const pairingEvents: Array<{ message: IncomingMessage; code: string }> = [];
      router.on('pairing:required', (event) => pairingEvents.push(event));

      adapter.simulateIncoming(makeIncoming({
        senderId: 'unknown_user',
        senderName: 'Unknown',
      }));

      expect(pairingEvents).toHaveLength(1);
      expect(pairingEvents[0].code).toMatch(/^\d{6}$/);

      // Message should NOT be in queue
      expect(router.getMessageQueue()).toHaveLength(0);
    });

    it('emits typing indicator for allowed senders', () => {
      const typingEvents: Array<{ channel: Channel; recipientId: string }> = [];
      router.on('typing', (event) => typingEvents.push(event));

      adapter.simulateIncoming(makeIncoming({ senderId: 'user123' }));

      expect(typingEvents).toHaveLength(1);
      expect(typingEvents[0].channel).toBe('telegram');
    });

    it('logs incoming messages to audit', () => {
      adapter.simulateIncoming(makeIncoming({ senderId: 'user123' }));

      const audit = router.getAuditLog();
      expect(audit).toHaveLength(1);
      expect(audit[0].direction).toBe('incoming');
      expect(audit[0].status).toBe('received');
    });

    it('logs blocked messages to audit', () => {
      adapter.simulateIncoming(makeIncoming({ senderId: 'unknown' }));

      const audit = router.getAuditLog();
      expect(audit).toHaveLength(1);
      expect(audit[0].status).toBe('blocked');
      expect(audit[0].reason).toContain('Pairing code');
    });
  });

  describe('outgoing messages', () => {
    it('queues outgoing messages with pending status', () => {
      const pending = router.queueOutgoing(makeOutgoing());

      expect(pending.status).toBe('pending');
      expect(pending.id).toBeDefined();
    });

    it('emits outgoing:pending event for user review', () => {
      const pendingEvents: PendingOutgoing[] = [];
      router.on('outgoing:pending', (event) => pendingEvents.push(event));

      router.queueOutgoing(makeOutgoing());

      expect(pendingEvents).toHaveLength(1);
      expect(pendingEvents[0].status).toBe('pending');
    });

    it('approves and sends outgoing messages', async () => {
      await adapter.connect();
      const pending = router.queueOutgoing(makeOutgoing());

      const result = await router.approveOutgoing(pending.id);
      expect(result).toBe(true);
      expect(adapter.sentMessages).toHaveLength(1);
    });

    it('allows editing text before approval', async () => {
      await adapter.connect();
      const pending = router.queueOutgoing(makeOutgoing({ text: 'Original' }));

      await router.approveOutgoing(pending.id, 'Edited text');
      expect(adapter.sentMessages[0].text).toBe('Edited text');
    });

    it('rejects outgoing messages', () => {
      const rejectedEvents: PendingOutgoing[] = [];
      router.on('outgoing:rejected', (event) => rejectedEvents.push(event));

      const pending = router.queueOutgoing(makeOutgoing());
      const result = router.rejectOutgoing(pending.id, 'Not appropriate');

      expect(result).toBe(true);
      expect(rejectedEvents).toHaveLength(1);
    });

    it('cannot approve already rejected message', async () => {
      const pending = router.queueOutgoing(makeOutgoing());
      router.rejectOutgoing(pending.id);

      const result = await router.approveOutgoing(pending.id);
      expect(result).toBe(false);
    });

    it('cannot reject already approved message', async () => {
      await adapter.connect();
      const pending = router.queueOutgoing(makeOutgoing());
      await router.approveOutgoing(pending.id);

      const result = router.rejectOutgoing(pending.id);
      expect(result).toBe(false);
    });

    it('lists pending outgoing messages', () => {
      router.queueOutgoing(makeOutgoing({ text: 'First' }));
      router.queueOutgoing(makeOutgoing({ text: 'Second' }));

      const pending = router.getPendingOutgoing();
      expect(pending).toHaveLength(2);
    });

    it('logs outgoing messages through audit lifecycle', async () => {
      await adapter.connect();
      const pending = router.queueOutgoing(makeOutgoing());
      await router.approveOutgoing(pending.id);

      const audit = router.getAuditLog();
      const outgoingAudit = audit.filter((r) => r.direction === 'outgoing');
      expect(outgoingAudit).toHaveLength(2);
      expect(outgoingAudit[0].status).toBe('pending_review');
      expect(outgoingAudit[1].status).toBe('sent');
    });

    it('logs rejected outgoing to audit', () => {
      const pending = router.queueOutgoing(makeOutgoing());
      router.rejectOutgoing(pending.id, 'Bad response');

      const audit = router.getAuditLog();
      const outgoingAudit = audit.filter((r) => r.direction === 'outgoing');
      expect(outgoingAudit).toHaveLength(2);
      expect(outgoingAudit[1].status).toBe('rejected');
      expect(outgoingAudit[1].reason).toBe('Bad response');
    });

    it('emits outgoing:sent event on successful send', async () => {
      await adapter.connect();
      const sentEvents: PendingOutgoing[] = [];
      router.on('outgoing:sent', (event) => sentEvents.push(event));

      const pending = router.queueOutgoing(makeOutgoing());
      await router.approveOutgoing(pending.id);

      expect(sentEvents).toHaveLength(1);
    });

    it('includes inReplyTo reference', () => {
      const incoming = makeIncoming();
      const pending = router.queueOutgoing(makeOutgoing(), incoming);

      expect(pending.inReplyTo).toEqual(incoming);
    });
  });

  describe('adapter management', () => {
    it('registers multiple adapters', () => {
      const discordAdapter = new MockAdapter('discord');
      router.registerAdapter(discordAdapter);

      expect(router.getAdapter('telegram')).toBe(adapter);
      expect(router.getAdapter('discord')).toBe(discordAdapter);
    });

    it('unregisters adapters', () => {
      router.unregisterAdapter('telegram');
      expect(router.getAdapter('telegram')).toBeUndefined();
    });

    it('fails to approve message when adapter missing', async () => {
      const pending = router.queueOutgoing(makeOutgoing({ channel: 'discord' }));
      const result = await router.approveOutgoing(pending.id);
      expect(result).toBe(false);
    });

    it('routes messages from correct adapter', () => {
      const discordAdapter = new MockAdapter('discord');
      router.registerAdapter(discordAdapter);

      // Add discord user to allowlist
      allowlist.addSender('discord', 'discord_user');

      const received: IncomingMessage[] = [];
      router.on('incoming', (msg) => received.push(msg));

      discordAdapter.simulateIncoming(makeIncoming({
        channel: 'discord',
        senderId: 'discord_user',
      }));

      expect(received).toHaveLength(1);
      expect(received[0].channel).toBe('discord');
    });
  });

  describe('audit trail', () => {
    it('records all message activity', () => {
      // Incoming allowed
      adapter.simulateIncoming(makeIncoming({ senderId: 'user123', text: 'Hi' }));

      // Incoming blocked
      adapter.simulateIncoming(makeIncoming({ senderId: 'unknown', text: 'Spam' }));

      // Outgoing queued
      router.queueOutgoing(makeOutgoing({ text: 'Reply' }));

      const audit = router.getAuditLog();
      expect(audit).toHaveLength(3);
    });

    it('emits audit events', () => {
      const auditEvents: AuditRecord[] = [];
      router.on('audit', (record) => auditEvents.push(record));

      adapter.simulateIncoming(makeIncoming({ senderId: 'user123' }));

      expect(auditEvents).toHaveLength(1);
      expect(auditEvents[0].direction).toBe('incoming');
    });
  });
});

// ============================================================
// 4. Mock Adapter Tests (WhatsApp/Telegram/Discord/Slack)
// ============================================================

describe('Mock Adapter Behaviors', () => {
  describe('WhatsApp adapter mock', () => {
    let adapter: MockAdapter;

    beforeEach(() => {
      adapter = new MockAdapter('whatsapp');
    });

    it('handles group messages with groupId', () => {
      const received: IncomingMessage[] = [];
      adapter.onMessage((msg) => received.push(msg));

      adapter.simulateIncoming(makeIncoming({
        channel: 'whatsapp',
        senderId: 'phone123',
        groupId: 'group_abc@g.us',
        text: 'Group message',
      }));

      expect(received[0].groupId).toBe('group_abc@g.us');
    });

    it('handles DM messages without groupId', () => {
      const received: IncomingMessage[] = [];
      adapter.onMessage((msg) => received.push(msg));

      adapter.simulateIncoming(makeIncoming({
        channel: 'whatsapp',
        senderId: 'phone123',
        text: 'DM message',
      }));

      expect(received[0].groupId).toBeUndefined();
    });

    it('handles media messages', () => {
      const received: IncomingMessage[] = [];
      adapter.onMessage((msg) => received.push(msg));

      adapter.simulateIncoming(makeIncoming({
        channel: 'whatsapp',
        media: {
          type: 'image',
          mimeType: 'image/jpeg',
          url: 'https://example.com/photo.jpg',
        },
      }));

      expect(received[0].media?.type).toBe('image');
    });
  });

  describe('Telegram adapter mock', () => {
    let adapter: MockAdapter;

    beforeEach(() => {
      adapter = new MockAdapter('telegram');
    });

    it('handles supergroup messages', () => {
      const received: IncomingMessage[] = [];
      adapter.onMessage((msg) => received.push(msg));

      adapter.simulateIncoming(makeIncoming({
        channel: 'telegram',
        groupId: '-1001234567890',
        text: 'Supergroup message',
      }));

      expect(received[0].groupId).toBe('-1001234567890');
    });

    it('handles reply-to messages', () => {
      const received: IncomingMessage[] = [];
      adapter.onMessage((msg) => received.push(msg));

      adapter.simulateIncoming(makeIncoming({
        channel: 'telegram',
        replyTo: '42',
        text: 'This is a reply',
      }));

      expect(received[0].replyTo).toBe('42');
    });
  });

  describe('Discord adapter mock', () => {
    let adapter: MockAdapter;

    beforeEach(() => {
      adapter = new MockAdapter('discord');
    });

    it('handles server/channel messages', () => {
      const received: IncomingMessage[] = [];
      adapter.onMessage((msg) => received.push(msg));

      adapter.simulateIncoming(makeIncoming({
        channel: 'discord',
        senderId: 'user#1234',
        groupId: 'channel_123',
      }));

      expect(received[0].groupId).toBe('channel_123');
    });

    it('handles thread replies', () => {
      const received: IncomingMessage[] = [];
      adapter.onMessage((msg) => received.push(msg));

      adapter.simulateIncoming(makeIncoming({
        channel: 'discord',
        replyTo: 'thread_msg_123',
      }));

      expect(received[0].replyTo).toBe('thread_msg_123');
    });
  });

  describe('Slack adapter mock', () => {
    let adapter: MockAdapter;

    beforeEach(() => {
      adapter = new MockAdapter('slack');
    });

    it('handles channel messages', () => {
      const received: IncomingMessage[] = [];
      adapter.onMessage((msg) => received.push(msg));

      adapter.simulateIncoming(makeIncoming({
        channel: 'slack',
        groupId: 'C0123456789',
      }));

      expect(received[0].groupId).toBe('C0123456789');
    });

    it('handles thread messages', () => {
      const received: IncomingMessage[] = [];
      adapter.onMessage((msg) => received.push(msg));

      adapter.simulateIncoming(makeIncoming({
        channel: 'slack',
        replyTo: '1234567890.123456',
      }));

      expect(received[0].replyTo).toBe('1234567890.123456');
    });
  });
});

// ============================================================
// 5. Outgoing Message Review Flow (Transparency)
// ============================================================

describe('Outgoing Message Review Flow', () => {
  let router: MessageRouter;
  let allowlist: SenderAllowlist;
  let adapter: MockAdapter;

  beforeEach(async () => {
    allowlist = new SenderAllowlist(makeAllowedSendersConfig({
      telegram: ['user123'],
    }));
    router = new MessageRouter(allowlist);
    adapter = new MockAdapter('telegram');
    router.registerAdapter(adapter);
    await adapter.connect();
  });

  it('full flow: receive -> process -> review -> send', async () => {
    const events: string[] = [];

    router.on('incoming', () => events.push('incoming'));
    router.on('outgoing:pending', () => events.push('outgoing:pending'));
    router.on('outgoing:sent', () => events.push('outgoing:sent'));

    // Step 1: Receive incoming message
    adapter.simulateIncoming(makeIncoming({ senderId: 'user123', text: 'What time is it?' }));
    expect(events).toContain('incoming');

    // Step 2: Agent processes and queues response
    const incoming = router.dequeueMessage()!;
    const pending = router.queueOutgoing(
      makeOutgoing({ text: 'It is 3:00 PM', recipientId: incoming.senderId }),
      incoming,
    );
    expect(events).toContain('outgoing:pending');

    // Step 3: User reviews and approves
    const result = await router.approveOutgoing(pending.id);
    expect(result).toBe(true);
    expect(events).toContain('outgoing:sent');

    // Step 4: Message was sent through adapter
    expect(adapter.sentMessages).toHaveLength(1);
    expect(adapter.sentMessages[0].text).toBe('It is 3:00 PM');
  });

  it('full flow: receive -> process -> review -> edit -> send', async () => {
    adapter.simulateIncoming(makeIncoming({ senderId: 'user123' }));
    const incoming = router.dequeueMessage()!;

    const pending = router.queueOutgoing(
      makeOutgoing({ text: 'Auto-generated response' }),
      incoming,
    );

    // User edits before approving
    await router.approveOutgoing(pending.id, 'User-edited response');

    expect(adapter.sentMessages[0].text).toBe('User-edited response');
  });

  it('full flow: receive -> process -> review -> reject', () => {
    adapter.simulateIncoming(makeIncoming({ senderId: 'user123' }));

    const pending = router.queueOutgoing(makeOutgoing({ text: 'Bad response' }));

    router.rejectOutgoing(pending.id, 'Response is inappropriate');

    // Nothing sent
    expect(adapter.sentMessages).toHaveLength(0);

    // Audit shows rejection
    const audit = router.getAuditLog();
    const rejected = audit.find((r) => r.status === 'rejected');
    expect(rejected).toBeDefined();
    expect(rejected?.reason).toBe('Response is inappropriate');
  });

  it('no silent auto-replies: all outgoing requires explicit approval', () => {
    // Queue 3 outgoing messages
    router.queueOutgoing(makeOutgoing({ text: 'Msg 1' }));
    router.queueOutgoing(makeOutgoing({ text: 'Msg 2' }));
    router.queueOutgoing(makeOutgoing({ text: 'Msg 3' }));

    // None should be sent automatically
    expect(adapter.sentMessages).toHaveLength(0);

    // All should be pending
    const pending = router.getPendingOutgoing();
    expect(pending).toHaveLength(3);
    expect(pending.every((p) => p.status === 'pending')).toBe(true);
  });
});

// ============================================================
// 6. Channel Status Management
// ============================================================

describe('Channel Status Management', () => {
  it('tracks status across multiple adapters', async () => {
    const telegram = new MockAdapter('telegram');
    const discord = new MockAdapter('discord');
    const whatsapp = new MockAdapter('whatsapp');

    expect(telegram.getStatus()).toBe('disconnected');
    expect(discord.getStatus()).toBe('disconnected');

    await telegram.connect();
    expect(telegram.getStatus()).toBe('connected');
    expect(discord.getStatus()).toBe('disconnected');

    await discord.connect();
    expect(discord.getStatus()).toBe('connected');

    telegram.simulateStatusChange('reconnecting');
    expect(telegram.getStatus()).toBe('reconnecting');
    expect(discord.getStatus()).toBe('connected');

    telegram.simulateStatusChange('error');
    expect(telegram.getStatus()).toBe('error');
  });

  it('emits status transitions correctly', async () => {
    const adapter = new MockAdapter('telegram');
    const transitions: Array<{ status: ChannelStatus; previous: ChannelStatus }> = [];
    adapter.on('status', (event) => transitions.push(event));

    await adapter.connect();
    adapter.simulateStatusChange('reconnecting');
    adapter.simulateStatusChange('connected');
    await adapter.disconnect();

    expect(transitions).toEqual([
      { channel: 'telegram', status: 'connected', previous: 'disconnected' },
      { channel: 'telegram', status: 'reconnecting', previous: 'connected' },
      { channel: 'telegram', status: 'connected', previous: 'reconnecting' },
      { channel: 'telegram', status: 'disconnected', previous: 'connected' },
    ]);
  });
});

// ============================================================
// 7. Multi-Channel Routing
// ============================================================

describe('Multi-Channel Routing', () => {
  let router: MessageRouter;
  let allowlist: SenderAllowlist;
  let telegramAdapter: MockAdapter;
  let discordAdapter: MockAdapter;
  let slackAdapter: MockAdapter;

  beforeEach(async () => {
    allowlist = new SenderAllowlist(makeAllowedSendersConfig({
      telegram: ['tg_user'],
      discord: ['dc_user'],
      slack: ['sl_user'],
    }));
    router = new MessageRouter(allowlist);

    telegramAdapter = new MockAdapter('telegram');
    discordAdapter = new MockAdapter('discord');
    slackAdapter = new MockAdapter('slack');

    router.registerAdapter(telegramAdapter);
    router.registerAdapter(discordAdapter);
    router.registerAdapter(slackAdapter);

    await telegramAdapter.connect();
    await discordAdapter.connect();
    await slackAdapter.connect();
  });

  it('routes responses back to originating channel', async () => {
    // Message from Telegram
    telegramAdapter.simulateIncoming(makeIncoming({
      channel: 'telegram',
      senderId: 'tg_user',
      text: 'Hello from Telegram',
    }));

    const incoming = router.dequeueMessage()!;
    const pending = router.queueOutgoing({
      channel: incoming.channel,
      recipientId: incoming.senderId,
      text: 'Response to Telegram',
    });

    await router.approveOutgoing(pending.id);

    expect(telegramAdapter.sentMessages).toHaveLength(1);
    expect(discordAdapter.sentMessages).toHaveLength(0);
    expect(slackAdapter.sentMessages).toHaveLength(0);
  });

  it('handles concurrent messages from different channels', () => {
    telegramAdapter.simulateIncoming(makeIncoming({
      channel: 'telegram',
      senderId: 'tg_user',
      text: 'Telegram msg',
    }));
    discordAdapter.simulateIncoming(makeIncoming({
      channel: 'discord',
      senderId: 'dc_user',
      text: 'Discord msg',
    }));
    slackAdapter.simulateIncoming(makeIncoming({
      channel: 'slack',
      senderId: 'sl_user',
      text: 'Slack msg',
    }));

    expect(router.getMessageQueue()).toHaveLength(3);
  });
});

// ============================================================
// 8. Config Integration
// ============================================================

describe('Config Integration', () => {
  it('default config has channels with all disabled', () => {
    expect(defaultConfig.channels).toBeDefined();
    expect(defaultConfig.channels?.whatsapp?.enabled).toBe(false);
    expect(defaultConfig.channels?.telegram?.enabled).toBe(false);
    expect(defaultConfig.channels?.discord?.enabled).toBe(false);
    expect(defaultConfig.channels?.slack?.enabled).toBe(false);
  });

  it('default config has empty allowed senders', () => {
    expect(defaultConfig.channels?.allowedSenders).toBeDefined();
    expect(defaultConfig.channels?.allowedSenders?.whatsapp).toEqual([]);
    expect(defaultConfig.channels?.allowedSenders?.telegram).toEqual([]);
    expect(defaultConfig.channels?.allowedSenders?.discord).toEqual([]);
    expect(defaultConfig.channels?.allowedSenders?.slack).toEqual([]);
  });

  it('channels config is optional in schema validation', () => {
    const configWithout = { ...defaultConfig };
    delete configWithout.channels;
    const result = validateConfig(configWithout);
    expect(result.success).toBe(true);
  });

  it('validates channels config with enabled telegram', () => {
    const config = {
      ...defaultConfig,
      channels: {
        telegram: {
          enabled: true,
          botToken: 'test-token-123',
        },
        allowedSenders: {
          whatsapp: [],
          telegram: ['user1'],
          discord: [],
          slack: [],
        },
      },
    };

    const result = validateConfig(config);
    expect(result.success).toBe(true);
  });

  it('validates channels config with all channels', () => {
    const config = {
      ...defaultConfig,
      channels: {
        whatsapp: {
          enabled: true,
          sessionPath: '.pawnbutler/wa-session',
        },
        telegram: {
          enabled: true,
          botToken: 'tg-token',
        },
        discord: {
          enabled: true,
          botToken: 'dc-token',
          guildId: 'guild-123',
        },
        slack: {
          enabled: true,
          botToken: 'xoxb-token',
          appToken: 'xapp-token',
          signingSecret: 'secret-123',
        },
        allowedSenders: {
          whatsapp: ['phone1'],
          telegram: ['tg1'],
          discord: ['dc1'],
          slack: ['sl1'],
        },
      },
    };

    const result = validateConfig(config);
    expect(result.success).toBe(true);
  });

  it('rejects channels config with invalid slack (missing appToken)', () => {
    const config = {
      ...defaultConfig,
      channels: {
        slack: {
          enabled: true,
          botToken: 'xoxb-token',
          // missing appToken and signingSecret
        },
        allowedSenders: {
          whatsapp: [],
          telegram: [],
          discord: [],
          slack: [],
        },
      },
    };

    const result = validateConfig(config);
    expect(result.success).toBe(false);
  });

  it('ChannelsConfig type exists in core types', () => {
    const config: CoreChannelsConfig = {
      whatsapp: { enabled: false, sessionPath: '.test' },
      telegram: { enabled: false, botToken: '' },
      discord: { enabled: false, botToken: '' },
      slack: { enabled: false, botToken: '', appToken: '', signingSecret: '' },
      allowedSenders: {
        whatsapp: [],
        telegram: [],
        discord: [],
        slack: [],
      },
    };
    expect(config.allowedSenders).toBeDefined();
  });

  it('DEFAULT_CHANNELS_CONFIG is exported', () => {
    expect(DEFAULT_CHANNELS_CONFIG).toBeDefined();
    expect(DEFAULT_CHANNELS_CONFIG?.allowedSenders).toBeDefined();
  });
});

// ============================================================
// 9. WhatsApp Adapter Unit Tests
// ============================================================

describe('WhatsApp Adapter', () => {
  it('can be imported', async () => {
    const { WhatsAppAdapter } = await import('../src/channels/whatsapp/whatsapp-adapter.js');
    expect(WhatsAppAdapter).toBeDefined();
  });

  it('creates instance with config', async () => {
    const { WhatsAppAdapter } = await import('../src/channels/whatsapp/whatsapp-adapter.js');
    const adapter = new WhatsAppAdapter({
      enabled: true,
      sessionPath: '.pawnbutler/wa-test',
    });

    expect(adapter.channel).toBe('whatsapp');
    expect(adapter.getStatus()).toBe('disconnected');
  });

  it('rejects connect when disabled', async () => {
    const { WhatsAppAdapter } = await import('../src/channels/whatsapp/whatsapp-adapter.js');
    const adapter = new WhatsAppAdapter({
      enabled: false,
      sessionPath: '.pawnbutler/wa-test',
    });

    await expect(adapter.connect()).rejects.toThrow('WhatsApp channel is not enabled');
  });

  it('formats text for WhatsApp (passthrough)', async () => {
    const { WhatsAppAdapter } = await import('../src/channels/whatsapp/whatsapp-adapter.js');
    const adapter = new WhatsAppAdapter({
      enabled: true,
      sessionPath: '.test',
    });

    expect(adapter.formatForChannel('Hello *bold*')).toBe('Hello *bold*');
  });
});

// ============================================================
// 10. WhatsApp Auth Manager
// ============================================================

describe('WhatsApp Auth Manager', () => {
  it('can be imported', async () => {
    const { WhatsAppAuthManager } = await import('../src/channels/whatsapp/whatsapp-auth.js');
    expect(WhatsAppAuthManager).toBeDefined();
  });

  it('reports no session when path does not exist', async () => {
    const { WhatsAppAuthManager } = await import('../src/channels/whatsapp/whatsapp-auth.js');
    const auth = new WhatsAppAuthManager('/tmp/nonexistent-pawnbutler-test-session');

    expect(auth.hasSession()).toBe(false);
    expect(auth.loadSession()).toBeNull();
  });

  it('returns session path', async () => {
    const { WhatsAppAuthManager } = await import('../src/channels/whatsapp/whatsapp-auth.js');
    const auth = new WhatsAppAuthManager('/tmp/test-session');
    expect(auth.getSessionPath()).toBe('/tmp/test-session');
  });
});

// ============================================================
// 11. Telegram Adapter Unit Tests
// ============================================================

describe('Telegram Adapter', () => {
  it('can be imported', async () => {
    const { TelegramAdapter } = await import('../src/channels/telegram/telegram-adapter.js');
    expect(TelegramAdapter).toBeDefined();
  });

  it('creates instance with config', async () => {
    const { TelegramAdapter } = await import('../src/channels/telegram/telegram-adapter.js');
    const adapter = new TelegramAdapter({
      enabled: true,
      botToken: 'test-token',
    });

    expect(adapter.channel).toBe('telegram');
    expect(adapter.getStatus()).toBe('disconnected');
  });

  it('rejects connect when disabled', async () => {
    const { TelegramAdapter } = await import('../src/channels/telegram/telegram-adapter.js');
    const adapter = new TelegramAdapter({
      enabled: false,
      botToken: 'test-token',
    });

    await expect(adapter.connect()).rejects.toThrow('Telegram channel is not enabled');
  });

  it('formats text for Telegram (passthrough)', async () => {
    const { TelegramAdapter } = await import('../src/channels/telegram/telegram-adapter.js');
    const adapter = new TelegramAdapter({
      enabled: true,
      botToken: 'test',
    });

    expect(adapter.formatForChannel('*bold* _italic_')).toBe('*bold* _italic_');
  });
});

// ============================================================
// 12. Discord Adapter Unit Tests
// ============================================================

describe('Discord Adapter', () => {
  it('can be imported', async () => {
    const { DiscordAdapter } = await import('../src/channels/discord/discord-adapter.js');
    expect(DiscordAdapter).toBeDefined();
  });

  it('creates instance with config', async () => {
    const { DiscordAdapter } = await import('../src/channels/discord/discord-adapter.js');
    const adapter = new DiscordAdapter({
      enabled: true,
      botToken: 'test-token',
    });

    expect(adapter.channel).toBe('discord');
    expect(adapter.getStatus()).toBe('disconnected');
  });

  it('rejects connect when disabled', async () => {
    const { DiscordAdapter } = await import('../src/channels/discord/discord-adapter.js');
    const adapter = new DiscordAdapter({
      enabled: false,
      botToken: 'test-token',
    });

    await expect(adapter.connect()).rejects.toThrow('Discord channel is not enabled');
  });

  it('formats text for Discord (passthrough)', async () => {
    const { DiscordAdapter } = await import('../src/channels/discord/discord-adapter.js');
    const adapter = new DiscordAdapter({
      enabled: true,
      botToken: 'test',
    });

    expect(adapter.formatForChannel('**bold** ~~strike~~')).toBe('**bold** ~~strike~~');
  });
});

// ============================================================
// 13. Slack Adapter Unit Tests
// ============================================================

describe('Slack Adapter', () => {
  it('can be imported', async () => {
    const { SlackAdapter } = await import('../src/channels/slack/slack-adapter.js');
    expect(SlackAdapter).toBeDefined();
  });

  it('creates instance with config', async () => {
    const { SlackAdapter } = await import('../src/channels/slack/slack-adapter.js');
    const adapter = new SlackAdapter({
      enabled: true,
      botToken: 'xoxb-test',
      appToken: 'xapp-test',
      signingSecret: 'secret',
    });

    expect(adapter.channel).toBe('slack');
    expect(adapter.getStatus()).toBe('disconnected');
  });

  it('rejects connect when disabled', async () => {
    const { SlackAdapter } = await import('../src/channels/slack/slack-adapter.js');
    const adapter = new SlackAdapter({
      enabled: false,
      botToken: 'xoxb-test',
      appToken: 'xapp-test',
      signingSecret: 'secret',
    });

    await expect(adapter.connect()).rejects.toThrow('Slack channel is not enabled');
  });

  it('converts markdown bold to Slack mrkdwn', async () => {
    const { SlackAdapter } = await import('../src/channels/slack/slack-adapter.js');
    const adapter = new SlackAdapter({
      enabled: true,
      botToken: 'xoxb-test',
      appToken: 'xapp-test',
      signingSecret: 'secret',
    });

    expect(adapter.formatForChannel('**bold text**')).toBe('*bold text*');
    expect(adapter.formatForChannel('normal text')).toBe('normal text');
  });
});

// ============================================================
// 14. Channel Types
// ============================================================

describe('Channel Types', () => {
  it('IncomingMessage has all required fields', () => {
    const msg: IncomingMessage = {
      id: 'test',
      channel: 'whatsapp',
      senderId: 'sender',
      senderName: 'Sender Name',
      text: 'Hello',
      timestamp: Date.now(),
    };
    expect(msg.id).toBeDefined();
    expect(msg.channel).toBeDefined();
    expect(msg.media).toBeUndefined();
    expect(msg.replyTo).toBeUndefined();
    expect(msg.groupId).toBeUndefined();
  });

  it('OutgoingMessage has all required fields', () => {
    const msg: OutgoingMessage = {
      channel: 'discord',
      recipientId: 'recipient',
      text: 'Hello',
    };
    expect(msg.channel).toBe('discord');
    expect(msg.media).toBeUndefined();
  });

  it('MediaAttachment supports all types', () => {
    const attachments: MediaAttachment[] = [
      { type: 'image', mimeType: 'image/png' },
      { type: 'document', mimeType: 'application/pdf', filename: 'doc.pdf' },
      { type: 'audio', mimeType: 'audio/mp3' },
      { type: 'video', mimeType: 'video/mp4', url: 'https://example.com/video.mp4' },
    ];

    expect(attachments).toHaveLength(4);
    expect(attachments[0].type).toBe('image');
    expect(attachments[1].filename).toBe('doc.pdf');
    expect(attachments[3].url).toBeDefined();
  });

  it('Channel type is restricted to valid values', () => {
    const channels: Channel[] = ['whatsapp', 'telegram', 'discord', 'slack'];
    expect(channels).toHaveLength(4);
  });

  it('ChannelStatus covers all states', () => {
    const statuses: ChannelStatus[] = ['connected', 'disconnected', 'reconnecting', 'error'];
    expect(statuses).toHaveLength(4);
  });
});
