// Child process of compare.mjs and alloc.mjs: loads one build of the code under test and one bench file, runs the cases.
//   node runner.mjs <module-under-test> <bench-file> <iterations> [case-substring]
// The bench file default-exports `async (lib) => ({ "case name": () => work(), ... })`; `lib` is the imported module.
// Prints one JSON line: { "case name": [ms, ms, ...], ... } (every iteration, warm-up included; the caller drops it).
import { pathToFileURL } from "node:url"
import { resolve } from "node:path"

export const loadCases = async (libPath, benchPath, filter) => {
  const lib = await import(pathToFileURL(resolve(libPath)).href)
  const setup = (await import(pathToFileURL(resolve(benchPath)).href)).default
  const cases = await setup(lib)
  return Object.entries(cases).filter(([name]) => !filter || name.includes(filter))
}

const isMain = import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const [libPath, benchPath, iterations = "25", filter] = process.argv.slice(2)
  const out = {}
  for (const [name, fn] of await loadCases(libPath, benchPath, filter)) {
    const samples = []
    for (let i = 0; i < +iterations; i++) {
      const t = performance.now()
      const r = fn()
      if (r && typeof r.then === "function") { await r }
      samples.push(performance.now() - t)
    }
    out[name] = samples
  }
  process.stdout.write(JSON.stringify(out) + "\n")
}
