import type {
  PawnButlerConfig,
  AgentMessage,
  ActionRequest,
  ApprovalRequest,
  ActionResult,
} from './types.js';
import { MessageBus } from './message-bus.js';
import { Guardian } from '../safety/guardian.js';
import type { AgentEngine } from '../agents/base-agent.js';
import type { LLMManager } from '../llm/llm-manager.js';
import type { SessionManager } from '../sessions/session-manager.js';

export interface BaseAgent {
  id: string;
  role: string;
  init(): Promise<void>;
  handleMessage(message: AgentMessage): Promise<void>;
  shutdown(): Promise<void>;
  setEngine?(engine: AgentEngine): void;
  setLLM?(llm: LLMManager): void;
}

export class PawnButlerEngine implements AgentEngine {
  private agents: Map<string, BaseAgent>;
  private messageBus: MessageBus;
  private guardianAgent: BaseAgent | null;
  private butler: BaseAgent | null;
  private guardianSafety: Guardian;
  private config: PawnButlerConfig;
  private running: boolean;
  private pendingApprovals: Map<string, ApprovalRequest>;
  private llmManager: LLMManager | null = null;
  private sessionManager: SessionManager | null = null;

  constructor(config: PawnButlerConfig) {
    this.config = config;
    this.agents = new Map();
    this.messageBus = new MessageBus();
    this.guardianAgent = null;
    this.butler = null;
    this.guardianSafety = new Guardian(config);
    this.running = false;
    this.pendingApprovals = new Map();
  }

  /** Set an LLM manager to be injected into agents on start */
  setLLMManager(llm: LLMManager): void {
    this.llmManager = llm;
  }

  /** Set a session manager for the engine */
  setSessionManager(sm: SessionManager): void {
    this.sessionManager = sm;
  }

  /** Get the Guardian safety instance */
  getGuardian(): Guardian {
    return this.guardianSafety;
  }

  /** Get the session manager */
  getSessionManager(): SessionManager | null {
    return this.sessionManager;
  }

  /** Get the LLM manager */
  getLLMManager(): LLMManager | null {
    return this.llmManager;
  }

  registerAgent(agent: BaseAgent): void {
    this.agents.set(agent.id, agent);

    if (agent.role === 'guardian') {
      this.guardianAgent = agent;
    }
    if (agent.role === 'butler') {
      this.butler = agent;
    }

    this.messageBus.subscribe(agent.id, (message: AgentMessage) => {
      agent.handleMessage(message).catch((err) => {
        console.error(`[Engine] Error in agent ${agent.id}:`, err);
      });
    });
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new Error('[Engine] Already running');
    }

    // Connect engine and LLM to all agents before initialization
    for (const [, agent] of this.agents) {
      if (agent.setEngine) {
        agent.setEngine(this);
      }
      if (this.llmManager && agent.setLLM) {
        agent.setLLM(this.llmManager);
      }
    }

    // Initialize in order: guardian -> butler -> researcher -> executor
    const initOrder = ['guardian', 'butler', 'researcher', 'executor'] as const;

    for (const role of initOrder) {
      for (const [, agent] of this.agents) {
        if (agent.role === role) {
          await agent.init();
        }
      }
    }

    this.running = true;
  }

  /**
   * Validate an action request through the Guardian safety layer.
   * Safe/moderate actions are auto-approved.
   * Dangerous actions require butler approval.
   * Forbidden actions are immediately blocked.
   */
  async validateAndExecute(request: ActionRequest): Promise<ActionResult> {
    return this.guardianSafety.validateAction(request);
  }

  async submitUserRequest(message: string): Promise<void> {
    if (!this.running) {
      throw new Error('[Engine] Not running');
    }
    if (!this.butler) {
      throw new Error('[Engine] No butler agent registered');
    }

    const agentMessage: AgentMessage = {
      from: 'user',
      to: this.butler.id,
      type: 'task',
      payload: { message },
    };

    this.messageBus.send(agentMessage);
  }

  routeMessage(message: AgentMessage): void {
    if (!this.running) {
      throw new Error('[Engine] Not running');
    }
    this.messageBus.send(message);
  }

  async requestApproval(request: ActionRequest): Promise<ActionResult> {
    if (!this.butler) {
      return {
        requestId: request.id,
        success: false,
        error: 'No butler agent available for approval',
        blockedBy: 'system',
        blockedReason: 'No butler agent registered',
      };
    }

    const approval: ApprovalRequest = {
      actionRequest: request,
      status: 'pending',
    };

    this.pendingApprovals.set(request.id, approval);

    const approvalMessage: AgentMessage = {
      from: request.agentId,
      to: this.butler.id,
      type: 'approval_request',
      payload: approval,
    };

    this.messageBus.send(approvalMessage);

    // Return a pending result - actual approval will come async
    return {
      requestId: request.id,
      success: false,
      error: 'Awaiting approval',
    };
  }

  resolveApproval(
    requestId: string,
    approved: boolean,
    reviewedBy: string,
    reason?: string
  ): ApprovalRequest | undefined {
    const approval = this.pendingApprovals.get(requestId);
    if (!approval) return undefined;

    approval.status = approved ? 'approved' : 'rejected';
    approval.reviewedBy = reviewedBy;
    approval.reviewedAt = Date.now();
    approval.reason = reason;

    this.pendingApprovals.delete(requestId);

    // Notify the requesting agent
    const responseMessage: AgentMessage = {
      from: reviewedBy,
      to: approval.actionRequest.agentId,
      type: 'approval_response',
      payload: approval,
    };

    this.messageBus.send(responseMessage);
    return approval;
  }

  async shutdown(): Promise<void> {
    if (!this.running) return;

    // Shutdown in reverse order: executor -> researcher -> butler -> guardian
    const shutdownOrder = ['executor', 'researcher', 'butler', 'guardian'] as const;

    for (const role of shutdownOrder) {
      for (const [, agent] of this.agents) {
        if (agent.role === role) {
          await agent.shutdown();
        }
      }
    }

    this.guardianSafety.destroy();
    this.messageBus.clear();
    this.agents.clear();
    this.pendingApprovals.clear();
    this.guardianAgent = null;
    this.butler = null;
    this.running = false;
  }

  getAgent(id: string): BaseAgent | undefined {
    return this.agents.get(id);
  }

  getMessageBus(): MessageBus {
    return this.messageBus;
  }

  getConfig(): PawnButlerConfig {
    return this.config;
  }

  isRunning(): boolean {
    return this.running;
  }
}
