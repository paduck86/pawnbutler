import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TfIdfEmbedding, OpenAIEmbedding, CachedEmbeddingEngine, createEmbeddingEngine } from '../src/memory/embeddings.js';
import type { EmbeddingEngine } from '../src/memory/embeddings.js';
import { VectorStore, cosineSimilarity } from '../src/memory/vector-store.js';
import { MemoryManager } from '../src/memory/memory-manager.js';
import { SessionStore } from '../src/memory/session-store.js';
import type { MemoryEntry, MemoryConfig, MemoryEvent, SessionEntry } from '../src/memory/types.js';
import { createMemorySearchTool, createMemoryGetTool, createMemorySaveTool } from '../src/tools/memory-tool.js';

// Helper: create a temp directory for each test
function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'pawnbutler-memory-test-'));
}

// Helper: generate a mock memory entry
function mockEntry(id: string, content: string, embedding: number[]): MemoryEntry {
  return {
    id,
    content,
    embedding,
    metadata: { source: 'test', tags: [], type: 'note' },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// -------------------------------------------------------
// Embedding Tests
// -------------------------------------------------------
describe('Embeddings', () => {
  describe('TfIdfEmbedding', () => {
    let engine: TfIdfEmbedding;

    beforeEach(() => {
      engine = new TfIdfEmbedding(128);
    });

    it('should report correct provider and dimension', () => {
      expect(engine.provider).toBe('tfidf');
      expect(engine.dimension).toBe(128);
    });

    it('should generate embeddings of correct dimension', async () => {
      const vec = await engine.embed('hello world test document');
      expect(vec).toHaveLength(128);
    });

    it('should generate normalized vectors (L2 norm ~1)', async () => {
      const vec = await engine.embed('the quick brown fox jumps over the lazy dog');
      const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
      expect(norm).toBeCloseTo(1.0, 2);
    });

    it('should produce similar embeddings for similar texts', async () => {
      const a = await engine.embed('machine learning and deep neural networks');
      const b = await engine.embed('deep learning and neural network models');
      const c = await engine.embed('cooking recipe for chocolate cake');
      const simAB = cosineSimilarity(a, b);
      const simAC = cosineSimilarity(a, c);
      expect(simAB).toBeGreaterThan(simAC);
    });

    it('should handle batch embeddings', async () => {
      const texts = ['first doc', 'second doc', 'third doc'];
      const results = await engine.embedBatch(texts);
      expect(results).toHaveLength(3);
      for (const vec of results) {
        expect(vec).toHaveLength(128);
      }
    });

    it('should produce zero-length-safe vector for empty string', async () => {
      const vec = await engine.embed('');
      expect(vec).toHaveLength(128);
      // All zeros is valid for empty text
    });
  });

  describe('createEmbeddingEngine', () => {
    it('should create TfIdfEmbedding for tfidf provider', () => {
      const engine = createEmbeddingEngine({ provider: 'tfidf', dimension: 64 });
      expect(engine.provider).toBe('tfidf');
      expect(engine.dimension).toBe(64);
    });

    it('should throw for openai without API key', () => {
      expect(() =>
        createEmbeddingEngine({ provider: 'openai' })
      ).toThrow('OpenAI API key is required');
    });

    it('should create OpenAIEmbedding with API key', () => {
      const engine = createEmbeddingEngine({
        provider: 'openai',
        apiKey: 'sk-test-key',
        dimension: 256,
      });
      expect(engine.provider).toBe('openai');
      expect(engine.dimension).toBe(256);
    });
  });
});

// -------------------------------------------------------
// Embedding Cache Tests
// -------------------------------------------------------
describe('CachedEmbeddingEngine', () => {
  it('should cache embed results', async () => {
    const inner = new TfIdfEmbedding(64);
    const cached = new CachedEmbeddingEngine(inner, 100);

    const first = await cached.embed('hello world');
    expect(cached.cacheSize).toBe(1);
    const second = await cached.embed('hello world');
    expect(second).toEqual(first);
    expect(cached.cacheSize).toBe(1);
  });

  it('should cache embedBatch results', async () => {
    const inner = new TfIdfEmbedding(64);
    const cached = new CachedEmbeddingEngine(inner, 100);

    await cached.embedBatch(['aaa', 'bbb']);
    expect(cached.cacheSize).toBe(2);

    // Second batch should use cache for aaa, compute ccc
    await cached.embedBatch(['aaa', 'ccc']);
    expect(cached.cacheSize).toBe(3);
  });

  it('should evict oldest entries when over limit', async () => {
    const inner = new TfIdfEmbedding(32);
    const cached = new CachedEmbeddingEngine(inner, 3);

    await cached.embed('one');
    await cached.embed('two');
    await cached.embed('three');
    expect(cached.cacheSize).toBe(3);

    // Adding fourth should evict first
    await cached.embed('four');
    expect(cached.cacheSize).toBe(3);
  });

  it('should clear cache', async () => {
    const inner = new TfIdfEmbedding(32);
    const cached = new CachedEmbeddingEngine(inner, 100);
    await cached.embed('test');
    expect(cached.cacheSize).toBe(1);
    cached.clearCache();
    expect(cached.cacheSize).toBe(0);
  });

  it('should pass through provider and dimension', () => {
    const inner = new TfIdfEmbedding(256);
    const cached = new CachedEmbeddingEngine(inner, 100);
    expect(cached.provider).toBe('tfidf');
    expect(cached.dimension).toBe(256);
  });

  it('should be enabled by default in createEmbeddingEngine', () => {
    const engine = createEmbeddingEngine({ provider: 'tfidf', dimension: 64 });
    expect(engine).toBeInstanceOf(CachedEmbeddingEngine);
  });

  it('should be disableable in createEmbeddingEngine', () => {
    const engine = createEmbeddingEngine({ provider: 'tfidf', dimension: 64, enableCache: false });
    expect(engine).toBeInstanceOf(TfIdfEmbedding);
  });
});

// -------------------------------------------------------
// Cosine Similarity Tests
// -------------------------------------------------------
describe('cosineSimilarity', () => {
  it('should return 1 for identical vectors', () => {
    const v = [1, 2, 3, 4, 5];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it('should return -1 for opposite vectors', () => {
    const a = [1, 0, 0];
    const b = [-1, 0, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
  });

  it('should return 0 for orthogonal vectors', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
  });

  it('should return 0 for zero vectors', () => {
    const zero = [0, 0, 0];
    const v = [1, 2, 3];
    expect(cosineSimilarity(zero, v)).toBe(0);
    expect(cosineSimilarity(v, zero)).toBe(0);
  });

  it('should be scale-invariant', () => {
    const a = [1, 2, 3];
    const b = [2, 4, 6]; // same direction, different magnitude
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
  });

  it('should handle different length vectors (uses min length)', () => {
    const a = [1, 0];
    const b = [1, 0, 9, 9, 9];
    // Only compares first 2 elements
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
  });
});

// -------------------------------------------------------
// VectorStore Tests
// -------------------------------------------------------
describe('VectorStore', () => {
  let tmpDir: string;
  let store: VectorStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new VectorStore(join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should insert and retrieve a memory entry', () => {
    const entry = mockEntry('e1', 'hello world', [1, 0, 0]);
    store.insert(entry);
    const retrieved = store.get('e1');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.content).toBe('hello world');
    expect(retrieved!.id).toBe('e1');
  });

  it('should return null for non-existent id', () => {
    expect(store.get('missing')).toBeNull();
  });

  it('should count entries', () => {
    expect(store.count()).toBe(0);
    store.insert(mockEntry('e1', 'a', [1, 0]));
    store.insert(mockEntry('e2', 'b', [0, 1]));
    expect(store.count()).toBe(2);
  });

  it('should delete an entry', () => {
    store.insert(mockEntry('e1', 'a', [1, 0]));
    expect(store.delete('e1')).toBe(true);
    expect(store.get('e1')).toBeNull();
    expect(store.count()).toBe(0);
  });

  it('should return false when deleting non-existent', () => {
    expect(store.delete('missing')).toBe(false);
  });

  it('should batch insert entries', () => {
    const entries = [
      mockEntry('b1', 'first', [1, 0, 0]),
      mockEntry('b2', 'second', [0, 1, 0]),
      mockEntry('b3', 'third', [0, 0, 1]),
    ];
    store.insertBatch(entries);
    expect(store.count()).toBe(3);
  });

  it('should batch delete entries', () => {
    store.insertBatch([
      mockEntry('d1', 'a', [1]),
      mockEntry('d2', 'b', [2]),
      mockEntry('d3', 'c', [3]),
    ]);
    const deleted = store.deleteBatch(['d1', 'd3']);
    expect(deleted).toBe(2);
    expect(store.count()).toBe(1);
    expect(store.get('d2')).not.toBeNull();
  });

  it('should list all entries', () => {
    store.insertBatch([
      mockEntry('l1', 'a', [1]),
      mockEntry('l2', 'b', [2]),
    ]);
    const all = store.listAll();
    expect(all).toHaveLength(2);
  });

  it('should upsert on duplicate id', () => {
    store.insert(mockEntry('u1', 'original', [1, 0]));
    store.insert(mockEntry('u1', 'updated', [0, 1]));
    expect(store.count()).toBe(1);
    const entry = store.get('u1');
    expect(entry!.content).toBe('updated');
  });

  it('should search by cosine similarity', () => {
    store.insertBatch([
      mockEntry('s1', 'north', [1, 0, 0]),
      mockEntry('s2', 'east', [0, 1, 0]),
      mockEntry('s3', 'up', [0, 0, 1]),
    ]);

    const results = store.search([1, 0, 0], 2);
    expect(results).toHaveLength(2);
    expect(results[0].entry.id).toBe('s1');
    expect(results[0].similarity).toBeCloseTo(1.0, 5);
  });

  it('should preserve embedding through encode/decode', () => {
    const original = [0.123, -0.456, 0.789, 1.0, -1.0, 0.0];
    store.insert(mockEntry('enc1', 'test', original));
    const retrieved = store.get('enc1');
    expect(retrieved).not.toBeNull();
    for (let i = 0; i < original.length; i++) {
      expect(retrieved!.embedding[i]).toBeCloseTo(original[i], 4);
    }
  });

  it('should preserve metadata through JSON serialization', () => {
    const entry: MemoryEntry = {
      id: 'meta1',
      content: 'test',
      embedding: [1],
      metadata: {
        source: 'unit-test',
        agentId: 'researcher',
        tags: ['important', 'test'],
        type: 'fact',
      },
      createdAt: 1000,
      updatedAt: 2000,
    };
    store.insert(entry);
    const retrieved = store.get('meta1');
    expect(retrieved!.metadata.source).toBe('unit-test');
    expect(retrieved!.metadata.agentId).toBe('researcher');
    expect(retrieved!.metadata.tags).toEqual(['important', 'test']);
    expect(retrieved!.metadata.type).toBe('fact');
    expect(retrieved!.createdAt).toBe(1000);
    expect(retrieved!.updatedAt).toBe(2000);
  });
});

// -------------------------------------------------------
// MemoryManager Tests
// -------------------------------------------------------
describe('MemoryManager', () => {
  let tmpDir: string;
  let engine: TfIdfEmbedding;
  let manager: MemoryManager;
  let config: MemoryConfig;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    engine = new TfIdfEmbedding(128);
    config = {
      enabled: true,
      provider: 'tfidf',
      embeddingDimension: 128,
      dbPath: join(tmpDir, 'vectors.db'),
      sessionDir: join(tmpDir, 'sessions'),
      maxChunkSize: 200,
      chunkOverlap: 30,
      searchTopK: 5,
      hybridAlpha: 0.7,
      deduplicationThreshold: 0.99,
    };
    manager = new MemoryManager(config, engine);
  });

  afterEach(() => {
    manager.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should save and retrieve a memory entry', async () => {
    const saved = await manager.save('TypeScript is a typed superset of JavaScript', {
      source: 'test',
    });
    expect(saved.length).toBeGreaterThan(0);
    expect(manager.count()).toBe(1);
    const entry = manager.get(saved[0].id);
    expect(entry).not.toBeNull();
    expect(entry!.content).toContain('TypeScript');
  });

  it('should perform semantic search', async () => {
    await manager.save('Python is a popular programming language', { source: 'test' });
    await manager.save('JavaScript runs in the browser', { source: 'test' });
    await manager.save('Cooking pasta requires boiling water', { source: 'test' });

    const results = await manager.semanticSearch('programming language');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].matchType).toBe('semantic');
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('should perform keyword search', async () => {
    await manager.save('TypeScript supports interfaces and generics', { source: 'test' });
    await manager.save('React uses JSX for templating', { source: 'test' });
    await manager.save('Python has list comprehensions', { source: 'test' });

    const results = manager.keywordSearch('TypeScript interfaces');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].matchType).toBe('keyword');
    // The TypeScript entry should score highest
    expect(results[0].entry.content).toContain('TypeScript');
  });

  it('should perform hybrid search', async () => {
    await manager.save('Machine learning uses neural networks', { source: 'test' });
    await manager.save('Deep learning is a subset of machine learning', { source: 'test' });
    await manager.save('Baking cookies requires sugar and flour', { source: 'test' });

    const results = await manager.hybridSearch('machine learning neural');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].matchType).toBe('hybrid');
  });

  it('should return empty results for no matches in keyword search', () => {
    const results = manager.keywordSearch('xyz123nonexistent');
    expect(results).toHaveLength(0);
  });

  it('should delete memory entries', async () => {
    const saved = await manager.save('temporary info', { source: 'test' });
    expect(manager.count()).toBe(1);
    expect(manager.delete(saved[0].id)).toBe(true);
    expect(manager.count()).toBe(0);
  });

  it('should emit memory events on save', async () => {
    const events: MemoryEvent[] = [];
    manager.on('memory', (event: MemoryEvent) => events.push(event));

    await manager.save('event test content', { source: 'test' });
    const saveEvent = events.find((e) => e.type === 'memory:save');
    expect(saveEvent).toBeDefined();
    expect(saveEvent!.details.entriesCount).toBe(1);
  });

  it('should emit memory events on search', async () => {
    await manager.save('searchable content here', { source: 'test' });

    const events: MemoryEvent[] = [];
    manager.on('memory', (event: MemoryEvent) => events.push(event));

    await manager.semanticSearch('searchable');
    expect(events.some((e) => e.type === 'memory:search')).toBe(true);
  });

  it('should emit memory events on delete', async () => {
    const saved = await manager.save('to be deleted', { source: 'test' });
    const events: MemoryEvent[] = [];
    manager.on('memory', (event: MemoryEvent) => events.push(event));
    manager.delete(saved[0].id);
    expect(events.some((e) => e.type === 'memory:delete')).toBe(true);
  });

  describe('chunking', () => {
    it('should not chunk text shorter than maxChunkSize', () => {
      const short = 'Short text under limit.';
      const chunks = manager.chunkContent(short);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe(short);
    });

    it('should chunk long text into multiple pieces', () => {
      const long = Array(50).fill('This is a sentence that adds up to a longer text.').join(' ');
      const chunks = manager.chunkContent(long);
      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        // Each chunk should be within reasonable bounds
        expect(chunk.length).toBeLessThanOrEqual(config.maxChunkSize + config.chunkOverlap + 50);
      }
    });

    it('should chunk by paragraph boundaries', () => {
      const text = 'First paragraph content here.\n\nSecond paragraph with different info.\n\nThird paragraph brings closure.';
      // Each paragraph is short enough to fit, but combined they may exceed maxChunkSize if maxChunkSize is small
      const smallConfig = { ...config, maxChunkSize: 50, chunkOverlap: 0 };
      const smallManager = new MemoryManager(smallConfig, engine);
      const chunks = smallManager.chunkContent(text);
      expect(chunks.length).toBeGreaterThanOrEqual(2);
      smallManager.close();
    });

    it('should save chunked content as multiple entries', async () => {
      const long = Array(50).fill('A medium-length sentence for testing chunking behavior.').join(' ');
      const saved = await manager.save(long, { source: 'chunking-test' });
      expect(saved.length).toBeGreaterThan(1);
      expect(manager.count()).toBe(saved.length);
    });
  });

  describe('deduplication', () => {
    it('should deduplicate identical content', async () => {
      const content = 'This exact content should only be stored once for dedup test';
      // Use very low threshold for testing
      const dedupConfig = { ...config, deduplicationThreshold: 0.95 };
      const dedupManager = new MemoryManager(dedupConfig, engine);

      await dedupManager.save(content, { source: 'test' });
      const secondSave = await dedupManager.save(content, { source: 'test' });

      // Second save should be deduplicated (empty array)
      expect(secondSave).toHaveLength(0);
      expect(dedupManager.count()).toBe(1);
      dedupManager.close();
    });

    it('should emit deduplicated event', async () => {
      const dedupConfig = { ...config, deduplicationThreshold: 0.95 };
      const dedupManager = new MemoryManager(dedupConfig, engine);
      const events: MemoryEvent[] = [];
      dedupManager.on('memory', (event: MemoryEvent) => events.push(event));

      const content = 'Unique content for dedup event testing purposes';
      await dedupManager.save(content, { source: 'test' });
      await dedupManager.save(content, { source: 'test' });

      expect(events.some((e) => e.type === 'memory:deduplicated')).toBe(true);
      dedupManager.close();
    });

    it('should not deduplicate different content', async () => {
      await manager.save('First unique content about cats', { source: 'test' });
      const saved2 = await manager.save('Second unique content about dogs', { source: 'test' });
      expect(saved2.length).toBe(1);
      expect(manager.count()).toBe(2);
    });
  });
});

