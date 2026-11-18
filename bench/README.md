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
| Date | 2026-11-18T09:01:37.524Z |

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
| fast-deep-equal | 3.1.3 |
| dequal | 2.0.3 |
| fast-equals | 6.2.2 |
| lodash.isequal | 4.5.0 |
| deep-equal | 2.2.3 |

## Method

Fixtures are generated deterministically by `fixtures/generate.mjs`: `wide-10k` is a flat object of 10 000 primitives, `deep-5k` a chain of 5 000 nested objects (`{ level, name, child }`), `array-100k` a flat array of 100 000 primitives, and `openapi` the Swagger petstore replicated into a 5.5 MB OpenAPI document with `$ref`s and `x-` extensions. Every cell is checked once for correctness (node counts for json-crawl, copies compared with the source, `true` for equal documents and `false` for documents that differ in their last leaf), then warmed up for 20 iterations and timed for 7 runs; tables show the median and the minimum. Cells marked † took more than 0.5 s per iteration and ran with a shortened warm-up. Traversal hooks are empty, so the times are the cost of the walk itself. Libraries whose semantics differ from json-crawl's are footnoted.

Libraries that handle cyclic input and libraries that do not are compared in separate tables: handling cycles means tracking every visited object, which is work the others skip, so a cycle-safe library is only compared with other cycle-safe ones. A library "handles cycles" when, on a small cyclic document, its traversal terminates, its clone reproduces the cycle in the copy, or its equality returns `true` for two equal cyclic documents and `false` for different ones; the harness checks this for every library in a worker with a time and memory limit before timing anything, and stops if a declared group does not match. json-crawl appears in both groups where it has both modes: `syncCrawl` without and with `circular: true`, `syncClone` with its default reference tracking and with `circular: false`. Its `equal` always handles cycles, so it is only in the cycle-safe table.

## Results

### Traversal

**sync traversal, empty visitor, libraries that handle cycles**, median / min ms (lower is better)

| fixture | json-crawl 1.0.0 circular [1] | traverse [2] | object-traversal cycles [3] |
|---|---|---|---|
| wide-10k (10,001 nodes) | 1.5 / 1.5 | 6.0 / 6.0 | 1.6 / 1.6 |
| deep-5k (15,003 nodes) | 87.4 / 82.7 | — [4] | 1.2 / 1.1 |
| array-100k (100,001 nodes) | 4.1 / 4.0 | 49.0 / 47.4 | 18.1 / 17.3 |
| openapi (317,649 nodes) | 37.7 / 35.9 | 166.8 / 162.5 | 47.5 / 45.8 |

[1] json-crawl 1.0.0 circular: circular: true (a node whose value is an ancestor is visited, its children are not)  
[2] traverse: path is an array of string keys; recursive; cycle detection always on  
[3] object-traversal cycles: cycleHandling: true; path is a dotted string  
[4] traverse on deep-5k: RangeError: Maximum call stack size exceeded

**sync traversal, empty visitor, libraries without cycle support (tree input only)**, median / min ms (lower is better)

| fixture | json-crawl 1.0.0 | json-crawl 0.5.3 | object-traversal [1] | deep-for-each [2] | tree-crawl [3] | json-schema-traverse [4] |
|---|---|---|---|---|---|---|
| wide-10k (10,001 nodes) | 2.1 / 1.5 | 6.4 / 6.3 | 1.5 / 1.5 | 1.4 / 1.4 | 6.0 / 6.0 | 2.3 / 2.2 |
| deep-5k (15,003 nodes) | 80.9 / 77.6 | 205.7 / 184.3 | 1.0 / 1.0 | — [5] | 0.5 / 0.4 | — [6] |
| array-100k (100,001 nodes) | 4.0 / 3.8 | 58.1 / 55.2 | 17.9 / 17.7 | 5.8 / 5.7 | 20.4 / 19.2 | 0.0 / 0.0 |
| openapi (317,649 nodes) | 26.4 / 26.1 | 212.8 / 204.5 | 45.8 / 44.5 | 57.5 / 56.7 | 17.6 / 17.2 | 30.4 / 29.8 |

