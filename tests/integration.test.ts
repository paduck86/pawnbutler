import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PawnButlerEngine } from '../src/core/engine.js';
import { MessageBus } from '../src/core/message-bus.js';
import { ButlerAgent } from '../src/agents/butler.js';
import { ResearcherAgent } from '../src/agents/researcher.js';
import { ExecutorAgent } from '../src/agents/executor.js';
import { Guardian } from '../src/safety/guardian.js';
import { UrlAllowlist } from '../src/safety/url-allowlist.js';
import { ActionClassifier } from '../src/safety/action-classifier.js';
import { defaultConfig } from '../src/config/default-config.js';
import type {
  AgentMessage,
  ActionRequest,
  ActionResult,
  ApprovalRequest,
  PawnButlerConfig,
} from '../src/core/types.js';
import type { AgentEngine } from '../src/agents/base-agent.js';

// Helper: create a test config with audit logging disabled
function testConfig(overrides: Partial<PawnButlerConfig> = {}): PawnButlerConfig {
  return {
    ...defaultConfig,
    auditLog: { ...defaultConfig.auditLog, enabled: false },
    ...overrides,
  };
}

// Helper: create a mock AgentEngine
function mockEngine(overrides: Partial<AgentEngine> = {}): AgentEngine {
  return {
    validateAndExecute: vi.fn().mockResolvedValue({ requestId: 'mock', success: true }),
    routeMessage: vi.fn(),
    requestApproval: vi.fn().mockResolvedValue({ requestId: 'mock', success: false, error: 'Awaiting approval' }),
    ...overrides,
  };
}

// -------------------------------------------------------
// 1. Full Flow Tests - Engine + All Agents
// -------------------------------------------------------
describe('Integration: Full Flow', () => {
  let engine: PawnButlerEngine;
  let butler: ButlerAgent;
  let researcher: ResearcherAgent;
  let executor: ExecutorAgent;

  beforeEach(async () => {
    engine = new PawnButlerEngine(testConfig());
    butler = new ButlerAgent({ id: 'butler' });
    researcher = new ResearcherAgent({ id: 'researcher' });
    executor = new ExecutorAgent({ id: 'executor' });

    engine.registerAgent(butler);
    engine.registerAgent(researcher);
    engine.registerAgent(executor);
  });

  afterEach(async () => {
    if (engine.isRunning()) {
      await engine.shutdown();
    }
  });

  it('should start all agents in correct order (guardian -> butler -> researcher -> executor)', async () => {
    const initOrder: string[] = [];
    const origButlerInit = butler.init.bind(butler);
    const origResearcherInit = researcher.init.bind(researcher);
    const origExecutorInit = executor.init.bind(executor);

    butler.init = async () => { initOrder.push('butler'); await origButlerInit(); };
    researcher.init = async () => { initOrder.push('researcher'); await origResearcherInit(); };
    executor.init = async () => { initOrder.push('executor'); await origExecutorInit(); };

    await engine.start();

    expect(initOrder).toEqual(['butler', 'researcher', 'executor']);
    expect(engine.isRunning()).toBe(true);
  });

  it('should submit user request to butler via message bus', async () => {
    await engine.start();
    await engine.submitUserRequest('search for TypeScript best practices');

    const history = engine.getMessageBus().getHistory('butler');
    expect(history.length).toBeGreaterThan(0);

    const taskMsg = history.find((m) => m.type === 'task');
    expect(taskMsg).toBeDefined();
    expect(taskMsg!.from).toBe('user');
    expect((taskMsg!.payload as { message: string }).message).toBe(
      'search for TypeScript best practices'
    );
  });

  it('should route butler delegation to researcher for search tasks', async () => {
    // Wire butler with a real engine-like mock to capture routed messages
    const routedMessages: AgentMessage[] = [];
    const engine2 = mockEngine({
      routeMessage: vi.fn((msg: AgentMessage) => routedMessages.push(msg)),
    });
    butler.setEngine(engine2);

    const result = await butler.handleTask('search for TypeScript tutorials');
    expect(result).toHaveProperty('delegated', true);
    expect(result).toHaveProperty('to', 'researcher');

    expect(routedMessages.length).toBe(1);
    expect(routedMessages[0].from).toBe('butler');
    expect(routedMessages[0].to).toBe('researcher');
    expect(routedMessages[0].type).toBe('task');
  });

  it('should route butler delegation to executor for write tasks', async () => {
    const routedMessages: AgentMessage[] = [];
    const engine2 = mockEngine({
      routeMessage: vi.fn((msg: AgentMessage) => routedMessages.push(msg)),
    });
    butler.setEngine(engine2);

    const result = await butler.handleTask('create file at /tmp/output.txt');
    expect(result).toHaveProperty('delegated', true);
    expect(result).toHaveProperty('to', 'executor');

    expect(routedMessages[0].to).toBe('executor');
  });

  it('should handle direct tasks (no delegation) when no routing keyword matches', async () => {
    const eng = mockEngine();
    butler.setEngine(eng);

    const result = await butler.handleTask('what is the current time?');
    expect(result).toHaveProperty('handled', true);
    expect(result).toHaveProperty('message', 'what is the current time?');
  });

  it('should reject user requests when engine is not running', async () => {
    await expect(engine.submitUserRequest('test')).rejects.toThrow('Not running');
  });

  it('should reject user requests when no butler is registered', async () => {
    const emptyEngine = new PawnButlerEngine(testConfig());
    const fakeAgent = { id: 'fake', role: 'researcher', init: vi.fn(), handleMessage: vi.fn(), shutdown: vi.fn() };
    emptyEngine.registerAgent(fakeAgent as any);
    await emptyEngine.start();

    await expect(emptyEngine.submitUserRequest('test')).rejects.toThrow('No butler');
    await emptyEngine.shutdown();
  });
});

