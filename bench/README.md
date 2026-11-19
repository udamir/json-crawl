# json-crawl benchmark

json-crawl 1.2.0 compared with the last 0.x release (json-crawl 0.5.3) and with popular npm libraries that cover one of its features: traversal, deep clone, deep equality and transformation, and with the last release (json-crawl 1.1.0) on async traversal, rules and common hook patterns. Everything below is produced by the scripts in this directory.

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
| Date | 2026-11-19T20:27:58.947Z |

| library | version |
|---|---|
| json-crawl 1.2.0 | this repository, `dist/index.cjs` built by `vp pack` |
| json-crawl 1.1.0 | npm release |
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

Libraries that handle cyclic input and libraries that do not are compared in separate tables: handling cycles means tracking every visited object, which is work the others skip, so a cycle-safe library is only compared with other cycle-safe ones. A library "handles cycles" when, on a small cyclic document, its traversal terminates, its clone reproduces the cycle in the copy, or its equality returns `true` for two equal cyclic documents and `false` for different ones; the harness checks this for every library in a worker with a time and memory limit before timing anything, and stops if a declared group does not match. json-crawl appears in both groups where it has both modes: `syncCrawl` without and with `circular: true`, `syncClone` with its default reference tracking and with `circular: false`. Its `equal` always handles cycles, so equality has only the cycle-safe table; groups without a json-crawl 1.2.0 column are not reported.

## Results

### Traversal

**sync traversal, the visitor reads value and key, libraries that handle cycles**, median / min ms (lower is better)

| fixture | json-crawl 1.2.0 circular [1] | traverse [2] | object-traversal cycles [3] |
|---|---|---|---|
| wide-10k (10,001 nodes) | 1.7 / 1.7 | 6.6 / 6.4 | 1.5 / 1.4 |
| deep-5k (15,003 nodes) | 4.2 / 3.8 | — [4] | 1.7 / 1.5 |
| array-100k (100,001 nodes) | 3.2 / 3.1 | 51.3 / 49.7 | 12.7 / 9.6 |
| openapi (317,649 nodes) | 36.9 / 36.2 | 167.2 / 166.5 | 47.0 / 45.4 |

[1] json-crawl 1.2.0 circular: circular: true (a node whose value is an ancestor is visited, its children are not)  
[2] traverse: recursive; cycle detection always on  
[3] object-traversal cycles: cycleHandling: true  
[4] traverse on deep-5k: RangeError: Maximum call stack size exceeded

**sync traversal, the visitor reads value and key, libraries without cycle support (tree input only)**, median / min ms (lower is better)

| fixture | json-crawl 1.2.0 | json-crawl 0.5.3 | object-traversal [1] | deep-for-each [2] | tree-crawl [3] | json-schema-traverse [4] |
|---|---|---|---|---|---|---|
| wide-10k (10,001 nodes) | 1.8 / 1.8 | 7.0 / 6.9 | 1.6 / 1.5 | 1.4 / 1.4 | 5.7 / 5.3 | 2.0 / 1.9 |
| deep-5k (15,003 nodes) | 3.6 / 3.4 | 206.5 / 194.7 | 1.4 / 1.0 | 2.0 / 1.7 | 1.0 / 0.8 | — [5] |
| array-100k (100,001 nodes) | 3.2 / 3.0 | 56.2 / 53.9 | 19.6 / 18.0 | 6.1 / 5.9 | 21.6 / 19.7 | 0.0 / 0.0 |
| openapi (317,649 nodes) | 23.8 / 23.2 | 173.5 / 169.1 | 46.0 / 43.5 | 56.2 / 55.2 | 28.0 / 27.1 | 30.2 / 29.8 |

[1] object-traversal: cycleHandling: false  
[2] deep-for-each: the root is not visited  
[3] tree-crawl: generic tree walker: no keys or paths  
[4] json-schema-traverse: visits sub-schema objects only, never primitives  
[5] json-schema-traverse on deep-5k: RangeError: Maximum call stack size exceeded

**async traversal (crawl), sync visitor**, median / min ms (lower is better)

| fixture | json-crawl 1.2.0 | json-crawl 1.1.0 | json-crawl 0.5.3 |
|---|---|---|---|
| wide-10k (10,001 nodes) | 1.2 / 1.2 | 1.4 / 1.2 | 7.7 / 7.2 |
| openapi (317,649 nodes) | 29.1 / 28.2 | 29.1 / 27.7 | 234.2 / 232.5 |

### Clone

**deep clone, libraries that handle cycles**, median / min ms (lower is better)

