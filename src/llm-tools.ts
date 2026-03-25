import Anthropic from "@anthropic-ai/sdk";
import { ThemeEngine } from "./theme-engine";

export const THEME_TOOLS: Anthropic.Tool[] = [
  {
    name: "set_editor_colors",
    description:
      "Set VS Code workbench/editor colors. Pass an object of color keys to hex values. " +
      "Common keys: editor.background, editor.foreground, editor.selectionBackground, " +
      "activityBar.background, sideBar.background, statusBar.background, " +
      "tab.activeBackground, titleBar.activeBackground, terminal.background, " +
      "editorLineNumber.foreground, editor.lineHighlightBackground, " +
      "list.activeSelectionBackground, editorCursor.foreground. " +
      "Values must be hex colors like #1F1F28 or #1F1F2880 (with alpha).",
    input_schema: {
      type: "object" as const,
      properties: {
        colors: {
          type: "object",
          description: "Map of VS Code color keys to hex color values",
          additionalProperties: { type: "string" },
        },
      },
      required: ["colors"],
    },
  },
  {
    name: "set_token_colors",
    description:
      "Set syntax highlighting token colors by name. Available token names: " +
      "Comment, Variable, Color, Invalid, 'Storage - Type', 'Storage - Modifier', " +
      "'Control Keyword', Function, String, Number, Boolean, Constant, " +
      "'Class, Support', Property, Import, Tag, Attribute, Punctuation, " +
      "'Regular Expression', 'Escape Character', Macro, " +
      "'Markdown - Heading', 'Markup - Italic', 'Markup - Bold'. " +
      "Each update needs a name and optionally foreground (hex) and fontStyle (bold/italic/underline or empty string).",
    input_schema: {
      type: "object" as const,
      properties: {
        updates: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Token color rule name" },
              foreground: { type: "string", description: "Hex color value" },
              fontStyle: {
                type: "string",
                description: "Font style: bold, italic, underline, or empty string",
              },
            },
            required: ["name"],
          },
        },
      },
      required: ["updates"],
    },
  },
  {
    name: "get_current_theme",
    description:
      "Get the current theme colors. Returns editor colors and token color names " +
      "so you can see what's currently set before making changes.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "reset_theme",
    description: "Reset the theme back to the default Kanagawa Wave colors.",
    input_schema: {
      type: "object" as const,
      properties: {},
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
      const colors = toolInput.colors as Record<string, string>;
      const changed = await engine.setColors(colors);
      return `Updated ${changed.length} editor colors: ${changed.join(", ")}`;
    }
    case "set_token_colors": {
      const updates = toolInput.updates as Array<{
        name: string;
        foreground?: string;
        fontStyle?: string;
      }>;
      const changed = await engine.setTokenColors(updates);
      return `Updated ${changed.length} token colors: ${changed.join(", ")}`;
    }
    case "get_current_theme": {
      const summary = engine.getColorSummary();
      return JSON.stringify(summary, null, 2);
    }
    case "reset_theme": {
      await engine.resetTheme();
      return "Theme reset to Kanagawa Wave defaults.";
    }
    default:
      return `Unknown tool: ${toolName}`;
  }
}