// -------------------------------------------------------
// 2. Agent Message Routing Tests
// -------------------------------------------------------
describe('Integration: Message Routing', () => {
  it('should deliver task message from butler to researcher', () => {
    const bus = new MessageBus();
    const received: AgentMessage[] = [];

    bus.subscribe('butler', () => {});
    bus.subscribe('researcher', (msg) => received.push(msg));

    const taskMsg: AgentMessage = {
      from: 'butler',
      to: 'researcher',
      type: 'task',
      payload: { task: 'find info about Node.js', context: {} },
    };

    bus.send(taskMsg);

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('task');
    expect((received[0].payload as any).task).toBe('find info about Node.js');
  });

  it('should deliver result message from researcher back to butler', () => {
    const bus = new MessageBus();
    const received: AgentMessage[] = [];

    bus.subscribe('butler', (msg) => received.push(msg));
    bus.subscribe('researcher', () => {});

    bus.send({
      from: 'researcher',
      to: 'butler',
      type: 'result',
      payload: { query: 'Node.js', sources: [], summary: 'Found 0 results' },
    });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('result');
    expect(received[0].from).toBe('researcher');
  });

  it('should deliver approval request from executor to butler', () => {
    const bus = new MessageBus();
    const received: AgentMessage[] = [];

    bus.subscribe('butler', (msg) => received.push(msg));
    bus.subscribe('executor', () => {});

    bus.send({
      from: 'executor',
      to: 'butler',
      type: 'approval_request',
      payload: { type: 'plan_review', plan: 'Write file', steps: ['write_file'] },
    });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('approval_request');
  });

  it('should deliver approval response from butler back to executor', () => {
    const bus = new MessageBus();
    const received: AgentMessage[] = [];

    bus.subscribe('butler', () => {});
    bus.subscribe('executor', (msg) => received.push(msg));

    const approval: ApprovalRequest = {
      actionRequest: {
        id: 'req-1',
        agentId: 'executor',
        agentRole: 'executor',
        actionType: 'write_file',
        params: { path: '/tmp/test.txt' },
        safetyLevel: 'moderate',
        timestamp: Date.now(),
        requiresApproval: true,
      },
      status: 'approved',
      reviewedBy: 'butler',
      reviewedAt: Date.now(),
    };

    bus.send({
      from: 'butler',
      to: 'executor',
      type: 'approval_response',
      payload: approval,
    });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('approval_response');
    expect((received[0].payload as ApprovalRequest).status).toBe('approved');
  });

  it('should broadcast alert to all agents except sender', () => {
    const bus = new MessageBus();
    const butlerMsgs: AgentMessage[] = [];
    const researcherMsgs: AgentMessage[] = [];
    const executorMsgs: AgentMessage[] = [];
    const guardianMsgs: AgentMessage[] = [];

    bus.subscribe('guardian', (msg) => guardianMsgs.push(msg));
    bus.subscribe('butler', (msg) => butlerMsgs.push(msg));
    bus.subscribe('researcher', (msg) => researcherMsgs.push(msg));
    bus.subscribe('executor', (msg) => executorMsgs.push(msg));

    bus.broadcast({
      from: 'guardian',
      to: 'all',
      type: 'alert',
      payload: { alert: 'Security violation detected' },
    });

    expect(guardianMsgs).toHaveLength(0); // sender excluded
    expect(butlerMsgs).toHaveLength(1);
    expect(researcherMsgs).toHaveLength(1);
    expect(executorMsgs).toHaveLength(1);
  });

  it('should maintain complete message history across all agents', () => {
    const bus = new MessageBus();
    bus.subscribe('butler', () => {});
    bus.subscribe('researcher', () => {});
    bus.subscribe('executor', () => {});

    bus.send({ from: 'user', to: 'butler', type: 'task', payload: 'msg1' });
    bus.send({ from: 'butler', to: 'researcher', type: 'task', payload: 'msg2' });
    bus.send({ from: 'researcher', to: 'butler', type: 'result', payload: 'msg3' });
    bus.send({ from: 'butler', to: 'executor', type: 'task', payload: 'msg4' });

    // Full history
    const allHistory = bus.getHistory();
    expect(allHistory).toHaveLength(4);

    // Butler-specific history (all messages involving butler)
    const butlerHistory = bus.getHistory('butler');
    expect(butlerHistory.length).toBe(4); // butler is from or to in all 4
  });
});

