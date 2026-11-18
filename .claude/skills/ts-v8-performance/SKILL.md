---
name: ts-v8-performance
description: Measure and improve the runtime performance of TypeScript/JavaScript code on V8 (Node.js, Deno, Chromium) using evidence instead of folklore - a fresh-process A/B benchmark harness, allocation-per-call and GC share, inline-cache and deopt summaries, CPU self time, plus a catalogue of what measurably helps and what measurably hurts, learned from optimizing a JSON traversal library. Use this skill whenever the user wants TS/JS code to run faster, asks why a function, loop, library or hot path is slow, wants to profile, reduce allocations or GC pressure, investigate deoptimizations, megamorphic property access, hidden classes or dictionary-mode objects, compare their library against competitors in a benchmark, check whether a refactor regressed speed, or review code for performance, even if they never mention V8. Not for page-load, bundle-size, network or React re-render performance.
---

# TypeScript / JavaScript performance on V8

This skill is a way of working plus a set of measured facts. The way of working matters more than the facts: on V8 most intuitions about "fast code" are wrong in some context, and the only reliable guide is a measurement that can tell a 5% change from noise. Every claim below comes with the mechanism that explains it and a number from a real optimization (a JSON crawl/clone/transform/equal library, Node 26, V8 14.6; see `references/case-study-json-crawl.md`). Treat the numbers as orders of magnitude for your own measurements, not as promises.

## The workflow at a glance

1. **Test**: make sure behaviour is pinned down by tests before touching anything.
2. **Measure**: build a benchmark that can tell a real change from noise, and record a baseline.
3. **Find**: locate where the time goes with the four views (CPU, allocation, inline caches, tiers) before changing code.
4. **Hypothesize**: tie each candidate to a V8 mechanism and an expected gain; rank by gain, effort and risk.
5. **Change**: prototype cheaply, port winners, one change per step, measured against the previous step and the baseline, tested, committed.
6. **Report**: numbers for wins and losses, the noise floor, and any contract change.

The next three sections give the steps for 1-3; the lists after them give the measured facts for 4-5.

## How to test

Performance work changes code paths in subtle ways (a fast path for a special case, a cache, shared objects), and each one is a place where behaviour can drift. Tests protect against the most common false win: code that is faster because it skips work it should do. Full detail: `references/measuring-and-testing.md` section 5.

1. Before the first change, check that the suite would catch a behaviour change in the code you will touch (outputs, ordering, identity of shared objects, error behaviour, async ordering). Add tests where it would not.
2. Run the full suite after every step, not only at the end.
3. For every new fast path, keep the general path and add an equivalence test that runs both on tricky inputs (holes, own `__proto__` keys, shared references, cycles, empty and primitive roots) and compares structure and identity, not only deep equality.
4. For every cache, test more distinct keys than its bound, and two different inputs that must give different results.
5. Test the contract the change could break: property order and enumerability of objects handed out, own vs prototype properties, shared vs fresh objects, sync vs async errors, callback order.
6. Before timing a prototype, run the tests against it and compare its outputs with the baseline's on the benchmark inputs.

## How to measure

Use realistic inputs in several shapes (wide, deep, large arrays, one realistic document) and the scripts in this skill's `scripts/` directory (run them by their full path; they need only Node, no dependencies). Full detail: `references/measuring-and-testing.md`; commands: `references/tooling.md`.

1. Write a bench file from `scripts/example-bench.mjs`. It receives the module under test as an argument, so one bench file runs against every build. Build inputs once, outside the timed functions; prefer cases that run 5 ms or more.
2. Build the current code and keep a copy as the baseline (`cp -r dist /tmp/base-dist`). Measure the shipped JavaScript, not the TypeScript, because the transpiler can change what V8 sees.
3. Run an A/A comparison (`node scripts/compare.mjs --bench bench.mjs dist/index.mjs dist/index.mjs`). Its spread, typically ±3-5% on a laptop, is the noise floor; do not act on smaller differences.
4. Compare builds only with `scripts/compare.mjs`: it runs each variant in a fresh process, interleaves them, reverses the order every round, drops warm-up and reports min and median. Never load two builds into one process: they share inline caches and JIT feedback and distort each other (this produced fake +20% regressions in the case study).
5. Measure allocation per item with `scripts/alloc.mjs --units <items>`; bytes per item is a stable signal even when timing is noisy, and the GC share tells you how much allocation costs.
6. After each change: rebuild, test, compare against the previous step and against the baseline, check allocation, then commit with the numbers.