[1] object-traversal: cycleHandling: false; path is a dotted string  
[2] deep-for-each: the root is not visited; path is a string like a.b[0]  
[3] tree-crawl: generic tree walker: no keys or paths  
[4] json-schema-traverse: visits sub-schema objects only, never primitives  
[5] deep-for-each on deep-5k: RangeError: Maximum call stack size exceeded  
[6] json-schema-traverse on deep-5k: RangeError: Maximum call stack size exceeded

**async traversal (crawl), sync visitor**, median / min ms (lower is better)

| fixture | json-crawl 1.0.0 | json-crawl 0.5.3 |
|---|---|---|
| wide-10k (10,001 nodes) | 1.5 / 1.4 | 7.2 / 7.0 |
| openapi (317,649 nodes) | 32.8 / 30.7 | 232.2 / 228.6 |

### Clone

**deep clone, libraries that handle cycles**, median / min ms (lower is better)

| fixture | json-crawl 1.0.0 | json-crawl 0.5.3 | rfdc circles [1] | lodash.clonedeep | clone | structuredClone [2] |
|---|---|---|---|---|---|---|
| wide-10k (10,001 nodes) | 1.7 / 1.7 | 10.1 / 9.7 | 1.9 / 1.8 | 1.9 / 1.9 | 2.0 / 2.0 | 3.7 / 3.6 |
| deep-5k (15,003 nodes) | 0.8 / 0.8 | 196.0 / 193.7 | 2.6 / 2.6 | — [3] | — [4] | — [5] |
| array-100k (100,001 nodes) | 0.8 / 0.7 | 91.9 / 90.4 | 5.3 / 5.1 | 4.1 / 3.8 | 8.7 / 8.5 | 3.2 / 3.0 |
| openapi (317,649 nodes) | 71.7 / 65.9 | 354.8 / 346.9 | 49.1 / 44.4 | 117.1 / 109.5 | 2.10 s / 2.06 s † | 134.1 / 129.2 |

[1] rfdc circles: rfdc({ circles: true })  
[2] structuredClone: built-in  
[3] lodash.clonedeep on deep-5k: RangeError: Maximum call stack size exceeded  
[4] clone on deep-5k: RangeError: Maximum call stack size exceeded  
[5] structuredClone on deep-5k: RangeError: Maximum call stack size exceeded

**deep clone, libraries without cycle support (tree input only)**, median / min ms (lower is better)

| fixture | json-crawl 1.0.0 tree [1] | rfdc [2] | klona | klona/json [3] | JSON.parse(JSON.stringify()) [4] |
|---|---|---|---|---|---|
| wide-10k (10,001 nodes) | 1.5 / 1.5 | 1.7 / 1.6 | 1.7 / 1.7 | 1.6 / 1.6 | 2.9 / 2.9 |
| deep-5k (15,003 nodes) | 0.5 / 0.5 | — [5] | 0.7 / 0.7 | — [6] | 1.6 / 1.5 |
| array-100k (100,001 nodes) | 0.3 / 0.3 | 5.2 / 5.2 | 0.9 / 0.9 | 0.4 / 0.4 | 4.7 / 4.5 |
| openapi (317,649 nodes) | 40.2 / 40.0 | 43.5 / 41.9 | 41.7 / 40.2 | 38.6 / 34.5 | 57.1 / 54.0 |

[1] json-crawl 1.0.0 tree: circular: false (tree input: no cycle or shared-reference tracking)  
[2] rfdc: default options  
[3] klona/json: JSON values only  
[4] JSON.parse(JSON.stringify()): built-in; throws on cycles  
[5] rfdc on deep-5k: RangeError: Maximum call stack size exceeded  
[6] klona/json on deep-5k: RangeError: Maximum call stack size exceeded

**deep clone that doubles every number, libraries that handle cycles**, median / min ms (lower is better)

| fixture | json-crawl 1.0.0 | json-crawl 0.5.3 | rfdc circles + traverse update [1] |
|---|---|---|---|
| array-100k (100,001 nodes) | 5.8 / 5.5 | 104.4 / 102.0 | 54.2 / 52.7 |
| openapi (317,649 nodes) | 109.7 / 108.2 | 387.7 / 381.9 | 238.2 / 225.9 |

[1] rfdc circles + traverse update: two passes: rfdc({ circles: true }) copy, then an in-place traverse update

