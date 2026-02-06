import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChannelProvider } from '../src/notifications/channel-provider.js';
import { TelegramProvider } from '../src/notifications/telegram.js';
import { SlackProvider } from '../src/notifications/slack.js';
import { DiscordProvider } from '../src/notifications/discord.js';
import { WhatsAppProvider } from '../src/notifications/whatsapp.js';
import { NotificationManager } from '../src/notifications/notification-manager.js';
import { Guardian } from '../src/safety/guardian.js';
import { defaultConfig } from '../src/config/default-config.js';
import type { ApprovalNotification } from '../src/notifications/types.js';
import type { ActionRequest } from '../src/core/types.js';

// -------------------------------------------------------
// Test fixtures
// -------------------------------------------------------
function makeNotification(
  overrides: Partial<ApprovalNotification> = {},
): ApprovalNotification {
  return {
    requestId: 'test-req-001',
    agentName: 'executor (executor)',
    actionType: 'exec_command',
    safetyLevel: 'dangerous',
    description: 'Agent "executor" wants to execute "exec_command"',
    params: { command: 'ls -la /home' },
    ...overrides,
  };
}

function makeRequest(overrides: Partial<ActionRequest> = {}): ActionRequest {
  return {
    id: 'test-req-1',
    agentId: 'researcher',
    agentRole: 'researcher',
    actionType: 'web_search',
    params: {},
    safetyLevel: 'safe',
    timestamp: Date.now(),
    requiresApproval: false,
    ...overrides,
  };
}

// -------------------------------------------------------
// Channel Provider Message Formatting Tests
// -------------------------------------------------------
describe('Channel Provider - Message Formatting', () => {
  const notification = makeNotification();

  it('Telegram: formats approval request message with Markdown', () => {
    const provider = new TelegramProvider(
      { channel: 'telegram', botToken: 'test-token', chatId: '12345' },
    );
    const message = provider.formatMessage(notification);

    expect(message).toContain('PawnButler Approval Request');
    expect(message).toContain('test-req-001');
    expect(message).toContain('executor (executor)');
    expect(message).toContain('exec_command');
    expect(message).toContain('dangerous');
    expect(message).toContain('command: ls -la /home');
  });

  it('Slack: formats approval request message with mrkdwn', () => {
    const provider = new SlackProvider(
      { channel: 'slack', webhookUrl: 'https://hooks.slack.com/test' },
    );
    const message = provider.formatMessage(notification);

    expect(message).toContain('PawnButler Approval Request');
    expect(message).toContain('test-req-001');
    expect(message).toContain('executor (executor)');
    expect(message).toContain('exec_command');
    expect(message).toContain('dangerous');
  });

  it('Discord: formats approval request with Discord markdown', () => {
    const provider = new DiscordProvider(
      { channel: 'discord', botToken: 'test-token', channelId: '999', applicationId: 'app1' },
    );
    const message = provider.formatMessage(notification);

    expect(message).toContain('**PawnButler Approval Request**');
    expect(message).toContain('test-req-001');
    expect(message).toContain('executor (executor)');
    expect(message).toContain('exec_command');
  });

  it('WhatsApp: formats plain text approval message with YES/NO instructions', () => {
    const provider = new WhatsAppProvider(
      { channel: 'whatsapp', phoneNumberId: 'phone1', accessToken: 'token1', recipientPhone: '+1234' },
    );
    const message = provider.formatMessage(notification);

    expect(message).toContain('PawnButler Approval Request');
    expect(message).toContain('test-req-001');
    expect(message).toContain('exec_command');
    expect(message).toContain('YES');
    expect(message).toContain('NO');
  });

  it('formats message with empty params', () => {
    const provider = new TelegramProvider(
      { channel: 'telegram', botToken: 'test-token', chatId: '12345' },
    );
    const emptyNotification = makeNotification({ params: {} });
    const message = provider.formatMessage(emptyNotification);

    expect(message).toContain('(none)');
  });
});

