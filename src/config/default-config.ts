import type { PawnButlerConfig } from '../core/types.js';

export const DEFAULT_URL_ALLOWLIST: string[] = [
  'google.com',
  'github.com',
  'stackoverflow.com',
  'wikipedia.org',
  'npmjs.com',
  'developer.mozilla.org',
];

export const DEFAULT_URL_BLOCKLIST: string[] = [
  'gambling',
  'casino',
  'betting',
  'toto',
  'adult',
  'porn',
  'darkweb',
  '\\.onion',
];

export const DEFAULT_SECRET_PATTERNS: string[] = [
  'sk-[a-zA-Z0-9]{20,}',
  'AKIA[0-9A-Z]{16}',
  'ghp_[a-zA-Z0-9]{36}',
  'gho_[a-zA-Z0-9]{36}',
  'Bearer\\s+[a-zA-Z0-9\\-._~+/]+=*',
  'xox[bpoas]-[a-zA-Z0-9\\-]+',
  'glpat-[a-zA-Z0-9\\-]{20,}',
  'ya29\\.[a-zA-Z0-9_-]+',
  '[a-zA-Z0-9]{32,}\\.apps\\.googleusercontent\\.com',
  'sk_live_[a-zA-Z0-9]{24,}',
  'rk_live_[a-zA-Z0-9]{24,}',
  'SG\\.[a-zA-Z0-9_-]{22}\\.[a-zA-Z0-9_-]{43}',
];

export const DEFAULT_LLM_CONFIG: PawnButlerConfig['llm'] = {
  defaultProvider: 'anthropic',
  defaultModel: 'claude-sonnet-4-5-20250929',
  fallbackChain: ['openai', 'google', 'local'],
  maxRetries: 2,
  providers: {},
};

export const DEFAULT_SESSION_CONFIG: PawnButlerConfig['sessions'] = {
  maxMessages: 100,
  contextWindow: 128000,
  pruningStrategy: 'sliding_window',
  storePath: '.pawnbutler/sessions',
};

export const DEFAULT_CHANNELS_CONFIG: PawnButlerConfig['channels'] = {
  whatsapp: { enabled: false, sessionPath: '.pawnbutler/whatsapp-session' },
  telegram: { enabled: false, botToken: '' },
  discord: { enabled: false, botToken: '' },
  slack: { enabled: false, botToken: '', appToken: '', signingSecret: '' },
  allowedSenders: {
    whatsapp: [],
    telegram: [],
    discord: [],
    slack: [],
  },
};

export const DEFAULT_MEMORY_CONFIG: PawnButlerConfig['memory'] = {
  enabled: true,
  provider: 'tfidf',
  embeddingDimension: 512,
  dbPath: '.pawnbutler/memory/vectors.db',
  sessionDir: '.pawnbutler/memory/sessions',
  maxChunkSize: 1000,
  chunkOverlap: 100,
  searchTopK: 10,
  hybridAlpha: 0.7,
  deduplicationThreshold: 0.95,
};

export const defaultConfig: PawnButlerConfig = {
  agents: [
    {
      id: 'guardian',
      role: 'guardian',
      name: 'Guardian',
      description: 'Safety monitor that validates all actions before execution',
      allowedTools: [],
      deniedTools: [],
      maxConcurrentActions: 1,
      requirePlanApproval: false,
    },
    {
      id: 'butler',
      role: 'butler',
      name: 'Butler',
      description: 'Primary orchestrator that manages user requests and coordinates agents',
      allowedTools: ['web_search', 'web_fetch', 'read_file'],
      deniedTools: ['signup', 'payment'],
      maxConcurrentActions: 3,
      requirePlanApproval: false,
    },
    {
      id: 'researcher',
      role: 'researcher',
      name: 'Researcher',
      description: 'Gathers information from web and files',
      allowedTools: ['web_search', 'web_fetch', 'read_file'],
      deniedTools: ['write_file', 'exec_command', 'signup', 'payment'],
      maxConcurrentActions: 5,
      requirePlanApproval: true,
    },
    {
      id: 'executor',
      role: 'executor',
      name: 'Executor',
      description: 'Executes approved actions like file writes and commands',
      allowedTools: ['read_file', 'write_file', 'edit_file', 'exec_command'],
      deniedTools: ['signup', 'payment'],
      maxConcurrentActions: 2,
      requirePlanApproval: true,
    },
  ],

  safety: {
    defaultLevel: 'moderate',
    forbiddenActions: ['signup', 'payment'],
    dangerousActions: ['api_call', 'send_message', 'exec_command'],
    secretPatterns: DEFAULT_SECRET_PATTERNS,
  },

  urlAllowlist: DEFAULT_URL_ALLOWLIST,
  urlBlocklist: DEFAULT_URL_BLOCKLIST,

  secretVault: {
    enabled: true,
    storePath: '.pawnbutler/vault',
  },

  auditLog: {
    enabled: true,
    logPath: '.pawnbutler/logs/audit.jsonl',
    alertLogPath: '.pawnbutler/logs/alerts.jsonl',
    retentionDays: 30,
  },

  sandbox: {
    enabled: true,
    image: 'pawnbutler-sandbox:latest',
    networkMode: 'none',
    memoryLimit: '512m',
    cpuLimit: 1,
    timeout: 30_000,
    mountPaths: [],
    allowWriteMount: false,
  },

  memory: DEFAULT_MEMORY_CONFIG,

  llm: DEFAULT_LLM_CONFIG,

  sessions: DEFAULT_SESSION_CONFIG,

  channels: DEFAULT_CHANNELS_CONFIG,
};