// -------------------------------------------------------
// 3. Approval Flow End-to-End
// -------------------------------------------------------
describe('Integration: Approval Flow E2E', () => {
  it('should complete full approval flow: executor -> guardian -> butler -> executor', async () => {
    const engine = new PawnButlerEngine(testConfig());
    const butler = new ButlerAgent({ id: 'butler' });
    const executor = new ExecutorAgent({ id: 'executor' });

    engine.registerAgent(butler);
    engine.registerAgent(executor);
    await engine.start();

    // 1. Engine creates a pending approval
    const actionRequest: ActionRequest = {
      id: 'approval-test-1',
      agentId: 'executor',
      agentRole: 'executor',
      actionType: 'exec_command',
      params: { command: 'ls -la' },
      safetyLevel: 'dangerous',
      timestamp: Date.now(),
      requiresApproval: true,
    };

    const pendingResult = await engine.requestApproval(actionRequest);
    expect(pendingResult.success).toBe(false);
    expect(pendingResult.error).toContain('Awaiting approval');

    // 2. Resolve approval (approved)
    const resolved = engine.resolveApproval('approval-test-1', true, 'butler', 'Command is safe');
    expect(resolved).toBeDefined();
    expect(resolved!.status).toBe('approved');
    expect(resolved!.reviewedBy).toBe('butler');
    expect(resolved!.reason).toBe('Command is safe');

    // 3. Verify approval response was routed to executor via message bus
    const executorHistory = engine.getMessageBus().getHistory('executor');
    const approvalResponse = executorHistory.find((m) => m.type === 'approval_response');
    expect(approvalResponse).toBeDefined();
    expect((approvalResponse!.payload as ApprovalRequest).status).toBe('approved');

    await engine.shutdown();
  });

  it('should handle rejected approval flow', async () => {
    const engine = new PawnButlerEngine(testConfig());
    const butler = new ButlerAgent({ id: 'butler' });
    const executor = new ExecutorAgent({ id: 'executor' });

    engine.registerAgent(butler);
    engine.registerAgent(executor);
    await engine.start();

    const actionRequest: ActionRequest = {
      id: 'approval-test-2',
      agentId: 'executor',
      agentRole: 'executor',
      actionType: 'exec_command',
      params: { command: 'deploy production' },
      safetyLevel: 'dangerous',
      timestamp: Date.now(),
      requiresApproval: true,
    };

    await engine.requestApproval(actionRequest);

    const resolved = engine.resolveApproval('approval-test-2', false, 'butler', 'Too risky');
    expect(resolved).toBeDefined();
    expect(resolved!.status).toBe('rejected');
    expect(resolved!.reason).toBe('Too risky');

    const executorHistory = engine.getMessageBus().getHistory('executor');
    const response = executorHistory.find((m) => m.type === 'approval_response');
    expect((response!.payload as ApprovalRequest).status).toBe('rejected');

    await engine.shutdown();
  });

  it('should return undefined when resolving non-existent approval', async () => {
    const engine = new PawnButlerEngine(testConfig());
    const butler = new ButlerAgent({ id: 'butler' });
    engine.registerAgent(butler);
    await engine.start();

    const result = engine.resolveApproval('nonexistent-id', true, 'butler');
    expect(result).toBeUndefined();

    await engine.shutdown();
  });

  it('should handle requestApproval when no butler is registered', async () => {
    const engine = new PawnButlerEngine(testConfig());
    // Register a non-butler agent to allow start
    const researcher = new ResearcherAgent({ id: 'researcher' });
    engine.registerAgent(researcher);
    await engine.start();

    const actionRequest: ActionRequest = {
      id: 'no-butler-test',
      agentId: 'researcher',
      agentRole: 'researcher',
      actionType: 'exec_command',
      params: { command: 'ls' },
      safetyLevel: 'dangerous',
      timestamp: Date.now(),
      requiresApproval: true,
    };

    const result = await engine.requestApproval(actionRequest);
    expect(result.success).toBe(false);
    expect(result.blockedReason).toContain('No butler');

    await engine.shutdown();
  });

  it('should track butler auto-approval decisions', async () => {
    const butler = new ButlerAgent({ id: 'butler' });

    // Safe action from researcher -> auto-approve
    const safeApproval: ApprovalRequest = {
      actionRequest: {
        id: 'safe-1',
        agentId: 'researcher',
        agentRole: 'researcher',
        actionType: 'web_search',
        params: { query: 'test' },
        safetyLevel: 'safe',
        timestamp: Date.now(),
        requiresApproval: false,
      },
      status: 'pending',
    };
    expect(await butler.handleApprovalRequest(safeApproval)).toBe('auto_approved');

    // Dangerous action from researcher -> auto-block (only executor can do dangerous)
    const dangerousFromResearcher: ApprovalRequest = {
      actionRequest: {
        id: 'danger-1',
        agentId: 'researcher',
        agentRole: 'researcher',
        actionType: 'exec_command',
        params: { command: 'ls' },
        safetyLevel: 'dangerous',
        timestamp: Date.now(),
        requiresApproval: true,
      },
      status: 'pending',
    };
    expect(await butler.handleApprovalRequest(dangerousFromResearcher)).toBe('auto_blocked');

    // Moderate action from executor -> auto-approve
    const moderateFromExecutor: ApprovalRequest = {
      actionRequest: {
        id: 'mod-1',
        agentId: 'executor',
        agentRole: 'executor',
        actionType: 'write_file',
        params: { path: '/tmp/x', content: 'y' },
        safetyLevel: 'moderate',
        timestamp: Date.now(),
        requiresApproval: false,
      },
      status: 'pending',
    };
    expect(await butler.handleApprovalRequest(moderateFromExecutor)).toBe('auto_approved');
  });
});

