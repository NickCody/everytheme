import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// Kept as-is for compatibility with LLMProvider.run({ history }).
export interface ChatEntry {
  userPrompt: string;
  toolCalls: string[];
  assistantResponse: string;
}

export type MessageRole = "user" | "assistant" | "system-error";

export interface ToolInvocation {
  name: string;
  input: unknown;
  result: string;
  ok: boolean;
}

export interface Message {
  id: string;
  role: MessageRole;
  text: string;
  toolInvocations?: ToolInvocation[];
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  titleLocked?: boolean;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  providerId?: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
  providerId?: string;
}

interface IndexFile {
  version: 1;
  activeId: string | null;
  order: string[];
}

const INDEX_NAME = "index.json";
const WRITE_DEBOUNCE_MS = 500;
const MAX_LLM_HISTORY_ENTRIES = 10;

export class ConversationStore {
  private dir: string;
  private index: IndexFile;
  private cache = new Map<string, Conversation>();
  private pendingWrites = new Map<string, NodeJS.Timeout>();

  constructor(context: vscode.ExtensionContext) {
    this.dir = path.join(context.globalStorageUri.fsPath, "conversations");
    fs.mkdirSync(this.dir, { recursive: true });
    this.index = this.loadOrRebuildIndex();
  }

  private indexPath(): string {
    return path.join(this.dir, INDEX_NAME);
  }

