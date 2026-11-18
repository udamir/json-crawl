# V8 mechanisms that decide performance

How V8 runs JavaScript, in the depth needed to turn a profile into a hypothesis. Each section ends with the code patterns that trigger the slow path. Version notes: written against V8 14.x (Node 24-26); the mechanisms have been stable for years, flag names and status bits change between versions (see `tooling.md`).

## Contents

1. Execution tiers and on-stack replacement
2. Hidden classes (maps) and dictionary mode
3. Inline caches: monomorphic, polymorphic, megamorphic
4. Function contexts and closures
5. Call-site feedback and inlining
6. Allocation, escape analysis and GC
7. Elements kinds (arrays)
8. Strings as property keys
9. WeakMap, WeakSet and ephemerons
10. Async functions and promises

## 1. Execution tiers and on-stack replacement

Code starts in Ignition (bytecode interpreter), moves to Sparkplug (a fast non-optimizing compiler) and, when hot, to Maglev (fast optimizing) and TurboFan (fully optimizing). Optimizing tiers specialize on the types and shapes seen so far (feedback); when a later value breaks an assumption, the code deoptimizes back to the interpreter and is reoptimized later with wider feedback. A function that is called once but loops for a long time (a whole-document traversal) is optimized while running, through on-stack replacement (OSR): the loop jumps into optimized code. `%GetOptimizationStatus` of such a function can say Sparkplug while its loop runs in TurboFan OSR code, so judge by `--trace-opt` (look for `OSR`), not by the status alone.

What is normal: a few deopts with reasons like "Insufficient type feedback" in the first one or two calls, on code paths that had not run before the first optimization. What is a problem: the same function deoptimizing again and again with the same reason (a deopt loop), a hot function never leaving Ignition/Sparkplug, or "wrong map" deopts in steady state, which mean shapes keep changing. In the case study tiering was healthy everywhere; the time was in allocation and call structure. Check tiering first because it is quick, but do not assume it is the problem.

## 2. Hidden classes (maps) and dictionary mode

Every object has a map describing its layout (which properties, in which order, at which offsets). Objects created the same way share a map, so property access compiles to a load at a fixed offset. Adding properties in a different order, or conditionally, produces different maps. Some operations push an object into dictionary mode (a hash table, no shared map, every access a lookup): `delete` of a property that is not the last one added, adding very many properties (large flat objects such as a 10 000-key map are dictionary-mode from the start), and object literals whose accessors are fresh closures.

Triggers seen in practice:

- An object literal with `get p() {...}` / `set p(v) {...}` created per item: each literal creates new accessor closures and a new accessor pair, V8 cannot share a map, `%HasFastProperties(obj)` is false. Every access to every property of such objects becomes slow, including the library's own `obj.value`. Fix: one class, one shared accessor descriptor (`static readonly desc = { get() { return this.#x }, ... }` and `Object.defineProperty(this, "p", Desc)` in the constructor), state in private fields.
- Merging with spread per item (`{ ...a, ...b }`) from sources of varying shapes: many distinct maps downstream (11 maps for one rules object type), so loads such as `rules["/*"]` go megamorphic.
- Spread or `Object.assign` from a dictionary-mode source is slow (it copies through the hash table); per-key copying is predictable.
- Class fields with `useDefineForClassFields` are defined before the constructor body in declaration order; use `declare` fields when the order matters.

Check with `%HaveSameMap(a, b)` and `%HasFastProperties(o)` under `--allow-natives-syntax`.

## 3. Inline caches: monomorphic, polymorphic, megamorphic

Every property access and call site has an inline cache (IC) that records the maps it has seen. One map: monomorphic, fastest, inlined as a map check plus a fixed-offset load. Two to four maps: polymorphic, a short chain of checks, still cheap. More: megamorphic, a lookup in a global stub cache keyed by (map, name), several times slower and not inlined. Keyed accesses (`obj[key]` with a variable key) on objects of many shapes are megamorphic by nature in generic code (a traversal reading `data[key]` across arbitrary documents); that is inherent and fine. What to fix are named accesses on your own internal objects (contexts, frames, rule sets) that went megamorphic because those objects have many shapes.

`--log-ic` writes every IC transition; `scripts/ic-summary.mjs` lists the sites in your file that reached P or N with the number of maps. A site at `1>P` with maps=2 is usually harmless (for example a PACKED_SMI root array next to HOLEY child arrays). A site at `N` with 10+ maps on an internal object is a target.

## 4. Function contexts and closures

Variables captured by an inner function live in a heap-allocated context instead of registers. If a function contains any closure that captures its parameters or locals, Ignition emits `CreateFunctionContext` at function entry, before the first statement, so the allocation happens even when the function returns early and the closure is never created. Block-scoped captured variables add a `CreateBlockContext`. TurboFan sometimes removes these when it inlines everything, often it does not (the context escapes into the closure).

Triggers seen in practice:

