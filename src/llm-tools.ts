import { type ToolDef } from "./llm-provider";
import { ThemeEngine, VALID_COLOR_KEYS, COLOR_KEYS_META } from "./theme-engine";

// The authoritative set of valid VS Code color keys lives in
// src/vscode-color-keys.json, generated from the canonical docs by
// `npm run update-color-keys` (see scripts/generate-color-keys.mjs).
// Import it via VALID_COLOR_KEYS / COLOR_KEYS_META from theme-engine.

// Build a case-insensitive lookup once so we can cheaply suggest corrections
// for LLM-provided keys that differ only in casing.
const CI_LOOKUP = new Map<string, string>();
for (const key of VALID_COLOR_KEYS) {
  CI_LOOKUP.set(key.toLowerCase(), key);
}

/** Find a plausible valid color key for a mistyped one. Cheap — meant to help
 *  the LLM self-correct when it gets casing or a common suffix wrong. */
function suggestColorKey(bad: string): string | undefined {
  const hit = CI_LOOKUP.get(bad.toLowerCase());
  if (hit) return hit;
  // Prefix match within the same category (e.g. "editor.foo" → any editor.*).
  const dot = bad.indexOf(".");
  if (dot > 0) {
    const prefix = bad.slice(0, dot + 1).toLowerCase();
    const suffix = bad.slice(dot + 1).toLowerCase();
    let best: string | undefined;
    let bestLen = 0;
    for (const key of VALID_COLOR_KEYS) {
      const lk = key.toLowerCase();
      if (!lk.startsWith(prefix)) continue;
      const ks = lk.slice(prefix.length);
      // Prefer the one with the longest shared-start with the user's suffix.
      let shared = 0;
      while (shared < suffix.length && shared < ks.length && suffix[shared] === ks[shared]) {
        shared++;
      }
      if (shared > bestLen) {
        bestLen = shared;
        best = key;
      }
    }
    if (best && bestLen >= 3) return best;
  }
  return undefined;
}

const TOKEN_SCOPE_REFERENCE = `
When setting token colors, each rule needs a "scope" (TextMate scope selector) that determines what syntax it matches.
Common scopes to set for a complete theme:
- comment, punctuation.definition.comment — code comments
- variable, variable.other, variable.parameter — variables and parameters
- variable.language — language builtins like this/self
- variable.other.property — object properties
- constant.numeric — numbers
- constant.language — true, false, null, etc.
- constant.character.escape — escape sequences like \\n
- constant.other.color — color literals
- string, punctuation.definition.string — string literals
- string.regexp — regular expressions
- string.other.link — links
- keyword, keyword.control — all keywords (if, else, return, etc.)
- keyword.control.flow, keyword.control.conditional, keyword.control.loop — flow keywords
- keyword.control.import — import/require
- keyword.control.trycatch — try/catch/finally
- keyword.operator — operators (+, -, =, etc.)
- keyword.other.unit — units (px, em, %, etc.)
- storage.type — let, const, var, function, class, etc.
- storage.modifier — public, private, static, async, etc.
- entity.name.function — function/method names at definition
- entity.name.type, entity.name.class — type/class names
- entity.name.tag — HTML/XML tags
- entity.name.section — section headings (markdown, etc.)
- entity.name.namespace, entity.name.type.module — namespaces/modules
- entity.other.attribute-name — HTML/XML attributes
- entity.other.inherited-class — extends/implements targets
- support.function — built-in/library functions
- support.type, support.class — built-in/library types
- support.constant — built-in constants
- support.variable — built-in variables
- meta.function-call — function call expressions
- meta.brace, punctuation — braces, brackets, punctuation
- punctuation.section.embedded — embedded code delimiters
- markup.heading — headings
- markup.bold — bold text
- markup.italic — italic text
- markup.underline — underlined text
- markup.inserted — diff additions
- markup.deleted — diff deletions
- markup.changed — diff modifications
- markup.inline.raw — inline code
- markup.list — list items
- markup.quote — blockquotes
- invalid, invalid.illegal — invalid/illegal code
- meta.tag — tag regions
- meta.import — import statements
`.trim();

