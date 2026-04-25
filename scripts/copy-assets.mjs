#!/usr/bin/env node
// Copy non-TS assets that the compiled extension needs at runtime:
//   - src/vscode-color-keys.json → out/ (JSON import target)
//   - node_modules/marked/marked.min.js → media/ (webview script, vendored
//     so the webview CSP can forbid remote fetches)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const copies = [
  {
    from: path.join(ROOT, "src", "vscode-color-keys.json"),
    to: path.join(ROOT, "out", "vscode-color-keys.json"),
    required: true,
  },
  {
    from: path.join(ROOT, "node_modules", "marked", "marked.min.js"),
    to: path.join(ROOT, "media", "marked.min.js"),
    required: false, // missing if `npm install` hasn't been run; not fatal in dev
  },
];

for (const { from, to, required } of copies) {
  if (!fs.existsSync(from)) {
    if (required) {
      console.error(`missing required asset: ${path.relative(ROOT, from)}`);
      process.exit(1);
    }
    console.error(`skip (not found): ${path.relative(ROOT, from)}`);
    continue;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  console.error(`copied ${path.relative(ROOT, from)} → ${path.relative(ROOT, to)}`);
}
