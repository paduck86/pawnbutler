# PawnButler

Safe personal AI agent system with strict guardrails.

## Features

- **6-Layer Defense**: Agent Policy, ToolRegistry, Guardian, External Approval, Docker Sandbox, Audit Trail
- **Multi-Agent**: Butler (leader), Researcher (read-only), Executor (local-only), Guardian (monitor)
- **Multi-Provider LLM**: Anthropic, OpenAI, Google, Ollama with fallback chains
- **Channels**: WhatsApp, Telegram, Discord, Slack (bidirectional)
- **Browser Automation**: Playwright with URL allowlist enforcement
- **Memory**: Semantic search with embeddings + SQLite vector store
- **Cron**: Scheduled tasks with user notification before execution
- **Desktop GUI**: Electron app with 10 panels

## Quick Start

```bash
npm install
cp pawnbutler.config.example.yaml pawnbutler.config.yaml
# Edit config with your API keys
npm start
```

## Download

[PawnButler-1.0.0-arm64.dmg](https://github.com/paduck86/pawnbutler/releases/download/v1.0.0/PawnButler-1.0.0-arm64.dmg) (macOS Apple Silicon)

## Desktop App

```bash
npm run app:dev
```

## Tests

```bash
npm test
```

## Safety

All actions pass through a 6-layer defense system. Key safety features:

- Forbidden action blocking (signup, payment, destructive commands)
- Secret detection and masking in audit logs and LLM calls
- Docker sandbox isolation (`--network none`) for command execution
- URL allowlist/blocklist enforcement
- Outgoing message approval required
- Unknown sender pairing codes
- Path traversal prevention

## Acknowledgments

Inspired by [OpenClaw](https://github.com/nichochar/openclaw) by Peter Steinberger. See [LICENSE](LICENSE) for details.

## License

[MIT](LICENSE)
