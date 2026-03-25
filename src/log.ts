import * as vscode from "vscode";

let channel: vscode.OutputChannel;

export function initLog(): vscode.OutputChannel {
  channel = vscode.window.createOutputChannel("Everytheme");
  return channel;
}

function timestamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 23);
}

export function log(msg: string): void {
  channel?.appendLine(`[${timestamp()}] ${msg}`);
}

export function logError(msg: string, err?: unknown): void {
  const detail =
    err instanceof Error
      ? `${err.message}\n${err.stack ?? ""}`
      : err !== undefined
        ? String(err)
        : "";
  channel?.appendLine(`[${timestamp()}] ERROR: ${msg}${detail ? `\n${detail}` : ""}`);
}
