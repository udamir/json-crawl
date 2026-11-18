// Lists inline-cache sites that went polymorphic (P) or megamorphic (N) in the code under test.
//   node --log-ic --logfile=v8.log --no-logfile-per-isolate <your-driver.mjs>
//   node ic-summary.mjs v8.log <file-substring> [source-file-for-line-text] [states, default "PN"]
// <file-substring> selects the functions to report: it is matched against V8's code names, which contain the script
// URL (e.g. "dist/index.mjs"). IC state letters: 0 uninitialized, 1 monomorphic, P polymorphic, N megamorphic,
// G generic, ^ recompute handler. A site whose history ends in N with many maps is a megamorphic access.
import { readFileSync } from "node:fs"

const [logFile, filter, sourceFile, wanted = "PN"] = process.argv.slice(2)
if (!logFile || !filter) { console.error("usage: node ic-summary.mjs <v8.log> <file-substring> [source-file] [states]"); process.exit(2) }
const sourceLines = sourceFile ? readFileSync(sourceFile, "utf8").split("\n") : []

const parseCsv = (line) => {
  const out = []
  let cur = ""
  let quoted = false
  for (const ch of line) {
    if (ch === '"') { quoted = !quoted } else if (ch === "," && !quoted) { out.push(cur); cur = "" } else { cur += ch }
  }
  out.push(cur)
  return out
}

const codes = []
const sites = new Map()
for (const line of readFileSync(logFile, "utf8").split("\n")) {
  if (line.startsWith("code-creation,")) {
    const f = parseCsv(line)
    codes.push({ addr: parseInt(f[4], 16), size: +f[5], name: f[6] })
    continue
  }
  if (!/^\w*IC,/.test(line)) { continue }
  const f = parseCsv(line)
  const pc = parseInt(f[1], 16)
  let fn
  for (let i = codes.length - 1; i >= 0; i--) {
    const c = codes[i]
    if (pc >= c.addr && pc < c.addr + c.size) { fn = c.name; break }
  }
  if (!fn || !fn.includes(filter)) { continue }
  // IC line: type, pc, time, line, column, old state, new state, map, key, modifier, slow reason
  const key = `${f[3]}:${f[4]} ${f[0]} .${f[8]}`
  if (!sites.has(key)) { sites.set(key, { fn: fn.split(" ")[0], line: +f[3], states: [], maps: new Set(), reasons: new Set() }) }
  const site = sites.get(key)
  site.states.push(f[6])
  site.maps.add(f[7])
  if (f[10]) { site.reasons.add(f[10]) }
}

const rows = [...sites.entries()].sort((a, b) => a[1].line - b[1].line)
let shown = 0
for (const [key, s] of rows) {
  if (!s.states.some((x) => wanted.includes(x))) { continue }
  shown++
  const text = (sourceLines[s.line - 1] ?? "").trim().slice(0, 90)
  console.log(`${key.padEnd(44)} in ${s.fn.padEnd(20)} ${s.states.slice(0, 12).join(">")}${s.states.length > 12 ? ">…" : ""} maps=${s.maps.size} ${[...s.reasons].join("|")}${text ? `  :: ${text}` : ""}`)
}
console.log(`\n${shown} of ${sites.size} IC sites in "${filter}" reached ${wanted.split("").join("/")}.`)
