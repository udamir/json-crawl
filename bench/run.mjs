// Runs every benchmark case and writes results/results.json and README.md.
// Every cell (case x fixture x library) runs in its own fresh process (`node run.mjs --cell <index>`), which loads only
// the fixture it needs: cells measured in one process influence each other (enum caches built by one library speed up
// the next, allocation decisions made on a deep document slow down later crawls). Each cell is checked for correctness
// once before it is timed; a library that throws (e.g. a stack overflow on the deep fixture) or returns a wrong result
// is reported with the error instead of a time.
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import * as lib from "./lib/libraries.mjs"
import { fmtMs, runCases, RUNS, WARMUP } from "./lib/harness.mjs"
import { verifyCycleFlags } from "./lib/cycles.mjs"

const { CURRENT, RELEASE, PREVIOUS, current } = lib
const read = (url) => JSON.parse(readFileSync(new URL(url, import.meta.url), "utf8"))
const summary = read("./fixtures/generated/summary.json")
// fixtures are parsed on first use, so that a cell's process holds only the document it measures
const loaded = {}
const fixtures = new Proxy(loaded, { get: (cache, name) => (cache[name] ??= read(`./fixtures/generated/${String(name)}.json`)) })

const assert = (ok, message) => { if (!ok) { throw new Error(message) } }
const isObj = (v) => typeof v === "object" && v !== null

// a copy of `doc` whose last leaf (in key order) differs, so that a correct equal has to walk the whole document
const mutateLast = (doc) => {
  const copy = current.syncClone(doc)
  let parent = copy
  let key
  for (;;) {
    const keys = Object.keys(parent)
    key = keys[keys.length - 1]
    if (!isObj(parent[key])) { break }
    parent = parent[key]
  }
  parent[key] = typeof parent[key] === "number" ? parent[key] + 1 : `${parent[key]}!`
  return copy
}

const cases = []
const add = (section, fixtureNames, libraries, make) => {
  for (const fixture of fixtureNames) {
    for (const [library, adapter] of Object.entries(libraries)) {
      cases.push({ case: section, fixture, library, note: adapter.note, cycles: adapter.cycles, make: () => make(fixtures[fixture], adapter, library, fixture) })
    }
  }
}

const ALL = ["wide-10k", "deep-5k", "array-100k", "openapi"]
const isCrawl = (library) => library.startsWith("json-crawl")

// traversal: json-crawl must visit every node; peers with other semantics are reported with their own count
add("traversal", ALL, lib.traversal, (doc, a, library, fixture) => ({
  check: () => {
    let n = 0
    a.run(doc, () => { n++ })
    if (isCrawl(library)) { assert(n === summary[fixture].nodes, `visited ${n} of ${summary[fixture].nodes} nodes`) }
  },
  fn: () => a.run(doc, () => {}),
}))

add("async traversal", ["wide-10k", "openapi"], lib.asyncTraversal, (doc, a, _library, fixture) => ({
  check: async () => {
    let n = 0
    await a.run(doc, () => { n++ })
    assert(n === summary[fixture].nodes, `visited ${n} of ${summary[fixture].nodes} nodes`)
  },
  fn: () => a.run(doc, () => {}),
}))

add("clone", ALL, lib.clone, (doc, a) => ({
  check: () => {
    const copy = a.run(doc)
    assert(copy !== doc && current.equal(copy, doc), "the copy differs from the source")
  },
  fn: () => a.run(doc),
}))

const doubled = (doc) => JSON.parse(JSON.stringify(doc), (_key, value) => (typeof value === "number" ? value * 2 : value))
add("transforming clone", ["array-100k", "openapi"], lib.cloneTransform, (doc, a) => ({
  check: () => assert(current.equal(a.run(doc), doubled(doc)), "numbers are not doubled"),
  fn: () => a.run(doc),
}))

