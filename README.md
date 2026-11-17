# json-crawl
<img alt="npm" src="https://img.shields.io/npm/v/json-crawl"> <img alt="npm" src="https://img.shields.io/npm/dm/json-crawl?label=npm"> <img alt="npm type definitions" src="https://img.shields.io/npm/types/json-crawl"> <img alt="GitHub" src="https://img.shields.io/github/license/udamir/json-crawl">

Walk, clone, transform and compare JSON documents with hooks. Zero dependencies, sync and async, fully typed.

- **Crawl** every node of a document with `syncCrawl` / `crawl`, with access to the value, key, path, a state that flows down the tree, and rules matched by path.
- **Clone** deeply with `syncClone` / `clone`, keeping cycles and shared references, and optionally rewriting values on the way.
- **Transform** a document in place with `transform`: replace or remove any node.
- **Compare** two documents with `equal`.
- **Rules**: attach your own metadata to paths (`/paths/*/get`, `/x-*`, `/**`) and get the matching rule for every node.
- Iterative, not recursive: documents nested 100 000 levels deep are fine.

## Installation

```sh
pnpm add json-crawl     # or: npm install json-crawl / yarn add json-crawl
```

The package ships ES modules, CommonJS and TypeScript declarations for both, plus a minified browser build (`dist/index.iife.js`, global `JsonCrawl`). It runs on Node.js 18+ and any ES2022 runtime.

## Quick start

```ts
import { syncCrawl } from "json-crawl"

const doc = { name: "Rex", tags: ["dog", "good"], owner: { name: "Ann" } }

const strings: string[] = []
syncCrawl(doc, ({ value, path }) => {
  if (typeof value === "string") { strings.push(path.join(".")) }
})
// strings: ["name", "tags.0", "tags.1", "owner.name"]
```

Nodes are visited depth-first, parents before children, object keys in insertion order. The root is visited too, with `key: undefined` and `path: []`.

## API at a glance

| function | what it does |
|---|---|
| `syncCrawl(data, hooks, params?)` | visits every node, synchronously |
| `crawl(data, hooks, params?)` | same, hooks may be async; returns a `Promise<void>` |
| `syncClone(data, hooks?, params?)` | returns a deep copy |
| `clone(data, hooks?, params?)` | same, hooks may be async |
| `transform(data, hooks?, params?)` | changes `data` in place and returns it (async) |
| `equal(a, b)` | deep equality of two JSON values |
| `getNodeRules(rules, key, path, value)` | the rule of a child node, as the crawler resolves it |
| `mergeRules([rulesA, rulesB])` | combines rule sets |
| `REMOVE` | value that removes a node in `transform` |

