# Measuring and testing performance changes

How to build a benchmark that can tell a real 5% change from noise, and how to make sure an optimization did not change behaviour. Commands for the individual tools are in `tooling.md`.

## Contents

1. What a trustworthy measurement needs
2. Building the bench file
3. Running a comparison, step by step
4. Reading the numbers
5. Testing that behaviour did not change
6. Benchmarks against other libraries
7. Keeping the gains

## 1. What a trustworthy measurement needs

- **The shipped code.** Benchmark the build output (`dist/`), because the transpiler and bundler decide what V8 runs.
- **Fresh processes.** Each variant runs in its own process, so JIT state, inline caches and hidden classes are not shared between variants. Two builds in one process distort each other (seen: +20% fake regressions).
- **Interleaving.** Alternate variants and reverse the order each round, so slow drift of the machine (thermal, background jobs) hits all variants equally.
- **Warm-up dropped.** The first iterations run in the interpreter and baseline tiers; drop them (8-10 of 20-30 per process works for cases of 5-100 ms).
- **Min and median.** The minimum estimates the best the code can do and is robust to interference; the median shows the typical run. Report both.
- **A noise floor.** An A/A run (the same build as two variants) gives the spread you must exceed before calling a change real. ±3% is good, ±5% is common on a laptop with an IDE open.
- **Several input shapes.** At least: wide (many keys at one level), deep (long chains, to expose per-depth costs), large arrays, and one realistic document. Optimizations often help one shape and hurt another (a spread-based copier was -27% on typical objects and +105% on a large flat object).
- **No setup inside the timed function.** Parse, clone and build inputs once; an in-place operation can run repeatedly on one prepared copy if it keeps the structure.

## 2. Building the bench file

Copy `scripts/example-bench.mjs` into the project (or a scratch directory). It default-exports `async (lib) => ({ "case name": () => work() })`; `lib` is the module under test, so the same bench file runs against any build. Add one case per operation and input shape you care about, plus the cases the change is expected to affect and a few it should not affect (to catch collateral regressions). Name cases so the table reads well ("clone, openapi", "crawl, deep-5k, reading path").

## 3. Running a comparison, step by step

1. Build the current code and save the build as the baseline (`cp -r dist /tmp/base-dist`). Keep it for the whole session; compare every later step against it as well as against the previous step.
2. Run the A/A comparison to learn the noise floor: `node scripts/compare.mjs --bench bench.mjs dist/index.mjs dist/index.mjs`.
3. Make one change, rebuild, run the tests, then `node scripts/compare.mjs --bench bench.mjs /tmp/prev-dist/index.mjs dist/index.mjs`. Save the build of each step (`/tmp/prev-dist`) before making the next change.
4. Measure allocation for the affected cases: `node scripts/alloc.mjs dist/index.mjs bench.mjs --units <items>`. A drop in bytes per item confirms an allocation fix even when timing is noisy.
5. If the result is inside the noise floor, rerun with more rounds before deciding; if it is still inside, the change did not help (keep it only if it is risk-free and simplifies code, and say it gave nothing measurable).
6. Commit the change with its numbers in the message. At the end, compare the original baseline against the final build for the summary table.

## 4. Reading the numbers

- Trust min-to-min changes beyond the A/A spread; look at the median too, and distrust a case where min improves but the median worsens (likely GC variance).
- Sub-millisecond cases swing by tens of percent; enlarge the input or ignore them.
- A big change in an unrelated case means noise (or a shared code path you forgot); rerun it alone with `--case`.
- When numbers from different sessions disagree, the machine load differed; only compare within one run, and say so when reporting.
- Express results as both ms and % against the stated baseline, and say which input and which statistic.

## 5. Testing that behaviour did not change

Performance changes alter code paths, so test more than usual:

- **Run the full suite on every step**, not only at the end.
- **Equivalence tests for fast paths.** When adding a specialized path (for example a clone without callbacks), keep the general path and test that both produce the same result on tricky inputs: holes in arrays, `__proto__` as an own key, shared references, cycles, empty containers, nested arrays, primitive roots. Compare structure and identity (which positions point to the same object), not just deep equality.
- **Test the contract you might break.** Property order and enumerability of objects handed to callers, own vs prototype properties (`{ ...ctx }` must still copy everything), shared vs fresh objects (write a characterization test when sharing becomes allowed), sync vs async errors (an `async` wrapper that now throws synchronously is a behaviour change), ordering of callbacks and exit hooks.
- **Test caches with many keys and mutations.** Bounded caches need a test with more distinct keys than the bound; identity caches need a test where two different inputs must give different results.
- **Verify prototypes too.** Before timing a prototype (a patched copy of the build), run the project's tests against it (a test copy whose imports point at the prototype) and compare its outputs with the baseline's on the benchmark inputs. An optimization that is fast because it skips work it should do is the most common false win.
- **Watch the test framework.** Deep-equality matchers and failure-message formatting are often recursive and overflow on very deep data; use reference checks and an iterative equality in such tests.

## 6. Benchmarks against other libraries

- Pick peers by actual usage (weekly downloads) and by feature: each peer only in the cases it supports.
- Verify every library's output before timing it (node counts visited, copy equal to the source, true for equal and false for unequal inputs), and record failures (stack overflows on deep inputs, wrong results) as results.
- Make the work equal: a visitor that reads `path` costs very different amounts depending on whether a library builds arrays or strings; split such cases into "operation only" and "operation + extra data".
- Footnote semantic differences (root not visited, no paths, no cycle handling, JSON-only values).
- Publish the harness and the environment (Node/V8 version, CPU, date) with the numbers; regenerate the report from the harness rather than editing it.

## 7. Keeping the gains

- Keep the bench file in the repository (for example `bench/`) with the generated report, so the next change can be measured the same way.
- In CI, timing is too noisy to gate on; gate on allocation per item (`alloc.mjs` output) or on complexity tests (time ratio of 4n vs n inputs) if you want an automatic guard, and run the timing benchmark before releases.
- Record rejected ideas with their numbers next to the accepted ones, so nobody retries them blindly.