const copies = new Map()
const copiesOf = (fixture) => {
  if (!copies.has(fixture)) { copies.set(fixture, { same: current.syncClone(fixtures[fixture]), changed: mutateLast(fixtures[fixture]) }) }
  return copies.get(fixture)
}
add("equal", ALL, lib.equal, (doc, a, _library, fixture) => ({
  check: () => {
    const { same, changed } = copiesOf(fixture)
    assert(a.run(doc, same) === true, "equal documents compare as different")
    assert(a.run(doc, changed) === false, "different documents compare as equal")
  },
  fn: () => a.run(doc, copiesOf(fixture).same),
}))

// rules (json-crawl only): an OpenAPI-shaped rule tree with exact keys, /* and lazy function rules; the hook reads the
// node rules and returns a fresh state per node
const schemaRules = () => ({ kind: "schema", "/properties": { "/*": schemaRules }, "/items": schemaRules, "/*": { kind: "keyword" } })
const operationRules = {
  kind: "operation",
  "/parameters": { "/*": { kind: "parameter", "/schema": schemaRules } },
  "/requestBody": { "/content": { "/*": { "/schema": schemaRules } } },
  "/responses": { "/*": { kind: "response", "/content": { "/*": { "/schema": schemaRules } } } },
  "/*": { kind: "operation-field" },
}
const openApiRules = { "/paths": { "/*": { "/*": operationRules } }, "/components": { "/schemas": { "/*": schemaRules } }, "/**": { any: true } }
const ruleCrawl = (crawl, rules) => {
  let n = 0
  crawl(fixtures.openapi, ({ rules, state }) => { if (rules?.kind) { n++ } return { state: { ...state } } }, { state: {}, rules })
  return n
}
for (const [library, l] of [[CURRENT, lib.current], [RELEASE, lib.release], [PREVIOUS, lib.previous]]) {
  cases.push({
    case: "rules", fixture: "openapi", library, cycles: false,
    make: () => ({
      check: () => {
        const n = ruleCrawl(l.syncCrawl, openApiRules)
        assert(n > 0 && n === ruleCrawl(lib.current.syncCrawl, openApiRules), "rule matches differ")
      },
      fn: () => ruleCrawl(l.syncCrawl, openApiRules),
    }),
  })
}

// prefix rules: x- extensions at every depth. 1.0.0 uses a prefix rule, 0.5.3 has none and needs a /* function rule
const ext = { kind: "extension" }
const prefixRules = { "/**": { "/x-*": ext } }
const emulatedRules = { "/**": { "/*": ({ key }) => (typeof key === "string" && key.startsWith("x-") ? ext : undefined) } }
const extCount = (crawl, rules) => {
  let n = 0
  crawl(fixtures.openapi, ({ rules }) => { if (rules?.kind) { n++ } }, { rules })
  return n
}
cases.push(
  { case: "prefix rules", fixture: "openapi", library: CURRENT, cycles: false, note: "\"/x-*\" prefix rule", make: () => ({ check: () => assert(extCount(lib.current.syncCrawl, prefixRules) > 0, "no extension matched"), fn: () => extCount(lib.current.syncCrawl, prefixRules) }) },
  { case: "prefix rules", fixture: "openapi", library: RELEASE, cycles: false, note: "\"/x-*\" prefix rule", make: () => ({ check: () => assert(extCount(lib.release.syncCrawl, prefixRules) === extCount(lib.current.syncCrawl, prefixRules), "extension matches differ"), fn: () => extCount(lib.release.syncCrawl, prefixRules) }) },
  { case: "prefix rules", fixture: "openapi", library: PREVIOUS, cycles: false, note: "no prefix rules: emulated with a /* function rule", make: () => ({ check: () => assert(extCount(lib.previous.syncCrawl, emulatedRules) === extCount(lib.current.syncCrawl, prefixRules), "extension matches differ"), fn: () => extCount(lib.previous.syncCrawl, emulatedRules) }) },
)