`hooks` is a function or an array of functions. `params` is `{ state?, rules?, circular? }`; see [Cycles](#cycles) for `circular`.

## Hooks

A hook receives the context of the current node and may return a response:

```ts
syncCrawl(doc, ({ value, key, path, state, rules }) => {
  return {
    value,       // replace the node's value for the rest of the crawl (and in clone/transform output)
    state,       // state for this node's children (siblings keep the parent's state)
    rules,       // rules to resolve this node's children with
    exitHook,    // () => void, called after all children of this node were visited
    done,        // true: skip this node's children (and the remaining hooks for this node)
    terminate,   // true: stop the whole crawl
  }
})
```

Every field is optional; returning nothing changes nothing. With several hooks, they run in array order and each one sees what the previous one returned.

**State flows down the tree.** Return a new state and only the node's children see it:

```ts
const depths: Record<string, number> = {}
syncCrawl(doc, ({ path, state }) => {
  depths[path.join(".") || "(root)"] = state.depth
  return { state: { depth: state.depth + 1 } }
}, { state: { depth: 0 } })
// depths: { "(root)": 0, name: 1, tags: 1, "tags.0": 2, "tags.1": 2, owner: 1, "owner.name": 2 }
```

**Skip a subtree, or stop early:**

```ts
syncCrawl(doc, ({ key }) => {
  if (key === "owner") { return { done: true } }        // owner.name is not visited
})

let found: unknown
syncCrawl(doc, ({ value }) => {
  if (value === "good") { found = value; return { terminate: true } }
})
```

**Run code after a node's children** (post-order), for example to count the leaves of every container:

```ts
const sizes: Record<string, number> = {}
syncCrawl(doc, ({ value, path, state }) => {
  if (typeof value !== "object" || value === null) { state.leaves++; return }
  const own = { leaves: 0 }
  return {
    state: own,
    exitHook: () => { sizes[path.join(".") || "(root)"] = own.leaves; state.leaves += own.leaves },
  }
}, { state: { leaves: 0 } })
// sizes: { tags: 2, owner: 1, "(root)": 4 }
```

**Async hooks** work with `crawl`, `clone` and `transform`. Hooks run one node at a time, in order:

```ts
import { crawl } from "json-crawl"

await crawl(doc, async ({ value, path }) => {
  if (typeof value === "string") { await checkSpelling(path, value) }
})
```

`syncCrawl` and `syncClone` throw a `TypeError` if a hook returns a promise.

## Clone

```ts
import { syncClone } from "json-crawl"

const copy = syncClone(doc)   // deep copy; cycles and shared references are kept as they are in the source
```

Hooks rewrite the copy while it is built; the source is never modified:

```ts
const user = { name: "Ann", password: "secret", tokens: ["a1", "b2"], meta: { internal: true } }

const safe = syncClone(user, ({ key, value }) => {
  if (key === "password") { return { value: "***" } }   // replace a value
  if (key === "meta") { return { done: true } }         // leave a node out of the copy
  if (typeof value === "string") { return { value: value.toUpperCase() } }
})
// safe: { name: "ANN", password: "***", tokens: ["A1", "B2"] }
```

`clone` is the same with async hooks. If you know the input is a tree, pass `{ circular: false }` to skip reference tracking; see [Cycles](#cycles).

## Transform

`transform` changes a document in place. Return `{ value }` to replace a node and `{ value: REMOVE }` to delete it; array elements are spliced out after the array is walked, so every element is visited once with its original index.

```ts
import { transform, REMOVE } from "json-crawl"

const config = { port: "8080", debug: true, users: [{ name: "a", token: "x" }, { name: "b", token: "y" }] }

await transform(config, ({ key, value }) => {
  if (key === "token") { return { value: REMOVE } }
  if (key === "port") { return { value: Number(value) } }
})
// config: { port: 8080, debug: true, users: [{ name: "a" }, { name: "b" }] }
```

`transform` returns the document (or the new root value if the hook replaced the root). For documents that may contain cycles, pass `{ circular: true }`; see [Cycles](#cycles).

## Equal

```ts
import { equal } from "json-crawl"

equal({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })   // true
equal({ a: [1, 2] }, { a: [2, 1] })                 // false
equal([], {})                                       // false
equal(NaN, NaN)                                     // true
```

`equal` compares JSON values: primitives by value (`NaN` equals `NaN`, `0` equals `-0`), arrays by index, objects by their own enumerable keys. Cyclic documents are compared by structure, with no option needed: the bookkeeping starts only below the first 32 levels, so ordinary documents don't pay for it. Prototypes are not compared, so class instances, `Date`, `Map` or `Set` are not meaningfully compared; use a general-purpose library for those.

## Rules

Rules attach your own data to the nodes of a document, by path. A rule set is an object whose `/`-prefixed keys match child keys:

| key | matches |
|---|---|
| `"/name"` | the child key `name` |
| `"/x-*"` | every child key that starts with `x-` |
| `"/*"` | any child key |
| `"/**"` | any key at any depth below |

Any other field of a rule set is yours. The crawler gives every hook the rule set of the current node as `rules`:

```ts
import { syncCrawl, type CrawlRules } from "json-crawl"

type Rule = { kind?: string }

const schemaRules: CrawlRules<Rule> = {
  kind: "schema",
  "/properties": { "/*": () => schemaRules },   // a function rule is resolved lazily, so rules can be recursive
  "/items": () => schemaRules,
}

const openApiRules: CrawlRules<Rule> = {
  "/paths": {
    "/*": {                                      // any path
      "/*": { kind: "operation" },               // any method
    },
  },
  "/components": { "/schemas": { "/*": schemaRules } },
  "/x-*": { kind: "extension" },
}

const openApiDoc = {
  paths: { "/pets": { get: { summary: "List pets" } } },
  components: { schemas: { Pet: { type: "object", properties: { tags: { type: "array", items: { type: "string" } } } } } },
  "x-generated": true,
}

syncCrawl(openApiDoc, ({ path, rules }) => {
  if (rules?.kind) { console.log(path, rules.kind) }
}, { rules: openApiRules })
// ["paths", "/pets", "get"] operation
// ["components", "schemas", "Pet"] schema
// ["components", "schemas", "Pet", "properties", "tags"] schema
// ["components", "schemas", "Pet", "properties", "tags", "items"] schema
// ["x-generated"] extension
```

How a child's rule is found: the exact key wins over the longest matching prefix, which wins over `/*`, which wins over `/**`. They are merged, so a `/*` rule supplies defaults for every key and an exact rule overrides some of its fields. A node no rule matches gets `rules: undefined`. `/**` keeps applying all the way down, which makes it the place for rules that should match at every depth:

```ts
const rules: CrawlRules<Rule> = {
  "/**": { "/x-*": { kind: "extension" } },     // x- keys at any depth
}
```

A rule can also be a function `({ key, path, value }) => rules | undefined`, called when a node is reached; return `undefined` for "no rule here".

Prefix rules (`"/<prefix>*"`) match string keys only, never array indexes, and are case-sensitive. Only a trailing `*` is special: `"/a*b*"` matches keys starting with `a*b`, and `"/*-id"` is the exact key `*-id`.

**Combining rule sets.** Spread a rule set to add or override single keys, or merge whole sets with `mergeRules`; keys present in several sets are merged when a node needs them, and a conflicting non-path field throws:

```ts
import { mergeRules } from "json-crawl"

const custom = { ...openApiRules, "/x-internal-*": { kind: "private" } }   // x-internal-* now wins over x-*
const merged = mergeRules([openApiRules, { "/paths": { "/*": { "/*": { "/deprecated": { kind: "flag" } } } } }])
```

`getNodeRules(rules, key, path, value)` returns the rule set of a child exactly as the crawler resolves it, for code that walks documents on its own.

## Cycles

JSON parsed from text never has cycles, but objects built in code can. Each function handles them as follows:

| function | default | option |
|---|---|---|
| `syncClone` / `clone` | cycles and shared references are kept: an object reached twice is copied once | `{ circular: false }`: treat the input as a tree; about 30% faster on large documents, every reference is copied separately, and a cyclic input never finishes |
| `equal` | cycles are compared by structure | none needed |
| `syncCrawl` / `crawl` / `transform` | references are followed, so a cyclic input never finishes | `{ circular: true }`: a node whose value is one of its own ancestors is visited, but its children are not (as if a hook returned `done`) |

```ts
const node: any = { name: "root", children: [] }
node.children.push({ name: "child", parent: node })

const names: string[] = []
syncCrawl(node, ({ key, value }) => {
  if (key === "name") { names.push(value as string) }
}, { circular: true })
// names: ["root", "child"]; the crawl stops at child.parent instead of looping

const copy: any = syncClone(node)     // copy.children[0].parent === copy
```

With `circular: true` the crawl only cuts real cycles. An object shared by two branches of the tree is still visited in both.

## Good to know

- Only own enumerable string keys are visited (no symbols, no inherited or non-enumerable properties). Array holes are skipped; `clone` keeps them and `equal` tells a hole from an explicit `undefined`.
- `path` is a fresh array for every node and is never changed afterwards, so it is safe to keep. For nodes deeper than 128 levels it is built only when a hook reads it, which keeps very deep documents fast.
- Clone and transform hooks get two extra state fields, `state.root` and `state.node` (the output being built). If such a hook returns its own state, keep them: `{ state: { ...state, mine: 1 } }`.
- Rule objects returned to hooks may be shared between nodes; treat them as read-only.

## Performance

json-crawl is written for large documents such as multi-megabyte OpenAPI specs. Minimum time in ms on a 5.5 MB OpenAPI document (317 649 nodes), Node 26, lower is better:

| task | json-crawl 1.0.0 | json-crawl 0.5.3 | popular alternatives |
|---|---|---|---|
| walk every node | 41 | 213 | object-traversal 44, deep-for-each 59, traverse 176 |
| walk every node, async | 39 | 239 | (none offer it) |
| deep clone | 131 (88 with `circular: false`) | 372 | klona 42, rfdc 45, lodash.clonedeep 115, structuredClone 138 |
| clone and double every number | 152 | 419 | JSON.parse reviver 134, rfdc + traverse 244, traverse map 694 |
| deep equality | 30 | 268 | fast-equals 33, fast-deep-equal 37, util.isDeepStrictEqual 94, lodash.isequal 102 |
| crawl with an OpenAPI rule tree | 155 | 309 | (json-crawl only) |

- Version 1.0.0 is 2–9× faster than 0.5.3, and `equal` on a 100 000-element array takes 0.5 ms instead of 22 s.
- Walking, comparing, and transforming while copying are on par with the fastest single-purpose libraries, even though every json-crawl hook gets the key, the path, a state and the matched rules.
- Plain cloning is 2–3× slower than klona or rfdc: json-crawl keeps cycles and shared references by default and runs the hook machinery. With `circular: false` (tree input) the gap halves; lodash.clonedeep and structuredClone, which also keep cycles, are in the same range as the default.
- Nothing overflows the stack: on a chain of 5 000 nested objects, traverse, deep-for-each, rfdc, lodash.clonedeep, structuredClone, fast-equals, lodash.isequal and util.isDeepStrictEqual throw `RangeError`, json-crawl does not.

Full tables, more fixtures and the method: [bench/README.md](bench/README.md).

## Contributing

json-crawl has no runtime dependencies, and it should stay that way. The toolchain is [Vite+](https://viteplus.dev) with TypeScript 7:

```sh
pnpm install
pnpm test            # vitest
pnpm run typecheck   # tsc
pnpm run lint        # oxlint
pnpm run build       # dist/ (ESM, CommonJS, IIFE and declarations)
```

Please add tests for your change.

## License

MIT
