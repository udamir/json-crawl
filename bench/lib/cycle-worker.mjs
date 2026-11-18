// Worker of cycles.mjs: runs one adapter on a small cyclic document and reports whether it handled the cycle.
import { parentPort, workerData } from "node:worker_threads"
import * as libraries from "./libraries.mjs"

const { section, name } = workerData
const cyclic = (n) => {
  const doc = { n, list: [1, { m: 2 }], child: { m: 2 } }
  doc.child.parent = doc
  doc.list.push(doc)
  return doc
}
const check = {
  traversal: async (run) => { await run(cyclic(1), () => {}); return true },
  asyncTraversal: async (run) => { await run(cyclic(1), () => {}); return true },
  clone: (run) => { const doc = cyclic(1); const copy = run(doc); return copy !== doc && copy.child.parent === copy && copy.list[2] === copy },
  cloneTransform: (run) => { const doc = cyclic(1); const copy = run(doc); return copy !== doc && copy.child.parent === copy && copy.list[2] === copy && copy.n === 2 },
  equal: (run) => run(cyclic(1), cyclic(1)) === true && run(cyclic(1), cyclic(2)) === false,
}
try {
  parentPort.postMessage({ handled: await check[section](libraries[section][name].run), detail: "" })
} catch (e) {
  parentPort.postMessage({ handled: false, detail: `${e.constructor.name}: ${String(e.message).split("\n")[0]}` })
}
