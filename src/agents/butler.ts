import type {
  AgentConfig,
  AgentMessage,
  AgentRole,
  ApprovalRequest,
  ApprovalStatus,
  ActionRequest,
} from '../core/types.js';
import { BaseAgent } from './base-agent.js';

export interface PlanReview {
  approved: boolean;
  feedback?: string;
}

export class ButlerAgent extends BaseAgent {
  private pendingApprovals: Map<string, ApprovalRequest>;

  constructor(config: Partial<AgentConfig> & { id: string }) {
    super({
      role: 'butler',
      name: config.name ?? 'Butler',
      description:
        config.description ??
        'Primary orchestrator that manages user requests and coordinates agents',
      allowedTools: config.allowedTools ?? ['*'],
      deniedTools: config.deniedTools ?? ['signup', 'payment'],
      maxConcurrentActions: config.maxConcurrentActions ?? 3,
      requirePlanApproval: false,
      ...config,
    });

    this.pendingApprovals = new Map();
  }

  async handleTask(
    userMessage: string,
    context?: Record<string, unknown>
  ): Promise<unknown> {
    this.status = 'working';
    this.currentTask = userMessage;

    try {
      // 1. Analyze user message (LLM-based if available, heuristic fallback)
      const analysis = this.llm
        ? await this.analyzeRequestWithLLM(userMessage, context)
        : this.analyzeRequest(userMessage, context);

      // 2. Determine if delegation is needed
      if (analysis.delegateTo) {
        const result = await this.delegateToAgent(
          analysis.delegateTo,
          userMessage,
          context
        );
        return result;
      }

      // 3. Handle directly - use LLM if available
      if (this.llm) {
        const response = await this.chatLLM([
          {
            role: 'system',
            content: `You are the Butler, a helpful AI assistant. Answer the user's question directly and concisely.`,
          },
          { role: 'user', content: userMessage },
        ]);
        if (response) {
          return { handled: true, message: userMessage, analysis, response: response.content };
        }
      }

      return { handled: true, message: userMessage, analysis };
    } finally {
      this.status = 'idle';
      this.currentTask = null;
    }
  }

  async handleMessage(message: AgentMessage): Promise<void> {
    switch (message.type) {
      case 'task':
        await this.handleTask(
          (message.payload as { message: string }).message
        );
        break;

      case 'approval_request':
        await this.handleApprovalRequest(
          message.payload as ApprovalRequest
        );
        break;

      case 'result':
        // Process results from delegated agents
        break;

      case 'alert':
        // Handle security/system alerts
        break;
    }
  }

  async handleApprovalRequest(
    request: ApprovalRequest
  ): Promise<ApprovalStatus> {
    this.pendingApprovals.set(request.actionRequest.id, request);
    this.status = 'working';

    try {
      const decision = this.evaluateApproval(request);

      if (decision === 'auto_approved' || decision === 'auto_blocked') {
        this.resolveApproval(request.actionRequest.id, decision);
        return decision;
      }

      // Cannot decide automatically - needs user input
      // Mark as pending for external resolution
      this.status = 'waiting_approval';
      return 'pending';
    } catch {
      this.resolveApproval(request.actionRequest.id, 'rejected');
      return 'rejected';
    }
  }

  async delegateToAgent(
    agentRole: AgentRole,
    task: string,
    context?: Record<string, unknown>
  ): Promise<unknown> {
    if (!this.engine) {
      throw new Error('Butler not connected to engine');
    }

    const delegationMessage: AgentMessage = {
      from: this.id,
      to: agentRole, // Engine should resolve role to agent id
      type: 'task',
      payload: { task, context, delegatedBy: this.id },
    };

    this.engine.routeMessage(delegationMessage);

    // In a real implementation, this would await a result via message bus
    return { delegated: true, to: agentRole, task };
  }

  async reviewPlan(
    plan: string,
    agentId: string
  ): Promise<PlanReview> {
    // Evaluate the plan for safety and correctness
    // TODO: Integrate with LLM for intelligent plan review
    const hasDangerousSteps = plan.toLowerCase().includes('exec_command');
    const hasWriteSteps =
      plan.toLowerCase().includes('write_file') ||
      plan.toLowerCase().includes('edit_file');

    if (hasDangerousSteps) {
      return {
        approved: false,
        feedback:
          'Plan contains dangerous command execution steps. Please provide more detail on what commands will be run.',
      };
    }

    if (hasWriteSteps) {
      // Moderate risk - approved with caution
      return { approved: true, feedback: 'Approved. Proceed with caution on file modifications.' };
    }

    return { approved: true };
  }

