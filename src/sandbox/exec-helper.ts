// Thin wrapper around child_process.execFile for testability

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFilePromise = promisify(execFile);

export interface ExecOptions {
  timeout?: number;
  maxBuffer?: number;
}

export interface ExecOutput {
  stdout: string;
  stderr: string;
}

export async function runCommand(
  cmd: string,
  args: string[],
  options?: ExecOptions
): Promise<ExecOutput> {
  const { stdout, stderr } = await execFilePromise(cmd, args, options);
  return { stdout, stderr };
}
