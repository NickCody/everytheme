import * as vscode from "vscode";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI, type FunctionDeclaration, SchemaType, type Part } from "@google/generative-ai";
import { log, logError } from "./log";
import type { ChatEntry } from "./conversation-store";

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type ToolHandler = (
  name: string,
  input: Record<string, unknown>
) => Promise<string>;

export interface RunOptions {
  systemPrompt: string;
  userPrompt: string;
  tools: ToolDef[];
  handleTool: ToolHandler;
  onProgress: (msg: string) => void;
  /** Prior conversation entries for continuity across requests */
  history?: readonly ChatEntry[];
}

export interface LLMProvider {
  id: string;
  label: string;
  model: string;
  run(opts: RunOptions): Promise<string>;
}

// --- Provider catalog (one model per engine) ---

interface ProviderEntry {
  id: string;
  label: string;
  model: string;
  description: string;
}

const PROVIDERS: ProviderEntry[] = [
  { id: "anthropic", label: "Anthropic", model: "claude-sonnet-4-20250514", description: "Claude Sonnet 4 — fast, excellent tool use" },
  { id: "openai", label: "OpenAI", model: "gpt-5.4", description: "GPT-5.4 — strong reasoning and tool use" },
  { id: "gemini", label: "Gemini", model: "gemini-2.0-flash", description: "Gemini 2.0 Flash — fast, good structured output" },
];

// --- Auto-detection ---

/** Read an everytheme setting, returning undefined for empty strings. */
function setting(key: string): string | undefined {
  return vscode.workspace.getConfiguration("everytheme").get<string>(key) || undefined;
}

export function detectProviders(): LLMProvider[] {
  const providers: LLMProvider[] = [];

  // Anthropic: setting > env var
  const anthropicKey = setting("anthropicApiKey") ?? process.env.ANTHROPIC_API_KEY;
  const anthropicBaseUrl = setting("anthropicBaseUrl") ?? process.env.ANTHROPIC_BASE_URL;
  if (anthropicKey) {
    const entry = PROVIDERS.find((p) => p.id === "anthropic")!;
    providers.push(new AnthropicProvider(anthropicKey, entry.model, anthropicBaseUrl));
  }

  // OpenAI: setting > env var
  const openaiKey = setting("openaiApiKey") ?? process.env.OPENAI_API_KEY;
  const openaiBaseUrl = setting("openaiBaseUrl") ?? process.env.OPENAI_BASE_URL;
  if (openaiKey) {
    const entry = PROVIDERS.find((p) => p.id === "openai")!;
    providers.push(new OpenAIProvider(openaiKey, entry.model, openaiBaseUrl));
  }

  // Gemini: setting > env var
  const geminiKey = setting("geminiApiKey") ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  const geminiBaseUrl = setting("geminiBaseUrl") ?? process.env.GOOGLE_API_BASE_URL;
  if (geminiKey) {
    const entry = PROVIDERS.find((p) => p.id === "gemini")!;
    providers.push(new GeminiProvider(geminiKey, entry.model, geminiBaseUrl));
  }

  log(`Detected ${providers.length} providers (${providers.map((p) => p.label).join(", ")})`);
  return providers;
}

export function getProviderDescription(id: string): string {
  return PROVIDERS.find((p) => p.id === id)?.description ?? "";
}

export function detectDefaultProvider(): LLMProvider | undefined {
  const providers = detectProviders();
  if (providers.length === 0) {
    return undefined;
  }

  const savedId = vscode.workspace.getConfiguration("everytheme").get<string>("provider");
  if (savedId) {
    const match = providers.find((p) => p.id === savedId);
    if (match) {
      return match;
    }
  }

  return providers[0];
}

// --- Anthropic ---

class AnthropicProvider implements LLMProvider {
  id = "anthropic";
  label = "Anthropic";

  constructor(private apiKey: string, public model: string, private baseURL?: string) {}