// -------------------------------------------------------
// 4. Guardian Integration with Full Agent Flow
// -------------------------------------------------------
describe('Integration: Guardian Safety in Agent Flow', () => {
  const guardian = new Guardian(testConfig());

  it('should allow researcher web search through guardian', async () => {
    const request: ActionRequest = {
      id: 'search-1',
      agentId: 'researcher',
      agentRole: 'researcher',
      actionType: 'web_search',
      params: { query: 'TypeScript documentation' },
      safetyLevel: 'moderate',
      timestamp: Date.now(),
      requiresApproval: false,
    };

    const result = await guardian.validateAction(request);
    expect(result.success).toBe(true);
  });

  it('should block researcher web fetch to non-allowlisted URL', async () => {
    const request: ActionRequest = {
      id: 'fetch-1',
      agentId: 'researcher',
      agentRole: 'researcher',
      actionType: 'web_fetch',
      params: { url: 'https://malicious-site.xyz/data' },
      safetyLevel: 'moderate',
      timestamp: Date.now(),
      requiresApproval: false,
    };

    const result = await guardian.validateAction(request);
    expect(result.success).toBe(false);
    expect(result.blockedBy).toBe('guardian');
  });

  it('should block executor signup attempt through guardian', async () => {
    const request: ActionRequest = {
      id: 'signup-1',
      agentId: 'executor',
      agentRole: 'executor',
      actionType: 'signup',
      params: { email: 'test@test.com', password: 'pass123' },
      safetyLevel: 'forbidden',
      timestamp: Date.now(),
      requiresApproval: true,
    };

    const result = await guardian.validateAction(request);
    expect(result.success).toBe(false);
    expect(result.blockedReason).toContain('forbidden');
  });

  it('should flag dangerous exec_command for butler approval', async () => {
    const request: ActionRequest = {
      id: 'exec-1',
      agentId: 'executor',
      agentRole: 'executor',
      actionType: 'exec_command',
      params: { command: 'npm test' },
      safetyLevel: 'dangerous',
      timestamp: Date.now(),
      requiresApproval: true,
    };

    const result = await guardian.validateAction(request);
    // Dangerous actions are not approved - they need butler review
    expect(result.success).toBe(false);
    expect(result.blockedReason).toContain('dangerous');
  });

  it('should block secret leakage in any agent request', async () => {
    const request: ActionRequest = {
      id: 'leak-1',
      agentId: 'researcher',
      agentRole: 'researcher',
      actionType: 'web_fetch',
      params: {
        url: 'https://google.com/search',
        headers: { 'X-API-Key': 'sk-abcdefghijklmnopqrstuvwxyz' },
      },
      safetyLevel: 'moderate',
      timestamp: Date.now(),
      requiresApproval: false,
    };

    const result = await guardian.validateAction(request);
    expect(result.success).toBe(false);
    expect(result.blockedReason).toContain('secret');
  });

  it('should track guardian status counters across multiple validations', async () => {
    const freshGuardian = new Guardian(testConfig());

    // Run a few validations
    await freshGuardian.validateAction({
      id: 's1', agentId: 'r', agentRole: 'researcher', actionType: 'web_search',
      params: { query: 'test' }, safetyLevel: 'safe', timestamp: Date.now(), requiresApproval: false,
    });
    await freshGuardian.validateAction({
      id: 's2', agentId: 'r', agentRole: 'researcher', actionType: 'signup',
      params: {}, safetyLevel: 'forbidden', timestamp: Date.now(), requiresApproval: false,
    });
    await freshGuardian.validateAction({
      id: 's3', agentId: 'e', agentRole: 'executor', actionType: 'payment',
      params: {}, safetyLevel: 'forbidden', timestamp: Date.now(), requiresApproval: false,
    });

    const status = freshGuardian.getStatus();
    expect(status.totalChecked).toBe(3);
    expect(status.blocked).toBe(2); // signup + payment
  });
});

