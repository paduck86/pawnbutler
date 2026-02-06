import type {
  AgentConfig,
  AgentMessage,
  ApprovalRequest,
  ApprovalStatus,
} from '../core/types.js';
import { BaseAgent } from './base-agent.js';

export interface ExecutionPlan {
  steps: PlanStep[];
  description: string;
  requiresApproval: boolean;
}

export interface PlanStep {
  action: string;
  params: Record<string, unknown>;
  description: string;
}

export interface ExecutionResult {
  plan: ExecutionPlan;
  results: Array<{ step: number; success: boolean; data?: unknown; error?: string }>;
  overallSuccess: boolean;
}

export class ExecutorAgent extends BaseAgent {
  private requirePlanApproval: boolean;
  private pendingPlanApproval: {
    plan: ExecutionPlan;
    resolve: (approved: boolean) => void;
  } | null;

  constructor(config: Partial<AgentConfig> & { id: string }) {
    super({
      role: 'executor',
      name: config.name ?? 'Executor',
      description:
        config.description ??
        'Executes approved actions like file writes and commands',
      allowedTools: config.allowedTools ?? [
        'read_file',
        'write_file',
        'edit_file',
        'exec_command',
      ],
      deniedTools: config.deniedTools ?? [
        'web_search',
        'web_fetch',
        'api_call',
        'send_message',
        'signup',
        'payment',
      ],
      maxConcurrentActions: config.maxConcurrentActions ?? 2,
      requirePlanApproval: config.requirePlanApproval ?? true,
      ...config,
    });

    this.requirePlanApproval =
      config.requirePlanApproval ?? true;
    this.pendingPlanApproval = null;
  }

  async handleTask(
    task: string,
    context?: Record<string, unknown>
  ): Promise<ExecutionResult> {
    this.status = 'working';
    this.currentTask = task;

    try {
      // 1. Create execution plan
      const plan = await this.createPlan(task, context);

      // 2. Submit plan for approval if required
      if (this.requirePlanApproval && plan.requiresApproval) {
        const approved = await this.submitPlanForApproval(plan);
        if (!approved) {
          return {
            plan,
            results: [],
            overallSuccess: false,
          };
        }
      }

      // 3. Execute the plan
      return await this.executePlan(plan);
    } finally {
      this.status = 'idle';
      this.currentTask = null;
    }
  }

  async handleMessage(message: AgentMessage): Promise<void> {
    switch (message.type) {
      case 'task': {
        const payload = message.payload as {
          task: string;
          context?: Record<string, unknown>;
        };
        const result = await this.handleTask(payload.task, payload.context);

        if (this.engine) {
          this.engine.routeMessage({
            from: this.id,
            to: message.from,
            type: 'result',
            payload: result,
          });
        }
        break;
      }

      case 'approval_response': {
        const approval = message.payload as ApprovalRequest;
        this.handlePlanApprovalResponse(approval.status);
        break;
      }

      default:
        break;
    }
  }

  async createPlan(
    task: string,
    context?: Record<string, unknown>
  ): Promise<ExecutionPlan> {
    // Try LLM-based planning first, fall back to heuristics
    if (this.llm) {
      const llmPlan = await this.createPlanWithLLM(task, context);
      if (llmPlan) return llmPlan;
    }

    const steps: PlanStep[] = [];
    const lower = task.toLowerCase();

    if (lower.includes('read')) {
      steps.push({
        action: 'read_file',
        params: { path: this.extractPath(task) },
        description: `Read file: ${this.extractPath(task)}`,
      });
    }

    if (lower.includes('write') || lower.includes('create')) {
      steps.push({
        action: 'write_file',
        params: {
          path: this.extractPath(task),
          content: '', // Will be filled by LLM
        },
        description: `Write file: ${this.extractPath(task)}`,
      });
    }

    if (lower.includes('edit') || lower.includes('modify')) {
      steps.push({
        action: 'edit_file',
        params: {
          path: this.extractPath(task),
          edits: [], // Will be filled by LLM
        },
        description: `Edit file: ${this.extractPath(task)}`,
      });
    }

    if (lower.includes('run') || lower.includes('execute')) {
      steps.push({
        action: 'exec_command',
        params: { command: '' }, // Will be filled by LLM
        description: 'Execute command (details pending)',
      });
    }

    // Determine if approval is needed based on step actions
    const hasDangerousSteps = steps.some(
      (s) => s.action === 'exec_command'
    );
    const hasWriteSteps = steps.some(
      (s) => s.action === 'write_file' || s.action === 'edit_file'
    );

    return {
      steps: steps.length > 0 ? steps : [{ action: 'read_file', params: {}, description: task }],
      description: task,
      requiresApproval: hasDangerousSteps || hasWriteSteps,
    };
  }