  getPendingApprovals(): Map<string, ApprovalRequest> {
    return new Map(this.pendingApprovals);
  }

  private analyzeRequest(
    message: string,
    _context?: Record<string, unknown>
  ): { delegateTo?: AgentRole; type: string } {
    // Heuristic-based routing (LLM routing used when available via analyzeRequestWithLLM)
    const lower = message.toLowerCase();

    if (
      lower.includes('search') ||
      lower.includes('find') ||
      lower.includes('look up') ||
      lower.includes('research')
    ) {
      return { delegateTo: 'researcher', type: 'research' };
    }

    if (
      lower.includes('write') ||
      lower.includes('create file') ||
      lower.includes('edit') ||
      lower.includes('run') ||
      lower.includes('execute')
    ) {
      return { delegateTo: 'executor', type: 'execution' };
    }

    return { type: 'direct' };
  }

  private async analyzeRequestWithLLM(
    message: string,
    context?: Record<string, unknown>
  ): Promise<{ delegateTo?: AgentRole; type: string }> {
    if (!this.llm) return this.analyzeRequest(message, context);

    try {
      const response = await this.chatLLM([
        {
          role: 'system',
          content: `You are the Butler agent in the PawnButler system. Analyze the user request and decide how to route it.
Respond with a JSON object: { "delegateTo": "researcher"|"executor"|null, "type": "research"|"execution"|"direct" }
- "researcher": for information gathering, searches, lookups, reading
- "executor": for file writes, edits, command execution, creation tasks
- null (type "direct"): for simple questions you can answer directly
Only output the JSON object, nothing else.`,
        },
        { role: 'user', content: message },
      ], { maxTokens: 100, temperature: 0 });

      if (response) {
        const parsed = JSON.parse(response.content.trim());
        return {
          delegateTo: parsed.delegateTo ?? undefined,
          type: parsed.type ?? 'direct',
        };
      }
    } catch {
      // Fall back to heuristic analysis
    }
    return this.analyzeRequest(message, context);
  }

  async reviewPlanWithLLM(
    plan: string,
    agentId: string
  ): Promise<PlanReview> {
    if (!this.llm) return this.reviewPlan(plan, agentId);

    try {
      const response = await this.chatLLM([
        {
          role: 'system',
          content: `You are the Butler safety reviewer. Evaluate this execution plan for safety risks.
Respond with JSON: { "approved": boolean, "feedback": "string" }
Block plans that: execute dangerous commands without justification, modify system files, access forbidden resources.
Approve plans that: are read-only, write to temp/project dirs, run safe commands.
Only output the JSON object, nothing else.`,
        },
        { role: 'user', content: `Agent ${agentId} submitted this plan:\n${plan}` },
      ], { maxTokens: 200, temperature: 0 });

      if (response) {
        return JSON.parse(response.content.trim());
      }
    } catch {
      // Fall back to heuristic review
    }
    return this.reviewPlan(plan, agentId);
  }

  private evaluateApproval(request: ApprovalRequest): ApprovalStatus {
    const { actionRequest } = request;

    // Auto-block forbidden actions
    if (
      actionRequest.actionType === 'signup' ||
      actionRequest.actionType === 'payment'
    ) {
      return 'auto_blocked';
    }

    // Auto-approve safe actions
    if (actionRequest.safetyLevel === 'safe') {
      return 'auto_approved';
    }

    // Auto-block dangerous actions from non-executor agents
    if (
      actionRequest.safetyLevel === 'dangerous' &&
      actionRequest.agentRole !== 'executor'
    ) {
      return 'auto_blocked';
    }

    // Moderate actions from known roles: auto-approve
    if (
      actionRequest.safetyLevel === 'moderate' &&
      (actionRequest.agentRole === 'executor' ||
        actionRequest.agentRole === 'researcher')
    ) {
      return 'auto_approved';
    }

    // Cannot decide automatically
    return 'pending';
  }

  private resolveApproval(
    requestId: string,
    status: ApprovalStatus
  ): void {
    const approval = this.pendingApprovals.get(requestId);
    if (!approval) return;

    approval.status = status;
    approval.reviewedBy = this.id;
    approval.reviewedAt = Date.now();

    this.pendingApprovals.delete(requestId);

    // Notify the requesting agent via engine
    if (this.engine) {
      const responseMessage: AgentMessage = {
        from: this.id,
        to: approval.actionRequest.agentId,
        type: 'approval_response',
        payload: approval,
      };
      this.engine.routeMessage(responseMessage);
    }
  }
}