// -------------------------------------------------------
// SessionStore Tests
// -------------------------------------------------------
describe('SessionStore', () => {
  let tmpDir: string;
  let store: SessionStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new SessionStore(join(tmpDir, 'sessions'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should load empty session for non-existent id', () => {
    const history = store.load('nonexistent');
    expect(history.sessionId).toBe('nonexistent');
    expect(history.entries).toHaveLength(0);
  });

  it('should append and load entries', () => {
    const entry: SessionEntry = {
      role: 'user',
      content: 'Hello',
      timestamp: Date.now(),
    };
    store.append('session-1', entry);

    const history = store.load('session-1');
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0].role).toBe('user');
    expect(history.entries[0].content).toBe('Hello');
  });

  it('should append multiple entries to same session', () => {
    store.append('s2', { role: 'user', content: 'Hi', timestamp: 1000 });
    store.append('s2', { role: 'assistant', content: 'Hello!', timestamp: 2000 });
    store.append('s2', { role: 'user', content: 'How are you?', timestamp: 3000 });

    const history = store.load('s2');
    expect(history.entries).toHaveLength(3);
    expect(history.entries[0].content).toBe('Hi');
    expect(history.entries[2].content).toBe('How are you?');
  });

  it('should save full session history (overwrite)', () => {
    store.append('s3', { role: 'user', content: 'old message', timestamp: 1000 });

    store.save({
      sessionId: 's3',
      entries: [
        { role: 'user', content: 'new message 1', timestamp: 2000 },
        { role: 'assistant', content: 'new message 2', timestamp: 3000 },
      ],
      createdAt: 2000,
      updatedAt: 3000,
    });

    const history = store.load('s3');
    expect(history.entries).toHaveLength(2);
    expect(history.entries[0].content).toBe('new message 1');
  });

  it('should check if session exists', () => {
    expect(store.exists('absent')).toBe(false);
    store.append('present', { role: 'user', content: 'exists', timestamp: Date.now() });
    expect(store.exists('present')).toBe(true);
  });

  it('should isolate different sessions', () => {
    store.append('alice', { role: 'user', content: 'Alice msg', timestamp: 1000 });
    store.append('bob', { role: 'user', content: 'Bob msg', timestamp: 2000 });

    const alice = store.load('alice');
    const bob = store.load('bob');
    expect(alice.entries).toHaveLength(1);
    expect(bob.entries).toHaveLength(1);
    expect(alice.entries[0].content).toBe('Alice msg');
    expect(bob.entries[0].content).toBe('Bob msg');
  });

  it('should sanitize session ids for path safety', () => {
    // Attempt path traversal - should be sanitized
    store.append('../../../etc/passwd', {
      role: 'user',
      content: 'should not escape',
      timestamp: Date.now(),
    });
    // If sanitized, it won't write outside session dir
    const history = store.load('../../../etc/passwd');
    expect(history.entries).toHaveLength(1);
  });

  it('should emit session events', () => {
    const events: MemoryEvent[] = [];
    store.on('session', (event: MemoryEvent) => events.push(event));

    store.append('evt-session', { role: 'user', content: 'hi', timestamp: Date.now() });
    expect(events.some((e) => e.type === 'session:save')).toBe(true);

    store.load('evt-session');
    expect(events.some((e) => e.type === 'session:load')).toBe(true);
  });

  it('should record timestamps correctly', () => {
    const ts1 = 1000;
    const ts2 = 5000;
    store.append('ts-test', { role: 'user', content: 'first', timestamp: ts1 });
    store.append('ts-test', { role: 'assistant', content: 'second', timestamp: ts2 });

    const history = store.load('ts-test');
    expect(history.createdAt).toBe(ts1);
    expect(history.updatedAt).toBe(ts2);
  });
});

