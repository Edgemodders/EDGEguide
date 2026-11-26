// Bundles the extension (CommonJS, VS Code's module loader) with the MCP SDK and zod inside, so the
// VSIX needs no node_modules. `node esbuild.mjs --watch` rebuilds on change; `--tests` bundles
// test/*.test.ts for `node --test "dist-test/*.test.cjs"`; `--production` (vsce's prepublish)
// minifies, with no source maps. The bundled packages' licenses go to dist/ThirdPartyNotices.txt.
import * as esbuild from "esbuild";
import * as fs from "node:fs";
import * as path from "node:path";

const watch = process.argv.includes("--watch");
const tests = process.argv.includes("--tests");
const production = process.argv.includes("--production");

const common = { bundle: true, sourcemap: !production, minify: production, logLevel: "info", platform: "node", format: "cjs", target: "node20" };

const extension = {
  ...common,
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  external: ["vscode"],
  metafile: true,
};

const testBuild = {
  ...common,
  sourcemap: true,
  minify: false,
  entryPoints: fs.readdirSync("test").filter((f) => f.endsWith(".test.ts")).map((f) => `test/${f}`),
  outdir: "dist-test",
  outExtension: { ".js": ".cjs" },
  external: ["vscode"],
  logLevel: "warning",
};

/** The npm packages a bundle holds, each with its version, license and license text. */
function notices(metafile) {
  const dirs = new Set();
  for (const input of Object.keys(metafile.inputs)) {
    const m = /^(.*?node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)/.exec(input);
    if (m) dirs.add(m[1]);
  }
  const parts = [...dirs].sort().map((dir) => {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    const file = fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
    const text = file ? fs.readFileSync(path.join(dir, file), "utf8").trim() : `License: ${pkg.license ?? "see the package"}`;
    return `${pkg.name} ${pkg.version} (${pkg.license ?? "unknown"})\n\n${text}`;
  });
  return `Third-party software bundled into EDGEguide's dist/extension.js:\n\n${parts.join(`\n\n${"-".repeat(72)}\n\n`)}\n`;
}

if (tests) {
  await esbuild.build(testBuild);
} else if (watch) {
  const ctx = await esbuild.context(extension);
  await ctx.watch();
} else {
  const result = await esbuild.build(extension);
  fs.writeFileSync("dist/ThirdPartyNotices.txt", notices(result.metafile));
}
