// PawnButler Cron Scheduling Types

export interface CronJob {
  id: string;
  name: string;
  schedule: string;
  taskDescription: string;
  targetAgent: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastRunAt: number | null;
  lastRunResult: 'success' | 'error' | null;
  runCount: number;
  oneShot: boolean;
}

export interface CronConfig {
  enabled: boolean;
  maxJobs: number;
  storePath: string;
  notifyBeforeRun: boolean;
}

export const DEFAULT_CRON_CONFIG: CronConfig = {
  enabled: true,
  maxJobs: 50,
  storePath: '.pawnbutler/cron-jobs.json',
  notifyBeforeRun: true,
};

export interface CronExecutionLog {
  jobId: string;
  jobName: string;
  timestamp: number;
  targetAgent: string;
  taskDescription: string;
  result: 'success' | 'error';
  error?: string;
  durationMs: number;
}
