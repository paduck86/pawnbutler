// Model Registry - Catalog of known models with capabilities and pricing

import type { ModelInfo, LLMProviderName } from './types.js';

const MODEL_CATALOG: ModelInfo[] = [
  // Anthropic models
  {
    id: 'claude-opus-4-6',
    provider: 'anthropic',
    displayName: 'Claude Opus 4.6',
    contextWindow: 200_000,
    maxOutputTokens: 32_000,
    inputCostPer1kTokens: 0.015,
    outputCostPer1kTokens: 0.075,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
  },
  {
    id: 'claude-sonnet-4-5-20250929',
    provider: 'anthropic',
    displayName: 'Claude Sonnet 4.5',
    contextWindow: 200_000,
    maxOutputTokens: 16_000,
    inputCostPer1kTokens: 0.003,
    outputCostPer1kTokens: 0.015,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
  },
  {
    id: 'claude-haiku-4-5-20251001',
    provider: 'anthropic',
    displayName: 'Claude Haiku 4.5',
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    inputCostPer1kTokens: 0.0008,
    outputCostPer1kTokens: 0.004,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
  },

  // OpenAI models
  {
    id: 'gpt-4o',
    provider: 'openai',
    displayName: 'GPT-4o',
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    inputCostPer1kTokens: 0.0025,
    outputCostPer1kTokens: 0.01,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
  },
  {
    id: 'gpt-4o-mini',
    provider: 'openai',
    displayName: 'GPT-4o Mini',
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    inputCostPer1kTokens: 0.00015,
    outputCostPer1kTokens: 0.0006,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
  },
  {
    id: 'o1',
    provider: 'openai',
    displayName: 'O1',
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    inputCostPer1kTokens: 0.015,
    outputCostPer1kTokens: 0.06,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
  },

  // Google models
  {
    id: 'gemini-2.0-flash',
    provider: 'google',
    displayName: 'Gemini 2.0 Flash',
    contextWindow: 1_000_000,
    maxOutputTokens: 8_192,
    inputCostPer1kTokens: 0.0001,
    outputCostPer1kTokens: 0.0004,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
  },
  {
    id: 'gemini-2.0-pro',
    provider: 'google',
    displayName: 'Gemini 2.0 Pro',
    contextWindow: 2_000_000,
    maxOutputTokens: 8_192,
    inputCostPer1kTokens: 0.00125,
    outputCostPer1kTokens: 0.005,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: true,
  },

  // Local models (Ollama) - zero cost
  {
    id: 'llama3.1',
    provider: 'local',
    displayName: 'Llama 3.1 (Local)',
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    inputCostPer1kTokens: 0,
    outputCostPer1kTokens: 0,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
  },
  {
    id: 'qwen2.5',
    provider: 'local',
    displayName: 'Qwen 2.5 (Local)',
    contextWindow: 32_000,
    maxOutputTokens: 4_096,
    inputCostPer1kTokens: 0,
    outputCostPer1kTokens: 0,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
  },
  {
    id: 'mistral',
    provider: 'local',
    displayName: 'Mistral (Local)',
    contextWindow: 32_000,
    maxOutputTokens: 4_096,
    inputCostPer1kTokens: 0,
    outputCostPer1kTokens: 0,
    supportsTools: true,
    supportsStreaming: true,
    supportsVision: false,
  },
];

export class ModelRegistry {
  private models: Map<string, ModelInfo>;

  constructor() {
    this.models = new Map();
    for (const model of MODEL_CATALOG) {
      this.models.set(model.id, model);
    }
  }

  getModel(modelId: string): ModelInfo | undefined {
    return this.models.get(modelId);
  }

  getModelsByProvider(provider: LLMProviderName): ModelInfo[] {
    return Array.from(this.models.values()).filter((m) => m.provider === provider);
  }

  getAllModels(): ModelInfo[] {
    return Array.from(this.models.values());
  }

  registerModel(model: ModelInfo): void {
    this.models.set(model.id, model);
  }

  estimateCost(modelId: string, inputTokens: number, outputTokens: number): number {
    const model = this.models.get(modelId);
    if (!model) return 0;
    return (
      (inputTokens / 1000) * model.inputCostPer1kTokens +
      (outputTokens / 1000) * model.outputCostPer1kTokens
    );
  }
}
