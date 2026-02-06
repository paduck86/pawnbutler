// PawnButler Cron Tools - Agent-facing cron scheduling tools

import type { ToolDefinition } from './tool-registry.js';
import { Scheduler } from '../cron/scheduler.js';
import type { CronConfig } from '../cron/types.js';

let _scheduler: Scheduler | null = null;

/**
 * Get or create the shared Scheduler instance.
 */
export function getScheduler(config?: Partial<CronConfig>): Scheduler {
  if (!_scheduler) {
    _scheduler = new Scheduler(config);
  }
  return _scheduler;
}

/**
 * Set a custom Scheduler (useful for testing).
 */
export function setScheduler(scheduler: Scheduler | null): void {
  _scheduler = scheduler;
}

export const cronAddTool: ToolDefinition = {
  name: 'cron_add',
  description: 'Schedule a recurring or one-shot task. Butler only.',
  safetyLevel: 'moderate',
  requiredRole: ['butler'],
  validateParams: (params) => {
    if (!params.name || typeof params.name !== 'string') {
      return { valid: false, error: 'Parameter "name" is required and must be a string' };
    }
    if (!params.schedule || typeof params.schedule !== 'string') {
      return { valid: false, error: 'Parameter "schedule" is required and must be a string' };
    }
    if (!params.taskDescription || typeof params.taskDescription !== 'string') {
      return { valid: false, error: 'Parameter "taskDescription" is required and must be a string' };
    }
    if (!params.targetAgent || typeof params.targetAgent !== 'string') {
      return { valid: false, error: 'Parameter "targetAgent" is required and must be a string' };
    }
    return { valid: true };
  },
  execute: async (params) => {
    const scheduler = getScheduler();
    return scheduler.addJob({
      name: params.name as string,
      schedule: params.schedule as string,
      taskDescription: params.taskDescription as string,
      targetAgent: params.targetAgent as string,
      oneShot: (params.oneShot as boolean) ?? false,
    });
  },
};

export const cronListTool: ToolDefinition = {
  name: 'cron_list',
  description: 'List all scheduled cron jobs. Butler only.',
  safetyLevel: 'safe',
  requiredRole: ['butler'],
  validateParams: () => ({ valid: true }),
  execute: async () => {
    const scheduler = getScheduler();
    return { jobs: scheduler.listJobs() };
  },
};

export const cronRemoveTool: ToolDefinition = {
  name: 'cron_remove',
  description: 'Remove a scheduled cron job by ID. Butler only.',
  safetyLevel: 'moderate',
  requiredRole: ['butler'],
  validateParams: (params) => {
    if (!params.id || typeof params.id !== 'string') {
      return { valid: false, error: 'Parameter "id" is required and must be a string' };
    }
    return { valid: true };
  },
  execute: async (params) => {
    const scheduler = getScheduler();
    const removed = await scheduler.removeJob(params.id as string);
    return { id: params.id, removed };
  },
};

export const cronStatusTool: ToolDefinition = {
  name: 'cron_status',
  description: 'Get status and execution logs for a specific cron job. Butler only.',
  safetyLevel: 'safe',
  requiredRole: ['butler'],
  validateParams: (params) => {
    if (!params.id || typeof params.id !== 'string') {
      return { valid: false, error: 'Parameter "id" is required and must be a string' };
    }
    return { valid: true };
  },
  execute: async (params) => {
    const scheduler = getScheduler();
    const job = scheduler.getJob(params.id as string);
    if (!job) {
      return { found: false, id: params.id };
    }
    const logs = scheduler.getExecutionLogs().filter(
      (log) => log.jobId === params.id,
    );
    return { found: true, job, executionLogs: logs };
  },
};

/**
 * All cron tool definitions.
 */
export const cronTools: ToolDefinition[] = [
  cronAddTool,
  cronListTool,
  cronRemoveTool,
  cronStatusTool,
];
