# json-crawl benchmark

json-crawl 1.1.0 compared with the last 0.x release (json-crawl 0.5.3) and with popular npm libraries that cover one of its features: traversal, deep clone, deep equality and transformation, and with the last release (json-crawl 1.0.0) on async traversal, rules and the hook patterns that changed since. Everything below is produced by the scripts in this directory.

## Run it

```sh
pnpm install
pnpm run all        # builds the library (pnpm build in the repository root), generates the fixtures, runs every case and rewrites this file
```

## Environment

| item | value |
|---|---|
| Node | v26.13.0 |
| CPU | Intel(R) Core(TM) i9-9880H CPU @ 2.30GHz, 16 logical cores, 16 GB RAM |
| OS | Darwin 24.6.0 (darwin x64) |
| Date | 2026-11-19T06:29:12.191Z |

| library | version |
|---|---|
| json-crawl 1.1.0 | this repository, `dist/index.cjs` built by `vp pack` |
| json-crawl 1.0.0 | npm release |
| json-crawl 0.5.3 | npm release |
| traverse | 0.6.14 |
| object-traversal | 1.0.1 |
| deep-for-each | 3.0.0 |
| tree-crawl | 1.2.2 |
| json-schema-traverse | 1.0.0 |
| rfdc | 1.4.1 |
| klona | 2.0.6 |
| lodash.clonedeep | 4.5.0 |
| clone | 2.1.2 |
| fast-equals | 6.2.2 |
| lodash.isequal | 4.5.0 |
| deep-equal | 2.2.3 |

## Method

Fixtures are generated deterministically by `fixtures/generate.mjs`: `wide-10k` is a flat object of 10 000 primitives, `deep-5k` a chain of 5 000 nested objects (`{ level, name, child }`), `array-100k` a flat array of 100 000 primitives, and `openapi` the Swagger petstore replicated into a 5.5 MB OpenAPI document with `$ref`s and `x-` extensions. Every cell (one library on one fixture) runs in its own fresh Node process that loads only that fixture, because cells measured in one process influence each other: one library building V8's enum caches for the document speeds up the next one, and a deep document measured earlier can slow down later crawls by 20% or more. Every cell is checked once for correctness (node counts for json-crawl, copies compared with the source, `true` for equal documents and `false` for documents that differ in their last leaf), then warmed up for 20 iterations and timed for 7 runs; tables show the median and the minimum. Cells marked † took more than 0.5 s per iteration and ran with a shortened warm-up. The traversal visitor reads only the value and the key, so the times are the cost of the walk itself. Reading the path is not benchmarked: libraries represent it differently (json-crawl and traverse hand out arrays of keys, object-traversal and deep-for-each strings), and a string path looks almost free in a benchmark only because V8 concatenates strings without copying and defers the copy to the first real use of the content, which a benchmark visitor does not reproduce. Libraries whose semantics differ from json-crawl's are footnoted.

Libraries that handle cyclic input and libraries that do not are compared in separate tables: handling cycles means tracking every visited object, which is work the others skip, so a cycle-safe library is only compared with other cycle-safe ones. A library "handles cycles" when, on a small cyclic document, its traversal terminates, its clone reproduces the cycle in the copy, or its equality returns `true` for two equal cyclic documents and `false` for different ones; the harness checks this for every library in a worker with a time and memory limit before timing anything, and stops if a declared group does not match. json-crawl appears in both groups where it has both modes: `syncCrawl` without and with `circular: true`, `syncClone` with its default reference tracking and with `circular: false`. Its `equal` always handles cycles, so equality has only the cycle-safe table; groups without a json-crawl 1.1.0 column are not reported.

## Results

### Traversal

**sync traversal, the visitor reads value and key, libraries that handle cycles**, median / min ms (lower is better)

