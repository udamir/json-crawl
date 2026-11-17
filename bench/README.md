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
| Date | 2026-11-17T23:46:30.794Z |

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

## Results

### Traversal

**sync traversal, empty visitor**, median / min ms (lower is better)

| fixture | json-crawl 1.0.0 | json-crawl 0.5.3 | traverse [1] | object-traversal [2] | deep-for-each [3] | tree-crawl [4] | json-schema-traverse [5] |
|---|---|---|---|---|---|---|---|
| wide-10k (10,001 nodes) | 1.3 / 1.3 | 5.6 / 5.5 | 5.6 / 5.6 | 1.4 / 1.3 | 1.3 / 1.2 | 5.2 / 5.1 | 2.0 / 1.9 |
| deep-5k (15,003 nodes) | 83.4 / 80.0 | 769.7 / 664.1 | — [6] | 3.4 / 2.8 | — [7] | 1.1 / 1.1 | — [8] |
| array-100k (100,001 nodes) | 13.7 / 12.0 | 69.1 / 64.6 | 56.4 / 49.2 | 18.3 / 18.1 | 5.9 / 5.8 | 20.2 / 20.0 | 0.0 / 0.0 |
| openapi (317,649 nodes) | 28.9 / 28.0 | 210.9 / 204.8 | 166.0 / 161.4 | 44.2 / 42.6 | 55.6 / 55.4 | 16.5 / 16.2 | 31.2 / 30.7 |

[1] traverse: path is an array of string keys; recursive  
[2] object-traversal: path is a dotted string; cycle handling disabled  
[3] deep-for-each: the root is not visited; path is a string like a.b[0]  
[4] tree-crawl: generic tree walker: no keys or paths  
[5] json-schema-traverse: visits sub-schema objects only, never primitives  
[6] traverse on deep-5k: RangeError: Maximum call stack size exceeded  
[7] deep-for-each on deep-5k: RangeError: Maximum call stack size exceeded  
[8] json-schema-traverse on deep-5k: RangeError: Maximum call stack size exceeded

**async traversal (crawl), sync visitor**, median / min ms (lower is better)

| fixture | json-crawl 1.0.0 | json-crawl 0.5.3 |
|---|---|---|
| wide-10k (10,001 nodes) | 1.4 / 1.4 | 7.7 / 7.2 |
| openapi (317,649 nodes) | 31.9 / 30.6 | 230.6 / 227.2 |

### Clone

**deep clone**, median / min ms (lower is better)

| fixture | json-crawl 1.0.0 | json-crawl 1.0.0 tree [1] | json-crawl 0.5.3 | rfdc [2] | klona [3] | klona/json [4] | lodash.clonedeep | clone | structuredClone [5] | JSON.parse(JSON.stringify()) [6] |
|---|---|---|---|---|---|---|---|---|---|---|
| wide-10k (10,001 nodes) | 1.8 / 1.8 | 1.5 / 1.5 | 9.3 / 9.2 | 1.8 / 1.8 | 1.7 / 1.7 | 1.6 / 1.6 | 2.0 / 2.0 | 2.1 / 2.1 | 4.0 / 3.9 | 3.0 / 3.0 |
| deep-5k (15,003 nodes) | 0.8 / 0.8 | 0.5 / 0.5 | 200.9 / 192.6 | — [7] | 0.7 / 0.7 | — [8] | — [9] | — [10] | — [11] | 1.4 / 1.4 |
| array-100k (100,001 nodes) | 0.7 / 0.7 | 0.3 / 0.3 | 86.8 / 85.5 | 5.3 / 5.2 | 0.9 / 0.9 | 0.4 / 0.4 | 3.7 / 3.6 | 8.2 / 7.6 | 3.3 / 3.2 | 5.2 / 5.1 |
| openapi (317,649 nodes) | 72.8 / 63.8 | 40.7 / 36.7 | 394.0 / 379.2 | 45.5 / 40.6 | 41.2 / 40.5 | 39.4 / 33.8 | 111.6 / 107.5 | 2.22 s / 2.12 s † | 195.9 / 160.0 | 78.0 / 73.7 |

