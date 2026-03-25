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
}

export interface PresetInfo {
  name: string;
  description?: string;
}

export interface Preset extends PresetInfo {
  theme: ThemeData;
}

export class ThemeEngine {
  private presetsDir: string;
  private statePath: string;
  private _activePresetName: string | null = null;

  constructor(private context: vscode.ExtensionContext) {
    this.presetsDir = path.join(context.globalStorageUri.fsPath, "presets");
    this.statePath = path.join(context.globalStorageUri.fsPath, "state.json");
    fs.mkdirSync(this.presetsDir, { recursive: true });
    this._activePresetName = this.loadState().activePreset;
  }

  get activePresetName(): string | null {
    return this._activePresetName;
  }

  private loadState(): { activePreset: string | null } {
    if (fs.existsSync(this.statePath)) {
      return JSON.parse(fs.readFileSync(this.statePath, "utf-8"));
    }
    return { activePreset: null };
  }

  private saveState(): void {
    fs.writeFileSync(
      this.statePath,
      JSON.stringify({ activePreset: this._activePresetName }),
      "utf-8"
    );
  }

  /** Read the current effective colors from VS Code settings overrides */
  getCurrentTheme(): ThemeData {
    const config = vscode.workspace.getConfiguration();
    const colors = config.get<ThemeColors>("workbench.colorCustomizations") ?? {};
    const tokenConfig = config.get<{ textMateRules?: TokenColor[] }>(
      "editor.tokenColorCustomizations"
    ) ?? {};
    return {
      colors,
      tokenColors: tokenConfig.textMateRules ?? [],
    };
  }

  /** Get a summary of current colors (for LLM context) */
  getColorSummary(): {
    activePreset: string | null;
    editorColors: ThemeColors;
    tokenColors: Array<{ name: string } & TokenColorSetting>;
  } {
    const theme = this.getCurrentTheme();
    return {
      activePreset: this._activePresetName,
      editorColors: theme.colors,
      tokenColors: theme.tokenColors.map((tc) => ({
        name: tc.name,
        ...tc.settings,
      })),
    };
  }

  /** Update workbench/editor colors */
  async setColors(colors: ThemeColors): Promise<string[]> {
    const config = vscode.workspace.getConfiguration();
    const current = config.get<ThemeColors>("workbench.colorCustomizations") ?? {};
    const changed: string[] = [];

    for (const [key, value] of Object.entries(colors)) {
      if (!isValidHexColor(value)) {
        continue;
      }
      current[key] = value;
      changed.push(key);
    }

    await config.update(
      "workbench.colorCustomizations",
      current,
      vscode.ConfigurationTarget.Global
    );
    return changed;
  }

  /** Update token colors by name */
  async setTokenColors(
    updates: Array<{ name: string; scope?: string | string[]; foreground?: string; fontStyle?: string }>
  ): Promise<string[]> {
    const config = vscode.workspace.getConfiguration();
    const tokenConfig = config.get<{ textMateRules?: TokenColor[] }>(
      "editor.tokenColorCustomizations"
    ) ?? {};
    const rules = tokenConfig.textMateRules ?? [];
    const changed: string[] = [];

    for (const update of updates) {
      const existing = rules.find(
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
      } else {
        // Add new rule — need at least a scope
        const scope = update.scope ?? update.name.toLowerCase();
        const settings: TokenColorSetting = {};
        if (update.foreground && isValidHexColor(update.foreground)) {
          settings.foreground = update.foreground;
        }
        if (update.fontStyle !== undefined) {
          settings.fontStyle = update.fontStyle;
        }
        rules.push({ name: update.name, scope, settings });
        changed.push(update.name);
      }
    }

    await config.update(
      "editor.tokenColorCustomizations",
      { ...tokenConfig, textMateRules: rules },
      vscode.ConfigurationTarget.Global
    );
    return changed;
  }

  /** Reset theme — clear all color overrides */
  async resetTheme(): Promise<void> {
    const config = vscode.workspace.getConfiguration();
    await config.update(
      "workbench.colorCustomizations",
      undefined,
      vscode.ConfigurationTarget.Global
    );
    await config.update(
      "editor.tokenColorCustomizations",
      undefined,
      vscode.ConfigurationTarget.Global
    );
    this._activePresetName = null;
    this.saveState();
  }

  // --- Preset management ---

  private presetPath(name: string): string {
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.presetsDir, `${safeName}.json`);
  }

  listPresets(): PresetInfo[] {
    const files = fs.readdirSync(this.presetsDir).filter((f) => f.endsWith(".json"));
    return files.map((f) => {
      const raw = JSON.parse(fs.readFileSync(path.join(this.presetsDir, f), "utf-8"));
      return { name: raw.name, description: raw.description };
    });
  }

  getPreset(name: string): Preset | undefined {
    const p = this.presetPath(name);
    if (!fs.existsSync(p)) {
      return undefined;
    }
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  }

  savePreset(name: string, description?: string): void {
    const theme = this.getCurrentTheme();
    const preset: Preset = { name, description, theme };
    fs.writeFileSync(this.presetPath(name), JSON.stringify(preset, null, 2), "utf-8");
    this._activePresetName = name;
    this.saveState();
  }

  deletePreset(name: string): boolean {
    const p = this.presetPath(name);
    if (!fs.existsSync(p)) {
      return false;
    }
    fs.unlinkSync(p);
    return true;
  }

  async loadPreset(name: string): Promise<boolean> {
    const preset = this.getPreset(name);
    if (!preset) {
      return false;
    }
    await this.applyTheme(preset.theme);
    this._activePresetName = name;
    this.saveState();
    return true;
  }

  clonePreset(sourceName: string, newName: string, newDescription?: string): boolean {
    const source = this.getPreset(sourceName);
    if (!source) {
      return false;
    }
    const clone: Preset = {
      name: newName,
      description: newDescription ?? source.description,
      theme: JSON.parse(JSON.stringify(source.theme)),
    };
    fs.writeFileSync(this.presetPath(newName), JSON.stringify(clone, null, 2), "utf-8");
    return true;
  }

  renamePreset(oldName: string, newName: string): boolean {
    const preset = this.getPreset(oldName);
    if (!preset) {
      return false;
    }
    preset.name = newName;
    fs.writeFileSync(this.presetPath(newName), JSON.stringify(preset, null, 2), "utf-8");
    fs.unlinkSync(this.presetPath(oldName));
    if (this._activePresetName === oldName) {
      this._activePresetName = newName;
      this.saveState();
    }
    return true;
  }

  /** Apply a full theme by writing both color and token customizations */
  private async applyTheme(theme: ThemeData): Promise<void> {
    const config = vscode.workspace.getConfiguration();
    await config.update(
      "workbench.colorCustomizations",
      Object.keys(theme.colors).length > 0 ? theme.colors : undefined,
      vscode.ConfigurationTarget.Global
    );
    await config.update(
      "editor.tokenColorCustomizations",
      theme.tokenColors.length > 0 ? { textMateRules: theme.tokenColors } : undefined,
      vscode.ConfigurationTarget.Global
    );
  }
}

function isValidHexColor(color: string): boolean {
  return /^#[0-9A-Fa-f]{6,8}$/.test(color);
}