// -------------------------------------------------------
// Approval/Rejection Response Handling
// -------------------------------------------------------
describe('Slack Provider - Action Payload Handling', () => {
  it('resolves pending approval when approve action received', async () => {
    const provider = new SlackProvider(
      { channel: 'slack', webhookUrl: 'https://hooks.slack.com/test' },
    );

    // Start listening (this creates the pending promise)
    const responsePromise = provider.listenForResponse('req-123', 5000);

    // Simulate receiving an action payload from Slack
    provider.handleActionPayload({
      actions: [{ action_id: 'approve', value: 'req-123' }],
      user: { id: 'U123', name: 'testuser' },
    });

    const response = await responsePromise;
    expect(response.requestId).toBe('req-123');
    expect(response.approved).toBe(true);
    expect(response.respondedBy).toBe('testuser');
    expect(response.respondedAt).toBeGreaterThan(0);

    provider.destroy();
  });

  it('resolves pending rejection when reject action received', async () => {
    const provider = new SlackProvider(
      { channel: 'slack', webhookUrl: 'https://hooks.slack.com/test' },
    );

    const responsePromise = provider.listenForResponse('req-456', 5000);

    provider.handleActionPayload({
      actions: [{ action_id: 'reject', value: 'req-456' }],
      user: { id: 'U456', name: 'admin' },
    });

    const response = await responsePromise;
    expect(response.requestId).toBe('req-456');
    expect(response.approved).toBe(false);
    expect(response.respondedBy).toBe('admin');
    expect(response.reason).toBe('Rejected by user');

    provider.destroy();
  });
});

describe('Discord Provider - Interaction Handling', () => {
  it('resolves pending approval on button interaction', async () => {
    const provider = new DiscordProvider(
      { channel: 'discord', botToken: 'test-token', channelId: '999', applicationId: 'app1' },
    );

    const responsePromise = provider.listenForResponse('req-discord-1', 5000);

    provider.handleInteraction({
      id: 'interaction-1',
      type: 3, // MESSAGE_COMPONENT
      data: { custom_id: 'approve:req-discord-1', component_type: 2 },
      member: { user: { id: '111', username: 'discorduser' } },
    });

    const response = await responsePromise;
    expect(response.requestId).toBe('req-discord-1');
    expect(response.approved).toBe(true);
    expect(response.respondedBy).toBe('discorduser');

    provider.destroy();
  });

  it('ignores non-component interactions', async () => {
    const provider = new DiscordProvider(
      { channel: 'discord', botToken: 'test-token', channelId: '999', applicationId: 'app1' },
    );

    const responsePromise = provider.listenForResponse('req-discord-2', 200);

    // Type 1 = PING, not a component interaction
    provider.handleInteraction({
      id: 'interaction-2',
      type: 1,
      data: { custom_id: 'approve:req-discord-2', component_type: 2 },
    });

    const response = await responsePromise;
    // Should timeout since interaction was ignored
    expect(response.approved).toBe(false);
    expect(response.respondedBy).toBe('system:timeout');

    provider.destroy();
  });
});

describe('WhatsApp Provider - Message Handling', () => {
  it('resolves via interactive button reply', async () => {
    const provider = new WhatsAppProvider(
      { channel: 'whatsapp', phoneNumberId: 'phone1', accessToken: 'token1', recipientPhone: '+1234' },
    );

    const responsePromise = provider.listenForResponse('req-wa-1', 5000);

    provider.handleIncomingMessage({
      from: '+1234567890',
      type: 'interactive',
      interactive: { button_reply: { id: 'approve:req-wa-1', title: 'Approve' } },
    });

    const response = await responsePromise;
    expect(response.requestId).toBe('req-wa-1');
    expect(response.approved).toBe(true);
    expect(response.respondedBy).toBe('+1234567890');

    provider.destroy();
  });

  it('resolves via text YES response', async () => {
    const provider = new WhatsAppProvider(
      { channel: 'whatsapp', phoneNumberId: 'phone1', accessToken: 'token1', recipientPhone: '+1234' },
    );

    const responsePromise = provider.listenForResponse('req-wa-2', 5000);

    provider.handleIncomingMessage({
      from: '+9876543210',
      type: 'text',
      text: { body: 'YES' },
    });

    const response = await responsePromise;
    expect(response.requestId).toBe('req-wa-2');
    expect(response.approved).toBe(true);

    provider.destroy();
  });

  it('resolves via text NO response', async () => {
    const provider = new WhatsAppProvider(
      { channel: 'whatsapp', phoneNumberId: 'phone1', accessToken: 'token1', recipientPhone: '+1234' },
    );

    const responsePromise = provider.listenForResponse('req-wa-3', 5000);

    provider.handleIncomingMessage({
      from: '+9876543210',
      type: 'text',
      text: { body: 'no' }, // case-insensitive
    });

    const response = await responsePromise;
    expect(response.requestId).toBe('req-wa-3');
    expect(response.approved).toBe(false);

    provider.destroy();
  });
});