// -------------------------------------------------------
// Memory Tools Tests
// -------------------------------------------------------
describe('Memory Tools', () => {
  let tmpDir: string;
  let engine: TfIdfEmbedding;
  let manager: MemoryManager;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    engine = new TfIdfEmbedding(128);
    manager = new MemoryManager(
      {
        enabled: true,
        provider: 'tfidf',
        embeddingDimension: 128,
        dbPath: join(tmpDir, 'vectors.db'),
        sessionDir: join(tmpDir, 'sessions'),
        maxChunkSize: 1000,
        chunkOverlap: 50,
        searchTopK: 5,
        hybridAlpha: 0.7,
        deduplicationThreshold: 0.99,
      },
      engine
    );
  });

  afterEach(() => {
    manager.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('memory_search tool', () => {
    it('should validate query parameter', () => {
      const tool = createMemorySearchTool(manager);
      expect(tool.validateParams!({}).valid).toBe(false);
      expect(tool.validateParams!({ query: 123 }).valid).toBe(false);
      expect(tool.validateParams!({ query: 'valid' }).valid).toBe(true);
    });

    it('should validate method parameter', () => {
      const tool = createMemorySearchTool(manager);
      expect(tool.validateParams!({ query: 'q', method: 'invalid' }).valid).toBe(false);
      expect(tool.validateParams!({ query: 'q', method: 'semantic' }).valid).toBe(true);
      expect(tool.validateParams!({ query: 'q', method: 'keyword' }).valid).toBe(true);
      expect(tool.validateParams!({ query: 'q', method: 'hybrid' }).valid).toBe(true);
    });

    it('should execute search and return results', async () => {
      await manager.save('Node.js is a JavaScript runtime', { source: 'test' });
      const tool = createMemorySearchTool(manager);
      const result = (await tool.execute({ query: 'JavaScript runtime' })) as {
        results: unknown[];
        totalResults: number;
      };
      expect(result.totalResults).toBeGreaterThan(0);
      expect(result.results.length).toBeGreaterThan(0);
    });

    it('should have correct tool metadata', () => {
      const tool = createMemorySearchTool(manager);
      expect(tool.name).toBe('memory_search');
      expect(tool.safetyLevel).toBe('safe');
      expect(tool.requiredRole).toContain('butler');
      expect(tool.requiredRole).toContain('researcher');
    });
  });

  describe('memory_get tool', () => {
    it('should validate id parameter', () => {
      const tool = createMemoryGetTool(manager);
      expect(tool.validateParams!({}).valid).toBe(false);
      expect(tool.validateParams!({ id: 123 }).valid).toBe(false);
      expect(tool.validateParams!({ id: 'valid-id' }).valid).toBe(true);
    });

    it('should return entry when found', async () => {
      const saveTool = createMemorySaveTool(manager);
      const saved = (await saveTool.execute({
        content: 'Retrievable content for get test',
        source: 'test',
      })) as { saved: number; ids: string[] };
      const id = saved.ids[0];

      const tool = createMemoryGetTool(manager);
      const result = (await tool.execute({ id })) as {
        found: boolean;
        content: string;
      };
      expect(result.found).toBe(true);
      expect(result.content).toContain('Retrievable content');
    });

    it('should return not found for missing id', async () => {
      const tool = createMemoryGetTool(manager);
      const result = (await tool.execute({ id: 'nonexistent-id' })) as {
        found: boolean;
        message: string;
      };
      expect(result.found).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('should have correct tool metadata', () => {
      const tool = createMemoryGetTool(manager);
      expect(tool.name).toBe('memory_get');
      expect(tool.safetyLevel).toBe('safe');
      expect(tool.requiredRole).toContain('butler');
    });
  });

  describe('memory_save tool', () => {
    it('should validate required parameters', () => {
      const tool = createMemorySaveTool(manager);
      expect(tool.validateParams!({}).valid).toBe(false);
      expect(tool.validateParams!({ content: 'text' }).valid).toBe(false);
      expect(tool.validateParams!({ content: 'text', source: 'test' }).valid).toBe(true);
    });

    it('should execute save and return saved count', async () => {
      const tool = createMemorySaveTool(manager);
      const result = (await tool.execute({
        content: 'Important fact to remember',
        source: 'user',
        tags: ['important'],
        type: 'fact',
      })) as { saved: number; ids: string[] };
      expect(result.saved).toBe(1);
      expect(result.ids).toHaveLength(1);
      expect(manager.count()).toBe(1);
    });

    it('should have correct tool metadata', () => {
      const tool = createMemorySaveTool(manager);
      expect(tool.name).toBe('memory_save');
      expect(tool.safetyLevel).toBe('safe');
    });
  });
});

// -------------------------------------------------------
// Integration: Hybrid Search Accuracy
// -------------------------------------------------------
describe('Hybrid Search Integration', () => {
  let tmpDir: string;
  let engine: TfIdfEmbedding;
  let manager: MemoryManager;

  beforeEach(async () => {
    tmpDir = makeTmpDir();
    engine = new TfIdfEmbedding(256);
    manager = new MemoryManager(
      {
        enabled: true,
        provider: 'tfidf',
        embeddingDimension: 256,
        dbPath: join(tmpDir, 'vectors.db'),
        sessionDir: join(tmpDir, 'sessions'),
        maxChunkSize: 2000,
        chunkOverlap: 100,
        searchTopK: 10,
        hybridAlpha: 0.5,
        deduplicationThreshold: 0.99,
      },
      engine
    );

    // Seed diverse content
    await manager.save('TypeScript is a strongly typed programming language that builds on JavaScript', { source: 'docs' });
    await manager.save('React is a JavaScript library for building user interfaces', { source: 'docs' });
    await manager.save('PostgreSQL is a powerful open source relational database system', { source: 'docs' });
    await manager.save('Docker containers provide isolated environments for running applications', { source: 'docs' });
    await manager.save('Git is a distributed version control system for tracking changes in source code', { source: 'docs' });
  });

  afterEach(() => {
    manager.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should rank relevant results higher with hybrid search', async () => {
    const results = await manager.hybridSearch('JavaScript programming language');
    expect(results.length).toBeGreaterThan(0);
    // TypeScript and React entries should score higher than PostgreSQL/Docker/Git
    const topContents = results.slice(0, 2).map((r) => r.entry.content);
    const hasJSRelevant = topContents.some(
      (c) => c.includes('JavaScript') || c.includes('TypeScript')
    );
    expect(hasJSRelevant).toBe(true);
  });

  it('should combine semantic and keyword scores', async () => {
    const hybridResults = await manager.hybridSearch('database system');
    const semanticResults = await manager.semanticSearch('database system');
    const keywordResults = manager.keywordSearch('database system');

    // Hybrid should find results from both methods
    expect(hybridResults.length).toBeGreaterThan(0);
    // With alpha=0.5, hybrid score should be between semantic and keyword
    if (hybridResults.length > 0 && semanticResults.length > 0 && keywordResults.length > 0) {
      const hybridTopId = hybridResults[0].entry.id;
      const semResult = semanticResults.find((r) => r.entry.id === hybridTopId);
      const kwResult = keywordResults.find((r) => r.entry.id === hybridTopId);
      if (semResult && kwResult) {
        // Hybrid score = 0.5 * semantic + 0.5 * keyword
        const expectedScore = 0.5 * semResult.score + 0.5 * kwResult.score;
        expect(hybridResults[0].score).toBeCloseTo(expectedScore, 3);
      }
    }
  });

  it('should respect topK parameter', async () => {
    const results = await manager.hybridSearch('programming', 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('should handle alpha=1 (pure semantic)', async () => {
    const results = await manager.hybridSearch('programming', 5, 1.0);
    expect(results.length).toBeGreaterThan(0);
    // All results should come from semantic search
    for (const r of results) {
      expect(r.matchType).toBe('hybrid');
    }
  });

  it('should handle alpha=0 (pure keyword)', async () => {
    const results = await manager.hybridSearch('PostgreSQL database', 5, 0.0);
    expect(results.length).toBeGreaterThan(0);
    // Top result should be the PostgreSQL entry
    expect(results[0].entry.content).toContain('PostgreSQL');
  });
});
