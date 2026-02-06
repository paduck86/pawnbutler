// PawnButler Vector Store - SQLite-backed vector storage with cosine similarity

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { MemoryEntry, MemoryMetadata } from './types.js';

export interface VectorSearchResult {
  entry: MemoryEntry;
  similarity: number;
}

export class VectorStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        embedding BLOB NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at);
    `);
  }

  insert(entry: MemoryEntry): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO memories (id, content, embedding, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      entry.id,
      entry.content,
      this.encodeEmbedding(entry.embedding),
      JSON.stringify(entry.metadata),
      entry.createdAt,
      entry.updatedAt
    );
  }

  insertBatch(entries: MemoryEntry[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO memories (id, content, embedding, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction((items: MemoryEntry[]) => {
      for (const entry of items) {
        stmt.run(
          entry.id,
          entry.content,
          this.encodeEmbedding(entry.embedding),
          JSON.stringify(entry.metadata),
          entry.createdAt,
          entry.updatedAt
        );
      }
    });

    transaction(entries);
  }

  get(id: string): MemoryEntry | null {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as
      | RawRow
      | undefined;
    if (!row) return null;
    return this.rowToEntry(row);
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    return result.changes > 0;
  }

  deleteBatch(ids: string[]): number {
    const placeholders = ids.map(() => '?').join(',');
    const result = this.db
      .prepare(`DELETE FROM memories WHERE id IN (${placeholders})`)
      .run(...ids);
    return result.changes;
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM memories').get() as {
      cnt: number;
    };
    return row.cnt;
  }

  listAll(): MemoryEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM memories ORDER BY created_at DESC')
      .all() as RawRow[];
    return rows.map((r) => this.rowToEntry(r));
  }

  /**
   * Search by cosine similarity against query embedding.
   * Computes similarity for all stored vectors in JS.
   */
  search(queryEmbedding: number[], topK: number): VectorSearchResult[] {
    const rows = this.db.prepare('SELECT * FROM memories').all() as RawRow[];

    const results: VectorSearchResult[] = [];
    for (const row of rows) {
      const embedding = this.decodeEmbedding(row.embedding);
      const similarity = cosineSimilarity(queryEmbedding, embedding);
      results.push({
        entry: this.rowToEntry(row),
        similarity,
      });
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, topK);
  }

  close(): void {
    this.db.close();
  }

  // --- Internal helpers ---

  private encodeEmbedding(embedding: number[]): Buffer {
    const buf = Buffer.alloc(embedding.length * 4);
    for (let i = 0; i < embedding.length; i++) {
      buf.writeFloatLE(embedding[i], i * 4);
    }
    return buf;
  }

  private decodeEmbedding(buf: Buffer): number[] {
    const count = buf.length / 4;
    const result = new Array(count);
    for (let i = 0; i < count; i++) {
      result[i] = buf.readFloatLE(i * 4);
    }
    return result;
  }

  private rowToEntry(row: RawRow): MemoryEntry {
    return {
      id: row.id,
      content: row.content,
      embedding: this.decodeEmbedding(row.embedding),
      metadata: JSON.parse(row.metadata) as MemoryMetadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

interface RawRow {
  id: string;
  content: string;
  embedding: Buffer;
  metadata: string;
  created_at: number;
  updated_at: number;
}

/**
 * Cosine similarity between two vectors.
 * Returns a value in [-1, 1], where 1 means identical direction.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}
