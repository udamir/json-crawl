// Bytes allocated and GC time per call, for every case of a bench file, after warm-up.
//   node alloc.mjs <module-under-test> <bench-file> [--units <n>] [--case <substring>]
// --units divides the allocation by a work unit count (e.g. the number of nodes or items processed) to report B/unit.
// Uses v8.getHeapStatistics().total_allocated_bytes (counts every allocation, also ones collected right away) and a
// PerformanceObserver on "gc" entries for the share of time spent in garbage collection.
import v8 from "node:v8"
import { PerformanceObserver } from "node:perf_hooks"
import { loadCases } from "./runner.mjs"

const args = process.argv.slice(2)
const [libPath, benchPath] = args.filter((a, i) => !a.startsWith("--") && !(args[i - 1] ?? "").startsWith("--"))
const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined }
const units = +(get("--units") ?? 0)
if (!libPath || !benchPath) { console.error("usage: node alloc.mjs <module> <bench-file> [--units n] [--case s]"); process.exit(2) }

let gcMs = 0
let scavenges = 0
let majors = 0
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) {
    gcMs += e.duration
    if (e.detail?.kind === 1) { scavenges++ } else { majors++ }
  }
}).observe({ entryTypes: ["gc"] })

const run = async (fn) => { const r = fn(); if (r && typeof r.then === "function") { await r } }
for (const [name, fn] of await loadCases(libPath, benchPath, get("--case"))) {
  for (let i = 0; i < 10; i++) { await run(fn) }
  const allocated = []
  for (let i = 0; i < 5; i++) {
    const before = v8.getHeapStatistics().total_allocated_bytes
    await run(fn)
    allocated.push(v8.getHeapStatistics().total_allocated_bytes - before)
  }
  await new Promise((r) => setTimeout(r, 20))
  gcMs = 0; scavenges = 0; majors = 0
  const N = 10
  let total = 0
  for (let i = 0; i < N; i++) { const t = performance.now(); await run(fn); total += performance.now() - t }
  await new Promise((r) => setTimeout(r, 50))
  const bytes = Math.min(...allocated)
  const perUnit = units ? `  ${(bytes / units).toFixed(1)} B/unit` : ""
  console.log(`${name.padEnd(28)} ${(bytes / 1e6).toFixed(2).padStart(8)} MB/call${perUnit}  time ${(total / N).toFixed(2)} ms  GC ${((100 * gcMs) / total).toFixed(0)}% (${(scavenges / N).toFixed(1)} scavenges, ${(majors / N).toFixed(1)} major per call)`)
}
