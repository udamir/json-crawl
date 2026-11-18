// Self time per function from a V8 CPU profile, with the warm-up dropped.
//   node --cpu-prof --cpu-prof-interval 100 --cpu-prof-dir=prof <your-driver.mjs>
//   node cpu-self.mjs prof/<file>.cpuprofile [skip-ms, default 0] [top, default 20]
// "(garbage collector)" is GC time; "(program)" is the engine itself; "(idle)" is waiting.
import { readFileSync } from "node:fs"

const [file, skipMs = "0", top = "20"] = process.argv.slice(2)
if (!file) { console.error("usage: node cpu-self.mjs <file.cpuprofile> [skip-ms] [top]"); process.exit(2) }
const prof = JSON.parse(readFileSync(file, "utf8"))
const nodes = new Map(prof.nodes.map((n) => [n.id, n]))
const self = new Map()
let total = 0
let t = prof.startTime
for (let i = 0; i < prof.samples.length; i++) {
  t += prof.timeDeltas[i]
  if (t - prof.startTime < +skipMs * 1000) { continue }
  const { callFrame } = nodes.get(prof.samples[i])
  const where = callFrame.url ? ` [${callFrame.url.split("/").pop()}:${callFrame.lineNumber + 1}]` : ""
  const name = `${callFrame.functionName || "(anonymous)"}${where}`
  self.set(name, (self.get(name) ?? 0) + 1)
  total++
}
for (const [name, n] of [...self].sort((a, b) => b[1] - a[1]).slice(0, +top)) {
  console.log(`${((100 * n) / total).toFixed(1).padStart(5)}%  ${name}`)
}
console.log(`\n${total} samples after the first ${skipMs} ms.`)