**deep clone that doubles every number, libraries without cycle support (tree input only)**, median / min ms (lower is better)

| fixture | json-crawl 1.0.0 tree [1] | rfdc + traverse update [2] | traverse map [3] | JSON.parse reviver [4] |
|---|---|---|---|---|
| array-100k (100,001 nodes) | 5.8 / 5.3 | 54.7 / 52.8 | 74.7 / 72.8 | 39.2 / 39.0 |
| openapi (317,649 nodes) | 76.5 / 72.7 | 224.5 / 221.6 | 621.4 / 613.7 † | 134.7 / 131.1 |

[1] json-crawl 1.0.0 tree: circular: false  
[2] rfdc + traverse update: two passes: rfdc copy, then an in-place traverse update  
[3] traverse map: traverse(doc).map with this.update; terminates on cycles but does not reproduce them in the copy  
[4] JSON.parse reviver: built-in; serializes the document first

### Equality

**deep equality of two equal documents, libraries that handle cycles**, median / min ms (lower is better)

| fixture | json-crawl 1.0.0 | fast-equals circular [1] | lodash.isequal | deep-equal [2] | util.isDeepStrictEqual [3] |
|---|---|---|---|---|---|
| wide-10k (10,001 nodes) | 1.9 / 1.8 | 1.9 / 1.8 | 2.2 / 2.2 | 2.8 / 2.7 | 2.2 / 2.0 |
| deep-5k (15,003 nodes) | 0.9 / 0.9 | — [4] | — [5] | — [6] | — [7] |
| array-100k (100,001 nodes) | 0.4 / 0.4 | 0.6 / 0.6 | 0.7 / 0.7 | 14.9 / 14.8 | 0.8 / 0.7 |
| openapi (317,649 nodes) | 30.9 / 30.3 | 75.7 / 75.3 | 103.2 / 101.2 | 25.13 s / 24.91 s † | 74.9 / 73.6 |

[1] fast-equals circular: circularDeepEqual  
[2] deep-equal: strict mode  
[3] util.isDeepStrictEqual: built-in  
[4] fast-equals circular on deep-5k: RangeError: Maximum call stack size exceeded  
[5] lodash.isequal on deep-5k: RangeError: Maximum call stack size exceeded  
[6] deep-equal on deep-5k: TypeError: iterator must be a function  
[7] util.isDeepStrictEqual on deep-5k: RangeError: Maximum call stack size exceeded

**deep equality of two equal documents, libraries without cycle support (tree input only)**, median / min ms (lower is better)

| fixture | json-crawl 0.5.3 | fast-deep-equal | dequal | fast-equals [1] |
|---|---|---|---|---|
| wide-10k (10,001 nodes) | 105.4 / 100.1 | 2.1 / 2.0 | 2.2 / 2.2 | 1.9 / 1.8 |
| deep-5k (15,003 nodes) | 199.1 / 193.1 | 0.8 / 0.8 | 1.0 / 1.0 | — [2] |
| array-100k (100,001 nodes) | 21.21 s / 20.83 s † | 0.7 / 0.6 | 0.7 / 0.7 | 0.6 / 0.6 |
| openapi (317,649 nodes) | 270.6 / 268.6 | 36.4 / 35.7 | 41.1 / 40.9 | 33.5 / 32.8 |

[1] fast-equals: deepEqual  
[2] fast-equals on deep-5k: RangeError: Maximum call stack size exceeded

### Rules (json-crawl only)

**OpenAPI rule tree with function rules, state copied per node**, median / min ms (lower is better)

| fixture | json-crawl 1.0.0 | json-crawl 0.5.3 |
|---|---|---|
| openapi (317,649 nodes) | 96.8 / 93.9 | 273.3 / 267.1 |

**x- extension rule at every depth**, median / min ms (lower is better)

| fixture | json-crawl 1.0.0 [1] | json-crawl 0.5.3 [2] |
|---|---|---|
| openapi (317,649 nodes) | 53.2 / 52.1 | 233.1 / 226.6 |

[1] json-crawl 1.0.0: "/x-*" prefix rule  
[2] json-crawl 0.5.3: no prefix rules: emulated with a /* function rule