| fixture | json-crawl 1.2.0 | json-crawl 0.5.3 | rfdc circles [1] | lodash.clonedeep | clone | structuredClone [2] |
|---|---|---|---|---|---|---|
| wide-10k (10,001 nodes) | 1.7 / 1.6 | 11.3 / 10.8 | 1.9 / 1.9 | 2.2 / 2.2 | 2.3 / 2.3 | 4.9 / 4.3 |
| deep-5k (15,003 nodes) | 0.9 / 0.8 | 377.4 / 193.9 | 6.2 / 3.2 | — [3] | — [4] | — [5] |
| array-100k (100,001 nodes) | 0.4 / 0.4 | 105.7 / 103.4 | 7.4 / 6.1 | 3.4 / 2.8 | 8.4 / 8.0 | 3.6 / 3.3 |
| openapi (317,649 nodes) | 77.7 / 72.6 | 412.4 / 369.4 | 56.9 / 51.7 | 120.1 / 116.6 | 2.31 s / 2.26 s † | 149.6 / 143.2 |

[1] rfdc circles: rfdc({ circles: true })  
[2] structuredClone: built-in  
[3] lodash.clonedeep on deep-5k: RangeError: Maximum call stack size exceeded  
[4] clone on deep-5k: RangeError: Maximum call stack size exceeded  
[5] structuredClone on deep-5k: RangeError: Maximum call stack size exceeded

**deep clone, libraries without cycle support (tree input only)**, median / min ms (lower is better)

| fixture | json-crawl 1.2.0 tree [1] | rfdc [2] | klona | klona/json [3] | JSON.parse(JSON.stringify()) [4] |
|---|---|---|---|---|---|
| wide-10k (10,001 nodes) | 1.7 / 1.7 | 1.9 / 1.8 | 1.8 / 1.8 | 1.6 / 1.6 | 3.1 / 3.1 |
| deep-5k (15,003 nodes) | 1.0 / 0.6 | 0.5 / 0.4 | 0.6 / 0.6 | 0.5 / 0.5 | 1.8 / 1.7 |
| array-100k (100,001 nodes) | 0.4 / 0.3 | 6.7 / 5.8 | 1.3 / 0.9 | 0.4 / 0.4 | 4.5 / 4.2 |
| openapi (317,649 nodes) | 44.2 / 34.9 | 63.1 / 50.5 | 54.5 / 46.8 | 45.5 / 42.2 | 68.6 / 66.2 |

[1] json-crawl 1.2.0 tree: circular: false (tree input: no cycle or shared-reference tracking)  
[2] rfdc: default options  
[3] klona/json: JSON values only  
[4] JSON.parse(JSON.stringify()): built-in; throws on cycles

**deep clone that doubles every number, libraries that handle cycles**, median / min ms (lower is better)

| fixture | json-crawl 1.2.0 | json-crawl 0.5.3 | rfdc circles + traverse update [1] |
|---|---|---|---|
| array-100k (100,001 nodes) | 5.2 / 5.0 | 157.0 / 119.6 | 103.7 / 78.7 |
| openapi (317,649 nodes) | 194.1 / 107.0 | 428.1 / 408.2 | 257.8 / 243.4 |

[1] rfdc circles + traverse update: two passes: rfdc({ circles: true }) copy, then an in-place traverse update

**deep clone that doubles every number, libraries without cycle support (tree input only)**, median / min ms (lower is better)

| fixture | json-crawl 1.2.0 tree [1] | rfdc + traverse update [2] | traverse map [3] | JSON.parse reviver [4] |
|---|---|---|---|---|
| array-100k (100,001 nodes) | 5.2 / 5.2 | 60.6 / 60.4 | 104.0 / 74.6 | 41.9 / 40.0 |
| openapi (317,649 nodes) | 74.3 / 69.6 | 252.9 / 250.5 | 834.8 / 644.7 † | 203.3 / 149.2 |

[1] json-crawl 1.2.0 tree: circular: false  
[2] rfdc + traverse update: two passes: rfdc copy, then an in-place traverse update  
[3] traverse map: traverse(doc).map with this.update; terminates on cycles but does not reproduce them in the copy  
[4] JSON.parse reviver: built-in; serializes the document first

### Equality

**deep equality of two equal documents**, median / min ms (lower is better)

| fixture | json-crawl 1.2.0 | fast-equals circular [1] | lodash.isequal | deep-equal [2] | util.isDeepStrictEqual [3] |
|---|---|---|---|---|---|
| wide-10k (10,001 nodes) | 2.2 / 2.1 | 2.1 / 2.1 | 2.4 / 2.4 | 2.8 / 2.8 | 2.4 / 2.3 |
| deep-5k (15,003 nodes) | 1.0 / 1.0 | — [4] | — [5] | — [6] | — [7] |
| array-100k (100,001 nodes) | 0.3 / 0.3 | 0.5 / 0.5 | 0.8 / 0.8 | 18.2 / 16.0 | 0.8 / 0.8 |
| openapi (317,649 nodes) | 49.6 / 48.9 | 90.5 / 78.2 | 106.5 / 105.4 | 26.19 s / 25.71 s † | 60.7 / 59.3 |

