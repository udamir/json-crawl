# Changelog

## 1.1.0

### Highlights

- **`ctx.parent`.** Every hook receives the object or array the current node was read from (`undefined` for the root), so code that needs the parent no longer has to pass it down as state: on a 5.5 MB OpenAPI document that is 27% faster than the state-based way 1.0.0 required.
- **Hooks that return something are cheaper.** On the same document compared with 1.0.0: a hook that returns an exit hook for every node 31% faster, a new state and an exit hook for every container 26%, a new state for every container 15%, `transform` with a synchronous hook 7%, async `crawl` with synchronous hooks 5%, a crawl with an OpenAPI rule tree 6%.
- **Merged rule sets resolve as fast as one set.** `rules: [a, b]` (or `mergeRules`) where both sets have rule objects under the same path key, such as two `/**` rules, is 4.3× faster than in 1.0.0 and as fast as a single set with the same rules.

### New

- `parent` in the hook context: the object or array the node's value was read from, the replacement when an earlier hook replaced the parent's value, and `undefined` for the root. In `syncClone` and `clone` it is the source container, in `transform` the container being changed.

### Performance

- A crawl whose hook returns nothing is up to 3% slower than in 1.0.0: every context carries the new `parent` field.
- The rules that nodes receive from merged rule objects may now be the same object for several nodes, as rules under a `/**` rule already were; as before, treat rule objects returned to hooks as read-only.

## 1.0.0

### Highlights

- **Prefix rules.** A rule key ending in `*` matches every key that starts with the text before it: `"/x-*": extensionRule`, `"/x-internal-*": privateRule` (the longest prefix wins). Order of precedence: exact key > longest prefix > `/*` > `/**`.
- **Much faster.** On a 5.5 MB OpenAPI document compared with 0.5.3: `syncCrawl` and async `crawl` 7× faster, `syncClone` 5×, cloning with a hook 4×, crawls with rules 3×, crawls with prefix rules 5×; `equal` is 5× faster even though it now also handles cycles and shared objects. `equal` on a 100 000-element array takes 0.5 ms instead of 22 s.
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