- A resolver with an inner `const resolve = (rule) => ... ctx ...` helper: 72 B context per call, also for the many calls that returned at `if (!rules) return`. Fix: guard in the caller, or inline the helper's body and keep the shared variable as a plain local.
- A hook that returns `{ exitHook: () => use(value, childState) }`: every call, including leaves that never create the closure, allocates the context. Fix: build the closure in a module-level factory `const makeExit = (value, state) => () => ...`.

Spot it in `--print-bytecode --print-bytecode-filter=<fn>`: `CreateFunctionContext` / `CreateFunctionContextWithCells` / `CreateBlockContext` near the top, `CreateClosure` inside.

## 5. Call-site feedback and inlining

A call site's feedback is monomorphic (one target) or megamorphic; there is no polymorphic call feedback. Closures created from the same source location share a feedback cell, so a call site that always calls closures of the same function literal stays inlinable even if the closure objects differ. TurboFan inlines monomorphic targets (and their small helpers), which removes call overhead and lets it optimize across the boundary. A loop that calls a list of callbacks through one site (`hooks[i](ctx)`) is monomorphic only if the list has one function; an internal step appended to user callbacks makes the site megamorphic and blocks inlining of all of them. Give hot internal steps their own call site. Verify with `--trace-turbo-inlining` (`Inlining <SharedFunctionInfo X> into <SharedFunctionInfo Y>`).

## 6. Allocation, escape analysis and GC

Allocation in V8 is a pointer bump in the young generation and is cheap per object; the cost comes back as scavenges (minor GCs) and, for data that survives (output being built), promotions and major GCs. Bytes allocated per item is the best single predictor: in the case study a plain traversal allocated 256-328 B/node with 3% GC, while clone allocated 580 B/node with 21% GC. Measure with `scripts/alloc.mjs`, which reads `v8.getHeapStatistics().total_allocated_bytes` (counts allocations that die immediately too) and the GC share via a `PerformanceObserver`.

Escape analysis lets TurboFan replace an object that never leaves the optimized function by its fields (no allocation). It works for small objects created and consumed inside one function after inlining. It does not work when the object is stored in another object, passed to a call that is not inlined, or flows through a loop phi (assigned in one iteration, used in the next). Do not restructure code hoping for it; measure allocation before and after, and expect "unchanged" (case study: returning the next context instead of storing it changed nothing and cost 4%).

## 7. Elements kinds (arrays)

Arrays track an elements kind: PACKED or HOLEY, and SMI (small integers), DOUBLE, or ELEMENTS (any value). Transitions go one way (SMI → DOUBLE → ELEMENTS, PACKED → HOLEY). `new Array(n)` creates HOLEY; `[]` + `push` stays PACKED. Holey arrays need a hole check on reads, which is cheap; reallocation when growing a packed array with `push` is not. Measured: copying short arrays with `new Array(n)` + index fill beat `slice()` + `push` (+43% slower) and a `push` loop (+20% slower). Mixing kinds at one site makes the IC polymorphic with two maps, which is cheap. Real holes in user data (sparse arrays) are a semantic question, not a speed one: decide whether to skip them (`i in arr`) and test it.

## 8. Strings as property keys

Property lookup by name uses internalized (unique) strings, compared by pointer. A key built at runtime (`"/" + key`, a template literal) is a new non-internalized string; a keyed lookup with it must first find the internalized copy in the string table, hashing the whole string, on every access, and the megamorphic stub cache does not help. Caching derived key strings in a `Map` (bounded, reset when full) makes later lookups use the already-internalized string: -14% on a rule-resolution hot path. Constant keys in source code are internalized at compile time and cost nothing.

String concatenation creates ropes (a tree of the parts) instead of copying, so building a path string `a.b.c` per node is O(1) per step, while building a path array is O(depth) per node. This is why a library with string paths can look 100× faster than one with array paths on very deep inputs; it is a representation difference, not a traversal-speed difference.

## 9. WeakMap, WeakSet and ephemerons

A `WeakMap` entry is an ephemeron: GC must do extra work to decide whether the value is reachable, and adding an entry for a short-lived key costs on the order of 150 ns including that GC work, versus tens of nanoseconds to rescan a small object. Use weak maps to cache facts about long-lived objects (configuration, rule sets, schemas), not about objects created per item. `Map` with object keys measured the same speed as `WeakMap` for an identity table inside one operation; use whichever has the right lifetime semantics.

## 10. Async functions and promises

An `async` function compiles to a resumable state machine. Even when it never actually suspends, a hot loop inside an async function runs 15-20% slower than the same loop in a sync function in the case study, because the suspend points constrain optimization. Every `await` of a non-promise still costs a microtask; checking `typeof r?.then === "function"` and awaiting only thenables avoids that when callbacks are usually synchronous. Splitting the loop into a synchronous stepper that returns only when it meets a thenable (and an async wrapper that awaits and resumes it) measured -13% more, at the cost of noticeably harder code; treat it as optional. Below an ES2017 target, `async` is lowered to generators, which is much slower; check the target.
