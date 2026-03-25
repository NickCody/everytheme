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

const SYSTEM_PROMPT = `You are an expert VS Code theme designer.

CRITICAL — DETERMINE INTENT FIRST:
Read the user's request carefully and determine if they are:
(A) CREATING A NEW THEME — they say things like "create", "make me a theme", "build a theme", "I want a cyberpunk theme", "give me a new theme". These are requests for a full, new, named theme from scratch.
(B) TWEAKING THE CURRENT THEME — they say things like "change the background", "make strings blue", "darker sidebar", "increase contrast". These are targeted edits to specific colors on whatever is currently active.

DO NOT confuse these. If the user is tweaking, change ONLY the things they mentioned. Do not touch anything else.

RULES FOR TWEAKS (intent B):
- Change ONLY what the user asked for. They may ask for one change or many, but only touch what they mention.
- Use good judgment about what's implied. "Make the background darker" means editor.background and closely related backgrounds (sidebar, activity bar, panel, terminal) — but NOT foregrounds, syntax colors, or unrelated UI. "Make strings green and comments italic" means exactly those two token changes.
- If the user lists several changes, apply all of them, but do not go beyond what they asked.
- Do NOT call reset_theme for tweaks.
- After tweaking, call save_preset with the SAME preset name (from the current theme state) to update it in place. If there is no active preset, do not save.
- Keep it minimal. Respect the user's specificity.

RULES FOR NEW THEMES (intent A):
- Be COMPREHENSIVE. Set EVERY color category — editor, sidebar, activity bar, status bar, title bar, tabs, terminal, buttons, inputs, dropdowns, lists, badges, scrollbars, minimap, panels, notifications, git decorations, diff editor, debug, peek views, breadcrumbs, and all syntax token colors.
- A theme is not done until every visible surface has been considered.
- Colors must work together as a cohesive palette. Pick a base palette of 8-12 colors and derive all specific colors from that palette.
- Ensure readability: maintain strong contrast between text and backgrounds (WCAG AA minimum).
- Terminal ANSI colors (all 16) must be set to match the theme mood.
- Syntax highlighting should cover ALL major categories (20+ rules minimum with proper TextMate scopes as arrays of strings).
- First call reset_theme to start clean, then set_editor_colors (80+ keys), then set_token_colors (20+ rules), then save_preset with a descriptive name.
- This ensures you don't contaminate an existing preset.

SPEED — MINIMIZE ROUND TRIPS:
- The current theme state is included in the user's message. Do NOT call get_current_theme — you already have it.
- For a new theme: call reset_theme + set_editor_colors + set_token_colors + save_preset ALL IN THE SAME TURN.
- For a tweak: call only the needed set_editor_colors and/or set_token_colors (+ save_preset if there's an active preset) in one turn.
- Aim for a single turn of tool calls.

PRESET MANAGEMENT:
- save_preset: Save current live colors as a named preset.
- load_preset: Load a saved preset as active (replaces live colors).
- list_presets / get_preset: Browse and inspect saved presets.
- clone_preset / rename_preset / delete_preset: Manage presets.
- When the user references a saved theme by name, use load_preset.`;

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
