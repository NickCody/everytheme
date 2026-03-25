import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { ThemeEngine } from "./theme-engine";
import { THEME_TOOLS, handleToolCall } from "./llm-tools";

let themeEngine: ThemeEngine;

export function activate(context: vscode.ExtensionContext) {
  themeEngine = new ThemeEngine(context);

  // Save a copy of the default theme for reset functionality
  saveDefaultThemeIfNeeded(context);

  const chatCmd = vscode.commands.registerCommand("everytheme.chat", () =>
    openThemeChat(context)
  );

  const resetCmd = vscode.commands.registerCommand("everytheme.reset", async () => {
    await themeEngine.resetTheme();
    vscode.window.showInformationMessage("Everytheme: Reset to Kanagawa defaults.");
  });

  context.subscriptions.push(chatCmd, resetCmd);
}

function saveDefaultThemeIfNeeded(context: vscode.ExtensionContext) {
  const defaultPath = path.join(context.extensionPath, "themes", "kanagawa-default.json");
  if (!fs.existsSync(defaultPath)) {
    const currentPath = path.join(
      context.extensionPath,
      "themes",
      "everytheme-color-theme.json"
    );
    fs.copyFileSync(currentPath, defaultPath);
  }
}

async function getApiKey(): Promise<string | undefined> {
  const config = vscode.workspace.getConfiguration("everytheme");
  let key = config.get<string>("anthropicApiKey");

  if (!key) {
    key = process.env.ANTHROPIC_API_KEY;
  }

  if (!key) {
    key = await vscode.window.showInputBox({
      prompt: "Enter your Anthropic API key",
      password: true,
      placeHolder: "sk-ant-...",
    });

    if (key) {
      await config.update("anthropicApiKey", key, vscode.ConfigurationTarget.Global);
    }
  }

  return key;
}

async function openThemeChat(context: vscode.ExtensionContext) {
  const apiKey = await getApiKey();
  if (!apiKey) {
    vscode.window.showErrorMessage("Everytheme: No API key provided.");
    return;
  }

  const userPrompt = await vscode.window.showInputBox({
    prompt: "Describe how you want to change the theme",
    placeHolder: 'e.g. "Make the background a deep navy blue" or "Use warm orange tones for strings"',
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
      progress.report({ message: "Thinking..." });

      try {
        const client = new Anthropic({ apiKey });

        const systemPrompt =
          "You are a VS Code theme designer. The user will describe how they want their editor theme to look. " +
          "Use the provided tools to modify the theme colors. Always call get_current_theme first to see " +
          "what's currently set, then make targeted changes based on the user's request. " +
          "Make cohesive changes - if the user asks for a mood or style, adjust multiple related colors " +
          "to create a harmonious result. Prefer subtle, tasteful adjustments. " +
          "When changing backgrounds, ensure text remains readable with good contrast.";

        let messages: Anthropic.MessageParam[] = [
          { role: "user", content: userPrompt },
        ];

        // Agentic loop: keep going while the model wants to use tools
        let response = await client.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          system: systemPrompt,
          tools: THEME_TOOLS,
          messages,
        });

        while (response.stop_reason === "tool_use") {
          const assistantContent = response.content;
          messages.push({ role: "assistant", content: assistantContent });

          const toolResults: Anthropic.ToolResultBlockParam[] = [];

          for (const block of assistantContent) {
            if (block.type === "tool_use") {
              progress.report({ message: `Applying: ${block.name}...` });
              const result = await handleToolCall(
                themeEngine,
                block.name,
                block.input as Record<string, unknown>
              );
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: result,
              });
            }
          }

          messages.push({ role: "user", content: toolResults });

          response = await client.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 4096,
            system: systemPrompt,
            tools: THEME_TOOLS,
            messages,
          });
        }

        // Extract the final text response
        const textBlock = response.content.find((b) => b.type === "text");
        if (textBlock && textBlock.type === "text") {
          vscode.window.showInformationMessage(
            `Everytheme: ${textBlock.text.slice(0, 200)}`
          );
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Everytheme error: ${message}`);
      }
    }
  );
}

export function deactivate() {}
