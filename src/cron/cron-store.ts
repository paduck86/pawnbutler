// PawnButler Cron Store - JSON file storage for cron jobs

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { CronJob } from './types.js';

export class CronStore {
  private storePath: string;
  private jobs: Map<string, CronJob> = new Map();
  private loaded = false;

  constructor(storePath: string) {
    this.storePath = storePath;
  }

  async load(): Promise<void> {
    try {
      const data = await readFile(this.storePath, 'utf-8');
      const parsed = JSON.parse(data) as CronJob[];
      this.jobs.clear();
      for (const job of parsed) {
        this.jobs.set(job.id, job);
      }
    } catch {
      // File doesn't exist yet, start empty
      this.jobs.clear();
    }
    this.loaded = true;
  }

  async save(): Promise<void> {
    const dir = dirname(this.storePath);
    await mkdir(dir, { recursive: true });
    const data = JSON.stringify([...this.jobs.values()], null, 2);
    await writeFile(this.storePath, data, 'utf-8');
  }

  private ensureLoaded(): void {
    if (!this.loaded) {
      throw new Error('CronStore not loaded. Call load() first.');
    }
  }

  getAll(): CronJob[] {
    this.ensureLoaded();
    return [...this.jobs.values()];
  }

  get(id: string): CronJob | undefined {
    this.ensureLoaded();
    return this.jobs.get(id);
  }

  async add(job: CronJob): Promise<void> {
    this.ensureLoaded();
    if (this.jobs.has(job.id)) {
      throw new Error(`Job "${job.id}" already exists`);
    }
    this.jobs.set(job.id, job);
    await this.save();
  }

  async update(id: string, updates: Partial<CronJob>): Promise<CronJob> {
    this.ensureLoaded();
    const existing = this.jobs.get(id);
    if (!existing) {
      throw new Error(`Job "${id}" not found`);
    }
    const updated = { ...existing, ...updates, id, updatedAt: Date.now() };
    this.jobs.set(id, updated);
    await this.save();
    return updated;
  }

  async remove(id: string): Promise<boolean> {
    this.ensureLoaded();
    const existed = this.jobs.delete(id);
    if (existed) {
      await this.save();
    }
    return existed;
  }

  count(): number {
    this.ensureLoaded();
    return this.jobs.size;
  }
}
