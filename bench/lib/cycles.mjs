// Verifies the `cycles` flag of every adapter: each runs on a cyclic document in a worker with a time and memory limit,
// so an adapter that loops forever or overflows counts as "no cycle support" instead of hanging the benchmark.
import { Worker } from "node:worker_threads"

const TIMEOUT_MS = 4000

const probe = (section, name) => new Promise((resolve) => {
  const worker = new Worker(new URL("./cycle-worker.mjs", import.meta.url), { workerData: { section, name }, resourceLimits: { maxOldGenerationSizeMb: 256 } })
  const done = (result) => { clearTimeout(timer); worker.terminate(); resolve(result) }
  const timer = setTimeout(() => done({ handled: false, detail: "did not finish (loops on the cycle)" }), TIMEOUT_MS)
  worker.on("message", done)
  worker.on("error", (e) => done({ handled: false, detail: String(e.message).split("\n")[0] }))
})

export const verifyCycleFlags = async (libraries, sections) => {
  const jobs = []
  for (const section of sections) {
    for (const [name, adapter] of Object.entries(libraries[section])) {
      jobs.push(probe(section, name).then((r) => ({ section, name, declared: adapter.cycles, ...r })))
    }
  }
  const results = await Promise.all(jobs)
  const wrong = results.filter((r) => r.handled !== r.declared)
  if (wrong.length) {
    throw new Error(`cycle support flags do not match behaviour:\n${wrong.map((r) => `  ${r.section} / ${r.name}: declared ${r.declared}, handled ${r.handled} ${r.detail}`).join("\n")}`)
  }
  return results
}
