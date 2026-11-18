// A/B timing in fresh processes, interleaved, order reversed every round, warm-up dropped.
//   node compare.mjs --bench <bench-file> [--rounds 4] [--iterations 25] [--warmup 8] [--case <substring>]
//                    [--node-flags "--max-old-space-size=4096"] <variant-A> <variant-B> [...]
// Variants are paths to the module under test (e.g. a copy of the old dist/index.mjs and the new one). The first
// variant is the baseline. Reports min and median of all warm samples and the change against the baseline.
// Never compare two builds inside one process: they share inline caches and JIT state and distort each other.
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const args = process.argv.slice(2)
const opt = { rounds: 4, iterations: 25, warmup: 8, bench: undefined, case: undefined, "node-flags": "" }
const variants = []
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("--")) { opt[args[i].slice(2)] = args[++i] } else { variants.push(args[i]) }
}
if (!opt.bench || variants.length < 1) {
  console.error("usage: node compare.mjs --bench <bench-file> [--rounds N] [--iterations N] [--warmup N] [--case s] <variant> ...")
  process.exit(2)
}
const runner = fileURLToPath(new URL("./runner.mjs", import.meta.url))
const flags = opt["node-flags"] ? opt["node-flags"].split(/\s+/) : []
const samples = variants.map(() => ({}))
for (let round = 0; round < +opt.rounds; round++) {
  const order = variants.map((_, i) => i)
  if (round % 2) { order.reverse() }
  for (const v of order) {
    const out = execFileSync(process.execPath, [...flags, runner, variants[v], opt.bench, String(opt.iterations), ...(opt.case ? [opt.case] : [])], { encoding: "utf8", maxBuffer: 1 << 26 })
    const result = JSON.parse(out.trim().split("\n").pop())
    for (const [name, xs] of Object.entries(result)) { (samples[v][name] ??= []).push(...xs.slice(+opt.warmup)) }
  }
}
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const fmt = (x) => (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2)).padStart(7)
const pct = (x, base) => `${x >= base ? "+" : ""}${((100 * (x - base)) / base).toFixed(0)}%`.padStart(5)
const names = Object.keys(samples[0])
const width = Math.max(4, ...names.map((n) => n.length))
console.log(`${"case".padEnd(width)}  ${variants.map((_, i) => `${i === 0 ? "base" : `v${i}`} min / median`.padStart(i === 0 ? 17 : 29)).join("")}`)
for (const name of names) {
  const base = samples[0][name]
  const bMin = Math.min(...base), bMed = median(base)
  let line = `${name.padEnd(width)}  ${fmt(bMin)} / ${fmt(bMed)}`
  for (let v = 1; v < variants.length; v++) {
    const xs = samples[v][name]
    if (!xs) { line += "   (missing)"; continue }
    const mn = Math.min(...xs), md = median(xs)
    line += `   ${fmt(mn)} / ${fmt(md)} ${pct(mn, bMin)}`
  }
  console.log(line)
}
console.log(`\n${variants.map((v, i) => `${i === 0 ? "base" : `v${i}`} = ${v}`).join("\n")}`)
console.log(`${opt.rounds} rounds x ${opt.iterations} iterations, first ${opt.warmup} of each process dropped; % = change of the min against base.`)
console.log("Run an A/A comparison (the same file twice) to learn the noise floor before trusting small differences.")