[1] json-crawl 1.0.0 tree: circular: false (no cycle or shared-reference tracking)  
[2] rfdc: no cycle handling  
[3] klona: no cycle handling  
[4] klona/json: JSON values only; no cycle handling  
[5] structuredClone: built-in  
[6] JSON.parse(JSON.stringify()): built-in; throws on cycles  
[7] rfdc on deep-5k: RangeError: Maximum call stack size exceeded  
[8] klona/json on deep-5k: RangeError: Maximum call stack size exceeded  
[9] lodash.clonedeep on deep-5k: RangeError: Maximum call stack size exceeded  
[10] clone on deep-5k: RangeError: Maximum call stack size exceeded  
[11] structuredClone on deep-5k: RangeError: Maximum call stack size exceeded

**deep clone that doubles every number**, median / min ms (lower is better)

| fixture | json-crawl 1.0.0 | json-crawl 0.5.3 | traverse map [1] | rfdc + traverse update [2] | JSON.parse reviver [3] |
|---|---|---|---|---|---|
| array-100k (100,001 nodes) | 8.6 / 8.2 | 120.6 / 118.1 | 76.8 / 75.4 | 54.6 / 54.0 | 39.0 / 38.8 |
| openapi (317,649 nodes) | 169.3 / 144.3 | 451.7 / 433.4 † | 641.0 / 626.8 † | 227.4 / 224.3 | 140.7 / 138.4 |

[1] traverse map: traverse(doc).map with this.update  
[2] rfdc + traverse update: two passes: rfdc copy, then an in-place traverse update  
[3] JSON.parse reviver: built-in; serializes the document first

### Equality

**deep equality of two equal documents**, median / min ms (lower is better)

| fixture | json-crawl 1.0.0 | json-crawl 0.5.3 | fast-deep-equal [1] | dequal [2] | fast-equals [3] | lodash.isequal | deep-equal [4] | util.isDeepStrictEqual [5] |
|---|---|---|---|---|---|---|---|---|
| wide-10k (10,001 nodes) | 2.1 / 2.1 | 101.0 / 99.0 | 2.0 / 2.0 | 2.2 / 2.1 | 1.9 / 1.8 | 2.2 / 2.1 | 2.5 / 2.5 | 2.0 / 2.0 |
| deep-5k (15,003 nodes) | 0.9 / 0.9 | 227.4 / 206.6 | 0.9 / 0.9 | 1.1 / 1.1 | — [6] | — [7] | — [8] | — [9] |
| array-100k (100,001 nodes) | 0.5 / 0.5 | 21.44 s / 21.16 s † | 0.7 / 0.6 | 0.7 / 0.7 | 0.5 / 0.5 | 0.7 / 0.7 | 16.2 / 14.9 | 0.8 / 0.7 |
| openapi (317,649 nodes) | 31.5 / 30.8 | 266.8 / 265.4 | 38.0 / 37.6 | 41.6 / 40.9 | 37.8 / 34.3 | 104.9 / 103.2 | 24.78 s / 24.65 s † | 77.5 / 74.8 |

[1] fast-deep-equal: no cycle handling  
[2] dequal: no cycle handling  
[3] fast-equals: deepEqual; no cycle handling  
[4] deep-equal: strict mode  
[5] util.isDeepStrictEqual: built-in  
[6] fast-equals on deep-5k: RangeError: Maximum call stack size exceeded  
[7] lodash.isequal on deep-5k: RangeError: Maximum call stack size exceeded  
[8] deep-equal on deep-5k: TypeError: iterator must be a function  
[9] util.isDeepStrictEqual on deep-5k: RangeError: Maximum call stack size exceeded

### Rules (json-crawl only)

**OpenAPI rule tree with function rules, state copied per node**, median / min ms (lower is better)

| fixture | json-crawl 1.0.0 | json-crawl 0.5.3 |
|---|---|---|
| openapi (317,649 nodes) | 95.0 / 93.5 | 271.4 / 260.4 |

**x- extension rule at every depth**, median / min ms (lower is better)

| fixture | json-crawl 1.0.0 [1] | json-crawl 0.5.3 [2] |
|---|---|---|
| openapi (317,649 nodes) | 53.6 / 52.2 | 237.0 / 228.6 |

[1] json-crawl 1.0.0: "/x-*" prefix rule  
[2] json-crawl 0.5.3: no prefix rules: emulated with a /* function rule