  async run(opts: RunOptions): Promise<string> {
    const client = new Anthropic({ apiKey: this.apiKey, ...(this.baseURL && { baseURL: this.baseURL }) });

    const tools: Anthropic.Tool[] = opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool["input_schema"],
    }));

    // Build message history for conversation continuity
    let messages: Anthropic.MessageParam[] = [];
    if (opts.history?.length) {
      for (const entry of opts.history) {
        messages.push({ role: "user", content: entry.userPrompt });
        const summary = entry.toolCalls.length > 0
          ? `[Called: ${entry.toolCalls.join(", ")}] ${entry.assistantResponse}`
          : entry.assistantResponse;
        messages.push({ role: "assistant", content: summary });
      }
      log(`[Anthropic] Including ${opts.history.length} history entries`);
    }
    messages.push({ role: "user", content: opts.userPrompt });

    log(`[Anthropic] Sending turn 1 to ${this.model}...`);
    let turn = 1;
    let response = await client.messages.create({
      model: this.model,
      max_tokens: 16384,
      system: opts.systemPrompt,
      tools,
      messages,
    });
    log(`[Anthropic] Turn ${turn} response: stop_reason=${response.stop_reason}, usage=${JSON.stringify(response.usage)}`);

    while (response.stop_reason === "tool_use") {
      const assistantContent = response.content;
      messages.push({ role: "assistant", content: assistantContent });

      const toolNames = assistantContent
        .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
        .map((b) => b.name);
      log(`[Anthropic] Turn ${turn}: ${toolNames.length} tool calls: ${toolNames.join(", ")}`);

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of assistantContent) {
        if (block.type === "tool_use") {
          opts.onProgress(`Applying: ${block.name}...`);
          const result = await opts.handleTool(
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
      turn++;
      log(`[Anthropic] Sending turn ${turn}...`);
      response = await client.messages.create({
        model: this.model,
        max_tokens: 16384,
        system: opts.systemPrompt,
        tools,
        messages,
      });
      log(`[Anthropic] Turn ${turn} response: stop_reason=${response.stop_reason}, usage=${JSON.stringify(response.usage)}`);
    }

    log(`[Anthropic] Complete after ${turn} turns`);
    const textBlock = response.content.find((b) => b.type === "text");
    return textBlock?.type === "text" ? textBlock.text : "";
  }
}

// --- OpenAI ---

class OpenAIProvider implements LLMProvider {
  id = "openai";
  label = "OpenAI";

  constructor(private apiKey: string, public model: string, private baseURL?: string) {}

  async run(opts: RunOptions): Promise<string> {
    const client = new OpenAI({ apiKey: this.apiKey, ...(this.baseURL && { baseURL: this.baseURL }) });

    const tools = opts.tools.map((t) => ({
      type: "function" as const,
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    }));

    // Build input with conversation history for continuity
    const input: any[] = [
      { role: "developer", content: opts.systemPrompt },
    ];
    if (opts.history?.length) {
      for (const entry of opts.history) {
        input.push({ role: "user", content: entry.userPrompt });
        const summary = entry.toolCalls.length > 0
          ? `[Called: ${entry.toolCalls.join(", ")}] ${entry.assistantResponse}`
          : entry.assistantResponse;
        input.push({ role: "assistant", content: summary });
      }
      log(`[OpenAI] Including ${opts.history.length} history entries`);
    }
    input.push({ role: "user", content: opts.userPrompt });

    log(`[OpenAI] Sending turn 1 to ${this.model} (responses API, reasoning=low)...`);
    let turn = 1;
    let response = await (client as any).responses.create({
      model: this.model,
      max_output_tokens: 16384,
      reasoning: { effort: "low" },
      input,
      tools,
    });
    log(`[OpenAI] Turn ${turn} response: status=${response.status}, output=${response.output?.length ?? 0} items, usage=${JSON.stringify(response.usage)}`);

    // Agentic loop: process function calls
    while (true) {
      const functionCalls = (response.output ?? []).filter(
        (item: any) => item.type === "function_call"
      );
      if (functionCalls.length === 0) {
        break;
      }

      const toolNames = functionCalls.map((fc: any) => fc.name);
      log(`[OpenAI] Turn ${turn}: ${toolNames.length} tool calls: ${toolNames.join(", ")}`);

      // Add assistant output to conversation
      const newInput: any[] = [];
      for (const item of response.output) {
        newInput.push(item);
      }

      // Execute tool calls and add results
      for (const fc of functionCalls) {
        opts.onProgress(`Applying: ${fc.name}...`);
        const args = typeof fc.arguments === "string" ? JSON.parse(fc.arguments) : fc.arguments;
        const result = await opts.handleTool(fc.name, args);
        newInput.push({
          type: "function_call_output",
          call_id: fc.call_id,
          output: result,
        });
      }

      turn++;
      log(`[OpenAI] Sending turn ${turn}...`);
      response = await (client as any).responses.create({
        model: this.model,
        max_output_tokens: 16384,
        reasoning: { effort: "low" },
        input: [...input, ...newInput],
        tools,
      });
      log(`[OpenAI] Turn ${turn} response: status=${response.status}, output=${response.output?.length ?? 0} items, usage=${JSON.stringify(response.usage)}`);

      // Accumulate for next iteration
      input.push(...newInput);
    }

    // Extract text from output
    const textItems = (response.output ?? []).filter(
      (item: any) => item.type === "message" && item.content
    );
    const text = textItems
      .flatMap((item: any) => item.content)
      .filter((c: any) => c.type === "output_text")
      .map((c: any) => c.text)
      .join("");

    log(`[OpenAI] Complete after ${turn} turns`);
    return text;
  }
}