## How to find optimizations

Work through these steps for each slow case and write down what each shows; the notes become the list of hypotheses. Full method, the symptom → cause → fix table and a code review checklist: `references/finding-optimizations.md`.

1. **Scale test.** Time inputs of size n, 2n, 4n (and a deep variant for nested data). Faster-than-linear growth is an algorithmic problem; fix that before anything else.
2. **Per-item budget.** List every operation done per item (calls, objects, arrays, closures, lookups, string builds). Most wins are entries that do not need to happen for every item.
3. **Allocation.** Compare `alloc.mjs` bytes per item with the budget. A gap is hidden allocation (closure contexts, temporary arrays, runtime-built strings). A GC share above ~10% makes allocation the primary target.
4. **CPU self time** (`--cpu-prof` + `scripts/cpu-self.mjs`): rank functions and note the GC share; inlined callees are charged to their caller.
5. **Shapes and inline caches** (`--log-ic` + `scripts/ic-summary.mjs`, `%HasFastProperties`): named accesses on your own objects that went megamorphic, objects in dictionary mode.
6. **Call sites and inlining** (`--trace-turbo-inlining`): are hot callbacks and helpers inlined into the loop?
7. **Tiers and deopts** (`--trace-opt --trace-deopt` + `scripts/opt-summary.mjs`): usually healthy; rule it out quickly. Early deopts are warm-up; repeated ones are real.
8. **Bytecode** of the top functions (`--print-bytecode --print-bytecode-filter=<name>`): `CreateFunctionContext` at entry, `CreateClosure`, literals, runtime-built keys.
9. **Emitted JS**: transpiler helpers and lowered features (see "TypeScript and the build").
10. **Ablation.** To price one piece of work, measure a deliberately broken variant that skips it (for example children sharing the parent's path instead of copying it). The difference is the most that optimizing that piece can gain. Never ship ablations.
11. **Hypothesize and rank.** Tie each candidate to a mechanism (`references/v8-mechanisms.md`) and an expected gain; rank by gain divided by effort and risk. Prototype the top few on a copy of the build, measure them separately, port only those beyond the noise floor, and measure again after porting: prototype gains do not always survive (one change measured -10 to -15% as a prototype and -3% after porting). Re-rank after each kept change, because removing one cost changes what dominates next.

## Priorities: where the big wins are

Work top-down. Each level typically dwarfs the next.

1. **Algorithmic complexity.** Quadratic behaviour hides until inputs grow, then dominates everything: an equality check that matched keys with nested loops took 20.5 s on a 100 000-element array and 0.3 ms after a linear rewrite; copying the full parent path at every node made a deep traversal O(depth²) and ran out of memory at 20 000 levels.
2. **Not doing the work at all.** Skip calls whose result is known (no rules → no rule resolution: -20% on a plain crawl), add a dedicated fast path for the common configuration (clone without hooks bypasses the whole hook machinery: -40%, -93% on deep or array-heavy inputs), compute per-container data once instead of per child, and build expensive data lazily (paths materialized only when read).
3. **Allocation per item.** Every object, array, closure and closure context allocated per item costs creation plus GC. In the case study, GC was 20-30% of clone time; cutting bytes per node is the most reliable lever after algorithms.
4. **Call structure and shapes.** Keep hot call sites monomorphic so TurboFan inlines them, keep objects in fast mode with stable hidden classes, avoid megamorphic property access on the hot path.
5. **Micro-tweaks** (loop forms, ordering checks, `for...in` vs `Object.keys`). Rarely worth more than the noise floor, often negative. Only after measuring.

## What helps (measured)

Each item: what to do, why V8 rewards it, what it bought.

- **Guard before calling, not inside the callee, when the callee has closures.** A function that defines an inner closure capturing its parameters allocates its function context at entry, before any early `return`. The guard inside did not help; moving `if (!rules)` to the caller removed 72 B/node and made the crawl 20-26% faster.
- **Don't create closures in hot functions.** Replace an inner helper closure with inline code or a module-level function taking explicit arguments. Build callbacks that must capture state in a separate module-level factory, so the hot function itself captures nothing (a transform hook that created an exit-hook closure allocated a context on every call, also for leaves).
- **Dedicated fast paths for the common case.** If most callers use the simplest configuration (no hooks, no options), give it its own tight loop with an explicit stack instead of the general machinery. Keep its semantics identical and prove it with an equivalence test against the general path (same structure, holes, own `__proto__` keys, shared references, cycles). This was the single largest win: clone -40% (-50% in tree mode, matching the fastest single-purpose cloners).
- **Keep objects in fast mode; share accessors.** An object literal with its own `get x()`/`set x()` creates fresh closures and an accessor pair per object, so V8 cannot share a hidden class and falls back to dictionary mode; every access to every property of such objects, including by the library's own code, becomes slow. Use a class whose accessor descriptor is defined once (a static object passed to `Object.defineProperty`) and reads private fields: all instances share one map. Deep traversal -50%, also when the accessor is read on every node.
- **Make hot call sites monomorphic so they inline.** A call site that sees several different functions (a hook list mixing internal and user hooks) goes megamorphic and nothing is inlined. Call an internal step from its own call site after the user hooks; TurboFan then inlines it together with its helpers (verify with `--trace-turbo-inlining`).
- **Intern strings used as property keys.** `obj["/" + key]` builds a new, non-internalized string per lookup, which forces a string-table lookup (hashing the whole key) on every access. Cache the derived key strings in a bounded `Map` (reset it when it reaches a few thousand entries): rule lookups -14% on their own.
- **Skip lookups that cannot hit.** When scanning an object's keys once anyway (to compile it), also record facts such as "has no exact keys" and skip the lookup per item. Combined with the two items around it, prefix-rule crawls became -65% to -73% faster.
- **Memoize merges of static objects by identity.** If the same `{ ...a, ...b }` is rebuilt per item from the same immutable sources, cache it in a `WeakMap` keyed by the source objects. This turns hundreds of thousands of fresh objects with many shapes (megamorphic loads downstream) into a handful of shared ones. It requires a documented contract: results may be shared and inputs must not be mutated after first use.
- **Cache per long-lived object, not per short-lived one.** A `WeakMap.set` for an object that dies right away costs about 150 ns (ephemeron bookkeeping in GC), versus about 27 ns to rescan a small object's keys. Cache results for objects that are reused (static configuration), recompute for objects created per item, and compute once per container in the caller when the same object is consulted for every child.
- **Single property get instead of `in` + get** when a missing key and an `undefined` value mean the same thing and the key cannot hit `Object.prototype` (for example, keys that always start with a character no prototype member starts with).
- **Preallocated arrays filled by index** for short copies (`const a = new Array(n); for (...) a[i] = src[i]`). They are HOLEY in elements kind but measured faster than packed alternatives (see below).
- **Lazy, hybrid data structures.** Build eagerly where it is cheap and almost always needed (paths up to depth 128 are copied), lazily where it is expensive and often unused (deeper paths are built from parent links only when read). Linear time on 100 000-level documents without slowing shallow ones.
- **Await only thenables in async loops.** `const r = hook(ctx); const res = isThenable(r) ? await r : r` avoids a microtask per item when callbacks are synchronous.
- **Bounded bookkeeping instead of complete bookkeeping.** Cycle detection in a deep equality check only needs to start below a depth threshold, because a cycle always produces unbounded depth: recording visited pairs only below depth 32 kept cycle safety and recovered the full cost of tracking on ordinary documents (55 → 33 ms).
- **Native modern syntax.** Target a JS version where everything hot is native (see "TypeScript and the build").

## What hurts or does not help (measured)

These are tempting and were measured slower or useless. Do not reach for them without your own measurement.

- **Packed arrays via `slice()` + `push()` or a `push` loop** instead of `new Array(n)` + index fill: +43% and +20% on a traversal. Growing arrays reallocates; the "holey" kind is not the bottleneck it is made out to be.
- **`Object.values()` snapshot** of an object instead of reading `obj[key]` in the loop: +14%, and it changes semantics (values read before earlier callbacks could change them).
- **`for...in` + `hasOwnProperty` instead of `Object.keys()`**: fewer allocations but +17% and +27% time in an equality check. Indexed loops over the key array are what V8 optimizes best.
- **Object spread / `slice()` as a fast copier**: -27% on typical objects but +105% on large flat objects, which are in dictionary mode and make spread slow. Per-key copying is more predictable.
- **`Map` instead of `WeakMap`** for an identity table: no gain in either direction.
- **Hoping escape analysis removes an allocation** (returning a fresh context object instead of storing it): allocation unchanged, +4%. TurboFan's escape analysis gives up on objects that flow through a loop phi or escape into calls it does not inline.
- **Reordering cheap checks** (reading an array element before the `in` hole check): 0% to +4%. Branch order inside a tight loop rarely matters after optimization.
- **Caching everything.** A cache keyed by short-lived objects costs more than it saves (ephemeron cost above); a cache of `"/"+key` strings bigger than needed (16 384 vs 4 096 entries) bought nothing.
- **Accessors on the prototype to save allocation** when callers rely on own enumerable properties (`{ ...ctx }`, `Object.keys(ctx)`): -88% but breaks the contract; the shared own accessor (above) kept the contract at -44%.
- **Mutating an object in place to save an allocation** when callers may hold the old one (callbacks that captured the context and expect it unchanged): rejected on semantics, not on speed.
- **Micro-optimizing equality, cloning or traversal that is already at parity** with the fastest libraries. Most of what remains there is the output itself and GC.

## TypeScript and the build

What V8 runs is the transpiler's output, so check it (`grep` the dist file for helpers, `WeakMap` shims, generator wrappers). Things that matter:

- **The compile target can silently cost a lot.** Below ES2022, `#private` fields and static blocks are lowered to `WeakMap`-based helpers (every field access becomes a WeakMap lookup); below ES2018 object spread becomes helper calls; below ES2017 `async`/`await` becomes generators; ES5 targets with `downlevelIteration` turn `for...of` into iterator-protocol helpers. Lowering `??=` (ES2021) and optional chaining (ES2020) is harmless. Pick the highest target your runtimes support (Node 18 supports ES2022) and confirm the emitted code is native.
- **Class fields change object shapes.** With `useDefineForClassFields` (the default from ES2022 targets), declared fields become own properties defined in declaration order before the constructor body runs. When property order or the absence of a property matters (an accessor defined in the constructor, matching the key order of plain objects), use `declare field: T` so TypeScript emits nothing and assign in the constructor in the order you want.
- **Keep runtime constructs erasable.** `enum`, `namespace` and parameter properties emit runtime code; `erasableSyntaxOnly` and `verbatimModuleSyntax` keep the output a straight copy of what you wrote, which makes the bytecode and the source easy to compare.
- **Types do not affect V8.** A `readonly`, a narrower type or an interface changes nothing at runtime; only the emitted JS and the shapes of the values it creates do.

## Benchmarks against other libraries

When comparing with competitors, make the work equal or label the difference. Reading `path` on every node of a 5 000-level chain cost one library 179 ms while another took 1 ms, because the second returned a string path (V8 concatenates strings without copying, as ropes) and the first a fresh array; with a no-op visitor the gap was 6.8 ms vs 1 ms. Split such cases ("walk only" and "walk and read path"), verify each library's output before timing it (node counts, copies equal to the source, true/false for equal/unequal inputs), record crashes (stack overflows on deep inputs are common in recursive libraries) as results rather than hiding them, and footnote semantic differences.

## Reporting

Report each change with: what changed, the mechanism, before → after (min and median, the fixture, the % change), the noise floor, and any contract change. Report losses and no-gains with numbers as well; they keep the next person from trying the same idea. Keep the before/after table per case and an overall baseline-to-final table.

## Reference files

- `references/measuring-and-testing.md` - building a trustworthy benchmark, running and reading comparisons, testing that behaviour did not change, benchmarking against other libraries, keeping the gains. Read it before the first measurement.
- `references/finding-optimizations.md` - the step-by-step investigation, per-item budgets and ablation, a symptom → cause → fix table and a review checklist. Read it when looking for what to change.
- `references/v8-mechanisms.md` - how V8 executes and optimizes JS, and which code patterns trigger each slow path. Read it when forming a hypothesis.
- `references/tooling.md` - exact commands, flags, and how to read every output (including `%GetOptimizationStatus` bit calibration and natives syntax helpers). Read it when running the tools.
- `references/case-study-json-crawl.md` - the full measured record behind the lists above (findings, wins, rejections, per-step numbers). Read it for worked examples.
- `scripts/` - `compare.mjs`, `runner.mjs`, `alloc.mjs`, `ic-summary.mjs`, `opt-summary.mjs`, `cpu-self.mjs`, `example-bench.mjs`; each file starts with its usage.
