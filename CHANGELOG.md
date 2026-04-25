# Changelog

## 0.2.4

- User chat bubble width bumped from 75% to 85%

## 0.2.3

- User chat bubble fixed at 75% width (multi-line wraps as needed)
- User role label now shows the OS username (`os.userInfo().username`, cross-platform) instead of the literal "USER"

## 0.2.2

- Right-align user messages in the chat panel and add a subtle white-33% outline for theme-friendly visibility

## 0.2.1

- Tighten chat transcript spacing: drop literal newlines from markdown rendering, tighter paragraph/list margins, hide redundant ASSISTANT role label

## 0.2.0

- New sidebar chat panel replaces the single-line InputBox flow
  - Activity bar icon opens a persistent chat view (Copilot/Claude-Code style)
  - Multi-line composer: Enter sends, Shift+Enter newline
  - Multiple parallel conversations, each persisted under `globalStorageUri/conversations/` and preserved across restarts
  - Tool calls render inline as collapsible entries showing input + result
  - Markdown assistant responses (via vendored `marked`)
  - Stop button cancels the agentic loop before further tool calls fire (no theme changes from a cancelled response)
  - Auto-titling from the first user prompt; manual rename persists
- `everytheme.chat` command now focuses the view (optionally pre-fills the composer) instead of opening an InputBox
- Added `everytheme.newConversation` command
- In-memory chat history (`src/chat-history.ts`) removed; replaced by persistent `ConversationStore`

## 0.1.3

- Color key registry generated from the canonical VS Code docs (910 keys, 56 sections); refresh via `npm run update-color-keys`
- `set_editor_colors` now validates keys against the registry and reports unknown keys back to the LLM with "did you mean?" suggestions so it can self-correct
- LLM context now includes the *effective* theme (base merged with overrides) plus the full settable-key surface, so tweaks like "lighten `editor.background`" work even when the key hasn't been overridden
- Presets now save the effective theme (not just overrides), producing self-contained colorsets

## 0.1.0

- Initial release
- Kanagawa Wave default base theme
- AI-powered theme creation via natural language (command palette)
- Multi-provider support: Anthropic, OpenAI, Gemini
- Model selection per provider
- Named theme presets: save, load, clone, rename, delete
- Theme picker dropdown
- Dedicated output channel logging
