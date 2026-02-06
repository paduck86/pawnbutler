// PawnButler File Operations Implementation - read, write, edit with security

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, dirname, isAbsolute } from 'node:path';
import { SecretVault } from '../safety/secret-vault.js';
import { toolEvents } from './tool-events.js';

export interface FileReadResult {
  path: string;
  content: string;
  size: number;
}

export interface FileWriteResult {
  path: string;
  written: boolean;
  size: number;
  secretsMasked: boolean;
}

export interface FileEditResult {
  path: string;
  edited: boolean;
  changesApplied: number;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB read limit

/**
 * Validate that a file path is within the allowed workspace.
 * Blocks path traversal attacks (../../).
 */
export function validatePath(
  filePath: string,
  workspaceRoot?: string,
): { valid: boolean; resolved: string; error?: string } {
  const root = workspaceRoot ?? process.cwd();
  const absoluteRoot = resolve(root);

  // Block explicit traversal patterns first
  if (filePath.includes('..')) {
    return {
      valid: false,
      resolved: '',
      error: `Path traversal detected in "${filePath}"`,
    };
  }

  // Resolve the path
  let resolved: string;
  if (isAbsolute(filePath)) {
    resolved = normalize(filePath);
  } else {
    resolved = resolve(absoluteRoot, filePath);
  }

  resolved = normalize(resolved);

  // Check that resolved path is within workspace
  if (!resolved.startsWith(absoluteRoot)) {
    return {
      valid: false,
      resolved,
      error: `Path "${filePath}" resolves outside workspace root "${absoluteRoot}"`,
    };
  }

  return { valid: true, resolved };
}

/**
 * Read a file with path validation and size limits.
 */
export async function executeReadFile(
  path: string,
  workspaceRoot?: string,
): Promise<FileReadResult> {
  const start = Date.now();
  toolEvents.emitStart('read_file', { path });

  try {
    const validation = validatePath(path, workspaceRoot);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const content = await readFile(validation.resolved, 'utf-8');

    if (content.length > MAX_FILE_SIZE) {
      throw new Error(`File too large: ${content.length} bytes exceeds ${MAX_FILE_SIZE} byte limit`);
    }

    const result: FileReadResult = {
      path: validation.resolved,
      content,
      size: content.length,
    };

    toolEvents.emitComplete('read_file', {
      path: validation.resolved,
      size: content.length,
    }, Date.now() - start);

    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    toolEvents.emitError('read_file', error, Date.now() - start);
    throw err;
  }
}

/**
 * Write a file with path validation and secret scanning.
 */
export async function executeWriteFile(
  path: string,
  content: string,
  vault?: SecretVault,
  workspaceRoot?: string,
): Promise<FileWriteResult> {
  const start = Date.now();
  toolEvents.emitStart('write_file', { path, contentLength: content.length });

  try {
    const validation = validatePath(path, workspaceRoot);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // Scan for secrets and mask them
    let finalContent = content;
    let secretsMasked = false;
    if (vault) {
      const masked = vault.mask(content);
      if (masked !== content) {
        secretsMasked = true;
        finalContent = masked;
      }
    }

    // Ensure directory exists
    await mkdir(dirname(validation.resolved), { recursive: true });

    await writeFile(validation.resolved, finalContent, 'utf-8');

    const result: FileWriteResult = {
      path: validation.resolved,
      written: true,
      size: finalContent.length,
      secretsMasked,
    };

    toolEvents.emitComplete('write_file', {
      path: validation.resolved,
      size: finalContent.length,
      secretsMasked,
    }, Date.now() - start);

    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    toolEvents.emitError('write_file', error, Date.now() - start);
    throw err;
  }
}

/**
 * Edit a file by replacing old_string with new_string, line by line.
 */
export async function executeEditFile(
  path: string,
  edits: Array<{ old_string: string; new_string: string }>,
  workspaceRoot?: string,
): Promise<FileEditResult> {
  const start = Date.now();
  toolEvents.emitStart('edit_file', { path, editCount: edits.length });

  try {
    const validation = validatePath(path, workspaceRoot);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    let content = await readFile(validation.resolved, 'utf-8');
    let changesApplied = 0;

    for (const edit of edits) {
      if (content.includes(edit.old_string)) {
        content = content.replace(edit.old_string, edit.new_string);
        changesApplied++;
      }
    }

    if (changesApplied > 0) {
      await writeFile(validation.resolved, content, 'utf-8');
    }

    const result: FileEditResult = {
      path: validation.resolved,
      edited: changesApplied > 0,
      changesApplied,
    };

    toolEvents.emitComplete('edit_file', {
      path: validation.resolved,
      changesApplied,
    }, Date.now() - start);

    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    toolEvents.emitError('edit_file', error, Date.now() - start);
    throw err;
  }
}
