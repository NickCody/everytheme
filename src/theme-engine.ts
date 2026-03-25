import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

export interface ThemeColors {
  [key: string]: string;
}

export interface TokenColorSetting {
  foreground?: string;
  fontStyle?: string;
}

export interface TokenColor {
  name: string;
  scope: string | string[];
  settings: TokenColorSetting;
}

export interface ThemeData {
  colors: ThemeColors;
  tokenColors: TokenColor[];
  semanticTokenColors: Record<string, string | { foreground: string; fontStyle?: string }>;
}

export class ThemeEngine {
  private themeFilePath: string;
  private baseTheme: ThemeData;

  constructor(private context: vscode.ExtensionContext) {
    this.themeFilePath = path.join(
      context.extensionPath,
      "themes",
      "everytheme-color-theme.json"
    );
    this.baseTheme = this.loadThemeFromDisk();
  }

  private loadThemeFromDisk(): ThemeData {
    const raw = fs.readFileSync(this.themeFilePath, "utf-8");
    return JSON.parse(raw);
  }

  getCurrentTheme(): ThemeData {
    return this.loadThemeFromDisk();
  }

  /** Get a summary of current colors (for LLM context) */
  getColorSummary(): {
    editorColors: ThemeColors;
    tokenColorNames: string[];
  } {
    const theme = this.getCurrentTheme();
    return {
      editorColors: theme.colors,
      tokenColorNames: theme.tokenColors.map((tc) => tc.name),
    };
  }

  /** Update workbench/editor colors */
  async setColors(colors: ThemeColors): Promise<string[]> {
    const theme = this.loadThemeFromDisk();
    const changed: string[] = [];

    for (const [key, value] of Object.entries(colors)) {
      if (!isValidHexColor(value)) {
        continue;
      }
      theme.colors[key] = value;
      changed.push(key);
    }

    this.writeThemeToDisk(theme);
    return changed;
  }

  /** Update token colors by name */
  async setTokenColors(
    updates: Array<{ name: string; foreground?: string; fontStyle?: string }>
  ): Promise<string[]> {
    const theme = this.loadThemeFromDisk();
    const changed: string[] = [];

    for (const update of updates) {
      const existing = theme.tokenColors.find(
        (tc) => tc.name.toLowerCase() === update.name.toLowerCase()
      );
      if (existing) {
        if (update.foreground && isValidHexColor(update.foreground)) {
          existing.settings.foreground = update.foreground;
        }
        if (update.fontStyle !== undefined) {
          existing.settings.fontStyle = update.fontStyle;
        }
        changed.push(existing.name);
      }
    }

    this.writeThemeToDisk(theme);
    return changed;
  }

  /** Reset theme to the Kanagawa defaults */
  async resetTheme(): Promise<void> {
    const defaultThemePath = path.join(
      this.context.extensionPath,
      "themes",
      "kanagawa-default.json"
    );
    if (fs.existsSync(defaultThemePath)) {
      const defaultTheme = fs.readFileSync(defaultThemePath, "utf-8");
      fs.writeFileSync(this.themeFilePath, defaultTheme, "utf-8");
    }
  }

  private writeThemeToDisk(theme: ThemeData): void {
    const full = {
      name: "Everytheme",
      type: "dark",
      semanticHighlighting: true,
      colors: theme.colors,
      tokenColors: theme.tokenColors,
      semanticTokenColors: theme.semanticTokenColors,
    };
    fs.writeFileSync(this.themeFilePath, JSON.stringify(full, null, 2), "utf-8");

    // Force VS Code to reload the theme by toggling it
    this.reloadTheme();
  }

  private async reloadTheme(): Promise<void> {
    const config = vscode.workspace.getConfiguration();
    const currentTheme = config.get<string>("workbench.colorTheme");

    if (currentTheme === "Everytheme") {
      // Toggle to default and back to force reload
      await config.update(
        "workbench.colorTheme",
        "Default Dark+",
        vscode.ConfigurationTarget.Global
      );
      await config.update(
        "workbench.colorTheme",
        "Everytheme",
        vscode.ConfigurationTarget.Global
      );
    }
  }
}

function isValidHexColor(color: string): boolean {
  return /^#[0-9A-Fa-f]{6,8}$/.test(color);
}
