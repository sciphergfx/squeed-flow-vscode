import * as esbuild from "esbuild";
import { readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";

const watch = process.argv.includes("--watch");

// Icon families the SDK's DynamicIcon can load on demand. Only the kept ones
// ship in the VSIX; the rest resolve to empty modules so `$icon` names from
// those families render nothing instead of pulling in ~35 MB of icon sources.
const ICON_FAMILIES = [
  "md", "fa6", "io5", "io", "ti", "go", "fi", "di", "ai", "bs", "ri", "fc", "gi",
  "hi2", "hi", "si", "sl", "im", "bi", "pi", "vsc", "tb", "tfi", "cg", "lia", "lu",
];
const KEPT_ICON_FAMILIES = new Set(["pi"]);

/** @type {esbuild.Plugin} */
const iconStubPlugin = {
  name: "react-icons-stub",
  setup(build) {
    const stubbed = new Set(
      ICON_FAMILIES.filter((family) => !KEPT_ICON_FAMILIES.has(family)).map(
        (family) => `react-icons/${family}`,
      ),
    );
    build.onResolve({ filter: /^react-icons\// }, async (args) => {
      if (stubbed.has(args.path)) return { path: "stub", namespace: "react-icons-stub" };
      // The SDK both imports named icons statically and `import()`s the whole
      // family by name. Give the dynamic import its own module instance so the
      // static path stays tree-shaken and the full family loads lazily.
      if (args.kind !== "dynamic-import") return undefined;
      const resolved = await build.resolve(args.path, {
        kind: "import-statement",
        resolveDir: args.resolveDir,
      });
      if (resolved.errors.length) return { errors: resolved.errors };
      return { path: resolved.path, namespace: "react-icons-lazy" };
    });
    build.onLoad({ filter: /.*/, namespace: "react-icons-stub" }, () => ({
      contents: "export {};",
      loader: "js",
    }));
    build.onLoad({ filter: /.*/, namespace: "react-icons-lazy" }, async (args) => ({
      contents: await readFile(args.path, "utf8"),
      loader: "js",
      resolveDir: dirname(args.path),
    }));
  },
};

/** @type {esbuild.BuildOptions} */
const extensionOptions = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  platform: "node",
  target: "node20",
  format: "cjs",
  // jsonc-parser's "main" is a UMD build whose AMD wrapper esbuild cannot bundle.
  mainFields: ["module", "main"],
  external: ["vscode"],
  sourcemap: watch,
  minify: !watch,
  logLevel: "info",
};

/** @type {esbuild.BuildOptions} */
const webviewOptions = {
  entryPoints: ["webview/main.tsx"],
  bundle: true,
  outdir: "dist/webview",
  platform: "browser",
  target: "es2022",
  format: "esm",
  splitting: true,
  jsx: "automatic",
  define: { "process.env.NODE_ENV": JSON.stringify(watch ? "development" : "production") },
  plugins: [iconStubPlugin],
  sourcemap: watch,
  minify: !watch,
  legalComments: "none",
  logLevel: "info",
};

await rm("dist", { recursive: true, force: true });

if (watch) {
  const contexts = await Promise.all([
    esbuild.context(extensionOptions),
    esbuild.context(webviewOptions),
  ]);
  await Promise.all(contexts.map((context) => context.watch()));
  console.log("watching for changes…");
} else {
  await Promise.all([esbuild.build(extensionOptions), esbuild.build(webviewOptions)]);
}