[1] fast-equals circular: circularDeepEqual  
[2] deep-equal: strict mode  
[3] util.isDeepStrictEqual: built-in  
[4] fast-equals circular on deep-5k: RangeError: Maximum call stack size exceeded  
[5] lodash.isequal on deep-5k: RangeError: Maximum call stack size exceeded  
[6] deep-equal on deep-5k: TypeError: iterator must be a function  
[7] util.isDeepStrictEqual on deep-5k: RangeError: Maximum call stack size exceeded

### Rules (json-crawl only)

**OpenAPI rule tree with function rules, state copied per node**, median / min ms (lower is better)

| fixture | json-crawl 1.2.0 | json-crawl 1.1.0 | json-crawl 0.5.3 |
|---|---|---|---|
| openapi (317,649 nodes) | 83.0 / 80.8 | 97.2 / 82.2 | 268.9 / 263.9 |

**x- extension rule at every depth**, median / min ms (lower is better)

| fixture | json-crawl 1.2.0 [1] | json-crawl 1.1.0 [2] | json-crawl 0.5.3 [3] |
|---|---|---|---|
| openapi (317,649 nodes) | 37.9 / 35.8 | 37.4 / 37.0 | 203.8 / 198.5 |

[1] json-crawl 1.2.0: "/x-*" prefix rule  
[2] json-crawl 1.1.0: "/x-*" prefix rule  
[3] json-crawl 0.5.3: no prefix rules: emulated with a /* function rule

### Hook patterns (json-crawl only)

What hooks commonly return or need, compared with the last release. Every hook counts the nodes it sees, and every cell is checked to have seen all of them.

**the hook returns an exit hook for every node**, median / min ms (lower is better)

| fixture | json-crawl 1.2.0 | json-crawl 1.1.0 |
|---|---|---|
| deep-5k (15,003 nodes) | 3.5 / 3.4 | 3.6 / 3.4 |
| openapi (317,649 nodes) | 26.5 / 25.3 | 24.2 / 23.9 |

**the hook returns a new state for every container**, median / min ms (lower is better)

| fixture | json-crawl 1.2.0 | json-crawl 1.1.0 |
|---|---|---|
| deep-5k (15,003 nodes) | 3.6 / 3.5 | 4.0 / 3.5 |
| openapi (317,649 nodes) | 27.9 / 27.7 | 26.2 / 25.4 |

**the hook returns a new state and an exit hook for every container**, median / min ms (lower is better)

| fixture | json-crawl 1.2.0 | json-crawl 1.1.0 |
|---|---|---|
| deep-5k (15,003 nodes) | 3.9 / 3.6 | 4.0 / 3.7 |
| openapi (317,649 nodes) | 29.8 / 29.4 | 26.3 / 25.2 |

**the hook needs the parent of every node**, median / min ms (lower is better)

| fixture | json-crawl 1.2.0 | json-crawl 1.1.0 |
|---|---|---|
| deep-5k (15,003 nodes) | 5.1 / 4.3 | 3.5 / 3.4 |
| openapi (317,649 nodes) | 58.6 / 32.6 | 24.1 / 22.8 |

**rules: [{ "/**": { a: 1 } }, { "/**": { b: 1 } }], the hook reads the merged rules**, median / min ms (lower is better)

| fixture | json-crawl 1.2.0 | json-crawl 1.1.0 |
|---|---|---|
| openapi (317,649 nodes) | 80.6 / 46.1 | 38.4 / 37.1 |

**transform with a synchronous no-op hook**, median / min ms (lower is better)

| fixture | json-crawl 1.2.0 | json-crawl 1.1.0 |
|---|---|---|
| openapi (317,649 nodes) | 40.1 / 38.5 | 44.8 / 42.2 |

### Lazy paths (json-crawl only)

The same crawl with the default paths and with `path: "lazy"`, by how many nodes read their path. Every cell is checked to visit every node and to read the same paths.

**the hook reads no path**, median / min ms (lower is better)

| fixture | json-crawl 1.2.0 | json-crawl 1.2.0 lazy paths [1] |
|---|---|---|
| deep-5k (15,003 nodes) | 3.6 / 3.6 | 0.7 / 0.7 |
| openapi (317,649 nodes) | 24.1 / 23.8 | 21.4 / 20.8 |

[1] json-crawl 1.2.0 lazy paths: path: "lazy"

**the hook reads the path of $ref nodes only (3% of the nodes)**, median / min ms (lower is better)

| fixture | json-crawl 1.2.0 | json-crawl 1.2.0 lazy paths [1] |
|---|---|---|
| openapi (317,649 nodes) | 27.5 / 25.2 | 27.1 / 25.5 |

[1] json-crawl 1.2.0 lazy paths: path: "lazy"

**the hook reads the path of every node**, median / min ms (lower is better)

| fixture | json-crawl 1.2.0 | json-crawl 1.2.0 lazy paths [1] |
|---|---|---|
| deep-5k (15,003 nodes) | 86.9 / 83.5 | 79.3 / 78.9 |
| openapi (317,649 nodes) | 24.8 / 24.3 | 30.6 / 29.4 |

[1] json-crawl 1.2.0 lazy paths: path: "lazy"