// hook patterns (json-crawl only, this build and the last release): what hooks commonly return or need, on every node
const exitOnly = () => ({ exitHook: noopExit })
function noopExit() {}
const stateOf = ({ value, state }) => (isObj(value) ? { state: { parent: value, depth: state.depth + 1 } } : undefined)
const stateAndExitOf = ({ value, state }) => (isObj(value) ? { state: { parent: value, depth: state.depth + 1 }, exitHook: noopExit } : undefined)
const mergedGlobalRules = [{ "/**": { a: 1 } }, { "/**": { b: 1 } }]
const patterns = [
  {
    case: "exit hook on every node",
    fixtures: ["deep-5k", "openapi"],
    run: (l, doc) => { let n = 0; l.syncCrawl(doc, () => { n++; return exitOnly() }); return n },
  },
  {
    case: "state per container",
    fixtures: ["deep-5k", "openapi"],
    run: (l, doc) => { let n = 0; l.syncCrawl(doc, (ctx) => { n++; return stateOf(ctx) }, { state: { parent: undefined, depth: 0 } }); return n },
  },
  {
    case: "state and exit hook per container",
    fixtures: ["deep-5k", "openapi"],
    run: (l, doc) => { let n = 0; l.syncCrawl(doc, (ctx) => { n++; return stateAndExitOf(ctx) }, { state: { parent: undefined, depth: 0 } }); return n },
  },
  {
    case: "parent of every node",
    fixtures: ["deep-5k", "openapi"],
    // 1.1 hands out ctx.parent; earlier releases need the parent passed down as state
    run: (l, doc, library) => {
      let n = 0
      if (library === CURRENT) {
        l.syncCrawl(doc, ({ parent }) => { if (parent !== undefined) { n++ } })
      } else {
        l.syncCrawl(doc, (ctx) => { if (ctx.state.parent !== undefined) { n++ } return isObj(ctx.value) ? { state: { parent: ctx.value } } : undefined }, { state: { parent: undefined } })
      }
      return n + 1
    },
    note: (library) => (library === CURRENT ? "ctx.parent" : "the parent passed down as state (no ctx.parent)"),
  },
  {
    case: "two merged /** rule sets",
    fixtures: ["openapi"],
    run: (l, doc) => { let n = 0; l.syncCrawl(doc, ({ rules }) => { if (rules?.a && rules?.b) { n++ } }, { rules: mergedGlobalRules }); return n + 1 },
  },
  {
    case: "transform, sync hook",
    fixtures: ["openapi"],
    // a no-op hook: the document is crawled and written back unchanged
    run: async (l, doc) => { let n = 0; await l.transform(doc, () => { n++ }); return n },
  },
]
for (const p of patterns) {
  for (const fixture of p.fixtures) {
    for (const [library, l] of [[CURRENT, lib.current], [RELEASE, lib.release]]) {
      cases.push({
        case: p.case, fixture, library, cycles: false, note: p.note?.(library),
        make: () => ({
          check: async () => assert(await p.run(l, fixtures[fixture], library) === summary[fixture].nodes, `${p.case}: not every node was counted`),
          fn: () => p.run(l, fixtures[fixture], library),
        }),
      })
    }
  }
}

// child mode: measure one cell and print its result row
const cellFlag = process.argv.indexOf("--cell")
if (cellFlag >= 0) {
  const cell = cases[+process.argv[cellFlag + 1]]
  const { make, ...meta } = cell
  const [row] = await runCases([{ ...meta, ...make() }], () => {})
  process.stdout.write(JSON.stringify(row) + "\n")
  process.exit(0)
}

// every adapter's cycle-support flag decides its table, so it is checked against real behaviour first
const cycleChecks = await verifyCycleFlags(lib, ["traversal", "asyncTraversal", "clone", "cloneTransform", "equal"])
console.log(`cycle support verified for ${cycleChecks.length} adapters (${cycleChecks.filter((r) => r.handled).length} handle cycles)`)
console.log(`${cases.length} cells, one fresh process each`)
const startedAt = new Date()
const self = fileURLToPath(import.meta.url)
const results = []
for (let i = 0; i < cases.length; i++) {
  const { case: name, fixture, library } = cases[i]
  let row
  try {
    const out = execFileSync(process.execPath, [...process.execArgv, self, "--cell", String(i)], { encoding: "utf8", maxBuffer: 1 << 26, env: process.env })
    row = JSON.parse(out.trim().split("\n").pop())
  } catch (e) {
    // a crash of the whole process (e.g. out of memory) is a result too
    row = { case: name, fixture, library, note: cases[i].note, cycles: cases[i].cycles, status: "error", error: `process failed: ${String(e.message).split("\n")[0]}` }
  }
  results.push(row)
  console.log(`  ${name} | ${fixture} | ${library}: ${row.status === "ok" ? `median ${fmtMs(row.median)} ms, min ${fmtMs(row.min)} ms${row.truncated ? " (truncated)" : ""}` : `ERROR ${row.error}`}`)
}
mkdirSync(new URL("./results/", import.meta.url), { recursive: true })
writeFileSync(new URL("./results/results.json", import.meta.url), JSON.stringify({ startedAt, results }, null, 2))

