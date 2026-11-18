# json-crawl benchmark

json-crawl 1.0.0 compared with the previous release (json-crawl 0.5.3) and with popular npm libraries that cover one of its features: traversal, deep clone, deep equality and transformation. Everything below is produced by the scripts in this directory.

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
| Date | 2026-11-18T14:02:55.677Z |

| library | version |
|---|---|
| json-crawl 1.0.0 | this repository, `dist/index.cjs` built by `vp pack` |
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

Libraries that handle cyclic input and libraries that do not are compared in separate tables: handling cycles means tracking every visited object, which is work the others skip, so a cycle-safe library is only compared with other cycle-safe ones. A library "handles cycles" when, on a small cyclic document, its traversal terminates, its clone reproduces the cycle in the copy, or its equality returns `true` for two equal cyclic documents and `false` for different ones; the harness checks this for every library in a worker with a time and memory limit before timing anything, and stops if a declared group does not match. json-crawl appears in both groups where it has both modes: `syncCrawl` without and with `circular: true`, `syncClone` with its default reference tracking and with `circular: false`. Its `equal` always handles cycles, so equality has only the cycle-safe table; groups without a json-crawl 1.0.0 column are not reported.

## Results

### Traversal

**sync traversal, the visitor reads value and key, libraries that handle cycles**, median / min ms (lower is better)

| fixture | json-crawl 1.0.0 circular [1] | traverse [2] | object-traversal cycles [3] |
|---|---|---|---|
| wide-10k (10,001 nodes) | 1.7 / 1.5 | 5.5 / 5.3 | 1.7 / 1.3 |
| deep-5k (15,003 nodes) | 3.9 / 3.8 | — [4] | 1.3 / 1.0 |
| array-100k (100,001 nodes) | 3.6 / 3.2 | 49.0 / 47.6 | 9.1 / 8.8 |
| openapi (317,649 nodes) | 35.5 / 34.8 | 174.8 / 171.0 | 46.8 / 45.9 |

[1] json-crawl 1.0.0 circular: circular: true (a node whose value is an ancestor is visited, its children are not)  
[2] traverse: recursive; cycle detection always on  
[3] object-traversal cycles: cycleHandling: true  
[4] traverse on deep-5k: RangeError: Maximum call stack size exceeded

**sync traversal, the visitor reads value and key, libraries without cycle support (tree input only)**, median / min ms (lower is better)

| fixture | json-crawl 1.0.0 | json-crawl 0.5.3 | object-traversal [1] | deep-for-each [2] | tree-crawl [3] | json-schema-traverse [4] |
|---|---|---|---|---|---|---|
| wide-10k (10,001 nodes) | 1.3 / 1.2 | 5.6 / 5.4 | 1.6 / 1.3 | 1.4 / 1.3 | 5.5 / 5.3 | 1.9 / 1.9 |
| deep-5k (15,003 nodes) | 3.4 / 3.3 | 192.8 / 187.1 | 1.1 / 1.0 | 1.7 / 1.7 | 0.8 / 0.8 | — [5] |
| array-100k (100,001 nodes) | 3.4 / 3.0 | 52.7 / 51.1 | 10.7 / 8.7 | 6.3 / 6.0 | 20.5 / 19.5 | 0.0 / 0.0 |
| openapi (317,649 nodes) | 25.1 / 22.9 | 177.1 / 175.9 | 49.0 / 45.8 | 58.5 / 55.8 | 27.5 / 26.6 | 32.5 / 29.9 |

[1] object-traversal: cycleHandling: false  
[2] deep-for-each: the root is not visited  
[3] tree-crawl: generic tree walker: no keys or paths  
[4] json-schema-traverse: visits sub-schema objects only, never primitives  
[5] json-schema-traverse on deep-5k: RangeError: Maximum call stack size exceeded

**async traversal (crawl), sync visitor**, median / min ms (lower is better)

| fixture | json-crawl 1.0.0 | json-crawl 0.5.3 |
|---|---|---|
| wide-10k (10,001 nodes) | 1.5 / 1.2 | 7.9 / 7.5 |
| openapi (317,649 nodes) | 33.7 / 32.7 | 239.5 / 236.0 |

### Clone

**deep clone, libraries that handle cycles**, median / min ms (lower is better)

| fixture | json-crawl 1.0.0 | json-crawl 0.5.3 | rfdc circles [1] | lodash.clonedeep | clone | structuredClone [2] |
|---|---|---|---|---|---|---|
| wide-10k (10,001 nodes) | 1.7 / 1.4 | 9.6 / 9.4 | 1.8 / 1.6 | 1.9 / 1.8 | 1.9 / 1.9 | 3.7 / 3.5 |
| deep-5k (15,003 nodes) | 0.8 / 0.8 | 197.1 / 194.0 | 2.0 / 2.0 | — [3] | — [4] | — [5] |
| array-100k (100,001 nodes) | 0.3 / 0.3 | 85.5 / 83.9 | 6.2 / 5.2 | 2.9 / 2.4 | 7.3 / 6.8 | 3.7 / 3.2 |
| openapi (317,649 nodes) | 70.0 / 68.4 | 353.5 / 346.6 | 48.7 / 43.5 | 108.1 / 105.3 | 2.23 s / 2.12 s † | 131.7 / 124.0 |

