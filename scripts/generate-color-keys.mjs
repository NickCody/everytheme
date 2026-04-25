#!/usr/bin/env node
// Generate src/vscode-color-keys.json from the canonical VS Code docs source.
//
// Source: https://github.com/microsoft/vscode-docs/blob/main/api/references/theme-color.md
// That page is the published reference that VS Code's theme authors use, and its
// format is stable: bullet-list items of the form `- \`color.identifier\`: description`,
// grouped under `##` / `###` headings.
//
// Run with: npm run update-color-keys

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";

const SOURCE_URL =
  "https://raw.githubusercontent.com/microsoft/vscode-docs/main/api/references/theme-color.md";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.resolve(__dirname, "..", "src", "vscode-color-keys.json");

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchText(res.headers.location).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`GET ${url} → HTTP ${res.statusCode}`));
          return;
        }
        let body = "";
        res.setEncoding("utf-8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve(body));
      })
      .on("error", reject);
  });
}

function parse(markdown) {
  const lines = markdown.split(/\r?\n/);
  const colors = new Set();
  const sections = {};
  let currentSection = "(uncategorized)";

  const headingRe = /^#{2,4}\s+(.+?)\s*$/;
  // Match list items whose first inline-code token is a color identifier:
  //   - `editor.background`: description
  //   - `editor.background` — description
  //   * `editor.background`: description
  const itemRe = /^\s*[-*]\s+`([A-Za-z][A-Za-z0-9_.-]*)`\s*[:\-—]/;

  for (const raw of lines) {
    const heading = raw.match(headingRe);
    if (heading) {
      currentSection = heading[1].replace(/\s+colors?$/i, "").trim() || heading[1].trim();
      continue;
    }
    const m = raw.match(itemRe);
    if (!m) continue;
    const id = m[1];
    // Skip obvious non-color-key examples (e.g. references to other docs).
    // Valid VS Code color ids are dotless-or-dotted camelCase with a letter start.
    if (!/^[a-z]/.test(id)) continue;
    if (colors.has(id)) continue;
    colors.add(id);
    (sections[currentSection] ??= []).push(id);
  }

  return {
    colors: [...colors].sort(),
    sections,
  };
}

async function main() {
  console.error(`Fetching ${SOURCE_URL}`);
  const md = await fetchText(SOURCE_URL);
  const { colors, sections } = parse(md);

  if (colors.length < 200) {
    throw new Error(
      `Parsed only ${colors.length} color keys — the upstream format may have changed. ` +
        `Inspect the source and update scripts/generate-color-keys.mjs.`
    );
  }

  const out = {
    source: SOURCE_URL,
    fetchedAt: new Date().toISOString(),
    count: colors.length,
    colors,
    sections,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf-8");
  console.error(`Wrote ${colors.length} color keys across ${Object.keys(sections).length} sections to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
