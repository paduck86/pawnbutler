import type {
  AgentConfig,
  AgentMessage,
} from '../core/types.js';
import { BaseAgent } from './base-agent.js';

export interface ResearchResult {
  query: string;
  sources: Array<{ url: string; title?: string; snippet?: string }>;
  summary?: string;
}

export class ResearcherAgent extends BaseAgent {
  constructor(config: Partial<AgentConfig> & { id: string }) {
    super({
      role: 'researcher',
      name: config.name ?? 'Researcher',
      description:
        config.description ??
        'Gathers information from web and files (read-only)',
      allowedTools: config.allowedTools ?? [
        'web_search',
        'web_fetch',
        'read_file',
      ],
      deniedTools: config.deniedTools ?? [
        'write_file',
        'edit_file',
        'exec_command',
        'api_call',
        'send_message',
        'signup',
        'payment',
      ],
      maxConcurrentActions: config.maxConcurrentActions ?? 5,
      requirePlanApproval: config.requirePlanApproval ?? true,
      ...config,
    });
  }

  async handleTask(
    query: string,
    context?: Record<string, unknown>
  ): Promise<ResearchResult> {
    this.status = 'working';
    this.currentTask = query;

    try {
      // 1. Build search query (LLM-enhanced if available)
      const searchQuery = this.llm
        ? await this.buildSearchQueryWithLLM(query, context)
        : this.buildSearchQuery(query, context);

      // 2. Execute web search via tool system
      const searchResult = await this.requestAction('web_search', {
        query: searchQuery,
      });

      if (!searchResult.success) {
        return {
          query,
          sources: [],
          summary: `Search failed: ${searchResult.error ?? 'Unknown error'}`,
        };
      }

      // 3. Fetch detailed content from results
      const sources = await this.fetchDetails(
        searchResult.data as Array<{ url: string; title?: string }> | undefined
      );

      // 4. Summarize results (LLM-enhanced if available)
      const summary = this.llm
        ? await this.summarizeWithLLM(query, sources)
        : `Found ${sources.length} relevant sources for: ${query}`;

      return { query, sources, summary };
    } finally {
      this.status = 'idle';
      this.currentTask = null;
    }
  }

  async handleMessage(message: AgentMessage): Promise<void> {
    switch (message.type) {
      case 'task': {
        const payload = message.payload as {
          task: string;
          context?: Record<string, unknown>;
        };
        const result = await this.handleTask(payload.task, payload.context);

        // Send result back to the requesting agent
        if (this.engine) {
          this.engine.routeMessage({
            from: this.id,
            to: message.from,
            type: 'result',
            payload: result,
          });
        }
        break;
      }

      case 'approval_response':
        // Handle approval responses for pending actions
        break;

      default:
        break;
    }
  }

  private buildSearchQuery(
    query: string,
    context?: Record<string, unknown>
  ): string {
    // Enhance the query with context if provided
    let enhanced = query;
    if (context?.topic && typeof context.topic === 'string') {
      enhanced = `${context.topic}: ${enhanced}`;
    }
    return enhanced;
  }

  private async buildSearchQueryWithLLM(
    query: string,
    context?: Record<string, unknown>
  ): Promise<string> {
    if (!this.llm) return this.buildSearchQuery(query, context);

    try {
      const response = await this.chatLLM([
        {
          role: 'system',
          content: `You are a research assistant. Transform the user's request into an optimized search query.
Output only the search query text, nothing else. Keep it concise (under 100 characters).`,
        },
        {
          role: 'user',
          content: context
            ? `Context: ${JSON.stringify(context)}\nRequest: ${query}`
            : query,
        },
      ], { maxTokens: 50, temperature: 0 });

      if (response) {
        return response.content.trim();
      }
    } catch {
      // Fall back to heuristic query building
    }
    return this.buildSearchQuery(query, context);
  }

  private async summarizeWithLLM(
    query: string,
    sources: Array<{ url: string; title?: string; snippet?: string }>
  ): Promise<string> {
    if (!this.llm || sources.length === 0) {
      return `Found ${sources.length} relevant sources for: ${query}`;
    }

    try {
      const sourcesText = sources
        .map((s, i) => `[${i + 1}] ${s.title ?? s.url}\n${s.snippet ?? '(no content)'}`)
        .join('\n\n');

      const response = await this.chatLLM([
        {
          role: 'system',
          content: `You are a research assistant. Summarize the search results for the user's query. Be concise (2-3 sentences).`,
        },
        { role: 'user', content: `Query: ${query}\n\nSources:\n${sourcesText}` },
      ], { maxTokens: 200, temperature: 0 });

      if (response) {
        return response.content.trim();
      }
    } catch {
      // Fall back to simple summary
    }
    return `Found ${sources.length} relevant sources for: ${query}`;
  }

  private async fetchDetails(
    results: Array<{ url: string; title?: string }> | undefined
  ): Promise<Array<{ url: string; title?: string; snippet?: string }>> {
    if (!results || results.length === 0) {
      return [];
    }

    const details: Array<{ url: string; title?: string; snippet?: string }> = [];

    for (const result of results.slice(0, 5)) {
      const fetchResult = await this.requestAction('web_fetch', {
        url: result.url,
      });

      if (fetchResult.success) {
        details.push({
          url: result.url,
          title: result.title,
          snippet:
            typeof fetchResult.data === 'string'
              ? fetchResult.data.slice(0, 500)
              : undefined,
        });
      } else {
        details.push({
          url: result.url,
          title: result.title,
          snippet: `Fetch failed: ${fetchResult.error ?? 'Unknown error'}`,
        });
      }
    }

    return details;
  }
}