// -------------------------------------------------------
// 5. Config Change Reflection Tests
// -------------------------------------------------------
describe('Integration: Config Changes', () => {
  it('should reflect new domain added to URL allowlist', () => {
    const allowlist = new UrlAllowlist({
      allow: defaultConfig.urlAllowlist,
      block: defaultConfig.urlBlocklist,
    });

    // Initially blocked
    expect(allowlist.isAllowed('https://custom-api.example.io/data').allowed).toBe(false);

    // Add domain
    allowlist.addAllowed('example.io');

    // Now allowed
    expect(allowlist.isAllowed('https://custom-api.example.io/data').allowed).toBe(true);
  });

  it('should reflect new pattern added to URL blocklist', () => {
    const allowlist = new UrlAllowlist({
      allow: [...defaultConfig.urlAllowlist, 'test-site.com'],
      block: defaultConfig.urlBlocklist,
    });

    // Initially allowed (it's in the allowlist)
    expect(allowlist.isAllowed('https://test-site.com/page').allowed).toBe(true);

    // Add block pattern that matches - this depends on UrlAllowlist.addBlocked implementation
    // Test the blocklist construction directly
    const strictList = new UrlAllowlist({
      allow: ['example.com'],
      block: [...defaultConfig.urlBlocklist, 'phishing'],
    });

    // Domain with 'phishing' should be blocked
    expect(strictList.isAllowed('https://phishing-site.com/login').allowed).toBe(false);
  });

  it('should reflect agent permission changes at runtime', () => {
    const researcher = new ResearcherAgent({ id: 'researcher' });

    // Default: cannot use write_file
    expect(researcher.isToolAllowed('write_file')).toBe(false);

    // Create new researcher with custom permissions
    const customResearcher = new ResearcherAgent({
      id: 'researcher-custom',
      allowedTools: ['web_search', 'web_fetch', 'read_file', 'write_file'],
      deniedTools: ['exec_command', 'signup', 'payment'],
    });

    expect(customResearcher.isToolAllowed('write_file')).toBe(true);
    expect(customResearcher.isToolAllowed('exec_command')).toBe(false);
  });

  it('should create guardian with custom safety config', async () => {
    const strictConfig = testConfig({
      safety: {
        ...defaultConfig.safety,
        forbiddenActions: ['signup', 'payment', 'api_call'],
      },
    });

    const strictGuardian = new Guardian(strictConfig);

    // api_call is now forbidden
    const result = await strictGuardian.validateAction({
      id: 'api-1',
      agentId: 'researcher',
      agentRole: 'researcher',
      actionType: 'api_call',
      params: {},
      safetyLevel: 'dangerous',
      timestamp: Date.now(),
      requiresApproval: true,
    });

    expect(result.success).toBe(false);
    expect(result.blockedReason).toContain('forbidden');
  });

  it('should support custom secret patterns in config', () => {
    const customConfig = testConfig({
      safety: {
        ...defaultConfig.safety,
        secretPatterns: [
          ...defaultConfig.safety.secretPatterns,
          'CUSTOM_KEY_[A-Z0-9]{10}',
        ],
      },
    });

    const classifier = new ActionClassifier(customConfig.safety);

    const result = classifier.containsSecretPattern('key=CUSTOM_KEY_ABCDEFGHIJ');
    expect(result.found).toBe(true);
  });
});

