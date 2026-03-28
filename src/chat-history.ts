/**
 * In-memory chat history for conversation continuity across requests.
 * Stores the last N user/assistant exchanges so the LLM understands
 * prior context (e.g., "revert that", "make it darker", "I don't like it").
 */

export interface ChatEntry {
  /** The user's raw prompt (without injected theme state) */
  userPrompt: string;
  /** Summary of what tools were called */
  toolCalls: string[];
  /** The LLM's final text response */
  assistantResponse: string;
}

const MAX_ENTRIES = 20;
const history: ChatEntry[] = [];

export function addEntry(entry: ChatEntry): void {
  history.push(entry);
  if (history.length > MAX_ENTRIES) {
    history.splice(0, history.length - MAX_ENTRIES);
  }
}

export function getHistory(): readonly ChatEntry[] {
  return history;
}

export function clearHistory(): void {
  history.length = 0;
}
