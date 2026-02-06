// PawnButler Memory Manager
// Semantic search, keyword search, hybrid search, chunking, deduplication

import { EventEmitter } from 'node:events';
import { v4 as uuidv4 } from 'uuid';
import type {
  MemoryConfig,
  MemoryEntry,
  MemoryMetadata,
  MemorySearchResult,
  MemoryEvent,
} from './types.js';
import type { EmbeddingEngine } from './embeddings.js';
import { VectorStore, cosineSimilarity } from './vector-store.js';

export class MemoryManager extends EventEmitter {
  private store: VectorStore;
  private engine: EmbeddingEngine;
  private config: MemoryConfig;

  constructor(config: MemoryConfig, engine: EmbeddingEngine) {
    super();
    this.config = config;
    this.engine = engine;
    this.store = new VectorStore(config.dbPath);
  }

  /**
   * Save content to memory with embedding and deduplication.
   */
  async save(
    content: string,
    metadata: MemoryMetadata
  ): Promise<MemoryEntry[]> {
    const chunks = this.chunkContent(content);
    const embeddings = await this.engine.embedBatch(chunks);
    const saved: MemoryEntry[] = [];

    for (let i = 0; i < chunks.length; i++) {
      // Check for duplicates
      if (await this.isDuplicate(embeddings[i])) {
        this.emit('memory', {
          type: 'memory:deduplicated',
          timestamp: Date.now(),
          details: { content: chunks[i].slice(0, 100) },
        } satisfies MemoryEvent);
        continue;
      }

      const now = Date.now();
      const entry: MemoryEntry = {
        id: uuidv4(),
        content: chunks[i],
        embedding: embeddings[i],
        metadata: { ...metadata, tags: metadata.tags ?? [] },
        createdAt: now,
        updatedAt: now,
      };

      this.store.insert(entry);
      saved.push(entry);
    }

    this.emit('memory', {
      type: 'memory:save',
      timestamp: Date.now(),
      details: {
        entriesCount: saved.length,
        chunksTotal: chunks.length,
        source: metadata.source,
      },
    } satisfies MemoryEvent);

    return saved;
  }

  /**
   * Semantic search: embed query then find nearest vectors.
   */
  async semanticSearch(
    query: string,
    topK?: number
  ): Promise<MemorySearchResult[]> {
    const k = topK ?? this.config.searchTopK;
    const queryEmbedding = await this.engine.embed(query);
    const results = this.store.search(queryEmbedding, k);

    const searchResults: MemorySearchResult[] = results.map((r) => ({
      entry: r.entry,
      score: r.similarity,
      matchType: 'semantic' as const,
    }));

    this.emit('memory', {
      type: 'memory:search',
      timestamp: Date.now(),
      details: { query, method: 'semantic', resultsCount: searchResults.length },
    } satisfies MemoryEvent);

    return searchResults;
  }

  /**
   * Keyword search: simple term matching with TF scoring.
   */
  keywordSearch(query: string, topK?: number): MemorySearchResult[] {
    const k = topK ?? this.config.searchTopK;
    const queryTerms = this.tokenize(query);
    if (queryTerms.length === 0) return [];

    const all = this.store.listAll();
    const scored: MemorySearchResult[] = [];

    for (const entry of all) {
      const contentTerms = this.tokenize(entry.content);
      if (contentTerms.length === 0) continue;

      let matchCount = 0;
      for (const qt of queryTerms) {
        for (const ct of contentTerms) {
          if (ct.includes(qt) || qt.includes(ct)) {
            matchCount++;
            break;
          }
        }
      }

      const score = matchCount / queryTerms.length;
      if (score > 0) {
        scored.push({ entry, score, matchType: 'keyword' });
      }
    }

    scored.sort((a, b) => b.score - a.score);

    this.emit('memory', {
      type: 'memory:search',
      timestamp: Date.now(),
      details: { query, method: 'keyword', resultsCount: Math.min(scored.length, k) },
    } satisfies MemoryEvent);

    return scored.slice(0, k);
  }

