import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { ThemeEngine } from "./theme-engine";
import { THEME_TOOLS, handleToolCall } from "./llm-tools";
import { detectAllOptions, detectDefaultProvider, type LLMProvider } from "./llm-provider";
import { initLog, log, logError } from "./log";

let themeEngine: ThemeEngine;
let activeProvider: LLMProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = initLog();
  context.subscriptions.push(outputChannel);
  log("Everytheme activating...");

  themeEngine = new ThemeEngine(context);
  saveDefaultThemeIfNeeded(context);

  activeProvider = detectDefaultProvider();
  if (activeProvider) {
    log(`Auto-selected provider: ${activeProvider.id} / ${activeProvider.model}`);
  } else {
    log("No provider detected — no API keys found in env");
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("everytheme.chat", () => openThemeChat()),
    vscode.commands.registerCommand("everytheme.selectTheme", () => selectTheme()),
    vscode.commands.registerCommand("everytheme.selectProvider", () => selectProvider()),
    vscode.commands.registerCommand("everytheme.reset", async () => {
      await themeEngine.resetTheme();
      vscode.window.showInformationMessage("Everytheme: Reset to defaults.");
    })
  );
}

function saveDefaultThemeIfNeeded(context: vscode.ExtensionContext) {
  const defaultPath = path.join(context.extensionPath, "themes", "kanagawa-default.json");
  if (!fs.existsSync(defaultPath)) {
    const currentPath = path.join(context.extensionPath, "themes", "everytheme-color-theme.json");
    fs.copyFileSync(currentPath, defaultPath);
  }
}

// --- Provider selection ---

async function selectProvider() {
  const options = detectAllOptions();
  if (options.length === 0) {
    vscode.window.showErrorMessage(
      "Everytheme: No API keys found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY."
    );
    return;
  }

  const items = options.map((o) => {
    const isActive =
      activeProvider?.id === o.provider.id &&
      activeProvider?.model === o.provider.model;
    return {
      label: `${o.providerName}: ${o.modelEntry.label}`,
      description: o.provider.model,
      detail: isActive
        ? `$(check) Active — ${o.modelEntry.description}`
        : o.modelEntry.description,
      option: o,
    };
  });

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: "Select AI provider and model",
    matchOnDescription: true,
  });

  if (pick) {
    activeProvider = pick.option.provider;
    const config = vscode.workspace.getConfiguration("everytheme");
    await config.update("provider", pick.option.provider.id, vscode.ConfigurationTarget.Global);
    await config.update("model", pick.option.provider.model, vscode.ConfigurationTarget.Global);
    log(`Provider changed: ${pick.option.providerName} / ${pick.option.provider.model}`);
    vscode.window.showInformationMessage(
      `Everytheme: Using ${pick.option.providerName} ${pick.option.modelEntry.label}`
    );
  }
}

// --- Theme chat ---

const SYSTEM_PROMPT = `You are an expert VS Code theme designer. Your job is to create beautiful, complete, professional-quality color themes.

CORE PRINCIPLES:
- When creating or changing a theme, be COMPREHENSIVE. Set EVERY color category — editor, sidebar, activity bar, status bar, title bar, tabs, terminal, buttons, inputs, dropdowns, lists, badges, scrollbars, minimap, panels, notifications, git decorations, diff editor, debug, peek views, breadcrumbs, and all syntax token colors.
- A theme is not done until every visible surface has been considered.
- Colors must work together as a cohesive palette. Pick a base palette of 8-12 colors and derive all specific colors from that palette — backgrounds, foregrounds, accents, borders, highlights, and syntax colors should all feel related.
- Ensure readability: maintain strong contrast between text and backgrounds. WCAG AA minimum (4.5:1 for body text, 3:1 for large text/UI).
- Borders and separators should be subtle but present — they define structure.
- Selection, highlight, and hover states should be clearly visible but not jarring.
- Terminal ANSI colors (all 16) must be set to match the theme mood.
- Syntax highlighting should cover ALL major categories: comments, strings, numbers, keywords, functions, types/classes, variables, properties, constants, operators, punctuation, tags, attributes, regex, escape chars, markup, and invalid tokens. Provide the full TextMate scope for each.

CRITICAL — NEVER POLLUTE EXISTING PRESETS:
- Color changes are LIVE ONLY — they do NOT auto-save to any preset.
- The only way to persist a theme is to explicitly call save_preset.
- When creating a NEW theme: first call reset_theme to start from a clean slate, then apply your colors, then call save_preset to save it. This ensures you don't contaminate an existing preset.
- When TWEAKING the current theme (e.g. "make the background darker"): just apply the changes, then call save_preset with the same name to update it.
- When the user asks you to create a theme, ALWAYS give it a name and save it as a preset. Infer a good name from the request (e.g. "Cyberpunk Neon", "Ocean Depths", "Forest Dawn").

SPEED — MINIMIZE ROUND TRIPS:
- The current theme state is included in the user's message. Do NOT call get_current_theme — you already have it.
- For a NEW theme, call reset_theme + set_editor_colors + set_token_colors + save_preset ALL IN THE SAME TURN as parallel tool calls.
- For a TWEAK, call set_editor_colors and/or set_token_colors + save_preset in one turn.
- Aim for a single turn of tool calls. Only make additional turns if you need to fix something.

WORKFLOW FOR NEW THEME:
1. Read the current theme state from the user's message.
2. Design your palette — decide on backgrounds, foregrounds, and accent colors.
3. In ONE tool-call turn, call ALL of these together:
   - reset_theme (clears the slate so existing presets are untouched)
   - set_editor_colors with a LARGE object covering all UI surfaces (80+ color keys minimum)
   - set_token_colors with rules for ALL syntax categories (20+ rules minimum, each with proper TextMate scopes as an array of strings)
   - save_preset with a descriptive name and description

PRESET MANAGEMENT:
- save_preset: Save current live colors as a named preset. Always call this after creating or modifying a theme.
- load_preset: Load a saved preset as active (replaces live colors).
- list_presets / get_preset: Browse and inspect saved presets.
- clone_preset / rename_preset / delete_preset: Manage presets.
- When the user references a saved theme by name, use load_preset.

Be bold and creative with color choices. The user wants a TRANSFORMATION, not a tweak. Deliver a fully realized theme that feels intentional and polished.`;