  async executePlan(plan: ExecutionPlan): Promise<ExecutionResult> {
    const results: Array<{
      step: number;
      success: boolean;
      data?: unknown;
      error?: string;
    }> = [];

    let overallSuccess = true;

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];

      // Each step goes through the guardian via requestAction
      const result = await this.requestAction(
        step.action as import('../core/types.js').ActionType,
        step.params
      );

      results.push({
        step: i,
        success: result.success,
        data: result.data,
        error: result.error,
      });

      if (!result.success) {
        overallSuccess = false;
        // Stop execution on failure
        break;
      }
    }

    return { plan, results, overallSuccess };
  }

  private async submitPlanForApproval(
    plan: ExecutionPlan
  ): Promise<boolean> {
    if (!this.engine) {
      return false;
    }

    this.status = 'waiting_approval';

    // Send plan to butler for review
    const planMessage: AgentMessage = {
      from: this.id,
      to: 'butler',
      type: 'approval_request',
      payload: {
        type: 'plan_review',
        plan: plan.description,
        steps: plan.steps.map((s) => s.description),
      },
    };

    this.engine.routeMessage(planMessage);

    // Wait for approval response
    return new Promise<boolean>((resolve) => {
      this.pendingPlanApproval = { plan, resolve };

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingPlanApproval) {
          this.pendingPlanApproval = null;
          this.status = 'idle';
          resolve(false);
        }
      }, 30_000);
    });
  }

  private handlePlanApprovalResponse(status: ApprovalStatus): void {
    if (!this.pendingPlanApproval) return;

    const { resolve } = this.pendingPlanApproval;
    this.pendingPlanApproval = null;
    this.status = 'working';

    resolve(status === 'approved' || status === 'auto_approved');
  }

  private async createPlanWithLLM(
    task: string,
    _context?: Record<string, unknown>
  ): Promise<ExecutionPlan | null> {
    try {
      const allowedActions = this.allowedTools.join(', ');
      const response = await this.chatLLM([
        {
          role: 'system',
          content: `You are an execution planner. Create a plan for the given task.
Available actions: ${allowedActions}
Respond with JSON: { "steps": [{ "action": "action_name", "params": {}, "description": "what this step does" }], "description": "overall plan description", "requiresApproval": true/false }
Set requiresApproval=true if the plan writes files or executes commands.
Only output the JSON object, nothing else.`,
        },
        { role: 'user', content: task },
      ], { maxTokens: 500, temperature: 0 });

      if (response) {
        return JSON.parse(response.content.trim());
      }
    } catch {
      // Fall back to heuristic planning
    }
    return null;
  }

  private extractPath(task: string): string {
    // Simple path extraction heuristic
    // TODO: Replace with LLM-based extraction
    const pathMatch = task.match(/(?:["'])([\w/.\\-]+)(?:["'])/);
    if (pathMatch) return pathMatch[1];

    const wordMatch = task.match(
      /\b([\w-]+(?:\/[\w.-]+)+(?:\.\w+)?)\b/
    );
    if (wordMatch) return wordMatch[1];

    return 'unknown';
  }
}