// ----------------------------------------------------------------------------------------------------------------
// report
// ----------------------------------------------------------------------------------------------------------------
const versionOf = (name) => read(`./node_modules/${name}/package.json`).version
const peerPackages = ["traverse", "object-traversal", "deep-for-each", "tree-crawl", "json-schema-traverse", "rfdc", "klona", "lodash.clonedeep", "clone", "fast-equals", "lodash.isequal", "deep-equal"]
const fmt = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : fmtMs(ms))
const nodes = (n) => n.toLocaleString("en-US")

const table = (section, title, cycles) => {
  const rows = results.filter((r) => r.case === section && (cycles === undefined || r.cycles === cycles))
  const libraries = [...new Set(rows.map((r) => r.library))]
  const fixtureNames = [...new Set(rows.map((r) => r.fixture))]
  const notes = []
  const footnote = (text) => {
    let i = notes.indexOf(text)
    if (i < 0) { notes.push(text); i = notes.length - 1 }
    return `[${i + 1}]`
  }
  const header = libraries.map((l) => {
    const note = rows.find((r) => r.library === l && r.note)?.note
    return note ? `${l} ${footnote(`${l}: ${note}`)}` : l
  })
  const lines = [`**${title}**, median / min ms (lower is better)`, "", `| fixture | ${header.join(" | ")} |`, `|---|${libraries.map(() => "---").join("|")}|`]
  for (const f of fixtureNames) {
    const cells = libraries.map((l) => {
      const r = rows.find((x) => x.library === l && x.fixture === f)
      if (!r) { return "" }
      if (r.status !== "ok") { return `— ${footnote(`${l} on ${f}: ${r.error}`)}` }
      return `${fmt(r.median)} / ${fmt(r.min)}${r.truncated ? " †" : ""}`
    })
    lines.push(`| ${f} (${nodes(summary[f].nodes)} nodes) | ${cells.join(" | ")} |`)
  }
  if (notes.length) { lines.push("", notes.map((n, i) => `[${i + 1}] ${n}`).join("  \n")) }
  return lines.join("\n")
}

// one table per group: libraries that handle cyclic input track visited objects, the others do not, so they are never
// compared in the same table
// a group without a column for this build says nothing about this library, so it is left out (equal always handles
// cycles, so equality has no tree-only table)
const tables = (section, title) => {
  const rows = results.filter((r) => r.case === section)
  const groups = [true, false].filter((cycles) => rows.some((r) => r.cycles === cycles && r.library.startsWith(CURRENT)))
  if (groups.length === 1 && rows.every((r) => r.cycles === groups[0])) { return table(section, title) }
  return groups.map((cycles) => table(section, `${title}, ${cycles ? "libraries that handle cycles" : "libraries without cycle support (tree input only)"}`, cycles)).join("\n\n")
}