// -------------------------------------------------------
// Timeout Auto-Reject Tests (fail-safe)
// -------------------------------------------------------
describe('Timeout Auto-Reject (fail-safe)', () => {
  it('Slack: auto-rejects on timeout', async () => {
    const provider = new SlackProvider(
      { channel: 'slack', webhookUrl: 'https://hooks.slack.com/test' },
    );

    const response = await provider.listenForResponse('req-timeout-1', 100);

    expect(response.requestId).toBe('req-timeout-1');
    expect(response.approved).toBe(false);
    expect(response.respondedBy).toBe('system:timeout');
    expect(response.reason).toContain('timed out');

    provider.destroy();
  });

  it('Discord: auto-rejects on timeout', async () => {
    const provider = new DiscordProvider(
      { channel: 'discord', botToken: 'test-token', channelId: '999', applicationId: 'app1' },
    );

    const response = await provider.listenForResponse('req-timeout-2', 100);

    expect(response.approved).toBe(false);
    expect(response.respondedBy).toBe('system:timeout');

    provider.destroy();
  });

  it('WhatsApp: auto-rejects on timeout', async () => {
    const provider = new WhatsAppProvider(
      { channel: 'whatsapp', phoneNumberId: 'phone1', accessToken: 'token1', recipientPhone: '+1234' },
    );

    const response = await provider.listenForResponse('req-timeout-3', 100);

    expect(response.approved).toBe(false);
    expect(response.respondedBy).toBe('system:timeout');

    provider.destroy();
  });
});

// -------------------------------------------------------
// NotificationManager Tests
// -------------------------------------------------------
describe('NotificationManager', () => {
  it('creates Telegram provider from config', () => {
    const manager = new NotificationManager({
      enabled: true,
      channelConfig: { channel: 'telegram', botToken: 'test-token', chatId: '12345' },
      approvalTimeoutMs: 60_000,
      notifyOnBlocked: false,
    });

    expect(manager.getProvider()).toBeInstanceOf(TelegramProvider);
    manager.destroy();
  });

  it('creates Slack provider from config', () => {
    const manager = new NotificationManager({
      enabled: true,
      channelConfig: { channel: 'slack', webhookUrl: 'https://hooks.slack.com/test' },
      approvalTimeoutMs: 60_000,
      notifyOnBlocked: false,
    });

    expect(manager.getProvider()).toBeInstanceOf(SlackProvider);
    manager.destroy();
  });

  it('creates Discord provider from config', () => {
    const manager = new NotificationManager({
      enabled: true,
      channelConfig: { channel: 'discord', botToken: 'tk', channelId: '1', applicationId: 'a' },
      approvalTimeoutMs: 60_000,
      notifyOnBlocked: false,
    });

    expect(manager.getProvider()).toBeInstanceOf(DiscordProvider);
    manager.destroy();
  });

  it('creates WhatsApp provider from config', () => {
    const manager = new NotificationManager({
      enabled: true,
      channelConfig: { channel: 'whatsapp', phoneNumberId: 'p', accessToken: 't', recipientPhone: '+1' },
      approvalTimeoutMs: 60_000,
      notifyOnBlocked: false,
    });

    expect(manager.getProvider()).toBeInstanceOf(WhatsAppProvider);
    manager.destroy();
  });

  it('throws for unsupported channel', () => {
    expect(() => new NotificationManager({
      enabled: true,
      channelConfig: { channel: 'sms' as never } as never,
      approvalTimeoutMs: 60_000,
      notifyOnBlocked: false,
    })).toThrow('Unsupported notification channel');
  });

  it('requestApproval sends request and listens for response (timeout)', async () => {
    const manager = new NotificationManager({
      enabled: true,
      channelConfig: { channel: 'slack', webhookUrl: 'https://hooks.slack.com/test' },
      approvalTimeoutMs: 150,
      notifyOnBlocked: false,
    });

    // Mock the send method to avoid actual HTTP calls
    const provider = manager.getProvider() as SlackProvider;
    vi.spyOn(provider, 'sendApprovalRequest').mockResolvedValue('msg-id');

    const response = await manager.requestApproval(makeNotification());

    // Should timeout and auto-reject
    expect(response.approved).toBe(false);
    expect(response.respondedBy).toBe('system:timeout');

    manager.destroy();
  });

  it('notifyBlocked sends alert when notifyOnBlocked is true', async () => {
    const manager = new NotificationManager({
      enabled: true,
      channelConfig: { channel: 'slack', webhookUrl: 'https://hooks.slack.com/test' },
      approvalTimeoutMs: 60_000,
      notifyOnBlocked: true,
    });

    const provider = manager.getProvider();
    const alertSpy = vi.spyOn(provider, 'sendAlert').mockResolvedValue();

    await manager.notifyBlocked('exec_command', 'Forbidden action');

    expect(alertSpy).toHaveBeenCalledWith(
      'Blocked action: exec_command\nReason: Forbidden action',
    );

    manager.destroy();
  });

  it('notifyBlocked does nothing when notifyOnBlocked is false', async () => {
    const manager = new NotificationManager({
      enabled: true,
      channelConfig: { channel: 'slack', webhookUrl: 'https://hooks.slack.com/test' },
      approvalTimeoutMs: 60_000,
      notifyOnBlocked: false,
    });

    const provider = manager.getProvider();
    const alertSpy = vi.spyOn(provider, 'sendAlert').mockResolvedValue();

    await manager.notifyBlocked('exec_command', 'Forbidden action');

    expect(alertSpy).not.toHaveBeenCalled();

    manager.destroy();
  });

  it('destroy cleans up provider', () => {
    const manager = new NotificationManager({
      enabled: true,
      channelConfig: { channel: 'slack', webhookUrl: 'https://hooks.slack.com/test' },
      approvalTimeoutMs: 60_000,
      notifyOnBlocked: false,
    });

    const provider = manager.getProvider();
    const destroySpy = vi.spyOn(provider, 'destroy');

    manager.destroy();

    expect(destroySpy).toHaveBeenCalled();
  });
});

