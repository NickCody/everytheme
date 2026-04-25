import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { ThemeEngine } from "./theme-engine";
import {
  ConversationStore,
  type Conversation,
  type ConversationSummary,
  type Message,
  type ToolInvocation,
} from "./conversation-store";
import {
  CancellationToken,
  isCancellationError,
  runChatTurn,
} from "./chat-runner";
import type { LLMProvider } from "./llm-provider";
import { log, logError } from "./log";

export const VIEW_ID = "everytheme.chatView";

// Message protocol (see plan). Keep this in sync with media/chat.js.
//
// Extension → Webview:
//   init, conversation-list, conversation-loaded, message-appended,
//   generation-started, generation-progress, generation-tool,
//   generation-finished, generation-error, provider-changed
//
// Webview → Extension:
//   ready, send, stop, new-conversation, switch-conversation,
//   rename-conversation, delete-conversation, open-logs

export interface ProviderHost {
  getActive(): LLMProvider | undefined;
  refresh(): LLMProvider | undefined;
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private activeTokens = new Map<string, CancellationToken>();
  private pendingPrefill: string | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly themeEngine: ThemeEngine,
    private readonly store: ConversationStore,
    private readonly providerHost: ProviderHost
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
    };
    webviewView.webview.html = this.renderHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      (msg) => this.onMessage(msg).catch((err) => logError("chat-view message failed", err)),
      undefined,
      this.context.subscriptions
    );
  }

  /** Focus the view, optionally pre-filling the composer with text. */
  async reveal(prefill?: string): Promise<void> {
    this.pendingPrefill = prefill ?? null;
    await vscode.commands.executeCommand("workbench.view.extension.everytheme");
    if (this.view) {
      this.view.show?.(true);
      if (this.pendingPrefill !== null) {
        this.post({ type: "prefill", text: this.pendingPrefill });
        this.pendingPrefill = null;
      }
    }
  }

  /** Create a new conversation and emit loaded event to the webview. */
  newConversation(): void {
    const conv = this.store.create();
    this.emitList();
    this.post({ type: "conversation-loaded", conversation: conv });
  }

  notifyProviderChanged(): void {
    const provider = this.providerHost.getActive();
    this.post({
      type: "provider-changed",
      providerLabel: provider?.label ?? null,
      providerId: provider?.id ?? null,
    });
  }

  dispose(): void {
    for (const t of this.activeTokens.values()) t.cancel();
    this.activeTokens.clear();
    this.store.flush();
  }

  // --- message handling ---

  private async onMessage(msg: any): Promise<void> {
    switch (msg?.type) {
      case "ready":
        this.sendInit();
        if (this.pendingPrefill !== null) {
          this.post({ type: "prefill", text: this.pendingPrefill });
          this.pendingPrefill = null;
        }
        return;
      case "send":
        await this.handleSend(msg.conversationId ?? null, String(msg.text ?? ""));
        return;
      case "stop": {
        const t = this.activeTokens.get(String(msg.conversationId));
        if (t) t.cancel();
        return;
      }
      case "new-conversation": {
        const conv = this.store.create();
        this.emitList();
        this.post({ type: "conversation-loaded", conversation: conv });
        return;
      }
      case "switch-conversation": {
        const conv = this.store.setActive(String(msg.conversationId));
        if (conv) {
          this.emitList();
          this.post({ type: "conversation-loaded", conversation: conv });
        }
        return;
      }
      case "rename-conversation": {
        this.store.rename(String(msg.conversationId), String(msg.title ?? ""));
        this.emitList();
        return;
      }
      case "delete-conversation": {
        const id = String(msg.conversationId);
        const confirm = await vscode.window.showWarningMessage(
          "Delete this conversation? This cannot be undone.",
          { modal: true },
          "Delete"
        );
        if (confirm !== "Delete") return;
        const t = this.activeTokens.get(id);
        if (t) t.cancel();
        this.activeTokens.delete(id);
        this.store.delete(id);
        this.emitList();
        const activeId = this.store.getActiveId();
        if (activeId) {
          const next = this.store.get(activeId);
          if (next) this.post({ type: "conversation-loaded", conversation: next });
        } else {
          this.post({ type: "conversation-loaded", conversation: null });
        }
        return;
      }
      case "open-logs":
        await vscode.commands.executeCommand("workbench.action.output.toggleOutput");
        return;
    }
  }

  private sendInit(): void {
    const provider = this.providerHost.getActive();
    const activeId = this.store.getActiveId();
    const active = activeId ? this.store.get(activeId) : undefined;
    let username = "you";
    try {
      username = os.userInfo().username || username;
    } catch {
      // Some sandboxed environments throw — fall back to default.
    }
    this.post({
      type: "init",
      conversations: this.store.list(),
      activeId,
      activeConversation: active ?? null,
      providerLabel: provider?.label ?? null,
      providerId: provider?.id ?? null,
      username,
    });
  }

  private emitList(): void {
    this.post({
      type: "conversation-list",
      conversations: this.store.list(),
      activeId: this.store.getActiveId(),
    });
  }

  private post(msg: unknown): void {
    this.view?.webview.postMessage(msg);
  }

  // --- generation lifecycle ---

  private async handleSend(conversationId: string | null, text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;

    const provider = this.providerHost.refresh();
    if (!provider) {
      const conv = conversationId ? this.store.get(conversationId) : undefined;
      if (conv) {
        const errMsg: Message = {
          id: crypto.randomUUID(),
          role: "system-error",
          text:
            "No AI provider configured. Run 'Everytheme: Configure API Keys & Endpoints' or set an API key env var.",
          createdAt: Date.now(),
        };
        this.store.appendMessage(conv.id, errMsg);
        this.post({ type: "message-appended", conversationId: conv.id, message: errMsg });
      } else {
        vscode.window.showErrorMessage(
          "Everytheme: No AI provider configured. Run 'Everytheme: Configure API Keys & Endpoints'."
        );
      }
      return;
    }

    // Ensure a conversation exists
    let conv: Conversation;
    if (conversationId) {
      const existing = this.store.get(conversationId);
      if (!existing) return;
      conv = existing;
    } else {
      conv = this.store.create();
      this.emitList();
      this.post({ type: "conversation-loaded", conversation: conv });
    }

    // Append user message
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      text: trimmed,
      createdAt: Date.now(),
    };
    this.store.appendMessage(conv.id, userMsg);
    this.post({ type: "message-appended", conversationId: conv.id, message: userMsg });
    this.emitList();

    // Bookkeeping for generation
    const token = new CancellationToken();
    this.activeTokens.set(conv.id, token);
    this.post({
      type: "generation-started",
      conversationId: conv.id,
      providerLabel: provider.label,
      providerId: provider.id,
    });
    this.store.setProvider(conv.id, provider.id);

    const assistantId = crypto.randomUUID();
    const toolInvocationsForUi: ToolInvocation[] = [];

    try {
      // buildHistoryFor only emits fully-paired user+assistant exchanges, so
      // the just-appended user message (unpaired) is already excluded.
      const history = this.store.buildHistoryFor(conv.id);
      const presets = this.themeEngine.listPresets();
      const result = await runChatTurn(
        provider,
        this.themeEngine,
        trimmed,
        history,
        presets,
        token,
        {
          onProgress: (status) =>
            this.post({ type: "generation-progress", conversationId: conv.id, status }),
          onTool: (invocation) => {
            toolInvocationsForUi.push(invocation);
            this.post({
              type: "generation-tool",
              conversationId: conv.id,
              messageId: assistantId,
              invocation,
            });
          },
        }
      );

      const assistantMsg: Message = {
        id: assistantId,
        role: "assistant",
        text: result.text,
        toolInvocations: result.toolInvocations.length > 0 ? result.toolInvocations : undefined,
        createdAt: Date.now(),
      };
      this.store.appendMessage(conv.id, assistantMsg);
      this.post({ type: "message-appended", conversationId: conv.id, message: assistantMsg });
      this.post({ type: "generation-finished", conversationId: conv.id, messageId: assistantId });
      this.emitList();
    } catch (err) {
      const cancelled = isCancellationError(err);
      if (cancelled) {
        // Persist what tool calls did run as an assistant message, plus a
        // system-error note so the transcript reflects the partial state.
        if (toolInvocationsForUi.length > 0) {
          const partial: Message = {
            id: assistantId,
            role: "assistant",
            text: "(cancelled — partial response)",
            toolInvocations: toolInvocationsForUi,
            createdAt: Date.now(),
          };
          this.store.appendMessage(conv.id, partial);
          this.post({ type: "message-appended", conversationId: conv.id, message: partial });
        }
        const note: Message = {
          id: crypto.randomUUID(),
          role: "system-error",
          text: "Cancelled.",
          createdAt: Date.now(),
        };
        this.store.appendMessage(conv.id, note);
        this.post({ type: "message-appended", conversationId: conv.id, message: note });
        this.post({
          type: "generation-error",
          conversationId: conv.id,
          error: "Cancelled",
          cancelled: true,
        });
      } else {
        logError("chat generation failed", err);
        const message = err instanceof Error ? err.message : String(err);
        const errMsg: Message = {
          id: crypto.randomUUID(),
          role: "system-error",
          text: `Error: ${message}`,
          createdAt: Date.now(),
        };
        this.store.appendMessage(conv.id, errMsg);
        this.post({ type: "message-appended", conversationId: conv.id, message: errMsg });
        this.post({ type: "generation-error", conversationId: conv.id, error: message });
      }
      this.emitList();
    } finally {
      this.activeTokens.delete(conv.id);
    }
  }

  // --- HTML ---

  private renderHtml(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString("base64");
    const mediaUri = (name: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", name));

    const htmlPath = path.join(this.context.extensionUri.fsPath, "media", "chat.html");
    const template = fs.readFileSync(htmlPath, "utf-8");

    return template
      .replaceAll("${cspSource}", webview.cspSource)
      .replaceAll("${nonce}", nonce)
      .replaceAll("${cssUri}", String(mediaUri("chat.css")))
      .replaceAll("${markedUri}", String(mediaUri("marked.min.js")))
      .replaceAll("${jsUri}", String(mediaUri("chat.js")));
  }
}
