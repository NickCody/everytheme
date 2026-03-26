import { type ToolDef } from "./llm-provider";
import { ThemeEngine } from "./theme-engine";

// Exhaustive list so the LLM knows the full surface area
const EDITOR_COLOR_KEYS = [
  // Editor
  "editor.background", "editor.foreground", "editor.selectionBackground",
  "editor.selectionForeground", "editor.selectionHighlightBackground",
  "editor.selectionHighlightBorder", "editor.inactiveSelectionBackground",
  "editor.wordHighlightBackground", "editor.wordHighlightBorder",
  "editor.wordHighlightStrongBackground", "editor.wordHighlightStrongBorder",
  "editor.findMatchBackground", "editor.findMatchBorder",
  "editor.findMatchHighlightBackground", "editor.findMatchHighlightBorder",
  "editor.hoverHighlightBackground", "editor.lineHighlightBackground",
  "editor.lineHighlightBorder", "editor.rangeHighlightBackground",
  "editor.snippetTabstopHighlightBackground",
  "editorCursor.background", "editorCursor.foreground",
  "editorWhitespace.foreground",
  "editorIndentGuide.background1", "editorIndentGuide.activeBackground1",
  "editorLineNumber.foreground", "editorLineNumber.activeForeground",
  "editorRuler.foreground",
  "editorBracketMatch.background", "editorBracketMatch.border",
  "editorBracketHighlight.foreground1", "editorBracketHighlight.foreground2",
  "editorBracketHighlight.foreground3", "editorBracketHighlight.foreground4",
  "editorBracketHighlight.foreground5", "editorBracketHighlight.foreground6",
  "editorBracketHighlight.unexpectedBracket.foreground",
  "editorBracketPairGuide.activeBackground1", "editorBracketPairGuide.activeBackground2",
  "editorBracketPairGuide.activeBackground3", "editorBracketPairGuide.activeBackground4",
  "editorBracketPairGuide.activeBackground5", "editorBracketPairGuide.activeBackground6",
  "editorOverviewRuler.border",
  "editorOverviewRuler.findMatchForeground",
  "editorOverviewRuler.errorForeground", "editorOverviewRuler.warningForeground",
  "editorOverviewRuler.infoForeground",
  "editorOverviewRuler.modifiedForeground", "editorOverviewRuler.addedForeground",
  "editorOverviewRuler.deletedForeground",
  "editorError.foreground", "editorWarning.foreground", "editorInfo.foreground",
  "editorHint.foreground",
  "editorGutter.background", "editorGutter.modifiedBackground",
  "editorGutter.addedBackground", "editorGutter.deletedBackground",
  "editorGutter.foldingControlForeground",
  // Editor widgets
  "editorWidget.background", "editorWidget.foreground", "editorWidget.border",
  "editorSuggestWidget.background", "editorSuggestWidget.border",
  "editorSuggestWidget.foreground", "editorSuggestWidget.selectedBackground",
  "editorSuggestWidget.selectedForeground", "editorSuggestWidget.highlightForeground",
  "editorSuggestWidget.focusHighlightForeground",
  "editorHoverWidget.background", "editorHoverWidget.foreground",
  "editorHoverWidget.border", "editorHoverWidget.highlightForeground",
  "editorHoverWidget.statusBarBackground",
  "editorMarkerNavigation.background",
  "editorInlayHint.foreground", "editorInlayHint.background",
  // Peek view
  "peekView.border", "peekViewEditor.background",
  "peekViewEditor.matchHighlightBackground",
  "peekViewResult.background", "peekViewResult.foreground",
  "peekViewResult.fileForeground", "peekViewResult.lineForeground",
  "peekViewResult.matchHighlightBackground", "peekViewResult.selectionBackground",
  "peekViewResult.selectionForeground",
  "peekViewTitle.background", "peekViewTitleLabel.foreground",
  "peekViewTitleDescription.foreground",
  // Diff editor
  "diffEditor.insertedTextBackground", "diffEditor.insertedTextBorder",
  "diffEditor.removedTextBackground", "diffEditor.removedTextBorder",
  "diffEditor.diagonalFill",
  // Editor group / tabs
  "editorGroup.border", "editorGroup.dropBackground",
  "editorGroupHeader.tabsBackground", "editorGroupHeader.tabsBorder",
  "tab.activeBackground", "tab.activeForeground", "tab.activeBorder",
  "tab.activeBorderTop", "tab.activeModifiedBorder",
  "tab.inactiveBackground", "tab.inactiveForeground", "tab.inactiveModifiedBorder",
  "tab.unfocusedActiveBackground", "tab.unfocusedActiveForeground",
  "tab.unfocusedActiveBorder", "tab.unfocusedActiveBorderTop",
  "tab.unfocusedInactiveBackground", "tab.unfocusedInactiveForeground",
  "tab.unfocusedHoverBackground", "tab.hoverBackground",
  "tab.hoverBorder", "tab.border", "tab.lastPinnedBorder",
  // Activity bar
  "activityBar.background", "activityBar.foreground",
  "activityBar.inactiveForeground", "activityBar.border",
  "activityBar.activeBorder", "activityBar.activeBackground",
  "activityBar.activeFocusBorder",
  "activityBarBadge.background", "activityBarBadge.foreground",
  // Side bar
  "sideBar.background", "sideBar.foreground", "sideBar.border",
  "sideBar.dropBackground",
  "sideBarTitle.foreground",
  "sideBarSectionHeader.background", "sideBarSectionHeader.foreground",
  "sideBarSectionHeader.border",
  // Minimap
  "minimap.findMatchHighlight", "minimap.selectionHighlight",
  "minimap.errorHighlight", "minimap.warningHighlight",
  "minimap.background",
  "minimapSlider.background", "minimapSlider.hoverBackground",
  "minimapSlider.activeBackground",
  "minimapGutter.addedBackground", "minimapGutter.modifiedBackground",
  "minimapGutter.deletedBackground",
  // Status bar
  "statusBar.background", "statusBar.foreground", "statusBar.border",
  "statusBar.noFolderBackground", "statusBar.noFolderForeground",
  "statusBar.debuggingBackground", "statusBar.debuggingForeground",
  "statusBar.debuggingBorder",
  "statusBarItem.hoverBackground",
  "statusBarItem.activeBackground",
  "statusBarItem.prominentForeground", "statusBarItem.prominentBackground",
  "statusBarItem.prominentHoverBackground",
  "statusBarItem.remoteBackground", "statusBarItem.remoteForeground",
  "statusBarItem.errorBackground", "statusBarItem.errorForeground",
  "statusBarItem.warningBackground", "statusBarItem.warningForeground",
  // Title bar
  "titleBar.activeBackground", "titleBar.activeForeground",
  "titleBar.inactiveBackground", "titleBar.inactiveForeground",
  "titleBar.border",
  // Menu
  "menubar.selectionBackground", "menubar.selectionForeground",
  "menu.background", "menu.foreground", "menu.selectionBackground",
  "menu.selectionForeground", "menu.selectionBorder",
  "menu.separatorBackground", "menu.border",
  // Command center / notifications
  "commandCenter.foreground", "commandCenter.background", "commandCenter.border",
  "commandCenter.activeForeground", "commandCenter.activeBackground",
  "commandCenter.activeBorder",
  "notificationCenter.border", "notificationCenterHeader.foreground",
  "notificationCenterHeader.background",
  "notifications.foreground", "notifications.background", "notifications.border",
  "notificationLink.foreground",
  "notificationsErrorIcon.foreground", "notificationsWarningIcon.foreground",
  "notificationsInfoIcon.foreground",
  // Banner
  "banner.background", "banner.foreground", "banner.iconForeground",
  // Buttons
  "button.background", "button.foreground", "button.hoverBackground",
  "button.secondaryBackground", "button.secondaryForeground",
  "button.secondaryHoverBackground",
  // Dropdown / input / checkbox
  "dropdown.background", "dropdown.foreground", "dropdown.border",
  "input.background", "input.foreground", "input.border",
  "input.placeholderForeground",
  "inputOption.activeBorder", "inputOption.activeBackground",
  "inputOption.activeForeground",
  "inputValidation.errorBackground", "inputValidation.errorBorder",
  "inputValidation.warningBackground", "inputValidation.warningBorder",
  "inputValidation.infoBackground", "inputValidation.infoBorder",
  "checkbox.background", "checkbox.foreground", "checkbox.border",
  // Scrollbar
  "scrollbar.shadow",
  "scrollbarSlider.activeBackground", "scrollbarSlider.background",
  "scrollbarSlider.hoverBackground",
  // Badge
  "badge.background", "badge.foreground",
  // Progress bar
  "progressBar.background",
  // Lists / trees
  "list.activeSelectionBackground", "list.activeSelectionForeground",
  "list.activeSelectionIconForeground",
  "list.inactiveSelectionBackground", "list.inactiveSelectionForeground",
  "list.inactiveSelectionIconForeground",
  "list.hoverBackground", "list.hoverForeground",
  "list.focusBackground", "list.focusForeground", "list.focusOutline",
  "list.highlightForeground", "list.focusHighlightForeground",
  "list.invalidItemForeground", "list.errorForeground", "list.warningForeground",
  "list.filterMatchBackground", "list.filterMatchBorder",
  "listFilterWidget.background", "listFilterWidget.outline",
  "listFilterWidget.noMatchesOutline",
  "tree.indentGuidesStroke", "tree.tableColumnsBorder",
  // Git
  "gitDecoration.addedResourceForeground", "gitDecoration.modifiedResourceForeground",
  "gitDecoration.deletedResourceForeground", "gitDecoration.renamedResourceForeground",
  "gitDecoration.untrackedResourceForeground", "gitDecoration.ignoredResourceForeground",
  "gitDecoration.conflictingResourceForeground",
  "gitDecoration.stageDeletedResourceForeground", "gitDecoration.stageModifiedResourceForeground",
  // Breadcrumbs
  "breadcrumb.foreground", "breadcrumb.focusForeground",
  "breadcrumb.activeSelectionForeground",
  "breadcrumbPicker.background",
  // Panel
  "panel.background", "panel.border", "panel.dropBorder",
  "panelTitle.activeBorder", "panelTitle.activeForeground",
  "panelTitle.inactiveForeground",
  "panelSection.border", "panelSection.dropBackground",
  "panelSectionHeader.background", "panelSectionHeader.foreground",
  "panelSectionHeader.border",
  // Terminal
  "terminal.background", "terminal.foreground", "terminal.border",
  "terminal.selectionBackground", "terminal.selectionForeground",
  "terminalCursor.background", "terminalCursor.foreground",
  "terminal.ansiBlack", "terminal.ansiRed", "terminal.ansiGreen",
  "terminal.ansiYellow", "terminal.ansiBlue", "terminal.ansiMagenta",
  "terminal.ansiCyan", "terminal.ansiWhite",
  "terminal.ansiBrightBlack", "terminal.ansiBrightRed", "terminal.ansiBrightGreen",
  "terminal.ansiBrightYellow", "terminal.ansiBrightBlue", "terminal.ansiBrightMagenta",
  "terminal.ansiBrightCyan", "terminal.ansiBrightWhite",
  // Debug
  "debugToolBar.background", "debugToolBar.border",
  "debugIcon.breakpointForeground", "debugIcon.breakpointDisabledForeground",
  "debugIcon.startForeground", "debugIcon.pauseForeground",
  "debugIcon.stopForeground", "debugIcon.stepOverForeground",
  "debugIcon.stepIntoForeground", "debugIcon.stepOutForeground",
  "debugIcon.continueForeground", "debugIcon.disconnectForeground",
  "debugConsole.infoForeground", "debugConsole.warningForeground",
  "debugConsole.errorForeground", "debugConsole.sourceForeground",
  "debugConsoleInputIcon.foreground",
  // Welcome / walkthrough
  "walkThrough.embeddedEditorBackground",
  "welcomePage.tileBackground", "welcomePage.tileBorder",
  "welcomePage.progress.foreground", "welcomePage.progress.background",
  // Text
  "textBlockQuote.background", "textBlockQuote.border",
  "textCodeBlock.background",
  "textLink.foreground", "textLink.activeForeground",
  "textPreformat.foreground",
  // Misc
  "foreground", "focusBorder", "disabledForeground",
  "widget.shadow", "selection.background",
  "descriptionForeground", "errorForeground",
  "icon.foreground",
  "sash.hoverBorder",
  "window.activeBorder", "window.inactiveBorder",
];

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
      "Set VS Code workbench/editor UI colors. Pass a 'colors' object mapping VS Code color keys to hex values (#RRGGBB or #RRGGBBAA). " +
      "For TWEAKS: set ONLY the specific keys the user asked about (1-20 keys). " +
      "For NEW THEMES: set comprehensively (80+ keys). " +
      "Key format: 'category.property', e.g. editor.background, sideBar.background, activityBar.background, statusBar.background, " +
      "tab.activeBackground, titleBar.activeBackground, terminal.background, panel.background, " +
      "editor.foreground, editor.selectionBackground, editorLineNumber.foreground, editorCursor.foreground, " +
      "list.activeSelectionBackground, input.background, button.background, badge.background, " +
      "terminal.ansiBlack/Red/Green/Yellow/Blue/Magenta/Cyan/White (and ansiBright* variants), " +
      "editorBracketHighlight.foreground1-6, gitDecoration.*, minimap.*, scrollbarSlider.*, etc. " +
      "Full reference: https://code.visualstudio.com/api/references/theme-color",
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
      const changed = await engine.setColors(colors);
      return `Updated ${changed.length} editor colors: ${changed.join(", ")}`;
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