| fixture | json-crawl 1.1.0 circular [1] | traverse [2] | object-traversal cycles [3] |
|---|---|---|---|
| wide-10k (10,001 nodes) | 1.5 / 1.5 | 6.6 / 6.5 | 1.6 / 1.4 |
| deep-5k (15,003 nodes) | 4.6 / 4.1 | — [4] | 1.2 / 1.1 |
| array-100k (100,001 nodes) | 3.4 / 3.3 | 50.3 / 49.5 | 9.5 / 9.1 |
| openapi (317,649 nodes) | 36.3 / 35.6 | 174.2 / 166.7 | 47.0 / 44.6 |

[1] json-crawl 1.1.0 circular: circular: true (a node whose value is an ancestor is visited, its children are not)  
[2] traverse: recursive; cycle detection always on  
[3] object-traversal cycles: cycleHandling: true  
[4] traverse on deep-5k: RangeError: Maximum call stack size exceeded

**sync traversal, the visitor reads value and key, libraries without cycle support (tree input only)**, median / min ms (lower is better)

| fixture | json-crawl 1.1.0 | json-crawl 0.5.3 | object-traversal [1] | deep-for-each [2] | tree-crawl [3] | json-schema-traverse [4] |
|---|---|---|---|---|---|---|
| wide-10k (10,001 nodes) | 1.6 / 1.6 | 6.7 / 6.7 | 1.5 / 1.5 | 1.5 / 1.4 | 5.6 / 5.3 | 2.2 / 2.0 |
| deep-5k (15,003 nodes) | 3.8 / 3.6 | 189.0 / 181.5 | 1.1 / 1.0 | 1.8 / 1.6 | 1.1 / 0.9 | — [5] |
| array-100k (100,001 nodes) | 3.3 / 3.1 | 50.7 / 49.5 | 9.7 / 8.8 | 6.0 / 5.9 | 19.6 / 19.4 | 0.0 / 0.0 |
| openapi (317,649 nodes) | 24.3 / 23.7 | 176.3 / 172.4 | 43.2 / 41.1 | 57.7 / 55.2 | 26.7 / 25.9 | 30.0 / 29.2 |

[1] object-traversal: cycleHandling: false  
[2] deep-for-each: the root is not visited  
[3] tree-crawl: generic tree walker: no keys or paths  
[4] json-schema-traverse: visits sub-schema objects only, never primitives  
[5] json-schema-traverse on deep-5k: RangeError: Maximum call stack size exceeded

**async traversal (crawl), sync visitor**, median / min ms (lower is better)

| fixture | json-crawl 1.1.0 | json-crawl 1.0.0 | json-crawl 0.5.3 |
|---|---|---|---|
| wide-10k (10,001 nodes) | 1.2 / 1.2 | 1.3 / 1.3 | 7.5 / 7.4 |
| openapi (317,649 nodes) | 29.4 / 28.6 | 31.0 / 30.2 | 237.7 / 230.4 |

### Clone

**deep clone, libraries that handle cycles**, median / min ms (lower is better)

| fixture | json-crawl 1.1.0 | json-crawl 0.5.3 | rfdc circles [1] | lodash.clonedeep | clone | structuredClone [2] |
|---|---|---|---|---|---|---|
| wide-10k (10,001 nodes) | 1.5 / 1.4 | 9.9 / 9.5 | 1.7 / 1.7 | 2.0 / 1.9 | 2.1 / 2.0 | 3.8 / 3.7 |
| deep-5k (15,003 nodes) | 0.8 / 0.8 | 204.9 / 189.9 | 2.1 / 1.9 | — [3] | — [4] | — [5] |
| array-100k (100,001 nodes) | 0.3 / 0.3 | 90.5 / 85.4 | 6.3 / 5.4 | 2.8 / 2.4 | 7.9 / 7.1 | 3.4 / 3.2 |
| openapi (317,649 nodes) | 74.0 / 68.3 | 349.2 / 338.6 | 49.5 / 43.6 | 109.8 / 107.8 | 2.23 s / 2.11 s † | 130.9 / 126.9 |