  /**
   * Hybrid search: combine semantic and keyword scores.
   * alpha=1 is pure semantic, alpha=0 is pure keyword.
   */
  async hybridSearch(
    query: string,
    topK?: number,
    alpha?: number
  ): Promise<MemorySearchResult[]> {
    const k = topK ?? this.config.searchTopK;
    const a = alpha ?? this.config.hybridAlpha;

    // Fetch more candidates from each method then merge
    const semanticResults = await this.semanticSearch(query, k * 2);
    const keywordResults = this.keywordSearch(query, k * 2);

    // Build score map keyed by entry id
    const scores = new Map<string, { entry: MemoryEntry; semantic: number; keyword: number }>();

    for (const r of semanticResults) {
      scores.set(r.entry.id, {
        entry: r.entry,
        semantic: r.score,
        keyword: 0,
      });
    }

    for (const r of keywordResults) {
      const existing = scores.get(r.entry.id);
      if (existing) {
        existing.keyword = r.score;
      } else {
        scores.set(r.entry.id, {
          entry: r.entry,
          semantic: 0,
          keyword: r.score,
        });
      }
    }

    const hybridResults: MemorySearchResult[] = [];
    for (const { entry, semantic, keyword } of scores.values()) {
      const combined = a * semantic + (1 - a) * keyword;
      hybridResults.push({
        entry,
        score: combined,
        matchType: 'hybrid',
      });
    }

    hybridResults.sort((a, b) => b.score - a.score);

    this.emit('memory', {
      type: 'memory:search',
      timestamp: Date.now(),
      details: { query, method: 'hybrid', alpha: a, resultsCount: Math.min(hybridResults.length, k) },
    } satisfies MemoryEvent);

    return hybridResults.slice(0, k);
  }

  /**
   * Delete a memory entry by id.
   */
  delete(id: string): boolean {
    const deleted = this.store.delete(id);
    if (deleted) {
      this.emit('memory', {
        type: 'memory:delete',
        timestamp: Date.now(),
        details: { id },
      } satisfies MemoryEvent);
    }
    return deleted;
  }

  /**
   * Get a memory entry by id.
   */
  get(id: string): MemoryEntry | null {
    return this.store.get(id);
  }

  /**
   * Get total stored memories count.
   */
  count(): number {
    return this.store.count();
  }

  /**
   * Close the underlying store.
   */
  close(): void {
    this.store.close();
  }

  // --- Content-aware chunking ---

  chunkContent(text: string): string[] {
    const maxSize = this.config.maxChunkSize;
    const overlap = this.config.chunkOverlap;

    if (text.length <= maxSize) {
      return [text];
    }

    const chunks: string[] = [];
    // Split on paragraph boundaries first
    const paragraphs = text.split(/\n\n+/);
    let current = '';

    for (const para of paragraphs) {
      if (current.length + para.length + 2 <= maxSize) {
        current = current ? current + '\n\n' + para : para;
      } else {
        if (current) {
          chunks.push(current);
        }
        // If a single paragraph exceeds maxSize, split by sentences
        if (para.length > maxSize) {
          const sentenceChunks = this.splitBySentence(para, maxSize, overlap);
          chunks.push(...sentenceChunks);
          current = '';
        } else {
          // Keep overlap from previous chunk
          if (chunks.length > 0 && overlap > 0) {
            const prev = chunks[chunks.length - 1];
            const overlapText = prev.slice(-overlap);
            current = overlapText + '\n\n' + para;
            if (current.length > maxSize) {
              current = para;
            }
          } else {
            current = para;
          }
        }
      }
    }

    if (current) {
      chunks.push(current);
    }

    return chunks.length > 0 ? chunks : [text];
  }

  private splitBySentence(
    text: string,
    maxSize: number,
    overlap: number
  ): string[] {
    const sentences = text.match(/[^.!?]+[.!?]+\s*/g) ?? [text];
    const chunks: string[] = [];
    let current = '';

    for (const sent of sentences) {
      if (current.length + sent.length <= maxSize) {
        current += sent;
      } else {
        if (current) chunks.push(current.trim());
        if (overlap > 0 && current.length > 0) {
          const overlapText = current.slice(-overlap);
          current = overlapText + sent;
          if (current.length > maxSize) {
            current = sent;
          }
        } else {
          current = sent;
        }
      }
    }

    if (current.trim()) {
      chunks.push(current.trim());
    }

    return chunks;
  }

  // --- Deduplication ---

  private async isDuplicate(embedding: number[]): Promise<boolean> {
    const threshold = this.config.deduplicationThreshold;
    if (threshold >= 1) return false; // disabled

    const results = this.store.search(embedding, 1);
    if (results.length === 0) return false;

    return results[0].similarity >= threshold;
  }

  // --- Tokenization for keyword search ---

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1);
  }
}
