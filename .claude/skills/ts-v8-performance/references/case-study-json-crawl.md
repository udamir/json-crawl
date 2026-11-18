# Case study: optimizing json-crawl 1.0.0

The measured record behind the lists in `SKILL.md`. json-crawl is a TypeScript library that walks JSON documents with user hooks (`syncCrawl`, async `crawl`), deep-clones them (`syncClone`, `clone`), transforms them in place (`transform`), compares them (`equal`) and attaches rules to paths (`/key`, `/prefix*`, `/*`, `/**`). Environment: Node 26.13 (V8 14.6), macOS, Intel i9; builds made with tsdown (Vite+) and TypeScript 7. Main fixture: a 5.5 MB OpenAPI document with 317 649 nodes (48% containers, average depth 5.6); also a 5 000-level chain (`deep-5k`), a 100 000-element flat array and a 10 000-key flat object. Timings are minimum ms over interleaved fresh processes; the A/A noise floor was ±3%.

## Contents

1. Phase 1: algorithmic and structural fixes
2. Phase 2: diagnosis with V8 tools
3. Phase 3: the changes, prototype vs ported
4. Rejected ideas
5. Final standing against other libraries
6. Lessons

## 1. Phase 1: algorithmic and structural fixes

Before any V8-level work, the old release (0.5.3) had problems that dwarfed everything later:

| problem | fix | effect |
|---|---|---|
| `equal` matched object keys with nested loops (quadratic) and recursed | iterative comparison with an explicit stack, keys looked up with `hasOwnProperty` | 100 000-element array: 20.5 s → 0.3 ms; openapi 268 → 33 ms |
| every node copied its parent's full path array (O(depth²)) | eager copy up to depth 128, parent-linked lazy paths beyond | 10 000-level chain: 4.3 s / 2.65 GB → 0.06 s / 80 MB; 100 000 levels now possible |
| the async crawl awaited every hook result | await only thenables | async crawl 5-7× faster with sync hooks |
| node contexts and rule contexts rebuilt per hook | rebuild only when a hook response changes value/state/rules, rules context created on first use | traversal 3-5× faster than 0.5.3 overall |
| cycle tracking in `equal` on every container pair | record visited pairs only below depth 32 (a cycle always produces unbounded depth) | openapi 55.8 → 33.4 ms, cycles still detected |
| optional cycle guard for crawl wanted | `Set` of the open containers, created only when the option is on | zero cost when off |

## 2. Phase 2: diagnosis with V8 tools

Findings of the analysis (tools: `--print-bytecode`, `--trace-opt/--trace-deopt`, `--trace-turbo-inlining`, `--log-ic`, natives syntax, `total_allocated_bytes`, GC observer, `--cpu-prof`):

- Tiering was healthy: every hot function reached TurboFan within one or two calls, mostly via OSR; deopts only during warm-up.
- A resolver with an inner closure allocated a 72 B function context per node at entry, before its `if (!rules) return`; 20% of a plain crawl.
- Allocation per node: crawl 328 B (3% GC), clone 580 B (21% GC), transform 498 B, rule-tree crawl 615 B, prefix-rule crawl 580 B (15% GC), deep-5k crawl 905 B (24% GC).
- Contexts of nodes deeper than 128 levels were object literals with own `get`/`set` closures: dictionary mode, every property access on them polymorphic between fast and dictionary maps.
- Clone ran two internal hooks plus the user's through one call site: megamorphic, nothing inlined; clone hook 26% self time, GC 19%.
- With a `/**` rule every node got a fresh merged rules object (317 649 objects, 11 maps): `rules["/**"]`, `rules["/*"]` megamorphic; exact lookups built `"/" + key` per node (non-internalized key); prefix compilation and one `WeakMap` entry per container took 24% self time plus 15% GC.
- The transform hook allocated a function and block context per call because an exit-hook closure captured its variables.
- The async crawl was 15-20% slower than the sync one with synchronous hooks.
- The build (ES2020 target) added nothing measurable; raising it to ES2022 later was required for native private fields.

## 3. Phase 3: the changes, prototype vs ported

Each change was prototyped as a patch on a copy of the built JS, then ported into the TypeScript source, tested (269 tests) and measured again against the previous step.

| change | mechanism | prototype | ported (openapi unless noted) |
|---|---|---|---|
| A: skip rule resolution when the parent has no rules | no closure context, no call | crawl -20…-26% | crawl -20% |
| D: dedicated iterative copier when clone has no hooks and no rules | no contexts, paths, frames, hook calls; one monomorphic loop | clone -43%, tree mode -48% | clone -42%, tree mode -50%, deep-5k -90%, array -93% |
| M2: deep contexts as a class with one shared accessor descriptor and private fields (target raised to ES2022) | one hidden class, fast properties, no closures per object | deep crawl -44%, path reads -54% | deep crawl -49%, path reads -54% |
| B+G+X+F: resolver without closure, cached `"/"+key` strings, skip exact lookups for sets without exact keys, memoized `/**` merges of static objects | internalized keys, fewer lookups, shared objects instead of 317 k fresh ones | rule tree -21%, prefix -73% | rule tree -32%, prefix -68% |
| U: transform's exit-hook closure built in a module-level factory | no context per hook call | transform -4% | transform -2% (noise) |
| C3+T: clone/transform write step called from its own call site in the engine | monomorphic site, inlined (verified with `--trace-turbo-inlining`) | clone with hook -10…-15%, transform -14% | clone with hook -3%, transform -6% |