// -------------------------------------------------------
// 6. Engine Lifecycle Tests
// -------------------------------------------------------
describe('Integration: Engine Lifecycle', () => {
  it('should initialize all agents on start and track running state', async () => {
    const engine = new PawnButlerEngine(testConfig());
    const butler = new ButlerAgent({ id: 'butler' });
    const researcher = new ResearcherAgent({ id: 'researcher' });
    const executor = new ExecutorAgent({ id: 'executor' });

    engine.registerAgent(butler);
    engine.registerAgent(researcher);
    engine.registerAgent(executor);

    expect(engine.isRunning()).toBe(false);

    await engine.start();

    expect(engine.isRunning()).toBe(true);
    expect(butler.reportStatus().status).toBe('idle');
    expect(researcher.reportStatus().status).toBe('idle');
    expect(executor.reportStatus().status).toBe('idle');

    await engine.shutdown();
  });

  it('should shutdown all agents and clear state', async () => {
    const engine = new PawnButlerEngine(testConfig());
    const butler = new ButlerAgent({ id: 'butler' });
    const researcher = new ResearcherAgent({ id: 'researcher' });

    engine.registerAgent(butler);
    engine.registerAgent(researcher);
    await engine.start();

    // Send some messages to build up state
    await engine.submitUserRequest('test message');

    await engine.shutdown();

    expect(engine.isRunning()).toBe(false);
    expect(butler.reportStatus().status).toBe('stopped');
    expect(researcher.reportStatus().status).toBe('stopped');

    // Message bus should be cleared
    const history = engine.getMessageBus().getHistory();
    expect(history).toHaveLength(0);

    // Agents should be cleared
    expect(engine.getAgent('butler')).toBeUndefined();
    expect(engine.getAgent('researcher')).toBeUndefined();
  });

  it('should be idempotent on double shutdown', async () => {
    const engine = new PawnButlerEngine(testConfig());
    const butler = new ButlerAgent({ id: 'butler' });
    engine.registerAgent(butler);
    await engine.start();

    await engine.shutdown();
    // Second shutdown should not throw
    await engine.shutdown();

    expect(engine.isRunning()).toBe(false);
  });

  it('should reject double start', async () => {
    const engine = new PawnButlerEngine(testConfig());
    const butler = new ButlerAgent({ id: 'butler' });
    engine.registerAgent(butler);
    await engine.start();

    await expect(engine.start()).rejects.toThrow('Already running');

    await engine.shutdown();
  });

  it('should reject routeMessage when not running', () => {
    const engine = new PawnButlerEngine(testConfig());
    expect(() => {
      engine.routeMessage({
        from: 'test',
        to: 'butler',
        type: 'task',
        payload: {},
      });
    }).toThrow('Not running');
  });

  it('should provide config access', () => {
    const config = testConfig();
    const engine = new PawnButlerEngine(config);
    expect(engine.getConfig()).toBe(config);
  });

  it('should look up registered agents by id', async () => {
    const engine = new PawnButlerEngine(testConfig());
    const butler = new ButlerAgent({ id: 'butler' });
    const researcher = new ResearcherAgent({ id: 'researcher' });

    engine.registerAgent(butler);
    engine.registerAgent(researcher);

    expect(engine.getAgent('butler')).toBe(butler);
    expect(engine.getAgent('researcher')).toBe(researcher);
    expect(engine.getAgent('nonexistent')).toBeUndefined();
  });
});

