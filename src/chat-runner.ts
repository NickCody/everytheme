import { ThemeEngine, COLOR_KEYS_META } from "./theme-engine";
import { THEME_TOOLS, handleToolCall } from "./llm-tools";
import type { LLMProvider } from "./llm-provider";
import type { ChatEntry, ToolInvocation } from "./conversation-store";
import { log, logError } from "./log";

export const SYSTEM_PROMPT = `You modify VS Code theme colors. You MUST follow these rules exactly.

IMPORTANT: MOST REQUESTS ARE SMALL TWEAKS. Only create a full theme when the user says "create a theme" or "new theme."

RULES FOR TWEAKS (most requests):
- "darken the editor background by 10%" → call set_editor_colors with {"colors": {"editor.background": "<new hex>"}}. That's it. ONE key. ONE tool call. Nothing else.
- "make strings green" → call set_token_colors with ONE rule for strings. Nothing else.
- "change the sidebar and title bar to navy" → set_editor_colors with 2-3 keys. Nothing else.
- ONLY set what was explicitly asked. Never set foregrounds when asked about backgrounds. Never set syntax colors when asked about UI colors. Never set extra colors "for consistency."
- NEVER call reset_theme for a tweak.
- NEVER call save_preset for a tweak. The engine auto-saves.
- If the user says "darken by X%", compute the darkened hex value from the current color shown in the theme state.

RULES FOR NEW THEMES (only when user says "create", "new theme", "build a theme", "give me a X theme"):
- Call reset_theme, then set_editor_colors (80+ keys), then set_token_colors (20+ rules), then save_preset. All in one turn.
- Make a cohesive palette. Ensure contrast. Set all 16 terminal ANSI colors. Use proper TextMate scopes (arrays of strings).

CONTEXT:
- The current theme state (active preset, colors, token rules) is provided in the user's message. Do NOT call get_current_theme.
- Make all tool calls in a SINGLE turn.
- Presets: save_preset, load_preset, list_presets, get_preset, clone_preset, rename_preset, delete_preset.`;

export class CancellationToken {
  cancelled = false;
  cancel() {
    this.cancelled = true;
  }
  throwIfCancelled() {
    if (this.cancelled) {
      throw new Error("__CANCELLED__");
    }
  }
}

export function isCancellationError(err: unknown): boolean {
  return err instanceof Error && err.message === "__CANCELLED__";
}

export interface RunnerEvents {
  onProgress: (status: string) => void;
  onTool: (invocation: ToolInvocation) => void;
}

export interface RunnerResult {
  text: string;
  toolInvocations: ToolInvocation[];
}

/** Build the enriched prompt: user text + current theme state + settable-key
 *  registry. Same context block that extension.ts used to build inline. */
export function buildEnrichedPrompt(
  userPrompt: string,
  themeEngine: ThemeEngine,
  presetSummaries: ReadonlyArray<{ name: string; description?: string }>
): string {
  const state = themeEngine.getColorSummary();
  const settableKeysBlock = Object.entries(COLOR_KEYS_META.sections)
    .map(([section, keys]) => `${section} (${keys.length}): ${keys.join(", ")}`)
    .join("\n");

  const parts = [
    userPrompt,
    "",
    `<current_theme_state>`,
    `Active preset: ${state.activePreset ?? "(none — base Everytheme / Kanagawa Wave)"}`,
    `Overrides: ${state.overrideColorCount} editor color(s) and ${state.overrideTokenCount} token rule(s) currently customized on top of the base theme.`,
    `Effective editor colors (${Object.keys(state.editorColors).length} keys, base+overrides merged): ${JSON.stringify(state.editorColors)}`,
    `Effective token color rules (${state.tokenColors.length} rules, base+overrides merged): ${JSON.stringify(state.tokenColors)}`,
    `</current_theme_state>`,
    `<all_settable_editor_color_keys count="${COLOR_KEYS_META.count}" source="${COLOR_KEYS_META.source}">`,
    `Every valid VS Code color key you can pass to set_editor_colors, grouped by section. Keys not listed here will be REJECTED. Keys absent from "Effective editor colors" above will fall back to VS Code defaults (not Everytheme), so set them explicitly when building a full theme.`,
    settableKeysBlock,
    `</all_settable_editor_color_keys>`,
    presetSummaries.length > 0
      ? `<saved_presets>${JSON.stringify(presetSummaries)}</saved_presets>`
      : "",
  ];
  return parts.filter(Boolean).join("\n");
}

/** Run a single turn of the chat against an LLM provider. Wraps tool
 *  invocations with a cancellation check, collects them for the UI, and
 *  reports progress. */
export async function runChatTurn(
  provider: LLMProvider,
  themeEngine: ThemeEngine,
  userPrompt: string,
  history: ReadonlyArray<ChatEntry>,
  presetSummaries: ReadonlyArray<{ name: string; description?: string }>,
  token: CancellationToken,
  events: RunnerEvents
): Promise<RunnerResult> {
  const enriched = buildEnrichedPrompt(userPrompt, themeEngine, presetSummaries);
  const toolInvocations: ToolInvocation[] = [];

  log(
    `Chat turn: provider=${provider.id} model=${provider.model}, history=${history.length} entries, ${toolInvocations.length} tools so far`
  );

  const text = await provider.run({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: enriched,
    tools: THEME_TOOLS,
    history,
    handleTool: async (name, input) => {
      token.throwIfCancelled();
      let result: string;
      let ok = true;
      try {
        result = await handleToolCall(themeEngine, name, input);
      } catch (err) {
        ok = false;
        result = err instanceof Error ? err.message : String(err);
        logError(`Tool ${name} threw`, err);
      }
      token.throwIfCancelled();
      const invocation: ToolInvocation = { name, input, result, ok };
      toolInvocations.push(invocation);
      events.onTool(invocation);
      return result;
    },
    onProgress: (msg) => {
      if (token.cancelled) return;
      events.onProgress(msg);
    },
  });

  token.throwIfCancelled();
  return { text, toolInvocations };
}
