import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { ThemeEngine } from "./theme-engine";
import { detectProviders, detectDefaultProvider, getProviderDescription, type LLMProvider } from "./llm-provider";
import { initLog, log, logError } from "./log";
import { ConversationStore } from "./conversation-store";
import { ChatViewProvider, VIEW_ID } from "./chat-view";

let themeEngine: ThemeEngine;
let store: ConversationStore;
let chatView: ChatViewProvider;
let activeProvider: LLMProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = initLog();
  context.subscriptions.push(outputChannel);
  log("Everytheme activating...");

  themeEngine = new ThemeEngine(context);
  saveDefaultThemeIfNeeded(context);
  store = new ConversationStore(context);

  activeProvider = detectDefaultProvider();
  if (activeProvider) {
    log(`Auto-selected provider: ${activeProvider.id} / ${activeProvider.model}`);
  } else {
    log("No provider detected — no API keys found in env");
  }

  chatView = new ChatViewProvider(context, themeEngine, store, {
    getActive: () => activeProvider,
    refresh: () => {
      activeProvider = detectDefaultProvider();
      return activeProvider;
    },
  });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, chatView, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("everytheme.chat", async (arg?: unknown) => {
      const prefill = typeof arg === "string" ? arg : undefined;
      await chatView.reveal(prefill);
    }),
    vscode.commands.registerCommand("everytheme.newConversation", async () => {
      await chatView.reveal();
      chatView.newConversation();
    }),
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
    chatView?.notifyProviderChanged();
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
    chatView?.notifyProviderChanged();
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
    chatView?.notifyProviderChanged();
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
    chatView?.notifyProviderChanged();
    vscode.window.showInformationMessage(`Everytheme: ${entry.providerLabel} ${fieldLabel} updated.`);
  }
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

export function deactivate() {
  chatView?.dispose();
}
