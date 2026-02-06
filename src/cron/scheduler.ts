// PawnButler Cron Scheduler - Job scheduling using croner

import { Cron } from 'croner';
import { v4 as uuidv4 } from 'uuid';
import type { CronJob, CronConfig, CronExecutionLog } from './types.js';
import { DEFAULT_CRON_CONFIG } from './types.js';
import { CronStore } from './cron-store.js';

export type JobHandler = (job: CronJob) => Promise<{ success: boolean; error?: string }>;
export type NotifyHandler = (job: CronJob, message: string) => Promise<void>;

export class Scheduler {
  private config: CronConfig;
  private store: CronStore;
  private runners: Map<string, Cron> = new Map();
  private jobHandler: JobHandler | null = null;
  private notifyHandler: NotifyHandler | null = null;
  private executionLogs: CronExecutionLog[] = [];
  private started = false;

  constructor(config: Partial<CronConfig> = {}) {
    this.config = { ...DEFAULT_CRON_CONFIG, ...config };
    this.store = new CronStore(this.config.storePath);
  }

  /**
   * Set the handler called when a cron job fires.
   * The handler routes the task to the appropriate agent.
   */
  onJobExecute(handler: JobHandler): void {
    this.jobHandler = handler;
  }

  /**
   * Set the handler for user notifications (e.g. "Job X is about to run").
   */
  onNotify(handler: NotifyHandler): void {
    this.notifyHandler = handler;
  }

  async start(): Promise<void> {
    if (this.started) return;
    await this.store.load();

    // Resume all enabled jobs
    for (const job of this.store.getAll()) {
      if (job.enabled) {
        this.scheduleJob(job);
      }
    }
    this.started = true;
  }

  async stop(): Promise<void> {
    for (const [, runner] of this.runners) {
      runner.stop();
    }
    this.runners.clear();
    this.started = false;
  }

  async addJob(params: {
    name: string;
    schedule: string;
    taskDescription: string;
    targetAgent: string;
    oneShot?: boolean;
  }): Promise<CronJob> {
    if (!this.started) {
      throw new Error('Scheduler not started. Call start() first.');
    }

    if (this.store.count() >= this.config.maxJobs) {
      throw new Error(`Maximum job limit reached (${this.config.maxJobs})`);
    }

    // Validate cron expression by trying to parse it
    try {
      new Cron(params.schedule, { maxRuns: 0 });
    } catch (err) {
      throw new Error(
        `Invalid cron schedule "${params.schedule}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const job: CronJob = {
      id: uuidv4(),
      name: params.name,
      schedule: params.schedule,
      taskDescription: params.taskDescription,
      targetAgent: params.targetAgent,
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastRunAt: null,
      lastRunResult: null,
      runCount: 0,
      oneShot: params.oneShot ?? false,
    };

    await this.store.add(job);
    this.scheduleJob(job);

    return job;
  }

  async removeJob(id: string): Promise<boolean> {
    const runner = this.runners.get(id);
    if (runner) {
      runner.stop();
      this.runners.delete(id);
    }
    return this.store.remove(id);
  }

  async updateJob(id: string, updates: Partial<Pick<CronJob, 'name' | 'schedule' | 'taskDescription' | 'targetAgent' | 'enabled'>>): Promise<CronJob> {
    // Stop existing runner
    const existingRunner = this.runners.get(id);
    if (existingRunner) {
      existingRunner.stop();
      this.runners.delete(id);
    }

    const updated = await this.store.update(id, updates);

    // Reschedule if enabled
    if (updated.enabled) {
      this.scheduleJob(updated);
    }

    return updated;
  }

  listJobs(): CronJob[] {
    return this.store.getAll();
  }

  getJob(id: string): CronJob | undefined {
    return this.store.get(id);
  }

  getExecutionLogs(): CronExecutionLog[] {
    return [...this.executionLogs];
  }

  private scheduleJob(job: CronJob): void {
    const maxRuns = job.oneShot ? 1 : undefined;

    const runner = new Cron(job.schedule, { maxRuns }, async () => {
      await this.executeJob(job);
    });

    this.runners.set(job.id, runner);
  }

  private async executeJob(job: CronJob): Promise<void> {
    const startTime = Date.now();

    // Notify user before running if configured
    if (this.config.notifyBeforeRun && this.notifyHandler) {
      await this.notifyHandler(
        job,
        `Cron job "${job.name}" is about to run: ${job.taskDescription}`,
      );
    }

    let result: 'success' | 'error' = 'error';
    let error: string | undefined;

    if (this.jobHandler) {
      try {
        const handlerResult = await this.jobHandler(job);
        result = handlerResult.success ? 'success' : 'error';
        error = handlerResult.error;
      } catch (err) {
        result = 'error';
        error = err instanceof Error ? err.message : String(err);
      }
    } else {
      error = 'No job handler registered';
    }

    const durationMs = Date.now() - startTime;

    // Update job state
    await this.store.update(job.id, {
      lastRunAt: startTime,
      lastRunResult: result,
      runCount: job.runCount + 1,
    });

    // Log execution
    this.executionLogs.push({
      jobId: job.id,
      jobName: job.name,
      timestamp: startTime,
      targetAgent: job.targetAgent,
      taskDescription: job.taskDescription,
      result,
      error,
      durationMs,
    });

    // Remove one-shot jobs after execution
    if (job.oneShot) {
      await this.removeJob(job.id);
    }
  }
}