export const THEME_TOOLS: ToolDef[] = [
  {
    name: "set_editor_colors",
    description:
      `Set VS Code workbench/editor UI colors. Pass a 'colors' object mapping VS Code color keys to hex values (#RRGGBB or #RRGGBBAA). ` +
      `Keys are validated against the official VS Code theme-color registry (${COLOR_KEYS_META.count} valid ids). ` +
      `UNKNOWN KEYS ARE REJECTED and reported back in the tool response — if you see "unknown keys" in the result, fix the spelling and call the tool again. ` +
      `For TWEAKS: set ONLY the specific keys the user asked about (1-20 keys). ` +
      `For NEW THEMES: set comprehensively (80+ keys). ` +
      `Key format: 'category.property', e.g. editor.background, sideBar.background, activityBar.background, statusBar.background, ` +
      `tab.activeBackground, titleBar.activeBackground, terminal.background, panel.background, ` +
      `editor.foreground, editor.selectionBackground, editorLineNumber.foreground, editorCursor.foreground, ` +
      `list.activeSelectionBackground, input.background, button.background, badge.background, ` +
      `terminal.ansiBlack/Red/Green/Yellow/Blue/Magenta/Cyan/White (and ansiBright* variants), ` +
      `editorBracketHighlight.foreground1-6, gitDecoration.*, minimap.*, scrollbarSlider.*, etc. ` +
      `Full reference: ${COLOR_KEYS_META.source}`,
    input_schema: {
      type: "object" as const,
      properties: {
        colors: {
          type: "object",
          description: "Map of VS Code color keys to hex color values.",
          additionalProperties: { type: "string" },
        },
      },
      required: ["colors"],
    },
  },
  {
    name: "set_token_colors",
    description:
      "Set syntax highlighting (TextMate) token colors. Each rule needs a name, a scope (array of TextMate scope selectors), " +
      "and settings (foreground color, fontStyle). If a rule with the same name already exists, it will be updated; otherwise created. " +
      "For TWEAKS: set ONLY the specific tokens the user asked about. " +
      "For NEW THEMES: set all major syntax categories (20+ rules). " +
      TOKEN_SCOPE_REFERENCE,
    input_schema: {
      type: "object" as const,
      properties: {
        updates: {
          type: "array",
          description: "Array of token color rules. Set all major syntax categories for completeness.",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Descriptive name for this rule (e.g. 'Comment', 'String', 'Function')" },
              scope: {
                type: "array",
                items: { type: "string" },
                description: "Array of TextMate scope selectors this rule matches (e.g. [\"comment\", \"punctuation.definition.comment\"])",
              },
              foreground: { type: "string", description: "Hex color value (#RRGGBB)" },
              fontStyle: {
                type: "string",
                description: "Font style: 'bold', 'italic', 'underline', 'bold italic', or '' (empty to clear)",
              },
            },
            required: ["name", "scope"],
          },
        },
      },
      required: ["updates"],
    },
  },
  {
    name: "get_current_theme",
    description:
      "Get the current theme color overrides. Returns the active preset name (if any), " +
      "all editor color customizations, and all token color rules currently applied.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "reset_theme",
    description: "Clear all color overrides, reverting to the base Everytheme/Kanagawa colors.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "list_presets",
    description:
      "List all saved theme presets. Returns name and description for each.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "get_preset",
    description:
      "Get full details of a saved preset including all its editor colors and token color rules.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Name of the preset" },
      },
      required: ["name"],
    },
  },
  {
    name: "save_preset",
    description:
      "Save the current active theme as a named preset. Use this after making changes " +
      "to preserve them as a reusable colorset.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Name for the preset" },
        description: {
          type: "string",
          description: "Short description of the color scheme (e.g. 'warm sunset tones with dark background')",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "delete_preset",
    description: "Delete a saved theme preset by name.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Name of the preset to delete" },
      },
      required: ["name"],
    },
  },
  {
    name: "load_preset",
    description:
      "Load a saved preset as the active theme. This replaces all current color overrides with the preset's colors.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Name of the preset to load" },
      },
      required: ["name"],
    },
  },
  {
    name: "clone_preset",
    description:
      "Clone an existing preset under a new name. Useful for creating variations of a theme.",
    input_schema: {
      type: "object" as const,
      properties: {
        source_name: { type: "string", description: "Name of the preset to clone" },
        new_name: { type: "string", description: "Name for the cloned preset" },
        description: { type: "string", description: "Optional description for the clone" },
      },
      required: ["source_name", "new_name"],
    },
  },
  {
    name: "rename_preset",
    description: "Rename an existing preset.",
    input_schema: {
      type: "object" as const,
      properties: {
        old_name: { type: "string", description: "Current name of the preset" },
        new_name: { type: "string", description: "New name for the preset" },
      },
      required: ["old_name", "new_name"],
    },
  },
];

