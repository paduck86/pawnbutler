import { v4 as uuidv4 } from 'uuid';
import type {
  AgentRole,
  AgentConfig,
  AgentMessage,
  ActionType,
  ActionRequest,
  ActionResult,
  SafetyLevel,
} from '../core/types.js';
import type { LLMManager } from '../llm/llm-manager.js';
import type { LLMMessage, LLMRequestOptions, LLMResponse, StreamChunk } from '../llm/types.js';

export type AgentStatus = 'idle' | 'working' | 'waiting_approval' | 'stopped';

export interface AgentStatusReport {
  id: string;
  role: AgentRole;
  status: AgentStatus;
  currentTask: string | null;
}

export abstract class BaseAgent {
  readonly id: string;
  readonly role: AgentRole;
  readonly name: string;
  readonly description: string;
  readonly allowedTools: string[];
  readonly deniedTools: string[];

  protected status: AgentStatus;
  protected currentTask: string | null;
  protected engine: AgentEngine | null;
  protected llm: LLMManager | null;

  constructor(config: AgentConfig) {
    this.id = config.id || uuidv4();
    this.role = config.role;
    this.name = config.name;
    this.description = config.description;
    this.allowedTools = [...config.allowedTools];
    this.deniedTools = [...config.deniedTools];
    this.status = 'idle';
    this.currentTask = null;
    this.engine = null;
    this.llm = null;
  }

  setEngine(engine: AgentEngine): void {
    this.engine = engine;
  }

  setLLM(llm: LLMManager): void {
    this.llm = llm;
  }

  hasLLM(): boolean {
    return this.llm !== null;
  }

  /** Send messages to the LLM and get a response. Returns null if no LLM configured. */
  protected async chatLLM(
    messages: LLMMessage[],
    options?: LLMRequestOptions
  ): Promise<LLMResponse | null> {
    if (!this.llm) return null;
    return this.llm.chat(messages, options);
  }

  /** Stream from the LLM. Returns null if no LLM configured. */
  protected async *streamLLM(
    messages: LLMMessage[],
    options?: LLMRequestOptions
  ): AsyncGenerator<StreamChunk> {
    if (!this.llm) return;
    yield* this.llm.stream(messages, options);
  }

  async requestAction(
    actionType: ActionType,
    params: Record<string, unknown>
  ): Promise<ActionResult> {
    if (!this.engine) {
      return {
        requestId: '',
        success: false,
        error: 'Agent not connected to engine',
      };
    }

    if (!this.isToolAllowed(actionType)) {
      return {
        requestId: '',
        success: false,
        error: `Tool "${actionType}" is not allowed for agent "${this.name}" (role: ${this.role})`,
        blockedBy: 'agent_policy',
        blockedReason: 'Tool not in allowed list or explicitly denied',
      };
    }

    const request: ActionRequest = {
      id: uuidv4(),
      agentId: this.id,
      agentRole: this.role,
      actionType,
      params,
      safetyLevel: 'moderate' as SafetyLevel,
      timestamp: Date.now(),
      requiresApproval: false,
    };

    this.status = 'working';
    const result = await this.engine.validateAndExecute(request);
    this.status = 'idle';

    return result;
  }

  isToolAllowed(toolName: string): boolean {
    // Denied tools always take priority
    if (this.deniedTools.includes(toolName)) {
      return false;
    }

    // Wildcard means all tools allowed (except denied)
    if (this.allowedTools.includes('*')) {
      return true;
    }

    return this.allowedTools.includes(toolName);
  }

  async init(): Promise<void> {
    this.status = 'idle';
    this.currentTask = null;
  }

  async shutdown(): Promise<void> {
    this.status = 'stopped';
    this.currentTask = null;
  }

  reportStatus(): AgentStatusReport {
    return {
      id: this.id,
      role: this.role,
      status: this.status,
      currentTask: this.currentTask,
    };
  }

  abstract handleTask(
    task: string,
    context?: Record<string, unknown>
  ): Promise<unknown>;

  abstract handleMessage(message: AgentMessage): Promise<void>;
}

/**
 * Minimal interface for the engine methods that agents need.
 * Avoids circular dependency with PawnButlerEngine.
 */
export interface AgentEngine {
  validateAndExecute(request: ActionRequest): Promise<ActionResult>;
  routeMessage(message: AgentMessage): void;
  requestApproval(request: ActionRequest): Promise<ActionResult>;
}
