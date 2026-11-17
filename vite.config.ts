import { defineConfig } from "vite-plus"

export default defineConfig({
  pack: [
    {
      // ESM + CommonJS with declarations for each (dist/index.mjs, index.cjs, index.d.mts, index.d.cts)
      entry: "src/index.ts",
      format: ["esm", "cjs"],
      target: "es2020",
      platform: "neutral",
      fixedExtension: true,
      sourcemap: true,
      dts: { generator: "tsgo" },
    },
    {
      // minified browser global (window.JsonCrawl)
      entry: "src/index.ts",
      format: "iife",
      globalName: "JsonCrawl",
      target: "es2020",
      platform: "browser",
      minify: true,
      sourcemap: true,
      dts: false,
      clean: false,
    },
  ],
  lint: {
    ignorePatterns: ["dist/**", "bench/**", "coverage/**"],
    rules: {
      "unicorn/no-new-array": "off",  // path arrays are preallocated on purpose
      "no-sparse-arrays": "off",       // tests cover array holes
      "unicorn/no-thenable": "off",    // tests cover thenable hook results
    },
  },
  test: {
    globals: true,
    include: ["test/**/*.test.ts"],
    coverage: { include: ["src/**/*.ts"], reporter: ["text", "lcov"] },
  },
})
