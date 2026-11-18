// Generates every fixture deterministically into bench/fixtures/generated/*.json.
// Every library loads exactly these files, so every cell of the report sees the same input.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import YAML from "yaml"

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(here, "generated")
mkdirSync(out, { recursive: true })

// xorshift32: deterministic pseudo random values
const rng = (seed) => {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 0x100000000
  }
}

const wide = (n, seed) => {
  const r = rng(seed)
  const o = {}
  for (let i = 0; i < n; i++) {
    const t = i % 4
    o[`key_${i}`] = t === 0 ? Math.floor(r() * 1e6) : t === 1 ? `value-${i}-${Math.floor(r() * 1e4)}` : t === 2 ? r() > 0.5 : null
  }
  return o
}

const deep = (levels) => {
  let node = { leaf: true, value: levels }
  for (let i = levels - 1; i >= 0; i--) node = { level: i, name: `level-${i}`, child: node }
  return node
}

const primitives = (n, seed) => {
  const r = rng(seed)
  const a = new Array(n)
  for (let i = 0; i < n; i++) a[i] = i % 3 === 0 ? Math.floor(r() * 1e6) : i % 3 === 1 ? `s${i}` : i % 2 === 0
  return a
}

// Realistic OpenAPI document: the Swagger petstore (fixtures/petstore.yaml) replicated until ~5 MB of JSON.
// Each copy k gets its own path keys (/pet -> /pet_k), schema names (Pet -> Pet_k), rewritten $refs and
// x- extensions on every operation and schema, so that prefix rules have many `x-` keys to hit.
const petstorePath = path.join(here, "petstore.yaml")
const petstore = YAML.parse(readFileSync(petstorePath, "utf8"))

const renameRefs = (value, suffix) => {
  if (Array.isArray(value)) return value.map((v) => renameRefs(v, suffix))
  if (value && typeof value === "object") {
    const o = {}
    for (const k of Object.keys(value)) {
      const v = value[k]
      o[k] = k === "$ref" && typeof v === "string" ? v.replace(/^#\/components\/schemas\/(\w+)$/, `#/components/schemas/$1_${suffix}`) : renameRefs(v, suffix)
    }
    return o
  }
  return value
}

const buildOpenApi = (targetBytes) => {
  const doc = { openapi: petstore.openapi, info: petstore.info, servers: petstore.servers, tags: petstore.tags, paths: {}, components: { schemas: {}, securitySchemes: petstore.components.securitySchemes } }
  let k = 0
  for (;;) {
    for (const [p, item] of Object.entries(petstore.paths)) {
      const copy = renameRefs(item, k)
      for (const op of Object.values(copy)) {
        if (op && typeof op === "object" && !Array.isArray(op)) {
          op["x-copy"] = k
          op["x-rate-limit"] = { burst: k % 10, window: "1m" }
          if (op.operationId) op.operationId = `${op.operationId}_${k}`
        }
      }
      doc.paths[`${p}_${k}`] = copy
    }
    for (const [name, schema] of Object.entries(petstore.components.schemas)) {
      const copy = renameRefs(schema, k)
      copy["x-schema-copy"] = k
      doc.components.schemas[`${name}_${k}`] = copy
    }
    k++
    if (k % 50 === 0 && JSON.stringify(doc).length >= targetBytes) break
  }
  return doc
}

const countNodes = (v) => {
  let n = 0
  const stack = [v]
  while (stack.length) {
    const x = stack.pop()
    n++
    if (x && typeof x === "object") for (const k of Object.keys(x)) stack.push(x[k])
  }
  return n
}

const fixtures = {
  "wide-10k": wide(10_000, 12),
  "deep-5k": deep(5_000),
  "array-100k": primitives(100_000, 13),
  openapi: buildOpenApi(5 * 1024 * 1024),
}

const summary = {}
for (const [name, value] of Object.entries(fixtures)) {
  const json = JSON.stringify(value)
  writeFileSync(path.join(out, `${name}.json`), json)
  summary[name] = { bytes: json.length, nodes: countNodes(value) }
  console.log(`${name.padEnd(12)} ${String(json.length).padStart(9)} bytes ${String(summary[name].nodes).padStart(8)} nodes`)
}
writeFileSync(path.join(out, "summary.json"), JSON.stringify(summary, null, 2))
