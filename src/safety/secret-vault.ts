// PawnButler Secret Vault - Secure secret storage with reference tokens

import type { VaultConfig } from '../core/types.js';

interface VaultEntry {
  key: string;
  value: string;
  addedAt: Date;
}

const VAULT_REF_PREFIX = '$VAULT{';
const VAULT_REF_SUFFIX = '}';
const VAULT_REF_PATTERN = /\$VAULT\{([^}]+)\}/g;

export class SecretVault {
  private secrets: Map<string, VaultEntry>;
  private config: VaultConfig;

  constructor(config: VaultConfig) {
    this.config = config;
    this.secrets = new Map();
  }

  store(key: string, value: string): string {
    this.secrets.set(key, {
      key,
      value,
      addedAt: new Date(),
    });
    return `${VAULT_REF_PREFIX}${key}${VAULT_REF_SUFFIX}`;
  }

  resolve(tokenRef: string): string | null {
    const match = tokenRef.match(/^\$VAULT\{([^}]+)\}$/);
    if (!match) {
      return null;
    }
    const entry = this.secrets.get(match[1]);
    return entry?.value ?? null;
  }

  has(key: string): boolean {
    return this.secrets.has(key);
  }

  remove(key: string): void {
    this.secrets.delete(key);
  }

  listKeys(): string[] {
    return [...this.secrets.keys()];
  }

  loadFromEnv(prefix?: string): void {
    const envPrefix = prefix ?? 'PAWNBUTLER_SECRET_';
    for (const [envKey, envValue] of Object.entries(process.env)) {
      if (envKey.startsWith(envPrefix) && envValue) {
        const secretKey = envKey.slice(envPrefix.length).toLowerCase();
        this.store(secretKey, envValue);
      }
    }
  }

  mask(text: string): string {
    let masked = text;
    for (const entry of this.secrets.values()) {
      if (entry.value && masked.includes(entry.value)) {
        masked = masked.replaceAll(entry.value, '***');
      }
    }
    return masked;
  }
}
