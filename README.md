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
2. Set at least one API key as an environment variable:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   OPENAI_API_KEY=sk-...
   GEMINI_API_KEY=...
   ```
3. Open the command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
4. Run **Everytheme: Change Theme with AI**
5. Describe your theme

## Commands

| Command | Description |
|---------|-------------|
| `Everytheme: Change Theme with AI` | Describe a theme in natural language |
| `Everytheme: Select Theme` | Pick from saved theme presets |
| `Everytheme: Select AI Provider` | Choose provider and model |
| `Everytheme: Reset to Default` | Clear all overrides, revert to base |

## Supported Providers

| Provider | Default Model | Env Variable |
|----------|--------------|--------------|
| Anthropic | Claude Sonnet 4 | `ANTHROPIC_API_KEY` |
| OpenAI | GPT-4.1 Mini | `OPENAI_API_KEY` |
| Gemini | Gemini 2.0 Flash | `GEMINI_API_KEY` or `GOOGLE_API_KEY` |

All available models can be selected via **Everytheme: Select AI Provider**.

## Settings

| Setting | Description |
|---------|-------------|
| `everytheme.anthropicApiKey` | Anthropic API key (alternative to env var) |
| `everytheme.provider` | Preferred provider (`anthropic`, `openai`, `gemini`) |
| `everytheme.model` | Preferred model ID |

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