// --- Gemini ---

class GeminiProvider implements LLMProvider {
  id = "gemini";
  label = "Gemini";

  constructor(private apiKey: string, public model: string, private baseURL?: string) {}

  async run(opts: RunOptions): Promise<string> {
    const genAI = new GoogleGenerativeAI(this.apiKey);
    if (this.baseURL) {
      (genAI as any).baseUrl = this.baseURL;
    }

    const functionDeclarations: FunctionDeclaration[] = opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: sanitizeSchemaForGemini(t.input_schema),
    }));

    const model = genAI.getGenerativeModel({
      model: this.model,
      systemInstruction: { parts: [{ text: opts.systemPrompt }], role: "user" },
      tools: [{ functionDeclarations }],
    });

    // Build chat history for conversation continuity
    const chatHistory: { role: string; parts: { text: string }[] }[] = [];
    if (opts.history?.length) {
      for (const entry of opts.history) {
        chatHistory.push({ role: "user", parts: [{ text: entry.userPrompt }] });
        const summary = entry.toolCalls.length > 0
          ? `[Called: ${entry.toolCalls.join(", ")}] ${entry.assistantResponse}`
          : entry.assistantResponse;
        chatHistory.push({ role: "model", parts: [{ text: summary }] });
      }
      log(`[Gemini] Including ${opts.history.length} history entries`);
    }

    const chat = model.startChat({ history: chatHistory });
    log(`[Gemini] Sending turn 1 to ${this.model}...`);
    let turn = 1;
    let result = await chat.sendMessage(opts.userPrompt);
    let response = result.response;
    log(`[Gemini] Turn ${turn} response: ${response.functionCalls()?.length ?? 0} function calls, finishReason=${response.candidates?.[0]?.finishReason}`);

    while (response.functionCalls()?.length) {
      const functionCalls = response.functionCalls()!;
      const toolNames = functionCalls.map((fc) => fc.name);
      log(`[Gemini] Turn ${turn}: ${toolNames.length} tool calls: ${toolNames.join(", ")}`);

      const responseParts: Part[] = [];
      for (const fc of functionCalls) {
        opts.onProgress(`Applying: ${fc.name}...`);
        const toolResult = await opts.handleTool(
          fc.name,
          (fc.args as Record<string, unknown>) ?? {}
        );
        responseParts.push({
          functionResponse: {
            name: fc.name,
            response: { result: toolResult },
          },
        });
      }

      turn++;
      log(`[Gemini] Sending turn ${turn}...`);
      result = await chat.sendMessage(responseParts);
      response = result.response;
      log(`[Gemini] Turn ${turn} response: ${response.functionCalls()?.length ?? 0} function calls, finishReason=${response.candidates?.[0]?.finishReason}`);
    }

    log(`[Gemini] Complete after ${turn} turns`);
    return response.text();
  }
}

// --- Gemini schema sanitization ---

function sanitizeSchemaForGemini(schema: Record<string, unknown>): any {
  return sanitizeNode(schema);
}

function sanitizeNode(node: unknown): any {
  if (node === null || node === undefined || typeof node !== "object") {
    return node;
  }
  if (Array.isArray(node)) {
    return node.map(sanitizeNode);
  }

  const obj = node as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (
      ["$schema", "oneOf", "anyOf", "allOf", "additionalProperties", "const", "default"].includes(key)
    ) {
      continue;
    }

    if (key === "type" && typeof value === "string") {
      result[key] = geminiType(value);
      continue;
    }

    result[key] = sanitizeNode(value);
  }

  return result;
}

function geminiType(type: string): SchemaType {
  const map: Record<string, SchemaType> = {
    string: SchemaType.STRING,
    number: SchemaType.NUMBER,
    integer: SchemaType.INTEGER,
    boolean: SchemaType.BOOLEAN,
    array: SchemaType.ARRAY,
    object: SchemaType.OBJECT,
  };
  return map[type] ?? SchemaType.STRING;
}