[1] rfdc circles: rfdc({ circles: true })  
[2] structuredClone: built-in  
[3] lodash.clonedeep on deep-5k: RangeError: Maximum call stack size exceeded  
[4] clone on deep-5k: RangeError: Maximum call stack size exceeded  
[5] structuredClone on deep-5k: RangeError: Maximum call stack size exceeded

**deep clone, libraries without cycle support (tree input only)**, median / min ms (lower is better)

| fixture | json-crawl 1.0.0 tree [1] | rfdc [2] | klona | klona/json [3] | JSON.parse(JSON.stringify()) [4] |
|---|---|---|---|---|---|
| wide-10k (10,001 nodes) | 1.5 / 1.4 | 1.7 / 1.6 | 1.6 / 1.6 | 1.5 / 1.5 | 3.1 / 2.9 |
| deep-5k (15,003 nodes) | 0.6 / 0.5 | 0.3 / 0.3 | 0.5 / 0.5 | 0.4 / 0.4 | 1.4 / 1.4 |
| array-100k (100,001 nodes) | 0.3 / 0.3 | 6.2 / 5.7 | 1.2 / 0.8 | 0.3 / 0.3 | 4.4 / 3.9 |
| openapi (317,649 nodes) | 38.2 / 36.8 | 46.3 / 41.5 | 41.3 / 35.9 | 39.2 / 34.1 | 57.5 / 54.0 |

[1] json-crawl 1.0.0 tree: circular: false (tree input: no cycle or shared-reference tracking)  
[2] rfdc: default options  
[3] klona/json: JSON values only  
[4] JSON.parse(JSON.stringify()): built-in; throws on cycles

**deep clone that doubles every number, libraries that handle cycles**, median / min ms (lower is better)

| fixture | json-crawl 1.0.0 | json-crawl 0.5.3 | rfdc circles + traverse update [1] |
|---|---|---|---|
| array-100k (100,001 nodes) | 4.8 / 4.7 | 97.8 / 95.2 | 54.8 / 53.3 |
| openapi (317,649 nodes) | 106.4 / 102.3 | 382.2 / 380.1 | 240.5 / 233.1 |

[1] rfdc circles + traverse update: two passes: rfdc({ circles: true }) copy, then an in-place traverse update

**deep clone that doubles every number, libraries without cycle support (tree input only)**, median / min ms (lower is better)

| fixture | json-crawl 1.0.0 tree [1] | rfdc + traverse update [2] | traverse map [3] | JSON.parse reviver [4] |
|---|---|---|---|---|
| array-100k (100,001 nodes) | 4.7 / 4.7 | 57.1 / 55.5 | 76.7 / 75.6 | 41.2 / 38.8 |
| openapi (317,649 nodes) | 67.0 / 64.0 | 225.9 / 222.4 | 632.7 / 615.3 † | 132.4 / 129.0 |

[1] json-crawl 1.0.0 tree: circular: false  
[2] rfdc + traverse update: two passes: rfdc copy, then an in-place traverse update  
[3] traverse map: traverse(doc).map with this.update; terminates on cycles but does not reproduce them in the copy  
[4] JSON.parse reviver: built-in; serializes the document first

### Equality

**deep equality of two equal documents**, median / min ms (lower is better)

| fixture | json-crawl 1.0.0 | fast-equals circular [1] | lodash.isequal | deep-equal [2] | util.isDeepStrictEqual [3] |
|---|---|---|---|---|---|
| wide-10k (10,001 nodes) | 2.0 / 2.0 | 2.0 / 2.0 | 2.3 / 2.3 | 2.7 / 2.7 | 2.2 / 2.2 |
| deep-5k (15,003 nodes) | 1.0 / 1.0 | — [4] | — [5] | — [6] | — [7] |
| array-100k (100,001 nodes) | 0.3 / 0.3 | 0.4 / 0.4 | 0.7 / 0.7 | 15.6 / 14.8 | 0.7 / 0.7 |
| openapi (317,649 nodes) | 49.0 / 47.7 | 76.3 / 74.6 | 105.3 / 104.5 | 25.57 s / 25.45 s † | 59.6 / 59.0 |

[1] fast-equals circular: circularDeepEqual  
[2] deep-equal: strict mode  
[3] util.isDeepStrictEqual: built-in  
[4] fast-equals circular on deep-5k: RangeError: Maximum call stack size exceeded  
[5] lodash.isequal on deep-5k: RangeError: Maximum call stack size exceeded  
[6] deep-equal on deep-5k: TypeError: iterator must be a function  
[7] util.isDeepStrictEqual on deep-5k: RangeError: Maximum call stack size exceeded

### Rules (json-crawl only)

**OpenAPI rule tree with function rules, state copied per node**, median / min ms (lower is better)

| fixture | json-crawl 1.0.0 | json-crawl 0.5.3 |
|---|---|---|
| openapi (317,649 nodes) | 84.1 / 82.8 | 247.0 / 246.2 |

**x- extension rule at every depth**, median / min ms (lower is better)

| fixture | json-crawl 1.0.0 [1] | json-crawl 0.5.3 [2] |
|---|---|---|
| openapi (317,649 nodes) | 38.0 / 37.5 | 210.0 / 202.5 |

[1] json-crawl 1.0.0: "/x-*" prefix rule  
[2] json-crawl 0.5.3: no prefix rules: emulated with a /* function rule
