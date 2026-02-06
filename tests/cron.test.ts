import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Scheduler } from '../src/cron/scheduler.js';
import { CronStore } from '../src/cron/cron-store.js';
import type { CronJob, CronConfig } from '../src/cron/types.js';
import { DEFAULT_CRON_CONFIG } from '../src/cron/types.js';
import {
  cronAddTool,
  cronListTool,
  cronRemoveTool,
  cronStatusTool,
  cronTools,
  setScheduler,
} from '../src/tools/cron-tool.js';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// -------------------------------------------------------
// CronConfig Defaults
// -------------------------------------------------------
describe('CronConfig defaults', () => {
  it('should have sane default config', () => {
    expect(DEFAULT_CRON_CONFIG.enabled).toBe(true);
    expect(DEFAULT_CRON_CONFIG.maxJobs).toBe(50);
    expect(DEFAULT_CRON_CONFIG.notifyBeforeRun).toBe(true);
    expect(DEFAULT_CRON_CONFIG.storePath).toContain('cron-jobs.json');
  });
});

// -------------------------------------------------------
// CronStore Tests
// -------------------------------------------------------
describe('CronStore', () => {
  const testDir = join(tmpdir(), 'pawnbutler-cron-test-' + Date.now());
  const storePath = join(testDir, 'test-jobs.json');
  let store: CronStore;

  function makeJob(overrides: Partial<CronJob> = {}): CronJob {
    return {
      id: 'test-job-1',
      name: 'Test Job',
      schedule: '*/5 * * * *',
      taskDescription: 'Run test task',
      targetAgent: 'butler',
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastRunAt: null,
      lastRunResult: null,
      runCount: 0,
      oneShot: false,
      ...overrides,
    };
  }

  beforeEach(async () => {
    store = new CronStore(storePath);
  });

  afterEach(async () => {
    try { await unlink(storePath); } catch { /* ignore */ }
  });

  it('should load empty when file does not exist', async () => {
    await store.load();
    expect(store.getAll()).toHaveLength(0);
    expect(store.count()).toBe(0);
  });

  it('should throw if not loaded', () => {
    expect(() => store.getAll()).toThrow('not loaded');
    expect(() => store.get('x')).toThrow('not loaded');
    expect(() => store.count()).toThrow('not loaded');
  });

  it('should add and retrieve a job', async () => {
    await store.load();
    const job = makeJob();
    await store.add(job);
    expect(store.count()).toBe(1);
    expect(store.get('test-job-1')).toBeDefined();
    expect(store.get('test-job-1')!.name).toBe('Test Job');
  });

  it('should reject duplicate job IDs', async () => {
    await store.load();
    await store.add(makeJob());
    await expect(store.add(makeJob())).rejects.toThrow('already exists');
  });

  it('should update a job', async () => {
    await store.load();
    await store.add(makeJob());
    const updated = await store.update('test-job-1', { name: 'Updated' });
    expect(updated.name).toBe('Updated');
    expect(store.get('test-job-1')!.name).toBe('Updated');
  });

  it('should throw when updating non-existent job', async () => {
    await store.load();
    await expect(store.update('nonexistent', { name: 'X' })).rejects.toThrow('not found');
  });

  it('should remove a job', async () => {
    await store.load();
    await store.add(makeJob());
    expect(await store.remove('test-job-1')).toBe(true);
    expect(store.count()).toBe(0);
  });

  it('should return false when removing non-existent job', async () => {
    await store.load();
    expect(await store.remove('nonexistent')).toBe(false);
  });

  it('should persist and reload jobs', async () => {
    await store.load();
    await store.add(makeJob({ id: 'a', name: 'Job A' }));
    await store.add(makeJob({ id: 'b', name: 'Job B' }));

    // Reload from file
    const store2 = new CronStore(storePath);
    await store2.load();
    expect(store2.count()).toBe(2);
    expect(store2.get('a')!.name).toBe('Job A');
    expect(store2.get('b')!.name).toBe('Job B');
  });
});

