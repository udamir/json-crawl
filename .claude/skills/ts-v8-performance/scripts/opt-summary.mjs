// Summarises optimization tiers and deoptimizations per function.
//   node --trace-opt --trace-deopt <your-driver.mjs> > trace.txt
//   node opt-summary.mjs trace.txt [function-name-regex]
// Prints, for each function, the tiers it was compiled to in order (ML = Maglev, TF = TurboFan, -OSR = on-stack
// replacement of a running loop) and every distinct deopt reason with its count. Deopts that happen only in the first
// iterations are warm-up; a function that keeps deoptimizing or never reaches TF in steady state is the problem.
import { readFileSync } from "node:fs"

const [traceFile, pattern] = process.argv.slice(2)
if (!traceFile) { console.error("usage: node opt-summary.mjs <trace.txt> [function-regex]"); process.exit(2) }
const select = pattern ? new RegExp(pattern) : undefined
const fns = new Map()
const entry = (name) => { if (!fns.has(name)) { fns.set(name, { tiers: [], deopts: [] }) } return fns.get(name) }
for (const line of readFileSync(traceFile, "utf8").split("\n")) {
  let m
  if ((m = line.match(/completed (?:optimizing|compiling) (?:0x\w+ )?<JSFunction ([^ >]*)[^>]*> \(target (\w+)\)( OSR)?/))) {
    entry(m[1] || "(anonymous)").tiers.push(m[2].replace("TURBOFAN_JS", "TF").replace("TURBOFAN", "TF").replace("MAGLEV", "ML") + (m[3] ? "-OSR" : ""))
  } else if ((m = line.match(/bailout \(kind: ([^,]+), reason: (.*?)\): begin\. deoptimizing (?:0x\w+ )?<JSFunction ([^ >]*)/))) {
    entry(m[3] || "(anonymous)").deopts.push(`${m[1]}: ${m[2]}`)
  }
}
for (const [name, f] of fns) {
  if (select && !select.test(name)) { continue }
  const counts = new Map()
  for (const d of f.deopts) { counts.set(d, (counts.get(d) ?? 0) + 1) }
  const deopts = [...counts].map(([d, n]) => `${d} x${n}`).join("; ")
  console.log(`${name.padEnd(26)} tiers: ${f.tiers.join(",") || "-"}${deopts ? `  | deopts: ${deopts}` : ""}`)
}
