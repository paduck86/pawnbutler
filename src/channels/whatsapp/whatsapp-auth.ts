// PawnButler WhatsApp Auth - Session file management for Baileys

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface WhatsAppSession {
  creds: unknown;
  keys: Record<string, unknown>;
}

export class WhatsAppAuthManager {
  private sessionPath: string;

  constructor(sessionPath: string) {
    this.sessionPath = sessionPath;
  }

  loadSession(): WhatsAppSession | null {
    if (!existsSync(this.sessionPath)) return null;

    try {
      const data = readFileSync(this.sessionPath, 'utf-8');
      return JSON.parse(data) as WhatsAppSession;
    } catch {
      return null;
    }
  }

  saveSession(session: WhatsAppSession): void {
    const dir = dirname(this.sessionPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.sessionPath, JSON.stringify(session, null, 2), 'utf-8');
  }

  deleteSession(): void {
    if (existsSync(this.sessionPath)) {
      writeFileSync(this.sessionPath, '', 'utf-8');
    }
  }

  hasSession(): boolean {
    return existsSync(this.sessionPath);
  }

  getSessionPath(): string {
    return this.sessionPath;
  }
}
