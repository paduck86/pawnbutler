import type {
  AgentRole,
  SafetyLevel,
  ActionRequest,
  ActionResult,
} from '../core/types.js';
import type { BaseAgent, AgentEngine } from '../agents/base-agent.js';
import { v4 as uuidv4 } from 'uuid';

export interface ToolDefinition {
  name: string;
  description: string;
  safetyLevel: SafetyLevel;
  requiredRole?: AgentRole[];
  execute: (params: Record<string, unknown>) => Promise<unknown>;
  validateParams?: (
    params: Record<string, unknown>
  ) => { valid: boolean; error?: string };
}

export class ToolRegistry {
  private tools: Map<string, ToolDefinition>;
  private engine: AgentEngine | null;

  constructor() {
    this.tools = new Map();
    this.engine = null;
  }

  setEngine(engine: AgentEngine): void {
    this.engine = engine;
  }

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  isAllowedForRole(toolName: string, role: AgentRole): boolean {
    const tool = this.tools.get(toolName);
    if (!tool) return false;

    // If no role restriction, tool is available to all
    if (!tool.requiredRole || tool.requiredRole.length === 0) {
      return true;
    }

    return tool.requiredRole.includes(role);
  }

  listForRole(role: AgentRole): ToolDefinition[] {
    const result: ToolDefinition[] = [];
    for (const tool of this.tools.values()) {
      if (this.isAllowedForRole(tool.name, role)) {
        result.push(tool);
      }
    }
    return result;
  }

  listAll(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  async execute(
    name: string,
    params: Record<string, unknown>,
    agent: BaseAgent
  ): Promise<ActionResult> {
    // 1. Check tool exists
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        requestId: '',
        success: false,
        error: `Tool "${name}" not found`,
      };
    }

    // 2. Check role permission
    if (!this.isAllowedForRole(name, agent.role)) {
      return {
        requestId: '',
        success: false,
        error: `Tool "${name}" is not allowed for role "${agent.role}"`,
        blockedBy: 'tool_registry',
        blockedReason: 'Role not in requiredRole list',
      };
    }

    // 3. Check agent-level tool permission
    if (!agent.isToolAllowed(name)) {
      return {
        requestId: '',
        success: false,
        error: `Tool "${name}" is denied for agent "${agent.name}"`,
        blockedBy: 'agent_policy',
        blockedReason: 'Tool denied by agent configuration',
      };
    }

    // 4. Validate params
    if (tool.validateParams) {
      const validation = tool.validateParams(params);
      if (!validation.valid) {
        return {
          requestId: '',
          success: false,
          error: `Invalid parameters: ${validation.error ?? 'Validation failed'}`,
        };
      }
    }

    // 5. Create action request for guardian validation
    const requestId = uuidv4();
    const request: ActionRequest = {
      id: requestId,
      agentId: agent.id,
      agentRole: agent.role,
      actionType: name as ActionRequest['actionType'],
      params,
      safetyLevel: tool.safetyLevel,
      timestamp: Date.now(),
      requiresApproval: tool.safetyLevel === 'dangerous',
    };

    // 6. Validate through engine (which routes to guardian)
    if (this.engine) {
      const validationResult = await this.engine.validateAndExecute(request);
      if (!validationResult.success) {
        return validationResult;
      }
    }

    // 7. Execute tool
    try {
      const data = await tool.execute(params);
      return {
        requestId,
        success: true,
        data,
      };
    } catch (err) {
      return {
        requestId,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
