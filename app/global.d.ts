// Global type declarations for PawnButler Electron app

interface PawnButlerAPI {
  agents: {
    getStatus: () => Promise<unknown[]>;
  };
  audit: {
    query: (filter: Record<string, unknown>) => Promise<unknown[]>;
    getAlerts: (limit?: number) => Promise<unknown[]>;
    getSummary: () => Promise<unknown>;
  };
  approval: {
    list: () => Promise<unknown[]>;
    approve: (id: string) => Promise<{ success: boolean; status?: string; error?: string }>;
    reject: (id: string, reason?: string) => Promise<{ success: boolean; status?: string; error?: string }>;
  };
  config: {
    get: () => Promise<unknown>;
    update: (updates: Record<string, unknown>) => Promise<{ success: boolean }>;
  };
  url: {
    getAllowlist: () => Promise<string[]>;
    getBlocklist: () => Promise<string[]>;
    addAllowed: (domain: string) => Promise<{ success: boolean }>;
    addBlocked: (pattern: string) => Promise<{ success: boolean }>;
  };
  vault: {
    getKeys: () => Promise<string[]>;
  };
  guardian: {
    getStatus: () => Promise<unknown>;
  };
  user: {
    sendRequest: (message: string) => Promise<{ success: boolean; error?: string }>;
  };
  agentMind: {
    getSteps: () => Promise<unknown[]>;
  };
  messages: {
    getAll: () => Promise<unknown[]>;
    approve: (id: string, editedText?: string) => Promise<{ success: boolean }>;
    reject: (id: string, reason?: string) => Promise<{ success: boolean }>;
  };
  memory: {
    list: () => Promise<unknown[]>;
    search: (query: string, method?: string, limit?: number) => Promise<unknown>;
    remove: (id: string) => Promise<{ success: boolean }>;
    getStats: () => Promise<unknown>;
  };
  browser: {
    getState: () => Promise<unknown>;
    getActions: () => Promise<unknown[]>;
    stop: () => Promise<{ success: boolean }>;
  };
  cron: {
    list: () => Promise<unknown[]>;
    add: (job: Record<string, unknown>) => Promise<{ success: boolean }>;
    update: (id: string, updates: Record<string, unknown>) => Promise<{ success: boolean }>;
    remove: (id: string) => Promise<{ success: boolean }>;
  };
  usage: {
    getStats: () => Promise<unknown>;
  };
  on: (channel: string, callback: (...args: unknown[]) => void) => void;
  off: (channel: string, callback: (...args: unknown[]) => void) => void;
}

interface Window {
  pawnbutler: PawnButlerAPI;
}