// -------------------------------------------------------
// Scheduler Tests
// -------------------------------------------------------
describe('Scheduler', () => {
  const testDir = join(tmpdir(), 'pawnbutler-sched-test-' + Date.now());
  const storePath = join(testDir, 'sched-jobs.json');

  function createScheduler(): Scheduler {
    return new Scheduler({ storePath, maxJobs: 5, notifyBeforeRun: false });
  }

  afterEach(async () => {
    try { await unlink(storePath); } catch { /* ignore */ }
  });

  it('should start and stop without errors', async () => {
    const sched = createScheduler();
    await sched.start();
    expect(sched.listJobs()).toHaveLength(0);
    await sched.stop();
  });

  it('should add a job', async () => {
    const sched = createScheduler();
    await sched.start();

    const job = await sched.addJob({
      name: 'Test',
      schedule: '*/5 * * * *',
      taskDescription: 'Do something',
      targetAgent: 'butler',
    });

    expect(job.id).toBeDefined();
    expect(job.name).toBe('Test');
    expect(job.schedule).toBe('*/5 * * * *');
    expect(job.enabled).toBe(true);
    expect(sched.listJobs()).toHaveLength(1);

    await sched.stop();
  });

  it('should reject invalid cron expressions', async () => {
    const sched = createScheduler();
    await sched.start();

    await expect(
      sched.addJob({
        name: 'Bad',
        schedule: 'invalid-cron-expr',
        taskDescription: 'Test',
        targetAgent: 'butler',
      }),
    ).rejects.toThrow('Invalid cron schedule');

    await sched.stop();
  });

  it('should throw if not started', async () => {
    const sched = createScheduler();
    await expect(
      sched.addJob({
        name: 'Test',
        schedule: '*/5 * * * *',
        taskDescription: 'Do something',
        targetAgent: 'butler',
      }),
    ).rejects.toThrow('not started');
  });

  it('should enforce max job limit', async () => {
    const sched = createScheduler(); // maxJobs = 5
    await sched.start();

    for (let i = 0; i < 5; i++) {
      await sched.addJob({
        name: `Job ${i}`,
        schedule: '*/5 * * * *',
        taskDescription: `Task ${i}`,
        targetAgent: 'butler',
      });
    }

    await expect(
      sched.addJob({
        name: 'Over limit',
        schedule: '*/5 * * * *',
        taskDescription: 'Task over',
        targetAgent: 'butler',
      }),
    ).rejects.toThrow('Maximum job limit');

    await sched.stop();
  });

  it('should remove a job', async () => {
    const sched = createScheduler();
    await sched.start();

    const job = await sched.addJob({
      name: 'Removable',
      schedule: '*/5 * * * *',
      taskDescription: 'Temp',
      targetAgent: 'butler',
    });

    expect(sched.listJobs()).toHaveLength(1);
    const removed = await sched.removeJob(job.id);
    expect(removed).toBe(true);
    expect(sched.listJobs()).toHaveLength(0);

    await sched.stop();
  });

  it('should update a job', async () => {
    const sched = createScheduler();
    await sched.start();

    const job = await sched.addJob({
      name: 'Original',
      schedule: '*/5 * * * *',
      taskDescription: 'Original task',
      targetAgent: 'butler',
    });

    const updated = await sched.updateJob(job.id, { name: 'Updated' });
    expect(updated.name).toBe('Updated');

    await sched.stop();
  });

  it('should get a specific job', async () => {
    const sched = createScheduler();
    await sched.start();

    const job = await sched.addJob({
      name: 'Specific',
      schedule: '*/5 * * * *',
      taskDescription: 'Find me',
      targetAgent: 'butler',
    });

    expect(sched.getJob(job.id)?.name).toBe('Specific');
    expect(sched.getJob('nonexistent')).toBeUndefined();

    await sched.stop();
  });

  it('should execute job handler on cron fire', async () => {
    const sched = createScheduler();
    const handler = vi.fn().mockResolvedValue({ success: true });
    sched.onJobExecute(handler);
    await sched.start();

    // Use a per-second cron to fire quickly
    const job = await sched.addJob({
      name: 'Quick',
      schedule: '* * * * * *', // every second (croner supports seconds)
      taskDescription: 'Quick task',
      targetAgent: 'butler',
    });

    // Wait for cron to fire
    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect(handler).toHaveBeenCalled();
    const logs = sched.getExecutionLogs();
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].result).toBe('success');
    expect(logs[0].jobName).toBe('Quick');

    await sched.stop();
  });

  it('should log errors from job handler', async () => {
    const sched = createScheduler();
    const handler = vi.fn().mockRejectedValue(new Error('Handler failed'));
    sched.onJobExecute(handler);
    await sched.start();

    await sched.addJob({
      name: 'Failing',
      schedule: '* * * * * *',
      taskDescription: 'Will fail',
      targetAgent: 'butler',
    });

    await new Promise((resolve) => setTimeout(resolve, 1500));

    const logs = sched.getExecutionLogs();
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].result).toBe('error');
    expect(logs[0].error).toContain('Handler failed');

    await sched.stop();
  });

  it('should notify before running if configured', async () => {
    const sched = new Scheduler({
      storePath,
      maxJobs: 5,
      notifyBeforeRun: true,
    });

    const notifyHandler = vi.fn().mockResolvedValue(undefined);
    const jobHandler = vi.fn().mockResolvedValue({ success: true });

    sched.onNotify(notifyHandler);
    sched.onJobExecute(jobHandler);
    await sched.start();

    await sched.addJob({
      name: 'Notified',
      schedule: '* * * * * *',
      taskDescription: 'Notify test',
      targetAgent: 'butler',
    });

    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect(notifyHandler).toHaveBeenCalled();
    const [, message] = notifyHandler.mock.calls[0];
    expect(message).toContain('Notified');
    expect(message).toContain('about to run');

    await sched.stop();
  });

  it('should handle one-shot jobs', async () => {
    const sched = createScheduler();
    const handler = vi.fn().mockResolvedValue({ success: true });
    sched.onJobExecute(handler);
    await sched.start();

    const job = await sched.addJob({
      name: 'OneShot',
      schedule: '* * * * * *',
      taskDescription: 'Run once',
      targetAgent: 'butler',
      oneShot: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect(handler).toHaveBeenCalled();
    // One-shot should be removed after execution
    expect(sched.getJob(job.id)).toBeUndefined();

    await sched.stop();
  });
});