const cpu = os.cpus()[0]?.model ?? "unknown"
const report = `# json-crawl benchmark

${CURRENT} compared with the last 0.x release (${PREVIOUS}) and with popular npm libraries that cover one of its features: traversal, deep clone, deep equality and transformation, and with the last release (${RELEASE}) on async traversal, rules and the hook patterns that changed since. Everything below is produced by the scripts in this directory.

## Run it

\`\`\`sh
pnpm install
pnpm run all        # builds the library (pnpm build in the repository root), generates the fixtures, runs every case and rewrites this file
\`\`\`

## Environment

| item | value |
|---|---|
| Node | ${process.version} |
| CPU | ${cpu}, ${os.cpus().length} logical cores, ${Math.round(os.totalmem() / 2 ** 30)} GB RAM |
| OS | ${os.type()} ${os.release()} (${process.platform} ${process.arch}) |
| Date | ${startedAt.toISOString()} |

| library | version |
|---|---|
| ${CURRENT} | this repository, \`dist/index.cjs\` built by \`vp pack\` |
| ${RELEASE} | npm release |
| ${PREVIOUS} | npm release |
${peerPackages.map((p) => `| ${p} | ${versionOf(p)} |`).join("\n")}

## Method

Fixtures are generated deterministically by \`fixtures/generate.mjs\`: \`wide-10k\` is a flat object of 10 000 primitives, \`deep-5k\` a chain of 5 000 nested objects (\`{ level, name, child }\`), \`array-100k\` a flat array of 100 000 primitives, and \`openapi\` the Swagger petstore replicated into a ${(summary.openapi.bytes / 2 ** 20).toFixed(1)} MB OpenAPI document with \`$ref\`s and \`x-\` extensions. Every cell (one library on one fixture) runs in its own fresh Node process that loads only that fixture, because cells measured in one process influence each other: one library building V8's enum caches for the document speeds up the next one, and a deep document measured earlier can slow down later crawls by 20% or more. Every cell is checked once for correctness (node counts for json-crawl, copies compared with the source, \`true\` for equal documents and \`false\` for documents that differ in their last leaf), then warmed up for ${WARMUP} iterations and timed for ${RUNS} runs; tables show the median and the minimum. Cells marked † took more than 0.5 s per iteration and ran with a shortened warm-up. The traversal visitor reads only the value and the key, so the times are the cost of the walk itself. Reading the path is not benchmarked: libraries represent it differently (json-crawl and traverse hand out arrays of keys, object-traversal and deep-for-each strings), and a string path looks almost free in a benchmark only because V8 concatenates strings without copying and defers the copy to the first real use of the content, which a benchmark visitor does not reproduce. Libraries whose semantics differ from json-crawl's are footnoted.

Libraries that handle cyclic input and libraries that do not are compared in separate tables: handling cycles means tracking every visited object, which is work the others skip, so a cycle-safe library is only compared with other cycle-safe ones. A library "handles cycles" when, on a small cyclic document, its traversal terminates, its clone reproduces the cycle in the copy, or its equality returns \`true\` for two equal cyclic documents and \`false\` for different ones; the harness checks this for every library in a worker with a time and memory limit before timing anything, and stops if a declared group does not match. json-crawl appears in both groups where it has both modes: \`syncCrawl\` without and with \`circular: true\`, \`syncClone\` with its default reference tracking and with \`circular: false\`. Its \`equal\` always handles cycles, so equality has only the cycle-safe table; groups without a ${CURRENT} column are not reported.

## Results

### Traversal

${tables("traversal", "sync traversal, the visitor reads value and key")}

${tables("async traversal", "async traversal (crawl), sync visitor")}

### Clone

${tables("clone", "deep clone")}

${tables("transforming clone", "deep clone that doubles every number")}

### Equality

${tables("equal", "deep equality of two equal documents")}

### Rules (json-crawl only)

${tables("rules", "OpenAPI rule tree with function rules, state copied per node")}

${tables("prefix rules", "x- extension rule at every depth")}

### Hook patterns (json-crawl only)

What hooks commonly return or need, compared with the last release. Every hook counts the nodes it sees, and every cell is checked to have seen all of them.

${tables("exit hook on every node", "the hook returns an exit hook for every node")}

${tables("state per container", "the hook returns a new state for every container")}

${tables("state and exit hook per container", "the hook returns a new state and an exit hook for every container")}

${tables("parent of every node", "the hook needs the parent of every node")}

${tables("two merged /** rule sets", "rules: [{ \"/**\": { a: 1 } }, { \"/**\": { b: 1 } }], the hook reads the merged rules")}

${tables("transform, sync hook", "transform with a synchronous no-op hook")}
`
writeFileSync(new URL("./README.md", import.meta.url), report)
console.log("wrote README.md")