[1] rfdc circles: rfdc({ circles: true })  
[2] structuredClone: built-in  
[3] lodash.clonedeep on deep-5k: RangeError: Maximum call stack size exceeded  
[4] clone on deep-5k: RangeError: Maximum call stack size exceeded  
[5] structuredClone on deep-5k: RangeError: Maximum call stack size exceeded

**deep clone, libraries without cycle support (tree input only)**, median / min ms (lower is better)

| fixture | json-crawl 1.1.0 tree [1] | rfdc [2] | klona | klona/json [3] | JSON.parse(JSON.stringify()) [4] |
|---|---|---|---|---|---|
| wide-10k (10,001 nodes) | 1.5 / 1.5 | 1.6 / 1.6 | 1.7 / 1.6 | 1.5 / 1.5 | 2.9 / 2.9 |
| deep-5k (15,003 nodes) | 0.5 / 0.5 | 0.3 / 0.3 | 0.5 / 0.5 | 0.4 / 0.4 | 1.4 / 1.4 |
| array-100k (100,001 nodes) | 0.4 / 0.3 | 6.3 / 5.5 | 1.2 / 0.9 | 0.4 / 0.4 | 4.4 / 4.1 |
| openapi (317,649 nodes) | 37.6 / 32.3 | 41.9 / 41.3 | 43.7 / 41.2 | 39.4 / 34.7 | 57.7 / 55.5 |

[1] json-crawl 1.1.0 tree: circular: false (tree input: no cycle or shared-reference tracking)  
[2] rfdc: default options  
[3] klona/json: JSON values only  
[4] JSON.parse(JSON.stringify()): built-in; throws on cycles

**deep clone that doubles every number, libraries that handle cycles**, median / min ms (lower is better)

| fixture | json-crawl 1.1.0 | json-crawl 0.5.3 | rfdc circles + traverse update [1] |
|---|---|---|---|
| array-100k (100,001 nodes) | 4.4 / 4.4 | 101.7 / 99.4 | 57.7 / 57.1 |
| openapi (317,649 nodes) | 97.7 / 95.8 | 384.6 / 377.2 | 232.2 / 229.5 |

[1] rfdc circles + traverse update: two passes: rfdc({ circles: true }) copy, then an in-place traverse update

**deep clone that doubles every number, libraries without cycle support (tree input only)**, median / min ms (lower is better)

| fixture | json-crawl 1.1.0 tree [1] | rfdc + traverse update [2] | traverse map [3] | JSON.parse reviver [4] |
|---|---|---|---|---|
| array-100k (100,001 nodes) | 4.6 / 4.5 | 54.0 / 53.0 | 77.6 / 76.2 | 41.4 / 40.0 |
| openapi (317,649 nodes) | 69.0 / 64.3 | 223.4 / 222.2 | 641.6 / 621.9 † | 136.9 / 129.9 |

[1] json-crawl 1.1.0 tree: circular: false  
[2] rfdc + traverse update: two passes: rfdc copy, then an in-place traverse update  
[3] traverse map: traverse(doc).map with this.update; terminates on cycles but does not reproduce them in the copy  
[4] JSON.parse reviver: built-in; serializes the document first

### Equality

**deep equality of two equal documents**, median / min ms (lower is better)

| fixture | json-crawl 1.1.0 | fast-equals circular [1] | lodash.isequal | deep-equal [2] | util.isDeepStrictEqual [3] |
|---|---|---|---|---|---|
| wide-10k (10,001 nodes) | 2.0 / 1.9 | 2.0 / 1.9 | 2.3 / 2.2 | 2.7 / 2.6 | 2.1 / 2.1 |
| deep-5k (15,003 nodes) | 0.9 / 0.9 | — [4] | — [5] | — [6] | — [7] |
| array-100k (100,001 nodes) | 0.3 / 0.3 | 0.5 / 0.5 | 0.7 / 0.7 | 15.9 / 14.1 | 0.7 / 0.7 |
| openapi (317,649 nodes) | 49.8 / 47.9 | 82.7 / 81.8 | 104.7 / 101.7 | 24.72 s / 24.71 s † | 60.3 / 58.6 |

