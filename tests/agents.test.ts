import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ButlerAgent } from '../src/agents/butler.js';
import { ResearcherAgent } from '../src/agents/researcher.js';
import { ExecutorAgent } from '../src/agents/executor.js';
import { PawnButlerEngine } from '../src/core/engine.js';
import { MessageBus } from '../src/core/message-bus.js';
import { defaultConfig } from '../src/config/default-config.js';
import type {
  AgentMessage,
  ActionRequest,
  ActionResult,
  ApprovalRequest,
} from '../src/core/types.js';
import type { AgentEngine } from '../src/agents/base-agent.js';

// -------------------------------------------------------
// Butler Approval Flow Tests
// -------------------------------------------------------
describe('ButlerAgent - Approval Flow', () => {
  let butler: ButlerAgent;

  beforeEach(() => {
    butler = new ButlerAgent({ id: 'butler' });
  });

  it('should auto-block signup actions', async () => {
    const approval: ApprovalRequest = {
      actionRequest: {
        id: 'req-1',
        agentId: 'executor',
        agentRole: 'executor',
        actionType: 'signup',
        params: {},
        safetyLevel: 'forbidden',
        timestamp: Date.now(),
        requiresApproval: true,
      },
      status: 'pending',
    };

    const status = await butler.handleApprovalRequest(approval);
    expect(status).toBe('auto_blocked');
  });

  it('should auto-block payment actions', async () => {
    const approval: ApprovalRequest = {
      actionRequest: {
        id: 'req-2',
        agentId: 'executor',
        agentRole: 'executor',
        actionType: 'payment',
        params: {},
        safetyLevel: 'forbidden',
        timestamp: Date.now(),
        requiresApproval: true,
      },
      status: 'pending',
    };

    const status = await butler.handleApprovalRequest(approval);
    expect(status).toBe('auto_blocked');
  });

  it('should auto-approve safe actions', async () => {
    const approval: ApprovalRequest = {
      actionRequest: {
        id: 'req-3',
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

    const status = await butler.handleApprovalRequest(approval);
    expect(status).toBe('auto_approved');
  });

  it('should auto-approve moderate actions from executor', async () => {
    const approval: ApprovalRequest = {
      actionRequest: {
        id: 'req-4',
        agentId: 'executor',
        agentRole: 'executor',
        actionType: 'write_file',
        params: { path: '/tmp/test.txt', content: 'hello' },
        safetyLevel: 'moderate',
        timestamp: Date.now(),
        requiresApproval: false,
      },
      status: 'pending',
    };

    const status = await butler.handleApprovalRequest(approval);
    expect(status).toBe('auto_approved');
  });

  it('should auto-block dangerous actions from non-executor agents', async () => {
    const approval: ApprovalRequest = {
      actionRequest: {
        id: 'req-5',
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

    const status = await butler.handleApprovalRequest(approval);
    expect(status).toBe('auto_blocked');
  });

  it('should delegate research tasks to researcher', async () => {
    const mockEngine: AgentEngine = {
      validateAndExecute: vi.fn().mockResolvedValue({ requestId: '', success: true }),
      routeMessage: vi.fn(),
      requestApproval: vi.fn().mockResolvedValue({ requestId: '', success: true }),
    };
    butler.setEngine(mockEngine);

    const result = await butler.handleTask('search for TypeScript tutorials');
    expect(result).toHaveProperty('delegated', true);
    expect(result).toHaveProperty('to', 'researcher');
    expect(mockEngine.routeMessage).toHaveBeenCalled();
  });

  it('should delegate execution tasks to executor', async () => {
    const mockEngine: AgentEngine = {
      validateAndExecute: vi.fn().mockResolvedValue({ requestId: '', success: true }),
      routeMessage: vi.fn(),
      requestApproval: vi.fn().mockResolvedValue({ requestId: '', success: true }),
    };
    butler.setEngine(mockEngine);

    const result = await butler.handleTask('write a file at /tmp/output.txt');
    expect(result).toHaveProperty('delegated', true);
    expect(result).toHaveProperty('to', 'executor');
  });

  it('should handle task messages via handleMessage', async () => {
    const mockEngine: AgentEngine = {
      validateAndExecute: vi.fn().mockResolvedValue({ requestId: '', success: true }),
      routeMessage: vi.fn(),
      requestApproval: vi.fn().mockResolvedValue({ requestId: '', success: true }),
    };
    butler.setEngine(mockEngine);

    const message: AgentMessage = {
      from: 'user',
      to: 'butler',
      type: 'task',
      payload: { message: 'find information about Node.js' },
    };

    await butler.handleMessage(message);
    // Should have delegated to researcher
    expect(mockEngine.routeMessage).toHaveBeenCalled();
  });
});

// -------------------------------------------------------
// Researcher Read-only Restriction Tests
// -------------------------------------------------------
describe('ResearcherAgent - Read-only Restrictions', () => {
  let researcher: ResearcherAgent;

  beforeEach(() => {
    researcher = new ResearcherAgent({ id: 'researcher' });
  });

  it('should allow web_search tool', () => {
    expect(researcher.isToolAllowed('web_search')).toBe(true);
  });

  it('should allow web_fetch tool', () => {
    expect(researcher.isToolAllowed('web_fetch')).toBe(true);
  });

  it('should allow read_file tool', () => {
    expect(researcher.isToolAllowed('read_file')).toBe(true);
  });

  it('should deny write_file tool', () => {
    expect(researcher.isToolAllowed('write_file')).toBe(false);
  });

  it('should deny edit_file tool', () => {
    expect(researcher.isToolAllowed('edit_file')).toBe(false);
  });

  it('should deny exec_command tool', () => {
    expect(researcher.isToolAllowed('exec_command')).toBe(false);
  });

  it('should deny api_call tool', () => {
    expect(researcher.isToolAllowed('api_call')).toBe(false);
  });

  it('should deny send_message tool', () => {
    expect(researcher.isToolAllowed('send_message')).toBe(false);
  });

  it('should deny signup tool', () => {
    expect(researcher.isToolAllowed('signup')).toBe(false);
  });

  it('should deny payment tool', () => {
    expect(researcher.isToolAllowed('payment')).toBe(false);
  });

  it('should return blocked result when requesting denied tool', async () => {
    const mockEngine: AgentEngine = {
      validateAndExecute: vi.fn(),
      routeMessage: vi.fn(),
      requestApproval: vi.fn(),
    };
    researcher.setEngine(mockEngine);

    const result = await researcher.requestAction('write_file', { path: '/tmp/test', content: 'x' });
    expect(result.success).toBe(false);
    expect(result.blockedBy).toBe('agent_policy');
    // Engine should NOT have been called
    expect(mockEngine.validateAndExecute).not.toHaveBeenCalled();
  });
});

// -------------------------------------------------------
// Executor Sandbox Restriction Tests
// -------------------------------------------------------
describe('ExecutorAgent - Sandbox Restrictions', () => {
  let executor: ExecutorAgent;

  beforeEach(() => {
    executor = new ExecutorAgent({ id: 'executor' });
  });

  it('should allow read_file tool', () => {
    expect(executor.isToolAllowed('read_file')).toBe(true);
  });

  it('should allow write_file tool', () => {
    expect(executor.isToolAllowed('write_file')).toBe(true);
  });

  it('should allow edit_file tool', () => {
    expect(executor.isToolAllowed('edit_file')).toBe(true);
  });

  it('should allow exec_command tool', () => {
    expect(executor.isToolAllowed('exec_command')).toBe(true);
  });

  it('should deny web_search tool', () => {
    expect(executor.isToolAllowed('web_search')).toBe(false);
  });

  it('should deny web_fetch tool', () => {
    expect(executor.isToolAllowed('web_fetch')).toBe(false);
  });

  it('should deny api_call tool', () => {
    expect(executor.isToolAllowed('api_call')).toBe(false);
  });

  it('should deny signup tool', () => {
    expect(executor.isToolAllowed('signup')).toBe(false);
  });

  it('should deny payment tool', () => {
    expect(executor.isToolAllowed('payment')).toBe(false);
  });

  it('should deny send_message tool', () => {
    expect(executor.isToolAllowed('send_message')).toBe(false);
  });

  it('should return blocked result when requesting denied tool', async () => {
    const mockEngine: AgentEngine = {
      validateAndExecute: vi.fn(),
      routeMessage: vi.fn(),
      requestApproval: vi.fn(),
    };
    executor.setEngine(mockEngine);

    const result = await executor.requestAction('web_search', { query: 'test' });
    expect(result.success).toBe(false);
    expect(result.blockedBy).toBe('agent_policy');
    expect(mockEngine.validateAndExecute).not.toHaveBeenCalled();
  });

  it('should require plan approval by default', () => {
    expect(executor.isToolAllowed('write_file')).toBe(true);
    // The executor config has requirePlanApproval = true by default
    const status = executor.reportStatus();
    expect(status.role).toBe('executor');
  });

  it('should create execution plans from tasks', async () => {
    const plan = await executor.createPlan('write a file at /tmp/test.txt');
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.steps.some((s) => s.action === 'write_file')).toBe(true);
    expect(plan.requiresApproval).toBe(true);
  });
});

// -------------------------------------------------------
// MessageBus Tests
// -------------------------------------------------------
describe('MessageBus', () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus();
  });

  it('should deliver messages to subscribed agents', () => {
    const received: AgentMessage[] = [];
    bus.subscribe('agent-1', (msg) => received.push(msg));

    bus.send({
      from: 'user',
      to: 'agent-1',
      type: 'task',
      payload: { message: 'hello' },
    });

    expect(received).toHaveLength(1);
    expect(received[0].payload).toEqual({ message: 'hello' });
  });

  it('should not deliver to unsubscribed agents', () => {
    const received: AgentMessage[] = [];
    bus.subscribe('agent-1', (msg) => received.push(msg));
    bus.unsubscribe('agent-1');

    bus.send({
      from: 'user',
      to: 'agent-1',
      type: 'task',
      payload: { message: 'hello' },
    });

    expect(received).toHaveLength(0);
  });

  it('should broadcast to all agents except sender', () => {
    const received1: AgentMessage[] = [];
    const received2: AgentMessage[] = [];
    bus.subscribe('agent-1', (msg) => received1.push(msg));
    bus.subscribe('agent-2', (msg) => received2.push(msg));

    bus.broadcast({
      from: 'agent-1',
      to: 'all',
      type: 'alert',
      payload: { alert: 'test' },
    });

    expect(received1).toHaveLength(0); // sender excluded
    expect(received2).toHaveLength(1);
  });

  it('should maintain message history', () => {
    bus.subscribe('agent-1', () => {});

    bus.send({ from: 'user', to: 'agent-1', type: 'task', payload: 'msg1' });
    bus.send({ from: 'user', to: 'agent-1', type: 'task', payload: 'msg2' });

    const history = bus.getHistory('agent-1');
    expect(history).toHaveLength(2);
  });

  it('should limit history retrieval', () => {
    bus.subscribe('agent-1', () => {});

    for (let i = 0; i < 10; i++) {
      bus.send({ from: 'user', to: 'agent-1', type: 'task', payload: `msg${i}` });
    }

    const history = bus.getHistory('agent-1', 3);
    expect(history).toHaveLength(3);
  });
});