Overall, baseline → final: crawl -27%, clone -39%, clone tree mode -49%, clone with a hook -11%, transform -10%, rule-tree crawl -29%, prefix-rule crawl -66%, deep-5k crawl -53%, deep-5k clone -92%, array clone -94%, equal unchanged.

Contract consequences that were documented: rule objects handed to hooks may be shared between nodes under `/**`; rule sets must not be mutated after first use (several caches assume it); non-enumerable exact rule keys are no longer found; the build target became ES2022.

### Second round (after a peer analysis)

A deep analysis of the libraries that were faster in some cells (tree-crawl, klona/json, rfdc with circles, object-traversal, the JSON reviver) produced three contract-preserving proposals; each was ported and measured per case in fresh processes against the previous build:

| change | prototype | ported | kept |
|---|---|---|---|
| frames as class instances instead of object literals | crawl -9%, -46% after a deep document | crawl +16..+20%, circular +8..+12%, prefix rules +13%, no gain after a deep document (A/A ±2%) | no |
| `new Array(length)` for clone array copies | tree clone -8..-11% | tree clone -11..-13%, others within noise | yes |
| write step returns the children's state instead of `{ state }` | -45 B/node, -1..-5% | -46 B/node, transform -3..-5%, clone with a hook -2..-5% | yes |

The analysis also found that the benchmark itself was biased by order: tree-crawl measured 14-17 ms only after another library had walked the document's keys (V8's enum cache), 24 ms in a fresh process; and OpenAPI crawls measured after the deep fixture were 20-36% slower. The harness now runs every cell in its own process. Why peers were faster: tree-crawl gives the visitor neither keys nor paths (path copy 37%, hook call 17%, context 8% of json-crawl's time); klona/json preallocates arrays (adopted); rfdc with circles tracks only ancestors, copies shared references twice and overflows on self-containing arrays (json-crawl's `WeakMap` costs ≈175 ns per container); object-traversal's string paths are ropes (see the string-path entry in SKILL.md).

## 4. Rejected ideas

| idea | result |
|---|---|
| packed path arrays (`slice()` + `push`) | crawl +43%, clone +17% |
| packed path arrays (push loop into `[]`) | crawl +20% |
| `Object.values` snapshot per object instead of `data[key]` | crawl +14%, and reads values too early |
| resolver without closure alone (without the caches) | -2% (kept only as the base of the cache changes) |
| memoized merges without the key-string cache and exact-key flag | prefix -49% but rule tree +4% |
| copier using `{ ...src }` / `slice()` then patching containers | openapi -27% (D gave -43%), 10 000-key object +105% (dictionary-mode spread) |
| `Map` instead of `WeakMap` for clone identity | no difference |
| `equal` counting keys with `for…in` instead of `Object.keys(y)` | fewer bytes, +17% time |
| `equal` iterating with `for…in` | +27% |
| bigger key-string cache (16 384 entries) | +1% / 0% |
| array elements read before the hole check | 0% / +4% |
| returning the next context instead of storing it, for escape analysis | allocation unchanged, +4% |
| mutating contexts in place | rejected on semantics |
| path accessor on the prototype instead of own | deep crawl -88% but breaks own-enumerable `path` (spread, `Object.keys`) |
| caching compiled rule sets for every object, including per-node ones | +16% on crawls whose rule sets are built per node (WeakMap ≈150 ns per short-lived entry) |
| frames as class instances (second round) | +8..+20% on traversals; the constructor was inlined, a literal from a boilerplate is still cheaper |
| a pool of reused frame objects | +10% (pooled frames live long enough to be promoted, so every store pays the write barrier) |
| no path node for shallow containers | -4% on openapi, +39% on deep-5k |
| building the context only when a later hook needs it | 64 B/node less, 0% time |
| string paths built as ropes | almost free while unused; when used, slower than arrays on ordinary documents (37.9 vs 17.4 ms) |

## 5. Final standing against other libraries

Minimum ms on the OpenAPI document after all changes (other libraries in the same run):

| task | json-crawl 1.0.0 | json-crawl 0.5.3 | others |
|---|---|---|---|
| walk every node | 28 | 205 | object-traversal 43, deep-for-each 55, traverse 161 |
| async walk | 31 | 227 | none offer it |
| deep clone | 64 (37 tree mode) | 379 | klona 41, rfdc 41, lodash.clonedeep 108, structuredClone 160 |
| clone + transform values | 144 | 433 | JSON.parse reviver 138, rfdc + traverse 224 |
| deep equality | 31 | 265 | fast-equals 34, fast-deep-equal 38, util.isDeepStrictEqual 75 |
| rule-tree crawl | 94 | 260 | (unique feature) |

On the 5 000-level chain, traverse, deep-for-each, rfdc, lodash.clonedeep, structuredClone, fast-equals, lodash.isequal and util.isDeepStrictEqual overflowed the stack. A visitor reading `path` on every node of that chain took about 75 ms in json-crawl (arrays) versus about 1 ms in object-traversal (string paths built as ropes): a representation difference, made visible by splitting "walk" from "walk + path".

## 6. Lessons

- Algorithms first: the two quadratic behaviours cost more than all V8-level issues together.
- The analysis paid off because it produced numbers per cause (bytes per node by object, ablations) before any change.
- The largest V8-level wins were about not doing work (skip a call, a dedicated fast path), then allocation, then shapes; micro-tweaks were mostly negative.
- Prototype numbers are an upper estimate; re-measure after porting.
- Measure in fresh processes and know the noise floor; several "regressions" seen in one-process comparisons were noise.
- Every speedup that shares objects or caches needs a documented contract.
