# Measurement and inspection tooling

Exact commands for the workflow in `SKILL.md`, and how to read what they print. All of them use Node's built-in V8 flags and the scripts in `scripts/`; nothing needs to be installed. Run them on the built JavaScript.

## Contents

1. Timing: `compare.mjs`
2. Allocation and GC: `alloc.mjs`
3. CPU self time: `--cpu-prof` + `cpu-self.mjs`
4. Inline caches: `--log-ic` + `ic-summary.mjs`
5. Tiers and deopts: `--trace-opt --trace-deopt` + `opt-summary.mjs`
6. Inlining: `--trace-turbo-inlining`
7. Bytecode: `--print-bytecode`
8. Shapes and status: natives syntax
9. A driver script
10. Pitfalls

## 1. Timing: compare.mjs

Write a bench file from `scripts/example-bench.mjs` (it default-exports `async (lib) => ({ "case": () => work() })`), save a copy of the old build (for example `cp -r dist /tmp/base-dist`), then:

```sh
node scripts/compare.mjs --bench bench.mjs --rounds 4 --iterations 25 --warmup 8 /tmp/base-dist/index.mjs dist/index.mjs
node scripts/compare.mjs --bench bench.mjs dist/index.mjs dist/index.mjs      # A/A: the noise floor
node scripts/compare.mjs --bench bench.mjs --case clone --node-flags "--max-old-space-size=4096" a.mjs b.mjs c.mjs
```

Each round starts one fresh process per variant (order reversed every other round), each process runs `iterations` calls and drops the first `warmup`. The table shows min / median over all kept samples and the change of the min against the first variant. Trust the min for "can it be faster", the median for "is it typically faster"; when they disagree strongly the case is noisy (GC, other processes). Rounds of 3-5 are usually enough; raise iterations for short cases.

## 2. Allocation and GC: alloc.mjs

```sh
node scripts/alloc.mjs dist/index.mjs bench.mjs --units 317649      # units = items processed per call (nodes, rows)
```

Prints MB allocated per call (minimum of 5 warmed-up calls), bytes per unit, mean time, GC share of the time and scavenges / major GCs per call. Interpret bytes per unit by subtracting what you know the code allocates per item (a result object, a context object of k fields ≈ 16 + 8k bytes on 64-bit with pointer compression roughly halving that, an array of n ≈ 16 + 8n); the remainder points at hidden allocations such as closure contexts. Changes of a few percent in bytes are reliable even when timings are noisy, which makes this the best tool for confirming an allocation fix.

## 3. CPU self time

```sh
node --cpu-prof --cpu-prof-interval 100 --cpu-prof-dir=prof driver.mjs
node scripts/cpu-self.mjs prof/*.cpuprofile 300 20      # drop the first 300 ms (startup, warm-up), top 20
```

Self time per function (time spent in its own code, not in callees). Inlined functions are attributed to the caller they were inlined into, so after optimization a big share often lands on the main loop; use it together with `--trace-turbo-inlining` to know what that loop contains. `(garbage collector)` is GC.

## 4. Inline caches

```sh
node --log-ic --logfile=v8.log --no-logfile-per-isolate driver.mjs
node scripts/ic-summary.mjs v8.log dist/index.mjs dist/index.mjs        # filter, source file for line text
node scripts/ic-summary.mjs v8.log dist/index.mjs dist/index.mjs N      # only sites that reached megamorphic
```

Each line is one IC site: `line:column type .property`, the function, the state history (`0` uninitialized, `1` monomorphic, `P` polymorphic, `N` megamorphic, `^` handler recomputed), the number of distinct maps and the slow-path reason if any. Ignore keyed accesses on user data in generic code (they are megamorphic by design); look at named accesses on your own objects. `--log-ic` slows the program a lot, so run a small number of iterations.

## 5. Tiers and deopts

