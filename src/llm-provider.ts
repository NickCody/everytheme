import * as vscode from "vscode";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI, type FunctionDeclaration, SchemaType, type Part } from "@google/generative-ai";
import { log, logError } from "./log";

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
}

export interface LLMProvider {
  id: string;
  label: string;
  model: string;
  run(opts: RunOptions): Promise<string>;
}

// --- Model catalog ---

interface ModelEntry {
  id: string;
  label: string;
  description: string;
}

const ANTHROPIC_MODELS: ModelEntry[] = [
  { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4", description: "Fast, great tool use — recommended" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", description: "Fastest, cheapest — may be less creative" },
  { id: "claude-opus-4-6", label: "Claude Opus 4.6", description: "Most capable — slower, expensive" },
];

const OPENAI_MODELS: ModelEntry[] = [
  { id: "gpt-4.1-mini", label: "GPT-4.1 Mini", description: "Fast, optimized for tool use — recommended" },
  { id: "gpt-4.1", label: "GPT-4.1", description: "More capable — slower" },
  { id: "gpt-4.1-nano", label: "GPT-4.1 Nano", description: "Fastest, cheapest — may struggle with large themes" },
  { id: "gpt-4o", label: "GPT-4o", description: "Multimodal, solid tool use" },
  { id: "gpt-4o-mini", label: "GPT-4o Mini", description: "Fast and cheap" },
];

const GEMINI_MODELS: ModelEntry[] = [
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", description: "Fast, good structured output — recommended" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", description: "Latest flash model" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", description: "Most capable — slower" },
];

// --- Auto-detection ---

export interface ProviderOption {
  provider: LLMProvider;
  providerName: string;
  modelEntry: ModelEntry;
}

export function detectAllOptions(): ProviderOption[] {
  const options: ProviderOption[] = [];

  const anthropicKey =
    vscode.workspace.getConfiguration("everytheme").get<string>("anthropicApiKey") ||
    process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    for (const m of ANTHROPIC_MODELS) {
      options.push({
        provider: new AnthropicProvider(anthropicKey, m.id),
        providerName: "Anthropic",
        modelEntry: m,
      });
    }
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    for (const m of OPENAI_MODELS) {
      options.push({
        provider: new OpenAIProvider(openaiKey, m.id),
        providerName: "OpenAI",
        modelEntry: m,
      });
    }
  }

  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (geminiKey) {
    for (const m of GEMINI_MODELS) {
      options.push({
        provider: new GeminiProvider(geminiKey, m.id),
        providerName: "Gemini",
        modelEntry: m,
      });
    }
  }

  log(`Detected ${options.length} provider/model options (${[anthropicKey ? "Anthropic" : "", openaiKey ? "OpenAI" : "", geminiKey ? "Gemini" : ""].filter(Boolean).join(", ")} keys found)`);
  return options;
}

export function detectDefaultProvider(): LLMProvider | undefined {
  const options = detectAllOptions();
  if (options.length === 0) {
    return undefined;
  }

  const config = vscode.workspace.getConfiguration("everytheme");
  const savedProvider = config.get<string>("provider");
  const savedModel = config.get<string>("model");

  if (savedProvider && savedModel) {
    const match = options.find(
      (o) => o.provider.id === savedProvider && o.provider.model === savedModel
    );
    if (match) {
      return match.provider;
    }
  }

  return options[0].provider;
}

// --- Anthropic ---

class AnthropicProvider implements LLMProvider {
  id = "anthropic";
  label = "Anthropic";

  constructor(private apiKey: string, public model: string) {}

  async run(opts: RunOptions): Promise<string> {
    const client = new Anthropic({ apiKey: this.apiKey });

    const tools: Anthropic.Tool[] = opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool["input_schema"],
    }));

    let messages: Anthropic.MessageParam[] = [
      { role: "user", content: opts.userPrompt },
    ];

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

  constructor(private apiKey: string, public model: string) {}

  async run(opts: RunOptions): Promise<string> {
    const client = new OpenAI({ apiKey: this.apiKey });

    const tools: OpenAI.ChatCompletionTool[] = opts.tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: opts.systemPrompt },
      { role: "user", content: opts.userPrompt },
    ];

    log(`[OpenAI] Sending turn 1 to ${this.model}...`);
    let turn = 1;
    let response = await client.chat.completions.create({
      model: this.model,
      max_tokens: 16384,
      messages,
      tools,
    });
    log(`[OpenAI] Turn ${turn} response: finish_reason=${response.choices[0]?.finish_reason}, usage=${JSON.stringify(response.usage)}`);

    while (response.choices[0]?.finish_reason === "tool_calls") {
      const msg = response.choices[0].message;
      messages.push(msg);

      const toolNames = (msg.tool_calls ?? []).map((tc) => tc.function.name);
      log(`[OpenAI] Turn ${turn}: ${toolNames.length} tool calls: ${toolNames.join(", ")}`);

      for (const tc of msg.tool_calls ?? []) {
        opts.onProgress(`Applying: ${tc.function.name}...`);
        const input = JSON.parse(tc.function.arguments);
        const result = await opts.handleTool(tc.function.name, input);
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result,
        });
      }

      turn++;
      log(`[OpenAI] Sending turn ${turn}...`);
      response = await client.chat.completions.create({
        model: this.model,
        max_tokens: 16384,
        messages,
        tools,
      });
      log(`[OpenAI] Turn ${turn} response: finish_reason=${response.choices[0]?.finish_reason}, usage=${JSON.stringify(response.usage)}`);
    }

    log(`[OpenAI] Complete after ${turn} turns`);
    return response.choices[0]?.message?.content ?? "";
  }
}

// --- Gemini ---

class GeminiProvider implements LLMProvider {
  id = "gemini";
  label = "Gemini";

  constructor(private apiKey: string, public model: string) {}

  async run(opts: RunOptions): Promise<string> {
    const genAI = new GoogleGenerativeAI(this.apiKey);

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

    const chat = model.startChat();
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
