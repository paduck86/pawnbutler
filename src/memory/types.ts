// PawnButler Memory System Types

export type EmbeddingProvider = 'openai' | 'tfidf';

export interface MemoryConfig {
  enabled: boolean;
  provider: EmbeddingProvider;
  openaiApiKey?: string;
  openaiModel?: string;
  embeddingDimension: number;
  dbPath: string;
  sessionDir: string;
  maxChunkSize: number;
  chunkOverlap: number;
  searchTopK: number;
  hybridAlpha: number; // 0 = pure keyword, 1 = pure semantic
  deduplicationThreshold: number; // cosine similarity threshold for dedup
}

export interface MemoryEntry {
  id: string;
  content: string;
  embedding: number[];
  metadata: MemoryMetadata;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryMetadata {
  source: string;
  agentId?: string;
  sessionId?: string;
  tags?: string[];
  type?: 'conversation' | 'fact' | 'task' | 'note';
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;
  matchType: 'semantic' | 'keyword' | 'hybrid';
}

export interface SessionEntry {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  agentId?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionHistory {
  sessionId: string;
  entries: SessionEntry[];
  createdAt: number;
  updatedAt: number;
}

export type MemoryEventType =
  | 'memory:save'
  | 'memory:search'
  | 'memory:delete'
  | 'memory:deduplicated'
  | 'session:save'
  | 'session:load';

export interface MemoryEvent {
  type: MemoryEventType;
  timestamp: number;
  details: Record<string, unknown>;
}
