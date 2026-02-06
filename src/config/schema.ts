import { z } from 'zod';

const agentRoleSchema = z.enum(['butler', 'researcher', 'executor', 'guardian']);

const safetyLevelSchema = z.enum(['safe', 'moderate', 'dangerous', 'forbidden']);

const actionTypeSchema = z.enum([
  'web_search',
  'web_fetch',
  'read_file',
  'write_file',
  'exec_command',
  'edit_file',
  'api_call',
  'signup',
  'payment',
  'send_message',
  'browser_navigate',
  'browser_click',
  'browser_type',
  'browser_screenshot',
  'browser_extract',
  'browser_evaluate',
  'cron_add',
  'cron_list',
  'cron_remove',
  'cron_status',
]);

const agentConfigSchema = z.object({
  id: z.string().min(1),
  role: agentRoleSchema,
  name: z.string().min(1),
  description: z.string(),
  allowedTools: z.array(z.string()),
  deniedTools: z.array(z.string()),
  maxConcurrentActions: z.number().int().positive(),
  requirePlanApproval: z.boolean(),
});

const safetyConfigSchema = z.object({
  defaultLevel: safetyLevelSchema,
  forbiddenActions: z.array(actionTypeSchema),
  dangerousActions: z.array(actionTypeSchema),
  secretPatterns: z.array(z.string()),
});

const vaultConfigSchema = z.object({
  enabled: z.boolean(),
  storePath: z.string().min(1),
});

const auditLogConfigSchema = z.object({
  enabled: z.boolean(),
  logPath: z.string().min(1),
  alertLogPath: z.string().min(1),
  retentionDays: z.number().int().positive(),
});

const sandboxConfigSchema = z.object({
  enabled: z.boolean(),
  image: z.string().min(1),
  networkMode: z.enum(['none', 'bridge']),
  memoryLimit: z.string().min(1),
  cpuLimit: z.number().positive(),
  timeout: z.number().int().positive(),
  mountPaths: z.array(z.string()),
  allowWriteMount: z.boolean(),
});

const notificationChannelSchema = z.enum(['telegram', 'slack', 'discord', 'whatsapp']);

const notificationsConfigSchema = z.object({
  enabled: z.boolean(),
  channel: notificationChannelSchema,
  approvalTimeoutMs: z.number().int().positive(),
  notifyOnBlocked: z.boolean(),
  telegram: z.object({
    botToken: z.string().min(1),
    chatId: z.string().min(1),
  }).optional(),
  slack: z.object({
    webhookUrl: z.string().url(),
    signingSecret: z.string().optional(),
  }).optional(),
  discord: z.object({
    botToken: z.string().min(1),
    channelId: z.string().min(1),
    applicationId: z.string().min(1),
  }).optional(),
  whatsapp: z.object({
    phoneNumberId: z.string().min(1),
    accessToken: z.string().min(1),
    recipientPhone: z.string().min(1),
  }).optional(),
});

const llmProviderNameSchema = z.enum(['anthropic', 'openai', 'google', 'local']);

const llmConfigSchema = z.object({
  defaultProvider: llmProviderNameSchema,
  defaultModel: z.string().min(1),
  fallbackChain: z.array(llmProviderNameSchema),
  maxRetries: z.number().int().min(0),
  providers: z.object({
    anthropic: z.object({
      apiKey: z.string().min(1),
      baseUrl: z.string().optional(),
    }).optional(),
    openai: z.object({
      apiKey: z.string().min(1),
      baseUrl: z.string().optional(),
      organization: z.string().optional(),
    }).optional(),
    google: z.object({
      apiKey: z.string().min(1),
    }).optional(),
    local: z.object({
      baseUrl: z.string().min(1),
      model: z.string().optional(),
    }).optional(),
  }),
});

const embeddingProviderSchema = z.enum(['openai', 'tfidf']);

const memoryConfigSchema = z.object({
  enabled: z.boolean(),
  provider: embeddingProviderSchema,
  openaiApiKey: z.string().optional(),
  openaiModel: z.string().optional(),
  embeddingDimension: z.number().int().positive(),
  dbPath: z.string().min(1),
  sessionDir: z.string().min(1),
  maxChunkSize: z.number().int().positive(),
  chunkOverlap: z.number().int().min(0),
  searchTopK: z.number().int().positive(),
  hybridAlpha: z.number().min(0).max(1),
  deduplicationThreshold: z.number().min(0).max(1),
});

const allowedSendersSchema = z.object({
  whatsapp: z.array(z.string()),
  telegram: z.array(z.string()),
  discord: z.array(z.string()),
  slack: z.array(z.string()),
});

const channelsConfigSchema = z.object({
  whatsapp: z.object({
    enabled: z.boolean(),
    sessionPath: z.string().min(1),
  }).optional(),
  telegram: z.object({
    enabled: z.boolean(),
    botToken: z.string().min(1),
  }).optional(),
  discord: z.object({
    enabled: z.boolean(),
    botToken: z.string().min(1),
    guildId: z.string().optional(),
  }).optional(),
  slack: z.object({
    enabled: z.boolean(),
    botToken: z.string().min(1),
    appToken: z.string().min(1),
    signingSecret: z.string().min(1),
  }).optional(),
  allowedSenders: allowedSendersSchema,
});

const sessionConfigSchema = z.object({
  maxMessages: z.number().int().positive(),
  contextWindow: z.number().int().positive(),
  pruningStrategy: z.enum(['sliding_window', 'summarize', 'none']),
  storePath: z.string().min(1),
});

export const pawnButlerConfigSchema = z.object({
  agents: z.array(agentConfigSchema).min(1),
  safety: safetyConfigSchema,
  urlAllowlist: z.array(z.string()),
  urlBlocklist: z.array(z.string()),
  secretVault: vaultConfigSchema,
  auditLog: auditLogConfigSchema,
  sandbox: sandboxConfigSchema,
  notifications: notificationsConfigSchema.optional(),
  memory: memoryConfigSchema.optional(),
  llm: llmConfigSchema.optional(),
  channels: channelsConfigSchema.optional(),
  sessions: sessionConfigSchema.optional(),
});

export type ValidatedConfig = z.infer<typeof pawnButlerConfigSchema>;

export function validateConfig(data: unknown): {
  success: boolean;
  data?: ValidatedConfig;
  errors?: string[];
} {
  const result = pawnButlerConfigSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const errors = result.error.issues.map(
    (issue) => `${issue.path.join('.')}: ${issue.message}`
  );
  return { success: false, errors };
}
