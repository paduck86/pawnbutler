// Session Manager - Create, load, save, and manage agent conversation sessions

import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import type { Session, SessionConfig, SessionMessage, SessionStatus } from './types.js';
import type { LLMMessage } from '../llm/types.js';

export class SessionManager {
  private sessions = new Map<string, Session>();
  private config: SessionConfig;

  constructor(config: SessionConfig) {
    this.config = config;
  }

  createSession(agentId: string, metadata?: Record<string, unknown>): Session {
    const now = Date.now();
    const session: Session = {
      id: uuidv4(),
      agentId,
      messages: [],
      createdAt: now,
      updatedAt: now,
      status: 'active',
      metadata,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  getActiveSession(agentId: string): Session | undefined {
    for (const session of this.sessions.values()) {
      if (session.agentId === agentId && session.status === 'active') {
        return session;
      }
    }
    return undefined;
  }

  addMessage(sessionId: string, message: SessionMessage): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    session.messages.push(message);
    session.updatedAt = Date.now();
  }

  updateStatus(sessionId: string, status: SessionStatus): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    session.status = status;
    session.updatedAt = Date.now();
  }

  /** Convert session messages to LLMMessage format for provider use */
  toLLMMessages(sessionId: string): LLMMessage[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    return session.messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
      toolCalls: msg.toolCalls,
      toolResult: msg.toolResult,
    }));
  }

  /** Save a session to disk as JSONL */
  async saveSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const dir = this.config.storePath;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const filePath = path.join(dir, `${sessionId}.jsonl`);
    const lines = session.messages.map((m) => JSON.stringify(m));
    // Write header line with session metadata
    const header = JSON.stringify({
      _type: 'session_header',
      id: session.id,
      agentId: session.agentId,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      status: session.status,
      metadata: session.metadata,
    });

    fs.writeFileSync(filePath, [header, ...lines].join('\n') + '\n');
  }

  /** Load a session from disk */
  async loadSession(sessionId: string): Promise<Session | null> {
    const filePath = path.join(this.config.storePath, `${sessionId}.jsonl`);
    if (!fs.existsSync(filePath)) return null;

    const content = fs.readFileSync(filePath, 'utf-8');
    const rawLines = content.trim().split('\n').filter(Boolean);
    if (rawLines.length === 0) return null;

    const header = JSON.parse(rawLines[0]);
    if (header._type !== 'session_header') return null;

    const messages: SessionMessage[] = rawLines.slice(1).map((line) => JSON.parse(line));

    const session: Session = {
      id: header.id,
      agentId: header.agentId,
      messages,
      createdAt: header.createdAt,
      updatedAt: header.updatedAt,
      status: header.status,
      metadata: header.metadata,
    };

    this.sessions.set(session.id, session);
    return session;
  }

  /** List all saved session IDs from disk */
  listSavedSessions(): string[] {
    if (!fs.existsSync(this.config.storePath)) return [];

    return fs.readdirSync(this.config.storePath)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => f.replace('.jsonl', ''));
  }

  getSessionCount(): number {
    return this.sessions.size;
  }

  deleteSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  getConfig(): SessionConfig {
    return this.config;
  }
}
