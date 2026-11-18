# Changelog

## 1.0.0

### Highlights

- **Prefix rules.** A rule key ending in `*` matches every key that starts with the text before it: `"/x-*": extensionRule`, `"/x-internal-*": privateRule` (the longest prefix wins). Order of precedence: exact key > longest prefix > `/*` > `/**`.
- **Much faster.** On a 5.5 MB OpenAPI document compared with 0.5.3: `syncCrawl` and async `crawl` 7× faster, `syncClone` 5×, cloning with a hook 4×, crawls with rules 3×, crawls with prefix rules 5×; `equal` is 8× faster even though it now also handles cycles. `equal` on a 100 000-element array takes 0.5 ms instead of 22 s.
- **Very deep documents.** Crawling, cloning and transforming work on documents nested 100 000 levels deep and take time linear in the document size, as long as hooks do not read `path` at every node (a path is built only when it is read).
- **`transform` works as documented.** Replacements and removals are written into the document at every depth (previously only the root could change), and nodes are removed with the new `REMOVE` value.
- **`equal` is correct and fast.** Fixed wrong results for objects compared with arrays and for type mismatches, `null` no longer throws, cyclic documents and shared objects are compared in linear time, and large arrays are compared in linear time.

### Breaking changes

- The package is ESM-first with a CommonJS build: `import` resolves to `dist/index.mjs`, `require` to `dist/index.cjs`, each with its own type declarations. The UMD build is gone (the browser build `dist/index.iife.js`, global `JsonCrawl`, stays), and files inside `dist/` can no longer be imported directly.
- `transform`: return `{ value: REMOVE }` to delete a node. `{ value: undefined }` now sets the value to `undefined` and keeps the key.
- Array holes are skipped by the crawl, kept by `clone` (the array length is preserved), and `equal` treats a hole and an explicit `undefined` as different.
- `equal`: `NaN` equals `NaN`, `0` equals `-0`, and prototypes are not compared.
- `syncCrawl` and `syncClone` throw a `TypeError` when a hook returns a promise, instead of silently ignoring its response.
- A `/**` rule given as a function that returns `undefined` for a node no longer stops `/**` from applying to that node's children.
- Hook responses only use the documented fields (`value`, `state`, `rules`, `exitHook`, `done`, `terminate`); other fields are ignored.
- Types: `CrawlContext.key` is `string | number | undefined` (it is `undefined` for the root), function rules may return `undefined`, and `mergeRules` takes a single type parameter, `mergeRules<R>(rules)`.

### New

- Prefix rules (`"/<prefix>*"`) and `matchPrefixRule(rules, key)`.
- `circular` option. `syncCrawl`, `crawl` and `transform` accept `{ circular: true }` to stop at cycles (a node whose value is one of its ancestors is visited, but its children are not). `syncClone` and `clone` accept `{ circular: false }` to skip reference tracking for tree-shaped input, which is about 45% faster on large documents.
- `REMOVE` and `JSON_ROOT_KEY` exports; `"/**"` is part of the `CrawlRules` type.
- Function rules can return `undefined` to mean "no rule for this node".

### Fixes

- `clone`, `syncClone` and `transform` copy an own `__proto__` key as a plain property instead of changing the prototype of the copy.
- Removing array elements in `transform` no longer skips the next element.
- `mergeRules` with function rules that return `undefined` no longer throws.
- `transform` returns the input document when no hook changed anything.

### Requirements

Node.js 18 or any ES2022 runtime.