[1] fast-equals circular: circularDeepEqual  
[2] deep-equal: strict mode  
[3] util.isDeepStrictEqual: built-in  
[4] fast-equals circular on deep-5k: RangeError: Maximum call stack size exceeded  
[5] lodash.isequal on deep-5k: RangeError: Maximum call stack size exceeded  
[6] deep-equal on deep-5k: TypeError: iterator must be a function  
[7] util.isDeepStrictEqual on deep-5k: RangeError: Maximum call stack size exceeded

### Rules (json-crawl only)

**OpenAPI rule tree with function rules, state copied per node**, median / min ms (lower is better)

| fixture | json-crawl 1.1.0 | json-crawl 1.0.0 | json-crawl 0.5.3 |
|---|---|---|---|
| openapi (317,649 nodes) | 77.6 / 76.0 | 81.8 / 80.6 | 251.5 / 248.7 |

**x- extension rule at every depth**, median / min ms (lower is better)

| fixture | json-crawl 1.1.0 [1] | json-crawl 1.0.0 [2] | json-crawl 0.5.3 [3] |
|---|---|---|---|
| openapi (317,649 nodes) | 37.2 / 36.5 | 37.5 / 36.9 | 197.4 / 194.3 |

[1] json-crawl 1.1.0: "/x-*" prefix rule  
[2] json-crawl 1.0.0: "/x-*" prefix rule  
[3] json-crawl 0.5.3: no prefix rules: emulated with a /* function rule

### Hook patterns (json-crawl only)

What hooks commonly return or need, compared with the last release. Every hook counts the nodes it sees, and every cell is checked to have seen all of them.

**the hook returns an exit hook for every node**, median / min ms (lower is better)

| fixture | json-crawl 1.1.0 | json-crawl 1.0.0 |
|---|---|---|
| deep-5k (15,003 nodes) | 3.5 / 3.5 | 4.0 / 4.0 |
| openapi (317,649 nodes) | 23.6 / 23.4 | 34.6 / 33.9 |

**the hook returns a new state for every container**, median / min ms (lower is better)

| fixture | json-crawl 1.1.0 | json-crawl 1.0.0 |
|---|---|---|
| deep-5k (15,003 nodes) | 4.1 / 3.6 | 4.4 / 4.2 |
| openapi (317,649 nodes) | 28.6 / 24.8 | 30.9 / 29.3 |

**the hook returns a new state and an exit hook for every container**, median / min ms (lower is better)

| fixture | json-crawl 1.1.0 | json-crawl 1.0.0 |
|---|---|---|
| deep-5k (15,003 nodes) | 3.7 / 3.4 | 4.6 / 4.5 |
| openapi (317,649 nodes) | 26.0 / 25.7 | 36.8 / 34.8 |

**the hook needs the parent of every node**, median / min ms (lower is better)

| fixture | json-crawl 1.1.0 [1] | json-crawl 1.0.0 [2] |
|---|---|---|
| deep-5k (15,003 nodes) | 3.5 / 3.3 | 4.6 / 4.1 |
| openapi (317,649 nodes) | 22.9 / 22.0 | 30.8 / 30.1 |

[1] json-crawl 1.1.0: ctx.parent  
[2] json-crawl 1.0.0: the parent passed down as state (no ctx.parent)

**rules: [{ "/**": { a: 1 } }, { "/**": { b: 1 } }], the hook reads the merged rules**, median / min ms (lower is better)

| fixture | json-crawl 1.1.0 | json-crawl 1.0.0 |
|---|---|---|
| openapi (317,649 nodes) | 35.7 / 35.2 | 157.7 / 152.5 |

**transform with a synchronous no-op hook**, median / min ms (lower is better)

| fixture | json-crawl 1.1.0 | json-crawl 1.0.0 |
|---|---|---|
| openapi (317,649 nodes) | 40.2 / 38.5 | 43.3 / 41.5 |