```sh
node --trace-opt --trace-deopt driver.mjs > trace.txt 2>&1
node scripts/opt-summary.mjs trace.txt 'myLoop|myHelper'
node --trace-deopt-verbose driver.mjs 2>&1 | less        # bytecode offset and source position of each deopt
```

`opt-summary.mjs` prints per function the tiers in completion order (`ML` Maglev, `TF` TurboFan, `-OSR` on-stack replacement) and each distinct deopt reason with its count. Healthy: TF reached in the first couple of calls, deopts only early. Unhealthy: deopt counts that keep growing with iterations, "wrong map" or "not a Smi" reasons in steady state, a hot function with no TF tier.

## 6. Inlining

```sh
node --trace-turbo-inlining driver.mjs 2>&1 | grep -E 'Inlining .* into .*myLoop' | sed -E 's/0x[0-9a-f]+//g' | sort | uniq -c
```

Shows which functions TurboFan inlined into which. Anonymous functions appear as `<SharedFunctionInfo>` without a name; name important callbacks (`const step = function step(...)` or a named const) when you need to see them. If a callback you expected is missing, its call site is probably megamorphic.

## 7. Bytecode

```sh
node --print-bytecode --print-bytecode-filter=resolveNodeRules driver.mjs 2>&1 | less
```

Look for `CreateFunctionContext` / `CreateBlockContext` at the start (captured variables: context allocated per call), `CreateClosure` (a closure per call), `CreateObjectLiteral` / `CloneObject` (object literal / spread per call), `CreateArrayLiteral`, `ToString` + `Add` before `GetKeyedProperty` (runtime-built property key). Bytecode is printed when a function is first compiled, so the driver must call the function.

## 8. Shapes and status: natives syntax

Run a small script with `node --allow-natives-syntax probe.mjs`:

```js
%HaveSameMap(a, b)          // true if a and b share a hidden class
%HasFastProperties(o)       // false means dictionary mode
%HasHoleyElements(arr); %HasSmiElements(arr); %HasDoubleElements(arr)
%PrepareFunctionForOptimization(f); f(); f(); %OptimizeFunctionOnNextCall(f); f()
%GetOptimizationStatus(f)   // a bit field; calibrate it on your V8 version
```

`%GetOptimizationStatus` bits change between V8 versions. Calibrate by printing the status of a trivial function after forcing each tier (interpreted, after `%CompileBaseline` for Sparkplug, after `%OptimizeMaglevOnNextCall`, after `%OptimizeFunctionOnNextCall`). On V8 14.6 the values were 0x41 Ignition, 0x4001 Sparkplug, 0x19 Maglev, 0x29 TurboFan. `%DebugPrint` is not available in release builds of Node. Natives syntax is for probes only; never ship it.

## 9. A driver script

The trace tools need a script that exercises the hot path enough times to warm up (8-20 calls of a realistic input):

```js
// driver.mjs - node <flags> driver.mjs path/to/dist/index.mjs
import { readFileSync } from "node:fs"
const lib = await import(new URL(process.argv[2], `file://${process.cwd()}/`).href)
const input = JSON.parse(readFileSync("fixture.json", "utf8"))
for (let i = 0; i < 12; i++) lib.process(input)
```

## 10. Pitfalls

- Two builds in one process share JIT state and inline caches; compare in separate processes only (`compare.mjs` does).
- Other processes on the machine (IDEs, language servers, other benchmarks) move timings by several percent; measure the noise with an A/A run and rerun when results look odd.
- Do not put input preparation (`structuredClone`, `JSON.parse`) inside a timed function; reuse one prepared input (an in-place transform can safely run repeatedly on one copy when it keeps the structure).
- Very short cases (< 2 ms) are noisy: raise iterations or the input size.
- Profiler and trace flags change timing; never time with them on.
- Test-framework matchers can be the slow or crashing part: deep-equality and even failure-message formatting are often recursive and overflow on deep inputs. Compare references or use an iterative equality in tests of deep data.
- After porting a prototype into the source, measure again; gains do not always transfer.
