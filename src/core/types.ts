// PawnButler Core Type System

export type AgentRole = 'butler' | 'researcher' | 'executor' | 'guardian';

export type SafetyLevel = 'safe' | 'moderate' | 'dangerous' | 'forbidden';

export type ActionType =
  | 'web_search'
  | 'web_fetch'
  | 'read_file'
  | 'write_file'
  | 'exec_command'
  | 'edit_file'
  | 'api_call'
  | 'signup'
  | 'payment'
  | 'send_message'
  | 'browser_navigate'
  | 'browser_click'
  | 'browser_type'
  | 'browser_screenshot'
  | 'browser_extract'
  | 'browser_evaluate'
  | 'cron_add'
  | 'cron_list'
  | 'cron_remove'
  | 'cron_status';

export interface ActionRequest {
  id: string;
  agentId: string;
  agentRole: AgentRole;
  actionType: ActionType;
  params: Record<string, unknown>;
  safetyLevel: SafetyLevel;
  timestamp: number;
  requiresApproval: boolean;
}

export interface ActionResult {
  requestId: string;
  success: boolean;
  data?: unknown;
  error?: string;
  blockedBy?: string;
  blockedReason?: string;
}

export type ApprovalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'auto_approved'
  | 'auto_blocked';

export interface ApprovalRequest {
  actionRequest: ActionRequest;
  status: ApprovalStatus;
  reviewedBy?: string;
  reviewedAt?: number;
  reason?: string;
}

export type AgentMessageType =
  | 'task'
  | 'result'
  | 'approval_request'
  | 'approval_response'
  | 'alert';

export interface AgentMessage {
  from: string;
  to: string;
  type: AgentMessageType;
  payload: unknown;
}

export interface AuditEntry {
  timestamp: number;
  agentId: string;
  agentRole: AgentRole;
  actionType: ActionType;
  safetyLevel: SafetyLevel;
  approvalStatus: ApprovalStatus;
  params: Record<string, unknown>; // sanitized - no secrets
  result: 'success' | 'blocked' | 'error';
  details?: string;
}

export interface AgentConfig {
  id: string;
  role: AgentRole;
  name: string;
  description: string;
  allowedTools: string[];
  deniedTools: string[];
  maxConcurrentActions: number;
  requirePlanApproval: boolean;
}

export interface SafetyConfig {
  defaultLevel: SafetyLevel;
  forbiddenActions: ActionType[];
  dangerousActions: ActionType[];
  secretPatterns: string[];
}

export interface VaultConfig {
  enabled: boolean;
  storePath: string;
}

export interface AuditLogConfig {
  enabled: boolean;
  logPath: string;
  alertLogPath: string;
  retentionDays: number;
}

export type NotificationChannel = 'telegram' | 'slack' | 'discord' | 'whatsapp';

export interface NotificationsConfig {
  enabled: boolean;
  channel: NotificationChannel;
  approvalTimeoutMs: number;
  notifyOnBlocked: boolean;
  telegram?: { botToken: string; chatId: string };
  slack?: { webhookUrl: string; signingSecret?: string };
  discord?: { botToken: string; channelId: string; applicationId: string };
  whatsapp?: { phoneNumberId: string; accessToken: string; recipientPhone: string };
}

export interface SandboxConfig {
  enabled: boolean;
  image: string;
  networkMode: 'none' | 'bridge';
  memoryLimit: string;
  cpuLimit: number;
  timeout: number;
  mountPaths: string[];
  allowWriteMount: boolean;
}

export type LLMProviderName = 'anthropic' | 'openai' | 'google' | 'local';

export interface LLMConfig {
  defaultProvider: LLMProviderName;
  defaultModel: string;
  fallbackChain: LLMProviderName[];
  maxRetries: number;
  providers: {
    anthropic?: { apiKey: string; baseUrl?: string };
    openai?: { apiKey: string; baseUrl?: string; organization?: string };
    google?: { apiKey: string };
    local?: { baseUrl: string; model?: string };
  };
}

export type EmbeddingProviderType = 'openai' | 'tfidf';

export interface MemoryConfig {
  enabled: boolean;
  provider: EmbeddingProviderType;
  openaiApiKey?: string;
  openaiModel?: string;
  embeddingDimension: number;
  dbPath: string;
  sessionDir: string;
  maxChunkSize: number;
  chunkOverlap: number;
  searchTopK: number;
  hybridAlpha: number;
  deduplicationThreshold: number;
}

export interface ChannelsConfig {
  whatsapp?: {
    enabled: boolean;
    sessionPath: string;
  };
  telegram?: {
    enabled: boolean;
    botToken: string;
  };
  discord?: {
    enabled: boolean;
    botToken: string;
    guildId?: string;
  };
  slack?: {
    enabled: boolean;
    botToken: string;
    appToken: string;
    signingSecret: string;
  };
  allowedSenders: {
    whatsapp: string[];
    telegram: string[];
    discord: string[];
    slack: string[];
  };
}

export interface SessionConfig {
  maxMessages: number;
  contextWindow: number;
  pruningStrategy: 'sliding_window' | 'summarize' | 'none';
  storePath: string;
}

export interface PawnButlerConfig {
  agents: AgentConfig[];
  safety: SafetyConfig;
  urlAllowlist: string[];
  urlBlocklist: string[];
  secretVault: VaultConfig;
  auditLog: AuditLogConfig;
  sandbox: SandboxConfig;
  notifications?: NotificationsConfig;
  memory?: MemoryConfig;
  llm?: LLMConfig;
  channels?: ChannelsConfig;
  sessions?: SessionConfig;
}
