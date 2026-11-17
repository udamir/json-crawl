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
| Date | 2026-11-17T22:11:03.402Z |

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
| wide-10k (10,001 nodes) | 1.9 / 1.4 | 6.4 / 5.7 | 6.0 / 5.6 | 1.4 / 1.4 | 1.5 / 1.3 | 5.8 / 5.4 | 2.0 / 2.0 |
| deep-5k (15,003 nodes) | 192.2 / 181.3 | 239.9 / 197.9 | — [6] | 1.1 / 1.1 | — [7] | 0.6 / 0.5 | — [8] |
| array-100k (100,001 nodes) | 6.4 / 6.2 | 72.8 / 67.5 | 53.8 / 51.7 | 19.2 / 18.0 | 6.0 / 5.9 | 22.6 / 20.8 | 0.0 / 0.0 |
| openapi (317,649 nodes) | 42.8 / 41.2 | 223.3 / 213.4 | 179.3 / 176.3 | 49.8 / 44.0 | 60.8 / 59.1 | 18.4 / 17.0 | 33.2 / 31.1 |

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
| wide-10k (10,001 nodes) | 1.5 / 1.4 | 7.8 / 7.4 |
| openapi (317,649 nodes) | 40.1 / 38.8 | 242.7 / 239.1 |

### Clone

**deep clone**, median / min ms (lower is better)

| fixture | json-crawl 1.0.0 | json-crawl 1.0.0 tree [1] | json-crawl 0.5.3 | rfdc [2] | klona [3] | klona/json [4] | lodash.clonedeep | clone | structuredClone [5] | JSON.parse(JSON.stringify()) [6] |
|---|---|---|---|---|---|---|---|---|---|---|
| wide-10k (10,001 nodes) | 2.1 / 2.1 | 2.0 / 2.0 | 10.6 / 10.1 | 2.0 / 1.9 | 1.8 / 1.7 | 1.6 / 1.6 | 2.4 / 1.9 | 2.3 / 2.2 | 4.2 / 3.7 | 3.3 / 2.9 |
| deep-5k (15,003 nodes) | 15.5 / 11.0 | 13.1 / 9.5 | 212.7 / 193.6 | — [7] | 0.6 / 0.6 | — [8] | — [9] | — [10] | — [11] | 1.6 / 1.5 |
| array-100k (100,001 nodes) | 11.3 / 10.7 | 9.7 / 9.1 | 94.9 / 87.7 | 5.5 / 5.3 | 1.0 / 0.9 | 0.5 / 0.4 | 4.2 / 4.0 | 8.2 / 7.8 | 3.7 / 3.6 | 7.5 / 5.8 |
| openapi (317,649 nodes) | 136.8 / 131.2 | 94.3 / 88.3 | 811.9 / 371.9 | 49.3 / 44.7 | 49.4 / 42.1 | 40.2 / 34.1 | 120.3 / 114.7 | 2.24 s / 2.18 s † | 138.8 / 137.8 | 59.3 / 58.3 |

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
| array-100k (100,001 nodes) | 13.5 / 13.3 | 106.7 / 104.0 | 80.8 / 79.8 | 58.1 / 57.6 | 41.9 / 41.2 |
| openapi (317,649 nodes) | 190.5 / 151.7 | 443.6 / 418.7 † | 759.8 / 694.2 † | 249.2 / 243.7 | 141.9 / 133.5 |

[1] traverse map: traverse(doc).map with this.update  
[2] rfdc + traverse update: two passes: rfdc copy, then an in-place traverse update  
[3] JSON.parse reviver: built-in; serializes the document first

### Equality

**deep equality of two equal documents**, median / min ms (lower is better)

| fixture | json-crawl 1.0.0 | json-crawl 0.5.3 | fast-deep-equal [1] | dequal [2] | fast-equals [3] | lodash.isequal | deep-equal [4] | util.isDeepStrictEqual [5] |
|---|---|---|---|---|---|---|---|---|
| wide-10k (10,001 nodes) | 2.1 / 1.9 | 164.0 / 152.5 | 2.5 / 2.5 | 4.3 / 3.2 | 2.3 / 2.3 | 2.8 / 2.7 | 3.2 / 3.1 | 2.9 / 2.6 |
| deep-5k (15,003 nodes) | 1.0 / 1.0 | 234.5 / 204.5 | 0.8 / 0.8 | 1.1 / 1.0 | — [6] | — [7] | — [8] | — [9] |
| array-100k (100,001 nodes) | 0.5 / 0.5 | 22.00 s / 21.90 s † | 0.8 / 0.6 | 0.7 / 0.7 | 0.5 / 0.5 | 0.7 / 0.7 | 16.2 / 15.1 | 0.7 / 0.7 |
| openapi (317,649 nodes) | 32.0 / 30.2 | 269.9 / 267.9 | 37.8 / 37.0 | 42.4 / 41.5 | 34.0 / 33.2 | 102.8 / 101.5 | 26.91 s / 26.62 s † | 96.9 / 94.4 |

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
| openapi (317,649 nodes) | 156.1 / 155.1 | 327.8 / 309.3 |

**x- extension rule at every depth**, median / min ms (lower is better)

| fixture | json-crawl 1.0.0 [1] | json-crawl 0.5.3 [2] |
|---|---|---|
| openapi (317,649 nodes) | 173.8 / 168.0 | 239.9 / 239.0 |

[1] json-crawl 1.0.0: "/x-*" prefix rule  
[2] json-crawl 0.5.3: no prefix rules: emulated with a /* function rule
