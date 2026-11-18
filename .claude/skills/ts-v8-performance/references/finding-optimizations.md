# Finding optimization opportunities

A systematic search for where time goes and what to change, in the order that finds the biggest wins first. Use it after a trustworthy benchmark exists (see `measuring-and-testing.md`).

## Contents

1. Step-by-step investigation
2. Cost budget per item and ablation
3. Symptom → cause → fix
4. Code review checklist for hot paths
5. Deciding what to try first

## 1. Step-by-step investigation

Work through these steps for each slow case, writing down what each one shows. The notes become the hypotheses list.

1. **Scale test for complexity.** Run the case on inputs of size n, 2n, 4n (and on a deep variant if the data is nested). Time that grows faster than linearly means an algorithmic problem (nested loops over keys, copying a prefix at each level, repeated `indexOf`/`includes` over growing arrays, re-sorting). Fix those first; nothing else comes close.
2. **Count the work per item.** Write down, for one item (node, row, element), every operation the code performs: calls, property reads, objects/arrays/closures created, map lookups, string builds. This is the "per-item budget" (section 2). Most wins are items on this list that do not need to happen for every item.
3. **Measure allocation per item** with `scripts/alloc.mjs --units <items>`. Compare it with the budget: the objects you listed should account for it. A gap means hidden allocation (closure contexts, temporary arrays from `Object.keys`/spread/`slice`, boxed doubles, strings). Also note the GC share: above ~10% allocation is a primary target.
4. **Profile self time** (`--cpu-prof` + `scripts/cpu-self.mjs`). Rank functions by self time. Note where GC sits. Remember inlined functions are charged to their caller.
5. **Check shapes and inline caches** (`--log-ic` + `scripts/ic-summary.mjs`). List named accesses on your own objects that are megamorphic or have many maps, and objects in dictionary mode (`%HasFastProperties`).
6. **Check call sites and inlining** (`--trace-turbo-inlining`). Are the hot callbacks and helpers inlined into the loop? Which call sites see many targets?
7. **Check tiers and deopts** (`--trace-opt --trace-deopt` + `scripts/opt-summary.mjs`). Usually healthy; rule it out quickly.
8. **Read the bytecode of the top functions** (`--print-bytecode-filter`). Look for per-call context creation, closures, literals and runtime-built keys (see `tooling.md` section 7).
9. **Read the emitted JS** for transpiler helpers and lowered features (see the TypeScript section of `SKILL.md`).
10. **Turn each observation into a hypothesis with an expected gain**, using the table in section 3, and order them with section 5.

## 2. Cost budget per item and ablation

Two techniques turn a vague profile into numbers per cause.

**Budget by bytes.** Allocation per item divides cleanly into causes. In the case study, a traversal allocated 328 B per node: a 72 B closure context of a resolver called even without rules (avoidable), about 92 B for the path array, 64 B for the context object handed to callbacks, and about 100 B per node from containers (frame record 96 B, path node 56 B and the `Object.keys` array, spread over the 48% of nodes that were containers). That list is the optimization plan: the 72 B went first (-20%), the containers next.

**Ablation.** To learn what one piece of work costs, measure a deliberately broken variant that skips it, for example children sharing the parent's path array instead of copying it, a hook loop that skips the internal hook, or a lookup replaced by a constant. The difference is the upper bound of what optimizing that piece can gain (the path copy was ≈22% of the traversal). Ablations are diagnostic only; never ship them, and say in notes that the variant is wrong on purpose.

## 3. Symptom → cause → fix

| symptom (where you see it) | likely cause | what to try |
|---|---|---|
| time grows faster than input size | quadratic algorithm, prefix copying per level, nested key matching | linear algorithm, shared/parent-linked structures, lazy materialization |
| bytes/item higher than the objects you create (alloc.mjs) | closure context per call, temporary arrays (`Object.keys`, spread, `slice`), runtime strings | guard before the call, module-level helpers, reuse key arrays, cache derived strings |
| `CreateFunctionContext` at the top of a hot function (bytecode) | an inner closure captures parameters | inline the closure's body, or move the closure into a module-level factory |
| GC share > 10% (alloc.mjs, cpu-self) | per-item objects: results, states, responses, merged objects | fast path without per-item objects, shared immutable objects, fewer intermediate copies |
| named access on own objects megamorphic, many maps (ic-summary) | objects of the same role built in different shapes (spread merges, conditional fields) | build them in one shape (class or one literal), memoize merges of static inputs |
| `%HasFastProperties` false on per-item objects | literal with own accessors, `delete`, too many properties | class with one shared accessor descriptor and private fields; avoid `delete` |
| callback not inlined into the loop (trace-turbo-inlining) | megamorphic call site (several callbacks through one site) | give internal steps their own call site; keep user callbacks on a separate site |
| keyed lookup with `ToString`/`Add` before it in bytecode | key string built per lookup | cache derived keys in a bounded `Map` |
| `WeakMap` set high in profile, GC ephemeron time | caching per short-lived object | cache only long-lived objects; compute once per container instead |
| same lookup per item although its answer is per container | work done at the wrong level | compute once in the caller and pass it in |
| function stuck in Sparkplug/Ignition, repeated deopts (opt-summary) | unstable types or shapes, rarely-taken paths in the hot loop | stabilize shapes, split rare paths into separate functions |
| async version 15-20% slower than sync with sync callbacks | resumable function around the hot loop, `await` on non-promises | await only thenables; optionally a sync stepper with async resume |
| dist contains `WeakMap` helpers, `__awaiter`, `__spreadArray`, `_classPrivateFieldGet` | transpile target too low | raise the target; confirm native syntax in the output |
| one library far faster than another on deep data only | different path representation (string ropes vs arrays) or recursion vs iteration | compare equal work; split "walk" and "walk + path" cases |

## 4. Code review checklist for hot paths

Read the hot function and its callees with these questions; each "yes" is a candidate.

- Is anything called per item whose result is known in advance (no options, no rules, empty list)?
- Is there a common configuration that could skip the general machinery entirely?
- Does any function on the hot path define a closure, and does that closure capture parameters or locals?
- Are objects of the same role created in more than one shape (conditional properties, different orders, spread from varying sources)?
- Are there object literals with getters/setters created per item?
- Are property keys built at runtime per lookup?
- Is the same fact recomputed for every child of a container?
- Is something cached per short-lived object, or is something long-lived recomputed per item?
- Are callbacks of different kinds called through one call site?
- Is anything awaited that is usually not a promise?
- Are arrays grown with `push` where the final length is known?
- Is data copied that could be shared or built lazily?

## 5. Deciding what to try first

Rank candidates by expected gain divided by effort and risk:

1. Expected gain: use the budget and ablations (a piece that is 20% of the bytes or the time can give at most about that much).
2. Effort: a two-line guard first, a dedicated fast path or an internal engine change later.
3. Risk: changes that alter what callers can observe (shared objects, caches that assume immutability, property enumerability, sync vs async errors) need an explicit decision and documentation; changes that are invisible go first.

Prototype the top three, measure them separately against the same baseline, and port only the ones that beat the noise floor. Re-rank after each kept change: removing one cost often changes what dominates next (after removing a closure context, the path copy became the largest per-node cost).