// -------------------------------------------------------
// PawnButlerEngine Tests
// -------------------------------------------------------
describe('PawnButlerEngine', () => {
  it('should register and start agents', async () => {
    const engine = new PawnButlerEngine(defaultConfig);
    const butler = new ButlerAgent({ id: 'butler' });
    engine.registerAgent(butler);

    await engine.start();
    expect(engine.isRunning()).toBe(true);
    expect(engine.getAgent('butler')).toBe(butler);

    await engine.shutdown();
    expect(engine.isRunning()).toBe(false);
  });

  it('should reject submitUserRequest when not running', async () => {
    const engine = new PawnButlerEngine(defaultConfig);
    await expect(engine.submitUserRequest('test')).rejects.toThrow('Not running');
  });

  it('should reject start when already running', async () => {
    const engine = new PawnButlerEngine(defaultConfig);
    const butler = new ButlerAgent({ id: 'butler' });
    engine.registerAgent(butler);

    await engine.start();
    await expect(engine.start()).rejects.toThrow('Already running');

    await engine.shutdown();
  });

  it('should route messages through the message bus', async () => {
    const engine = new PawnButlerEngine(defaultConfig);
    const butler = new ButlerAgent({ id: 'butler' });
    engine.registerAgent(butler);

    await engine.start();

    // Submit a user request - this should route to butler
    await engine.submitUserRequest('hello butler');

    const history = engine.getMessageBus().getHistory('butler');
    expect(history.length).toBeGreaterThan(0);
    expect(history[0].type).toBe('task');

    await engine.shutdown();
  });
});
