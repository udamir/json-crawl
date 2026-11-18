// Runs every benchmark case and writes results/results.json and README.md.
// Each case is checked for correctness once before it is timed; a library that throws (e.g. a stack overflow on the
// deep fixture) or returns a wrong result is reported with the error instead of a time.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import * as lib from "./lib/libraries.mjs"
import { fmtMs, runCases, RUNS, WARMUP } from "./lib/harness.mjs"
import { verifyCycleFlags } from "./lib/cycles.mjs"

const { CURRENT, PREVIOUS, current } = lib
const read = (url) => JSON.parse(readFileSync(new URL(url, import.meta.url), "utf8"))
const summary = read("./fixtures/generated/summary.json")
const fixtures = Object.fromEntries(Object.keys(summary).map((name) => [name, read(`./fixtures/generated/${name}.json`)]))

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
      cases.push({ case: section, fixture, library, note: adapter.note, cycles: adapter.cycles, ...make(fixtures[fixture], adapter, library, fixture) })
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
const ruleCounts = {}
const ruleCrawl = (crawl, rules) => {
  let n = 0
  crawl(fixtures.openapi, ({ rules, state }) => { if (rules?.kind) { n++ } return { state: { ...state } } }, { state: {}, rules })
  return n
}
for (const [library, l] of [[CURRENT, lib.current], [PREVIOUS, lib.previous]]) {
  cases.push({
    case: "rules", fixture: "openapi", library, cycles: false,
    check: () => { ruleCounts[library] = ruleCrawl(l.syncCrawl, openApiRules); assert(ruleCounts[library] === ruleCounts[CURRENT], "rule matches differ") },
    fn: () => ruleCrawl(l.syncCrawl, openApiRules),
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
const expectedExt = extCount(lib.current.syncCrawl, prefixRules)
cases.push(
  { case: "prefix rules", fixture: "openapi", library: CURRENT, cycles: false, note: "\"/x-*\" prefix rule", check: () => assert(expectedExt > 0, "no extension matched"), fn: () => extCount(lib.current.syncCrawl, prefixRules) },
  { case: "prefix rules", fixture: "openapi", library: PREVIOUS, cycles: false, note: "no prefix rules: emulated with a /* function rule", check: () => assert(extCount(lib.previous.syncCrawl, emulatedRules) === expectedExt, "extension matches differ"), fn: () => extCount(lib.previous.syncCrawl, emulatedRules) },
)

// every adapter's cycle-support flag decides its table, so it is checked against real behaviour first
const cycleChecks = await verifyCycleFlags(lib, ["traversal", "asyncTraversal", "clone", "cloneTransform", "equal"])
console.log(`cycle support verified for ${cycleChecks.length} adapters (${cycleChecks.filter((r) => r.handled).length} handle cycles)`)
console.log(`${cases.length} cells`)
const startedAt = new Date()
const results = await runCases(cases)
mkdirSync(new URL("./results/", import.meta.url), { recursive: true })
writeFileSync(new URL("./results/results.json", import.meta.url), JSON.stringify({ startedAt, results }, null, 2))

// ----------------------------------------------------------------------------------------------------------------
// report
// ----------------------------------------------------------------------------------------------------------------
const versionOf = (name) => read(`./node_modules/${name}/package.json`).version
const peerPackages = ["traverse", "object-traversal", "deep-for-each", "tree-crawl", "json-schema-traverse", "rfdc", "klona", "lodash.clonedeep", "clone", "fast-deep-equal", "dequal", "fast-equals", "lodash.isequal", "deep-equal"]
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
const tables = (section, title) => {
  const groups = [...new Set(results.filter((r) => r.case === section).map((r) => r.cycles))]
  if (groups.length < 2) { return table(section, title) }
  return [
    table(section, `${title}, libraries that handle cycles`, true),
    table(section, `${title}, libraries without cycle support (tree input only)`, false),
  ].join("\n\n")
}

const cpu = os.cpus()[0]?.model ?? "unknown"
const report = `# json-crawl benchmark

${CURRENT} compared with the previous release (${PREVIOUS}) and with popular npm libraries that cover one of its features: traversal, deep clone, deep equality and transformation. Everything below is produced by the scripts in this directory.

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
| ${PREVIOUS} | npm release |
${peerPackages.map((p) => `| ${p} | ${versionOf(p)} |`).join("\n")}

## Method

Fixtures are generated deterministically by \`fixtures/generate.mjs\`: \`wide-10k\` is a flat object of 10 000 primitives, \`deep-5k\` a chain of 5 000 nested objects (\`{ level, name, child }\`), \`array-100k\` a flat array of 100 000 primitives, and \`openapi\` the Swagger petstore replicated into a ${(summary.openapi.bytes / 2 ** 20).toFixed(1)} MB OpenAPI document with \`$ref\`s and \`x-\` extensions. Every cell is checked once for correctness (node counts for json-crawl, copies compared with the source, \`true\` for equal documents and \`false\` for documents that differ in their last leaf), then warmed up for ${WARMUP} iterations and timed for ${RUNS} runs; tables show the median and the minimum. Cells marked † took more than 0.5 s per iteration and ran with a shortened warm-up. Traversal hooks are empty, so the times are the cost of the walk itself. Libraries whose semantics differ from json-crawl's are footnoted.

Libraries that handle cyclic input and libraries that do not are compared in separate tables: handling cycles means tracking every visited object, which is work the others skip, so a cycle-safe library is only compared with other cycle-safe ones. A library "handles cycles" when, on a small cyclic document, its traversal terminates, its clone reproduces the cycle in the copy, or its equality returns \`true\` for two equal cyclic documents and \`false\` for different ones; the harness checks this for every library in a worker with a time and memory limit before timing anything, and stops if a declared group does not match. json-crawl appears in both groups where it has both modes: \`syncCrawl\` without and with \`circular: true\`, \`syncClone\` with its default reference tracking and with \`circular: false\`. Its \`equal\` always handles cycles, so it is only in the cycle-safe table.

## Results

### Traversal

${tables("traversal", "sync traversal, empty visitor")}

${tables("async traversal", "async traversal (crawl), sync visitor")}

### Clone

${tables("clone", "deep clone")}

${tables("transforming clone", "deep clone that doubles every number")}

### Equality

${tables("equal", "deep equality of two equal documents")}

### Rules (json-crawl only)

${tables("rules", "OpenAPI rule tree with function rules, state copied per node")}

${tables("prefix rules", "x- extension rule at every depth")}
`
writeFileSync(new URL("./README.md", import.meta.url), report)
console.log("wrote README.md")