  private convPath(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  private loadOrRebuildIndex(): IndexFile {
    const p = this.indexPath();
    if (fs.existsSync(p)) {
      try {
        const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
        if (raw && raw.version === 1 && Array.isArray(raw.order)) {
          return raw as IndexFile;
        }
      } catch {
        // fall through and rebuild
      }
    }
    return this.rebuildIndex();
  }

  private rebuildIndex(): IndexFile {
    const files = fs
      .readdirSync(this.dir)
      .filter((f) => f.endsWith(".json") && f !== INDEX_NAME);
    const entries: Array<{ id: string; updatedAt: number }> = [];
    for (const f of files) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(this.dir, f), "utf-8"));
        if (raw?.id && typeof raw.updatedAt === "number") {
          entries.push({ id: raw.id, updatedAt: raw.updatedAt });
        }
      } catch {
        // skip corrupt files
      }
    }
    entries.sort((a, b) => b.updatedAt - a.updatedAt);
    const rebuilt: IndexFile = {
      version: 1,
      activeId: entries[0]?.id ?? null,
      order: entries.map((e) => e.id),
    };
    this.writeIndex(rebuilt);
    return rebuilt;
  }

  private writeIndex(idx: IndexFile = this.index): void {
    fs.writeFileSync(this.indexPath(), JSON.stringify(idx, null, 2), "utf-8");
  }

  private writeConversationSync(conv: Conversation): void {
    fs.writeFileSync(this.convPath(conv.id), JSON.stringify(conv, null, 2), "utf-8");
  }

  private scheduleWrite(conv: Conversation): void {
    const existing = this.pendingWrites.get(conv.id);
    if (existing) {
      clearTimeout(existing);
    }
    const t = setTimeout(() => {
      this.pendingWrites.delete(conv.id);
      this.writeConversationSync(conv);
    }, WRITE_DEBOUNCE_MS);
    this.pendingWrites.set(conv.id, t);
  }

  /** Flush all pending debounced writes. Call on deactivate. */
  flush(): void {
    for (const [id, t] of this.pendingWrites) {
      clearTimeout(t);
      const conv = this.cache.get(id);
      if (conv) {
        this.writeConversationSync(conv);
      }
    }
    this.pendingWrites.clear();
  }

  private loadConversation(id: string): Conversation | undefined {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const p = this.convPath(id);
    if (!fs.existsSync(p)) return undefined;
    try {
      const conv = JSON.parse(fs.readFileSync(p, "utf-8")) as Conversation;
      this.cache.set(id, conv);
      return conv;
    } catch {
      return undefined;
    }
  }

  list(): ConversationSummary[] {
    return this.index.order
      .map((id) => this.loadConversation(id))
      .filter((c): c is Conversation => Boolean(c))
      .map((c) => ({
        id: c.id,
        title: c.title,
        updatedAt: c.updatedAt,
        messageCount: c.messages.length,
        providerId: c.providerId,
      }));
  }

  getActiveId(): string | null {
    return this.index.activeId;
  }

  get(id: string): Conversation | undefined {
    return this.loadConversation(id);
  }

  create(): Conversation {
    const now = Date.now();
    const conv: Conversation = {
      id: crypto.randomUUID(),
      title: "New chat",
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    this.cache.set(conv.id, conv);
    this.writeConversationSync(conv);
    this.index.order = [conv.id, ...this.index.order];
    this.index.activeId = conv.id;
    this.writeIndex();
    return conv;
  }

  setActive(id: string): Conversation | undefined {
    const conv = this.loadConversation(id);
    if (!conv) return undefined;
    this.index.activeId = id;
    this.writeIndex();
    return conv;
  }

  rename(id: string, title: string): Conversation | undefined {
    const conv = this.loadConversation(id);
    if (!conv) return undefined;
    conv.title = title.trim() || "Untitled";
    conv.titleLocked = true;
    conv.updatedAt = Date.now();
    this.scheduleWrite(conv);
    return conv;
  }

  delete(id: string): boolean {
    const p = this.convPath(id);
    const existed = fs.existsSync(p);
    if (existed) fs.unlinkSync(p);
    this.cache.delete(id);
    const pending = this.pendingWrites.get(id);
    if (pending) {
      clearTimeout(pending);
      this.pendingWrites.delete(id);
    }
    this.index.order = this.index.order.filter((x) => x !== id);
    if (this.index.activeId === id) {
      this.index.activeId = this.index.order[0] ?? null;
    }
    this.writeIndex();
    return existed;
  }

  /** Append a message to a conversation. Also bumps the conversation to the
   *  top of the order list, auto-titles on first user message (unless locked),
   *  and schedules a debounced write. */
  appendMessage(id: string, message: Message): Conversation | undefined {
    const conv = this.loadConversation(id);
    if (!conv) return undefined;
    conv.messages.push(message);
    conv.updatedAt = message.createdAt;

    if (!conv.titleLocked && conv.title === "New chat" && message.role === "user") {
      const firstLine = message.text.split(/\r?\n/)[0].trim();
      conv.title =
        firstLine.length > 50 ? `${firstLine.slice(0, 50).trimEnd()}…` : firstLine || "New chat";
    }

    // Move to top of order
    this.index.order = [id, ...this.index.order.filter((x) => x !== id)];
    this.writeIndex();
    this.scheduleWrite(conv);
    return conv;
  }

  setProvider(id: string, providerId: string): void {
    const conv = this.loadConversation(id);
    if (!conv) return;
    conv.providerId = providerId;
    this.scheduleWrite(conv);
  }

  /** Trim conversation messages to the last N user/assistant exchanges and
   *  convert to `ChatEntry[]` for LLMProvider.run({ history }).
   *  Drops system-error messages. Pairs each assistant message with the
   *  nearest preceding user message. */
  buildHistoryFor(id: string): ChatEntry[] {
    const conv = this.loadConversation(id);
    if (!conv) return [];
    const entries: ChatEntry[] = [];
    let pendingUser: string | null = null;
    for (const m of conv.messages) {
      if (m.role === "system-error") continue;
      if (m.role === "user") {
        pendingUser = m.text;
        continue;
      }
      if (m.role === "assistant" && pendingUser !== null) {
        entries.push({
          userPrompt: pendingUser,
          toolCalls: (m.toolInvocations ?? []).map((t) => t.name),
          assistantResponse: m.text,
        });
        pendingUser = null;
      }
    }
    // Return only the last N exchanges
    return entries.slice(-MAX_LLM_HISTORY_ENTRIES);
  }
}