// -------------------------------------------------------
// Guardian Integration with Notifications
// -------------------------------------------------------
describe('Guardian - Notification Integration', () => {
  it('works without notifications configured (backward compatible)', async () => {
    const config = {
      ...defaultConfig,
      auditLog: { ...defaultConfig.auditLog, enabled: false },
    };
    const guardian = new Guardian(config);

    // Dangerous action should still work the old way
    const request = makeRequest({
      actionType: 'exec_command',
      params: { command: 'ls -la' },
    });
    const result = await guardian.validateAction(request);

    expect(result.success).toBe(false);
    expect(result.blockedReason).toContain('dangerous');
    expect(guardian.getNotificationManager()).toBeNull();

    guardian.destroy();
  });

  it('creates NotificationManager when notifications are configured', () => {
    const config = {
      ...defaultConfig,
      auditLog: { ...defaultConfig.auditLog, enabled: false },
      notifications: {
        enabled: true,
        channel: 'telegram' as const,
        approvalTimeoutMs: 30_000,
        notifyOnBlocked: true,
        telegram: { botToken: 'test-bot-token', chatId: '12345' },
      },
    };
    const guardian = new Guardian(config);

    expect(guardian.getNotificationManager()).not.toBeNull();

    guardian.destroy();
  });

  it('does not create NotificationManager when notifications are disabled', () => {
    const config = {
      ...defaultConfig,
      auditLog: { ...defaultConfig.auditLog, enabled: false },
      notifications: {
        enabled: false,
        channel: 'telegram' as const,
        approvalTimeoutMs: 30_000,
        notifyOnBlocked: true,
        telegram: { botToken: 'test-bot-token', chatId: '12345' },
      },
    };
    const guardian = new Guardian(config);

    expect(guardian.getNotificationManager()).toBeNull();

    guardian.destroy();
  });

  it('uses external approval for dangerous actions when notifications enabled', async () => {
    const config = {
      ...defaultConfig,
      auditLog: { ...defaultConfig.auditLog, enabled: false },
      notifications: {
        enabled: true,
        channel: 'slack' as const,
        approvalTimeoutMs: 200,
        notifyOnBlocked: false,
        slack: { webhookUrl: 'https://hooks.slack.com/test' },
      },
    };
    const guardian = new Guardian(config);

    const manager = guardian.getNotificationManager()!;
    const provider = manager.getProvider() as SlackProvider;

    // Mock to prevent actual HTTP calls
    vi.spyOn(provider, 'sendApprovalRequest').mockResolvedValue('msg-id');

    const request = makeRequest({
      actionType: 'exec_command',
      params: { command: 'ls -la' },
    });
    const result = await guardian.validateAction(request);

    // Should auto-reject after timeout (fail-safe)
    expect(result.success).toBe(false);
    expect(result.blockedBy).toBe('guardian');
    expect(result.blockedReason).toContain('rejected via external approval');

    guardian.destroy();
  });

  it('approves action when external approval is given', async () => {
    const config = {
      ...defaultConfig,
      auditLog: { ...defaultConfig.auditLog, enabled: false },
      notifications: {
        enabled: true,
        channel: 'slack' as const,
        approvalTimeoutMs: 5000,
        notifyOnBlocked: false,
        slack: { webhookUrl: 'https://hooks.slack.com/test' },
      },
    };
    const guardian = new Guardian(config);

    const manager = guardian.getNotificationManager()!;
    const provider = manager.getProvider() as SlackProvider;

    // Mock send to capture the requestId, then simulate approval
    vi.spyOn(provider, 'sendApprovalRequest').mockImplementation(async (notification) => {
      // Simulate async approval after a short delay
      setTimeout(() => {
        provider.handleActionPayload({
          actions: [{ action_id: 'approve', value: notification.requestId }],
          user: { id: 'U123', name: 'admin' },
        });
      }, 50);
      return 'msg-id';
    });

    const request = makeRequest({
      id: 'approve-test-id',
      actionType: 'exec_command',
      params: { command: 'ls -la' },
    });
    const result = await guardian.validateAction(request);

    expect(result.success).toBe(true);
    expect(result.requestId).toBe('approve-test-id');

    guardian.destroy();
  });

  it('sends blocked notification when notifyOnBlocked is true', async () => {
    const config = {
      ...defaultConfig,
      auditLog: { ...defaultConfig.auditLog, enabled: false },
      notifications: {
        enabled: true,
        channel: 'slack' as const,
        approvalTimeoutMs: 60_000,
        notifyOnBlocked: true,
        slack: { webhookUrl: 'https://hooks.slack.com/test' },
      },
    };
    const guardian = new Guardian(config);

    const manager = guardian.getNotificationManager()!;
    const provider = manager.getProvider();
    const alertSpy = vi.spyOn(provider, 'sendAlert').mockResolvedValue();

    // Forbidden action should trigger blocked notification
    const request = makeRequest({ actionType: 'signup' });
    await guardian.validateAction(request);

    // Give the async notification a tick to fire
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(alertSpy).toHaveBeenCalled();

    guardian.destroy();
  });

  it('safe actions still auto-approve even with notifications configured', async () => {
    const config = {
      ...defaultConfig,
      auditLog: { ...defaultConfig.auditLog, enabled: false },
      notifications: {
        enabled: true,
        channel: 'telegram' as const,
        approvalTimeoutMs: 60_000,
        notifyOnBlocked: false,
        telegram: { botToken: 'test-bot-token', chatId: '12345' },
      },
    };
    const guardian = new Guardian(config);

    const request = makeRequest({
      actionType: 'web_search',
      params: { query: 'TypeScript tutorial' },
    });
    const result = await guardian.validateAction(request);

    expect(result.success).toBe(true);

    guardian.destroy();
  });
});

