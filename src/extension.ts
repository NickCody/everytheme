import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { ThemeEngine } from "./theme-engine";
import { THEME_TOOLS, handleToolCall } from "./llm-tools";
import { detectProviders, detectDefaultProvider, getProviderDescription, type LLMProvider } from "./llm-provider";
import { addEntry, getHistory } from "./chat-history";
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
    }),
    vscode.commands.registerCommand("everytheme.configureProvider", () => configureProvider())
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
  const providers = detectProviders();
  if (providers.length === 0) {
    vscode.window.showErrorMessage(
      "Everytheme: No API keys found. Run 'Everytheme: Configure API Keys & Endpoints' or set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY env var."
    );
    return;
  }

  const items = providers.map((p) => ({
    label: p.label,
    description: `${p.model}`,
    detail: p.id === activeProvider?.id
      ? `$(check) Active — ${getProviderDescription(p.id)}`
      : getProviderDescription(p.id),
    provider: p,
  }));

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: "Select AI provider",
  });

  if (pick) {
    activeProvider = pick.provider;
    await vscode.workspace
      .getConfiguration("everytheme")
      .update("provider", pick.provider.id, vscode.ConfigurationTarget.Global);
    log(`Provider changed: ${pick.provider.label} / ${pick.provider.model}`);
    vscode.window.showInformationMessage(
      `Everytheme: Using ${pick.provider.label} (${pick.provider.model})`
    );
  }
}

// --- Provider configuration ---

interface ProviderSettingEntry {
  providerId: string;
  providerLabel: string;
  keySetting: string;
  keyEnv: string;
  urlSetting: string;
  urlEnv: string;
}

const PROVIDER_SETTINGS: ProviderSettingEntry[] = [
  { providerId: "anthropic", providerLabel: "Anthropic", keySetting: "anthropicApiKey", keyEnv: "ANTHROPIC_API_KEY", urlSetting: "anthropicBaseUrl", urlEnv: "ANTHROPIC_BASE_URL" },
  { providerId: "openai", providerLabel: "OpenAI", keySetting: "openaiApiKey", keyEnv: "OPENAI_API_KEY", urlSetting: "openaiBaseUrl", urlEnv: "OPENAI_BASE_URL" },
  { providerId: "gemini", providerLabel: "Gemini", keySetting: "geminiApiKey", keyEnv: "GEMINI_API_KEY", urlSetting: "geminiBaseUrl", urlEnv: "GOOGLE_API_BASE_URL" },
];

async function configureProvider() {
  const cfg = vscode.workspace.getConfiguration("everytheme");

  const items: { label: string; description: string; entry: ProviderSettingEntry | undefined; field: "key" | "url" | "clear" }[] = [];

  for (const p of PROVIDER_SETTINGS) {
    const currentKey = cfg.get<string>(p.keySetting);
    const envKey = process.env[p.keyEnv];
    const currentUrl = cfg.get<string>(p.urlSetting);
    const envUrl = process.env[p.urlEnv];

    items.push({
      label: `${p.providerLabel}: API Key`,
      description: currentKey ? "$(key) Set in Everytheme" : envKey ? `$(key) From ${p.keyEnv}` : "$(warning) Not set",
      entry: p,
      field: "key",
    });
    items.push({
      label: `${p.providerLabel}: Base URL`,
      description: currentUrl ? `$(globe) ${currentUrl}` : envUrl ? `$(globe) From ${p.urlEnv}` : "$(globe) SDK default",
      entry: p,
      field: "url",
    });
  }

  items.push({
    label: "$(trash) Clear all Everytheme overrides",
    description: "Restore env-var / SDK defaults for all providers",
    entry: undefined,
    field: "clear",
  });

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: "Configure API keys and endpoints (Everytheme-only, won't affect other tools)",
  });
  if (!pick) { return; }

  if (pick.field === "clear") {
    for (const p of PROVIDER_SETTINGS) {
      await cfg.update(p.keySetting, undefined, vscode.ConfigurationTarget.Global);
      await cfg.update(p.urlSetting, undefined, vscode.ConfigurationTarget.Global);
    }
    activeProvider = detectDefaultProvider();
    vscode.window.showInformationMessage("Everytheme: All overrides cleared. Using env vars / SDK defaults.");
    return;
  }

  const entry = pick.entry!;
  const settingKey = pick.field === "key" ? entry.keySetting : entry.urlSetting;
  const currentValue = cfg.get<string>(settingKey) || "";
  const fieldLabel = pick.field === "key" ? "API Key" : "Base URL";

  const items2: vscode.QuickPickItem[] = [
    { label: `$(pencil) Set ${entry.providerLabel} ${fieldLabel}`, description: currentValue ? `Current: ${pick.field === "key" ? "••••" + currentValue.slice(-4) : currentValue}` : undefined },
    { label: `$(trash) Clear override`, description: "Fall back to env var / SDK default" },
  ];

  const action = await vscode.window.showQuickPick(items2, {
    placeHolder: `${entry.providerLabel} ${fieldLabel}`,
  });
  if (!action) { return; }

  if (action.label.includes("Clear")) {
    await cfg.update(settingKey, undefined, vscode.ConfigurationTarget.Global);
    activeProvider = detectDefaultProvider();
    vscode.window.showInformationMessage(`Everytheme: ${entry.providerLabel} ${fieldLabel} override cleared.`);
    return;
  }

  const value = await vscode.window.showInputBox({
    prompt: `Enter ${entry.providerLabel} ${fieldLabel}`,
    value: currentValue,
    password: pick.field === "key",
    placeHolder: pick.field === "key" ? "sk-..." : "https://api.example.com/v1",
  });

  if (value !== undefined) {
    await cfg.update(settingKey, value || undefined, vscode.ConfigurationTarget.Global);
    activeProvider = detectDefaultProvider();
    vscode.window.showInformationMessage(`Everytheme: ${entry.providerLabel} ${fieldLabel} updated.`);
  }
}

// --- Theme chat ---

const SYSTEM_PROMPT = `You modify VS Code theme colors. You MUST follow these rules exactly.

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

async function openThemeChat() {
  if (!activeProvider) {
    activeProvider = detectDefaultProvider();
    if (!activeProvider) {
      vscode.window.showErrorMessage(
        "Everytheme: No API keys found. Run 'Everytheme: Configure API Keys & Endpoints' or set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY env var."
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
        log(`Chat history: ${getHistory().length} prior entries`);

        const toolCallNames: string[] = [];
        const startTime = Date.now();
        const result = await activeProvider!.run({
          systemPrompt: SYSTEM_PROMPT,
          userPrompt: enrichedPrompt,
          tools: THEME_TOOLS,
          history: getHistory(),
          handleTool: async (name, input) => {
            toolCallNames.push(name);
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

        // Record this exchange in chat history for future context
        addEntry({
          userPrompt,
          toolCalls: toolCallNames,
          assistantResponse: result || "(no response)",
        });

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
