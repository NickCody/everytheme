<p align="center">
  <img src="icon.png" width="128" height="128" alt="Everytheme">
</p>

<h1 align="center">Everytheme</h1>

<p align="center">
  AI-powered VS Code theme that changes on the fly via natural language.
</p>

<p align="center">
  Describe a vibe, get a complete theme — backgrounds, UI, syntax highlighting, terminal colors — all in seconds.
</p>

---

## Features

- **Natural language theme creation** — describe what you want ("cyberpunk neon", "warm sunset", "forest at dawn") and get a fully realized theme
- **Multi-provider** — works with Anthropic, OpenAI, and Gemini; auto-detects API keys from environment
- **Model selection** — choose the right speed/quality tradeoff per provider
- **Named presets** — save, load, clone, rename, and delete themes
- **Theme picker** — browse and switch between saved themes via dropdown
- **Instant application** — colors update live as the AI works
- **Comprehensive** — sets 80+ UI colors and 20+ syntax highlighting rules per theme
- **Kanagawa Wave default** — ships with a beautiful base theme inspired by [Kanagawa](https://github.com/metapho-re/kanagawa-vscode-theme)

## Quick Start

1. Install the extension
2. Provide at least one API key — **either** set an environment variable:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   OPENAI_API_KEY=sk-...
   GEMINI_API_KEY=...
   ```
   **or** run **Everytheme: Configure API Keys & Endpoints** from the command palette to set keys directly in VS Code (see [API Key & Endpoint Configuration](#api-key--endpoint-configuration) below).
3. Open the command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
4. Run **Everytheme: Change Theme with AI**
5. Describe your theme

## Commands

| Command | Description |
|---------|-------------|
| `Everytheme: Change Theme with AI` | Describe a theme in natural language |
| `Everytheme: Select Theme` | Pick from saved theme presets |
| `Everytheme: Select AI Provider` | Choose provider and model |
| `Everytheme: Configure API Keys & Endpoints` | Set API keys and base URLs per provider |
| `Everytheme: Reset to Default` | Clear all overrides, revert to base |

## Supported Providers

| Provider | Default Model | Env Variable |
|----------|--------------|--------------|
| Anthropic | Claude Sonnet 4 | `ANTHROPIC_API_KEY` |
| OpenAI | GPT-5.5 | `OPENAI_API_KEY` |
| Gemini | Gemini 2.0 Flash | `GEMINI_API_KEY` or `GOOGLE_API_KEY` |

All available models can be selected via **Everytheme: Select AI Provider**.

## API Key & Endpoint Configuration

Everytheme reads API keys and base URLs from two sources, in priority order:

1. **Everytheme settings** (VS Code user settings, scoped to this extension only)
2. **Environment variables** (system-wide)

If your environment variables work fine, you don't need to do anything. But if you need to override them — for example, your company sets `OPENAI_BASE_URL` globally and it breaks other tools — you can set values that apply **only to Everytheme**:

1. Run **Everytheme: Configure API Keys & Endpoints** from the command palette
2. Pick the provider and field (API Key or Base URL)
3. Enter the value

These overrides are stored in VS Code user settings under `everytheme.*` and do not affect other extensions, CLI tools, or environment variables.

To **clear an override** and fall back to the environment variable / SDK default, use the same command and choose "Clear override", or use "Clear all Everytheme overrides" to reset everything at once.

### Environment variables

| Provider | API Key | Base URL |
|----------|---------|----------|
| Anthropic | `ANTHROPIC_API_KEY` | `ANTHROPIC_BASE_URL` |
| OpenAI | `OPENAI_API_KEY` | `OPENAI_BASE_URL` |
| Gemini | `GEMINI_API_KEY` or `GOOGLE_API_KEY` | `GOOGLE_API_BASE_URL` |

## Settings

| Setting | Description |
|---------|-------------|
| `everytheme.provider` | Preferred provider (`anthropic`, `openai`, `gemini`) |
| `everytheme.anthropicApiKey` | Anthropic API key (overrides env var) |
| `everytheme.anthropicBaseUrl` | Anthropic base URL (overrides env var) |
| `everytheme.openaiApiKey` | OpenAI API key (overrides env var) |
| `everytheme.openaiBaseUrl` | OpenAI base URL (overrides env var) |
| `everytheme.geminiApiKey` | Gemini API key (overrides env var) |
| `everytheme.geminiBaseUrl` | Gemini base URL (overrides env var) |

## Logging

Open the **Output** panel (`Cmd+Shift+U`) and select **Everytheme** from the dropdown to see detailed logs — API calls, tool invocations, timing, and errors.

## Development

```bash
git clone https://github.com/NickCody/everytheme.git
cd everytheme
npm install
npm run compile
```

Press **F5** in VS Code to launch the Extension Development Host.

### Build VSIX

```bash
npx @vscode/vsce package
```

## License

[MIT](LICENSE)