// -------------------------------------------------------
// 7. Cross-cutting: Agent-Tool-Guardian Integration
// -------------------------------------------------------
describe('Integration: Agent -> Tool -> Guardian Pipeline', () => {
  it('should block researcher from writing files at agent level (before guardian)', async () => {
    const researcher = new ResearcherAgent({ id: 'researcher' });
    const eng = mockEngine();
    researcher.setEngine(eng);

    const result = await researcher.requestAction('write_file', {
      path: '/tmp/test.txt',
      content: 'data',
    });

    expect(result.success).toBe(false);
    expect(result.blockedBy).toBe('agent_policy');
    // Engine should never be called - blocked at agent level
    expect(eng.validateAndExecute).not.toHaveBeenCalled();
  });

  it('should block executor from web searching at agent level', async () => {
    const executor = new ExecutorAgent({ id: 'executor' });
    const eng = mockEngine();
    executor.setEngine(eng);

    const result = await executor.requestAction('web_search', {
      query: 'how to hack',
    });

    expect(result.success).toBe(false);
    expect(result.blockedBy).toBe('agent_policy');
    expect(eng.validateAndExecute).not.toHaveBeenCalled();
  });

  it('should allow researcher web search and call engine.validateAndExecute', async () => {
    const researcher = new ResearcherAgent({ id: 'researcher' });
    const eng = mockEngine();
    researcher.setEngine(eng);

    const result = await researcher.requestAction('web_search', {
      query: 'TypeScript generics',
    });

    expect(result.success).toBe(true);
    expect(eng.validateAndExecute).toHaveBeenCalledTimes(1);

    const callArg = (eng.validateAndExecute as any).mock.calls[0][0] as ActionRequest;
    expect(callArg.actionType).toBe('web_search');
    expect(callArg.agentRole).toBe('researcher');
  });

  it('should allow executor file operations and call engine.validateAndExecute', async () => {
    const executor = new ExecutorAgent({ id: 'executor' });
    const eng = mockEngine();
    executor.setEngine(eng);

    const result = await executor.requestAction('write_file', {
      path: '/tmp/output.txt',
      content: 'hello world',
    });

    expect(result.success).toBe(true);
    expect(eng.validateAndExecute).toHaveBeenCalledTimes(1);
  });

  it('should propagate engine validation failure back to agent', async () => {
    const researcher = new ResearcherAgent({ id: 'researcher' });
    const eng = mockEngine({
      validateAndExecute: vi.fn().mockResolvedValue({
        requestId: 'blocked-1',
        success: false,
        error: 'URL not in allowlist',
        blockedBy: 'guardian',
        blockedReason: 'Domain not allowed',
      }),
    });
    researcher.setEngine(eng);

    const result = await researcher.requestAction('web_fetch', {
      url: 'https://unknown-site.xyz/page',
    });

    expect(result.success).toBe(false);
    expect(result.blockedBy).toBe('guardian');
  });

  it('should return error when agent has no engine set', async () => {
    const researcher = new ResearcherAgent({ id: 'researcher' });
    // No engine set

    const result = await researcher.requestAction('web_search', { query: 'test' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not connected to engine');
  });
});

// -------------------------------------------------------
// 8. Executor Plan + Approval Integration
// -------------------------------------------------------
describe('Integration: Executor Plan Flow', () => {
  it('should create plan with approval required for write tasks', async () => {
    const executor = new ExecutorAgent({ id: 'executor' });

    const plan = await executor.createPlan('write data to "/tmp/output.txt"');
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.steps.some((s) => s.action === 'write_file')).toBe(true);
    expect(plan.requiresApproval).toBe(true);
  });

  it('should create plan with approval required for exec tasks', async () => {
    const executor = new ExecutorAgent({ id: 'executor' });

    const plan = await executor.createPlan('run npm test and execute the build');
    expect(plan.steps.some((s) => s.action === 'exec_command')).toBe(true);
    expect(plan.requiresApproval).toBe(true);
  });

  it('should create plan for read-only tasks without dangerous flag', async () => {
    const executor = new ExecutorAgent({ id: 'executor' });

    const plan = await executor.createPlan('read the file at "src/index.ts"');
    expect(plan.steps.some((s) => s.action === 'read_file')).toBe(true);
    expect(plan.requiresApproval).toBe(false);
  });

  it('should butler review plans correctly', async () => {
    const butler = new ButlerAgent({ id: 'butler' });

    // Plan with exec_command -> rejected
    const dangerousPlan = await butler.reviewPlan('Step 1: exec_command to run deploy', 'executor');
    expect(dangerousPlan.approved).toBe(false);
    expect(dangerousPlan.feedback).toContain('dangerous');

    // Plan with write_file -> approved with caution
    const writePlan = await butler.reviewPlan('Step 1: write_file to save output', 'executor');
    expect(writePlan.approved).toBe(true);
    expect(writePlan.feedback).toContain('caution');

    // Safe plan -> approved without feedback
    const safePlan = await butler.reviewPlan('Step 1: read documentation', 'executor');
    expect(safePlan.approved).toBe(true);
  });
});

// -------------------------------------------------------
// 9. Researcher handleMessage + Result Routing
// -------------------------------------------------------
describe('Integration: Researcher Message Handling', () => {
  it('should process task message and route result back', async () => {
    const researcher = new ResearcherAgent({ id: 'researcher' });
    const routedMessages: AgentMessage[] = [];
    const eng = mockEngine({
      validateAndExecute: vi.fn().mockResolvedValue({
        requestId: 'r1',
        success: true,
        data: [], // empty search results
      }),
      routeMessage: vi.fn((msg: AgentMessage) => routedMessages.push(msg)),
    });
    researcher.setEngine(eng);

    const taskMessage: AgentMessage = {
      from: 'butler',
      to: 'researcher',
      type: 'task',
      payload: { task: 'find Node.js best practices', context: {} },
    };

    await researcher.handleMessage(taskMessage);

    // Should have routed a result back to butler
    expect(routedMessages.length).toBeGreaterThan(0);
    const resultMsg = routedMessages.find((m) => m.type === 'result');
    expect(resultMsg).toBeDefined();
    expect(resultMsg!.from).toBe('researcher');
    expect(resultMsg!.to).toBe('butler');
    expect((resultMsg!.payload as any).query).toBe('find Node.js best practices');
  });

  it('should handle search failure gracefully', async () => {
    const researcher = new ResearcherAgent({ id: 'researcher' });
    const routedMessages: AgentMessage[] = [];
    const eng = mockEngine({
      validateAndExecute: vi.fn().mockResolvedValue({
        requestId: 'r2',
        success: false,
        error: 'Search service unavailable',
      }),
      routeMessage: vi.fn((msg: AgentMessage) => routedMessages.push(msg)),
    });
    researcher.setEngine(eng);

    await researcher.handleMessage({
      from: 'butler',
      to: 'researcher',
      type: 'task',
      payload: { task: 'search for something' },
    });

    const resultMsg = routedMessages.find((m) => m.type === 'result');
    expect(resultMsg).toBeDefined();
    expect((resultMsg!.payload as any).summary).toContain('failed');
  });
});

// -------------------------------------------------------
// 10. Executor handleMessage + Execution Flow
// -------------------------------------------------------
describe('Integration: Executor Message Handling', () => {
  it('should process task message and route execution result back', async () => {
    const executor = new ExecutorAgent({
      id: 'executor',
      requirePlanApproval: false, // skip approval for test
    });
    const routedMessages: AgentMessage[] = [];
    const eng = mockEngine({
      validateAndExecute: vi.fn().mockResolvedValue({
        requestId: 'e1',
        success: true,
        data: { path: '/tmp/test', written: true },
      }),
      routeMessage: vi.fn((msg: AgentMessage) => routedMessages.push(msg)),
    });
    executor.setEngine(eng);

    await executor.handleMessage({
      from: 'butler',
      to: 'executor',
      type: 'task',
      payload: { task: 'read the file at "src/index.ts"' },
    });

    const resultMsg = routedMessages.find((m) => m.type === 'result');
    expect(resultMsg).toBeDefined();
    expect(resultMsg!.from).toBe('executor');
    expect(resultMsg!.to).toBe('butler');
  });

  it('should handle execution failure and stop at failing step', async () => {
    const executor = new ExecutorAgent({
      id: 'executor',
      requirePlanApproval: false,
    });
    const eng = mockEngine({
      validateAndExecute: vi.fn().mockResolvedValue({
        requestId: 'e-fail',
        success: false,
        error: 'Permission denied',
        blockedBy: 'guardian',
      }),
      routeMessage: vi.fn(),
    });
    executor.setEngine(eng);

    const result = await executor.handleTask('write data to "/tmp/restricted.txt"');
    expect(result.overallSuccess).toBe(false);
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].success).toBe(false);
  });
});
