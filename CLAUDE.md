# Everytheme — collaboration rules

## Versioning

Bump the patch digit (third segment, e.g. `0.2.0` → `0.2.1`) any time a change requires the user to reload VS Code or reinstall the extension to take effect — recompiling, repackaging, or modifying anything in `src/`, `media/`, `themes/`, or `package.json`.

- Pure conversation, research, or documentation answers: no bump.
- Any change a user has to reload to see: bump.
- Larger user-visible feature work still uses minor bumps (second digit). Patch bumps are for the routine "I made a change, please reload" cases.
- Always update `package.json` `version` **and** add a `CHANGELOG.md` entry.

Rationale: the version number is the user's sanity check that `package:install` actually picked up the new code. Two consecutive reloads showing the same version is ambiguous.

## Color keys

The set of valid VS Code color keys lives in [src/vscode-color-keys.json](src/vscode-color-keys.json), generated from the canonical VS Code docs by `npm run update-color-keys`. Don't hand-curate parallel lists. Validation happens in `ThemeEngine.setColors`; unknown keys are reported back to the LLM as suggestions for self-correction.

## Build

`npm run compile` runs `tsc` then `scripts/copy-assets.mjs`, which copies the JSON registry into `out/` and vendors `marked.min.js` into `media/`. The webview reads its assets from `extensionUri/media/` (project root, not `out/`).