// -------------------------------------------------------
// Provider destroy / cleanup
// -------------------------------------------------------
describe('Provider Cleanup', () => {
  it('Slack: resolves all pending with timeout on destroy', async () => {
    const provider = new SlackProvider(
      { channel: 'slack', webhookUrl: 'https://hooks.slack.com/test' },
    );

    const responsePromise = provider.listenForResponse('req-cleanup-1', 60_000);

    provider.destroy();

    const response = await responsePromise;
    expect(response.approved).toBe(false);
    expect(response.respondedBy).toBe('system:timeout');
  });

  it('Discord: resolves all pending with timeout on destroy', async () => {
    const provider = new DiscordProvider(
      { channel: 'discord', botToken: 'tk', channelId: '1', applicationId: 'a' },
    );

    const responsePromise = provider.listenForResponse('req-cleanup-2', 60_000);

    provider.destroy();

    const response = await responsePromise;
    expect(response.approved).toBe(false);
    expect(response.respondedBy).toBe('system:timeout');
  });

  it('WhatsApp: resolves all pending with timeout on destroy', async () => {
    const provider = new WhatsAppProvider(
      { channel: 'whatsapp', phoneNumberId: 'p', accessToken: 't', recipientPhone: '+1' },
    );

    const responsePromise = provider.listenForResponse('req-cleanup-3', 60_000);

    provider.destroy();

    const response = await responsePromise;
    expect(response.approved).toBe(false);
    expect(response.respondedBy).toBe('system:timeout');
  });

  it('Telegram: stops polling on destroy', () => {
    const provider = new TelegramProvider(
      { channel: 'telegram', botToken: 'test-token', chatId: '12345' },
    );

    // Just ensure destroy doesn't throw
    provider.destroy();
  });
});
