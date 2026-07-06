import { build } from "esbuild";

// Bundle the whole server (own code + express + mongodb + deps) into one file.
await build({
  entryPoints: ["src/server.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: "dist/index.js",
  // Many deps (express, body-parser, ...) are CommonJS and call require()
  // internally. In an ESM bundle esbuild's shim rejects that, so we hand them a
  // real require built from this module's URL.
  banner: {
    js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
  },
  logLevel: "info",
});
