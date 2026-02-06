// PawnButler Session Store - JSONL file-based conversation history

import {
  appendFileSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { EventEmitter } from 'node:events';
import type { SessionEntry, SessionHistory, MemoryEvent } from './types.js';

export class SessionStore extends EventEmitter {
  private sessionDir: string;

  constructor(sessionDir: string) {
    super();
    this.sessionDir = sessionDir;
    mkdirSync(this.sessionDir, { recursive: true });
  }

  /**
   * Append an entry to a session's JSONL file.
   */
  append(sessionId: string, entry: SessionEntry): void {
    const filePath = this.sessionPath(sessionId);
    mkdirSync(dirname(filePath), { recursive: true });
    const line = JSON.stringify(entry) + '\n';
    appendFileSync(filePath, line, 'utf-8');

    this.emit('session', {
      type: 'session:save',
      timestamp: Date.now(),
      details: { sessionId, role: entry.role },
    } satisfies MemoryEvent);
  }

  /**
   * Load all entries for a session.
   */
  load(sessionId: string): SessionHistory {
    const filePath = this.sessionPath(sessionId);

    if (!existsSync(filePath)) {
      return {
        sessionId,
        entries: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }

    const content = readFileSync(filePath, 'utf-8');
    const entries: SessionEntry[] = content
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        try {
          return JSON.parse(line) as SessionEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is SessionEntry => e !== null);

    const createdAt = entries.length > 0 ? entries[0].timestamp : Date.now();
    const updatedAt =
      entries.length > 0 ? entries[entries.length - 1].timestamp : Date.now();

    this.emit('session', {
      type: 'session:load',
      timestamp: Date.now(),
      details: { sessionId, entriesCount: entries.length },
    } satisfies MemoryEvent);

    return { sessionId, entries, createdAt, updatedAt };
  }

  /**
   * Save a full session history (overwrites existing).
   */
  save(history: SessionHistory): void {
    const filePath = this.sessionPath(history.sessionId);
    mkdirSync(dirname(filePath), { recursive: true });
    const content = history.entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
    writeFileSync(filePath, content, 'utf-8');

    this.emit('session', {
      type: 'session:save',
      timestamp: Date.now(),
      details: {
        sessionId: history.sessionId,
        entriesCount: history.entries.length,
      },
    } satisfies MemoryEvent);
  }

  /**
   * Check if a session exists.
   */
  exists(sessionId: string): boolean {
    return existsSync(this.sessionPath(sessionId));
  }

  private sessionPath(sessionId: string): string {
    // Sanitize sessionId to prevent path traversal
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.sessionDir, `${safe}.jsonl`);
  }
}