async function openThemeChat() {
  if (!activeProvider) {
    activeProvider = detectDefaultProvider();
    if (!activeProvider) {
      vscode.window.showErrorMessage(
        "Everytheme: No API keys found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY."
      );
      return;
    }
  }

  const userPrompt = await vscode.window.showInputBox({
    prompt: `Describe your theme (using ${activeProvider.label} ${activeProvider.model})`,
    placeHolder:
      'e.g. "Create a warm sunset theme" or "Make it cyberpunk neon"',
  });

  if (!userPrompt) {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Everytheme",
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: `${activeProvider!.label}: Thinking...` });

      try {
        // Pre-inject current state so the LLM doesn't need to call get_current_theme
        const currentState = themeEngine.getColorSummary();
        const presets = themeEngine.listPresets();
        const contextBlock = [
          `<current_theme_state>`,
          `Active preset: ${currentState.activePreset ?? "(none — base Kanagawa Wave)"}`,
          `Editor colors (${Object.keys(currentState.editorColors).length} overrides): ${JSON.stringify(currentState.editorColors)}`,
          `Token colors (${currentState.tokenColors.length} rules): ${JSON.stringify(currentState.tokenColors)}`,
          `</current_theme_state>`,
          presets.length > 0
            ? `<saved_presets>${JSON.stringify(presets)}</saved_presets>`
            : "",
        ]
          .filter(Boolean)
          .join("\n");

        const enrichedPrompt = `${userPrompt}\n\n${contextBlock}`;

        log(`Chat request: provider=${activeProvider!.id} model=${activeProvider!.model}`);
        log(`User prompt: ${userPrompt}`);
        log(`Context: activePreset=${currentState.activePreset ?? "none"}, ${Object.keys(currentState.editorColors).length} editor colors, ${currentState.tokenColors.length} token rules, ${presets.length} saved presets`);

        const startTime = Date.now();
        const result = await activeProvider!.run({
          systemPrompt: SYSTEM_PROMPT,
          userPrompt: enrichedPrompt,
          tools: THEME_TOOLS,
          handleTool: async (name, input) => {
            const inputJson = JSON.stringify(input);
            if (name === "set_editor_colors") {
              log(`Tool call: ${name} — ${Object.keys((input as any).colors ?? {}).length} colors, raw keys: ${JSON.stringify(Object.keys(input)).slice(0, 500)}`);
              if (!input.colors) {
                log(`Tool call: ${name} — full raw input: ${inputJson.slice(0, 2000)}`);
              }
            } else if (name === "set_token_colors") {
              log(`Tool call: ${name} — ${((input as any).updates ?? []).length} rules`);
            } else {
              log(`Tool call: ${name}(${inputJson.slice(0, 300)})`);
            }
            const toolResult = await handleToolCall(themeEngine, name, input);
            log(`Tool result: ${toolResult.slice(0, 300)}`);
            return toolResult;
          },
          onProgress: (msg) => progress.report({ message: msg }),
        });
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        log(`Chat complete in ${elapsed}s`);
        if (result) {
          log(`LLM response: ${result.slice(0, 500)}`);
          vscode.window.showInformationMessage(
            `Everytheme: ${result.slice(0, 200)}`
          );
        }
      } catch (err: unknown) {
        logError("Chat failed", err);
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Everytheme error: ${message}`);
      }
    }
  );
}

// --- Theme selection ---

async function selectTheme() {
  const presets = themeEngine.listPresets();
  const activePreset = themeEngine.activePresetName;

  const items: vscode.QuickPickItem[] = [
    {
      label: "$(star) Kanagawa Wave",
      description: "Default",
      detail: activePreset === null ? "$(check) Active" : undefined,
    },
    ...presets.map((p) => ({
      label: p.name,
      description: p.description ?? "",
      detail: p.name === activePreset ? "$(check) Active" : undefined,
    })),
  ];

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: "Select a theme",
    matchOnDescription: true,
  });

  if (!pick) {
    return;
  }

  if (pick.label === "$(star) Kanagawa Wave") {
    await themeEngine.resetTheme();
    vscode.window.showInformationMessage("Everytheme: Loaded Kanagawa Wave.");
  } else {
    const loaded = await themeEngine.loadPreset(pick.label);
    if (loaded) {
      vscode.window.showInformationMessage(`Everytheme: Loaded "${pick.label}".`);
    }
  }
}

export function deactivate() {}
