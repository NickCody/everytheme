#!/usr/bin/env node
// Bundle the extension entry point with esbuild. `vscode` is provided by the
// host at runtime and must stay external; everything else is inlined.

import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

/** @type {import("esbuild").BuildOptions} */
const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "out/extension.js",
  platform: "node",
  format: "cjs",
  target: "node18",
  external: ["vscode"],
  sourcemap: !production,
  minify: production,
  logLevel: "info",
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
