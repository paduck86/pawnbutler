// PawnButler Embedding Providers
// OpenAI text-embedding-3-small and TF-IDF fallback

import type { EmbeddingProvider } from './types.js';

export interface EmbeddingEngine {
  readonly provider: EmbeddingProvider;
  readonly dimension: number;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

// --- OpenAI Embedding Provider ---

export class OpenAIEmbedding implements EmbeddingEngine {
  readonly provider: EmbeddingProvider = 'openai';
  readonly dimension: number;
  private apiKey: string;
  private model: string;

  constructor(opts: { apiKey: string; model?: string; dimension?: number }) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? 'text-embedding-3-small';
    this.dimension = opts.dimension ?? 1536;
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: this.apiKey });

    const response = await client.embeddings.create({
      model: this.model,
      input: texts,
      dimensions: this.dimension,
    });

    // Sort by index to preserve order
    const sorted = response.data.sort((a, b) => a.index - b.index);
    return sorted.map((d) => d.embedding);
  }
}

// --- TF-IDF Fallback Embedding Provider ---

export class TfIdfEmbedding implements EmbeddingEngine {
  readonly provider: EmbeddingProvider = 'tfidf';
  readonly dimension: number;
  private vocabulary: Map<string, number>;
  private idf: Map<string, number>;
  private documentCount: number;

  constructor(dimension = 512) {
    this.dimension = dimension;
    this.vocabulary = new Map();
    this.idf = new Map();
    this.documentCount = 0;
  }

  async embed(text: string): Promise<number[]> {
    return this.computeVector(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Update vocabulary with all texts first
    for (const text of texts) {
      this.updateVocabulary(text);
    }
    return texts.map((text) => this.computeVector(text));
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1);
  }

  private updateVocabulary(text: string): void {
    const tokens = new Set(this.tokenize(text));
    this.documentCount++;
    for (const token of tokens) {
      const count = this.idf.get(token) ?? 0;
      this.idf.set(token, count + 1);
      if (!this.vocabulary.has(token)) {
        this.vocabulary.set(token, this.vocabulary.size);
      }
    }
  }

  private computeVector(text: string): number[] {
    this.updateVocabulary(text);
    const tokens = this.tokenize(text);
    const tf = new Map<string, number>();

    for (const token of tokens) {
      tf.set(token, (tf.get(token) ?? 0) + 1);
    }

    // Build sparse vector then hash to fixed dimension
    const vector = new Array(this.dimension).fill(0);
    const totalTokens = tokens.length || 1;

    for (const [token, count] of tf.entries()) {
      const tfScore = count / totalTokens;
      const docFreq = this.idf.get(token) ?? 1;
      const idfScore = Math.log((this.documentCount + 1) / (docFreq + 1)) + 1;
      const tfidf = tfScore * idfScore;

      // Hash token to bucket(s) for fixed-dimension vector
      const hash = this.hashString(token);
      const idx = Math.abs(hash) % this.dimension;
      // Use sign from second hash for feature hashing
      const sign = this.hashString(token + '_sign') % 2 === 0 ? 1 : -1;
      vector[idx] += sign * tfidf;
    }

    // L2 normalize
    return this.normalize(vector);
  }

  private hashString(s: string): number {
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
      const char = s.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0; // Convert to 32-bit integer
    }
    return hash;
  }

  private normalize(vector: number[]): number[] {
    let norm = 0;
    for (const v of vector) {
      norm += v * v;
    }
    norm = Math.sqrt(norm);
    if (norm === 0) return vector;
    return vector.map((v) => v / norm);
  }
}

// --- Caching Wrapper ---

export class CachedEmbeddingEngine implements EmbeddingEngine {
  readonly provider: EmbeddingProvider;
  readonly dimension: number;
  private inner: EmbeddingEngine;
  private cache: Map<string, number[]>;
  private maxEntries: number;

  constructor(inner: EmbeddingEngine, maxEntries = 1000) {
    this.inner = inner;
    this.provider = inner.provider;
    this.dimension = inner.dimension;
    this.cache = new Map();
    this.maxEntries = maxEntries;
  }

  async embed(text: string): Promise<number[]> {
    const cached = this.cache.get(text);
    if (cached) {
      return cached;
    }
    const vec = await this.inner.embed(text);
    this.putCache(text, vec);
    return vec;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: (number[] | null)[] = texts.map((t) => this.cache.get(t) ?? null);
    const uncached: { index: number; text: string }[] = [];
    for (let i = 0; i < texts.length; i++) {
      if (!results[i]) {
        uncached.push({ index: i, text: texts[i] });
      }
    }

    if (uncached.length > 0) {
      const embeddings = await this.inner.embedBatch(uncached.map((u) => u.text));
      for (let j = 0; j < uncached.length; j++) {
        results[uncached[j].index] = embeddings[j];
        this.putCache(uncached[j].text, embeddings[j]);
      }
    }

    return results as number[][];
  }

  get cacheSize(): number {
    return this.cache.size;
  }

  clearCache(): void {
    this.cache.clear();
  }

  private putCache(key: string, value: number[]): void {
    // Evict oldest entries if over limit
    if (this.cache.size >= this.maxEntries) {
      const firstKey = this.cache.keys().next().value!;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }
}

// --- Factory ---

export function createEmbeddingEngine(opts: {
  provider: EmbeddingProvider;
  apiKey?: string;
  model?: string;
  dimension?: number;
  enableCache?: boolean;
  cacheMaxEntries?: number;
}): EmbeddingEngine {
  let engine: EmbeddingEngine;
  if (opts.provider === 'openai') {
    if (!opts.apiKey) {
      throw new Error('OpenAI API key is required for openai embedding provider');
    }
    engine = new OpenAIEmbedding({
      apiKey: opts.apiKey,
      model: opts.model,
      dimension: opts.dimension,
    });
  } else {
    engine = new TfIdfEmbedding(opts.dimension);
  }

  if (opts.enableCache !== false) {
    return new CachedEmbeddingEngine(engine, opts.cacheMaxEntries);
  }
  return engine;
}