// -------------------------------------------------------
// Cron Tool Definitions
// -------------------------------------------------------
describe('Cron Tool Definitions', () => {
  it('should export 4 cron tools', () => {
    expect(cronTools).toHaveLength(4);
  });

  it('cron_add should have correct properties', () => {
    expect(cronAddTool.name).toBe('cron_add');
    expect(cronAddTool.safetyLevel).toBe('moderate');
    expect(cronAddTool.requiredRole).toEqual(['butler']);
  });

  it('cron_list should have correct properties', () => {
    expect(cronListTool.name).toBe('cron_list');
    expect(cronListTool.safetyLevel).toBe('safe');
    expect(cronListTool.requiredRole).toEqual(['butler']);
  });

  it('cron_remove should have correct properties', () => {
    expect(cronRemoveTool.name).toBe('cron_remove');
    expect(cronRemoveTool.safetyLevel).toBe('moderate');
    expect(cronRemoveTool.requiredRole).toEqual(['butler']);
  });

  it('cron_status should have correct properties', () => {
    expect(cronStatusTool.name).toBe('cron_status');
    expect(cronStatusTool.safetyLevel).toBe('safe');
    expect(cronStatusTool.requiredRole).toEqual(['butler']);
  });
});

// -------------------------------------------------------
// Cron Tool Param Validation
// -------------------------------------------------------
describe('Cron Tool Param Validation', () => {
  it('cron_add rejects missing name', () => {
    const result = cronAddTool.validateParams!({
      schedule: '*/5 * * * *',
      taskDescription: 'Test',
      targetAgent: 'butler',
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('name');
  });

  it('cron_add rejects missing schedule', () => {
    const result = cronAddTool.validateParams!({
      name: 'Test',
      taskDescription: 'Test',
      targetAgent: 'butler',
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('schedule');
  });

  it('cron_add rejects missing taskDescription', () => {
    const result = cronAddTool.validateParams!({
      name: 'Test',
      schedule: '*/5 * * * *',
      targetAgent: 'butler',
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('taskDescription');
  });

  it('cron_add rejects missing targetAgent', () => {
    const result = cronAddTool.validateParams!({
      name: 'Test',
      schedule: '*/5 * * * *',
      taskDescription: 'Test',
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('targetAgent');
  });

  it('cron_add accepts valid params', () => {
    const result = cronAddTool.validateParams!({
      name: 'Test',
      schedule: '*/5 * * * *',
      taskDescription: 'Test task',
      targetAgent: 'butler',
    });
    expect(result.valid).toBe(true);
  });

  it('cron_list accepts empty params', () => {
    const result = cronListTool.validateParams!({});
    expect(result.valid).toBe(true);
  });

  it('cron_remove rejects missing id', () => {
    const result = cronRemoveTool.validateParams!({});
    expect(result.valid).toBe(false);
    expect(result.error).toContain('id');
  });

  it('cron_remove accepts valid id', () => {
    const result = cronRemoveTool.validateParams!({ id: 'some-id' });
    expect(result.valid).toBe(true);
  });

  it('cron_status rejects missing id', () => {
    const result = cronStatusTool.validateParams!({});
    expect(result.valid).toBe(false);
    expect(result.error).toContain('id');
  });

  it('cron_status accepts valid id', () => {
    const result = cronStatusTool.validateParams!({ id: 'some-id' });
    expect(result.valid).toBe(true);
  });
});

// -------------------------------------------------------
// setScheduler utility
// -------------------------------------------------------
describe('setScheduler', () => {
  afterEach(() => {
    setScheduler(null);
  });

  it('should allow setting a custom scheduler', () => {
    const sched = new Scheduler();
    setScheduler(sched);
    // No error thrown means success
  });

  it('should allow resetting to null', () => {
    setScheduler(null);
    // No error thrown means success
  });
});