export async function handleToolCall(
  engine: ThemeEngine,
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<string> {
  switch (toolName) {
    case "set_editor_colors": {
      // Models sometimes put colors at the top level instead of under "colors"
      let colors = toolInput.colors as Record<string, string> | undefined;
      if (!colors || Object.keys(colors).length === 0) {
        // Check if the model passed color keys directly (e.g. {"editor.background": "#000"})
        const directColors: Record<string, string> = {};
        for (const [key, value] of Object.entries(toolInput)) {
          if (key !== "colors" && typeof value === "string" && /^#[0-9A-Fa-f]{6,8}$/.test(value)) {
            directColors[key] = value;
          }
        }
        if (Object.keys(directColors).length > 0) {
          colors = directColors;
        }
      }
      if (!colors || Object.keys(colors).length === 0) {
        return "No colors provided — pass a 'colors' object with VS Code color keys mapped to hex values like {\"colors\": {\"editor.background\": \"#000000\"}}.";
      }
      const { changed, unknownKeys, invalidHex } = await engine.setColors(colors);
      const parts: string[] = [`Applied ${changed.length} / ${Object.keys(colors).length} editor colors.`];
      if (changed.length > 0) {
        parts.push(`Applied: ${changed.join(", ")}.`);
      }
      if (unknownKeys.length > 0) {
        const suggestions = unknownKeys
          .slice(0, 10)
          .map((k) => {
            const match = suggestColorKey(k);
            return match ? `${k} → did you mean "${match}"?` : k;
          })
          .join("; ");
        parts.push(
          `REJECTED ${unknownKeys.length} unknown key(s) not in the VS Code theme-color registry: ${suggestions}. ` +
            `Only use valid ids from ${COLOR_KEYS_META.source} — if the user's request requires these, retry with corrected ids.`
        );
      }
      if (invalidHex.length > 0) {
        parts.push(`REJECTED ${invalidHex.length} invalid hex value(s): ${invalidHex.join(", ")}. Use #RRGGBB or #RRGGBBAA.`);
      }
      return parts.join(" ");
    }
    case "set_token_colors": {
      // Models sometimes put rules at the top level instead of under "updates"
      let updates = toolInput.updates as Array<{
        name: string;
        scope?: string | string[];
        foreground?: string;
        fontStyle?: string;
      }> | undefined;
      if (!updates || !Array.isArray(updates) || updates.length === 0) {
        // Check common alternative keys
        for (const key of ["rules", "tokenColors", "token_colors"]) {
          if (Array.isArray(toolInput[key]) && (toolInput[key] as unknown[]).length > 0) {
            updates = toolInput[key] as typeof updates;
            break;
          }
        }
      }
      if (!updates || updates.length === 0) {
        return "No token color updates provided — pass an 'updates' array like {\"updates\": [{\"name\": \"Comment\", \"scope\": [\"comment\"], \"foreground\": \"#888888\"}]}.";
      }
      const changed = await engine.setTokenColors(updates);
      return `Updated ${changed.length} token colors: ${changed.join(", ")}`;
    }
    case "get_current_theme": {
      const summary = engine.getColorSummary();
      return JSON.stringify(summary, null, 2);
    }
    case "reset_theme": {
      await engine.resetTheme();
      return "Theme reset — all color overrides cleared.";
    }
    case "list_presets": {
      const presets = engine.listPresets();
      if (presets.length === 0) {
        return "No saved presets yet.";
      }
      return JSON.stringify(presets, null, 2);
    }
    case "get_preset": {
      const preset = engine.getPreset(toolInput.name as string);
      if (!preset) {
        return `Preset "${toolInput.name}" not found.`;
      }
      return JSON.stringify({
        name: preset.name,
        description: preset.description,
        editorColors: preset.theme.colors,
        tokenColors: preset.theme.tokenColors.map((tc) => ({
          name: tc.name,
          scope: tc.scope,
          ...tc.settings,
        })),
      }, null, 2);
    }
    case "save_preset": {
      engine.savePreset(
        toolInput.name as string,
        toolInput.description as string | undefined
      );
      return `Preset "${toolInput.name}" saved.`;
    }
    case "delete_preset": {
      const deleted = engine.deletePreset(toolInput.name as string);
      return deleted
        ? `Preset "${toolInput.name}" deleted.`
        : `Preset "${toolInput.name}" not found.`;
    }
    case "load_preset": {
      const loaded = await engine.loadPreset(toolInput.name as string);
      return loaded
        ? `Preset "${toolInput.name}" loaded as active theme.`
        : `Preset "${toolInput.name}" not found.`;
    }
    case "clone_preset": {
      const cloned = engine.clonePreset(
        toolInput.source_name as string,
        toolInput.new_name as string,
        toolInput.description as string | undefined
      );
      return cloned
        ? `Preset "${toolInput.source_name}" cloned as "${toolInput.new_name}".`
        : `Source preset "${toolInput.source_name}" not found.`;
    }
    case "rename_preset": {
      const renamed = engine.renamePreset(
        toolInput.old_name as string,
        toolInput.new_name as string
      );
      return renamed
        ? `Preset "${toolInput.old_name}" renamed to "${toolInput.new_name}".`
        : `Preset "${toolInput.old_name}" not found.`;
    }
    default:
      return `Unknown tool: ${toolName}`;
  }
}
