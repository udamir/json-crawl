// Every library under test, wrapped so that all libraries of one feature share a call shape. `note` marks semantics
// that differ from json-crawl's; the report prints it as a footnote.
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { isDeepStrictEqual } from "node:util"

const require = createRequire(import.meta.url)

export const current = require("../../dist/index.cjs")
export const previous = require("json-crawl-0.5.3")
export const CURRENT = `json-crawl ${require("../../package.json").version}`
const version = (url) => JSON.parse(readFileSync(new URL(url, import.meta.url), "utf8")).version
export const PREVIOUS = `json-crawl ${version("../node_modules/json-crawl-0.5.3/package.json")}`

const traverseLib = require("traverse")
const { traverse: objectTraversal } = require("object-traversal")
const treeCrawl = require("tree-crawl")
const deepForEach = require("deep-for-each")
const jsonSchemaTraverse = require("json-schema-traverse")
const rfdc = require("rfdc")()
const { klona } = require("klona")
const { klona: klonaJson } = require("klona/json")
const lodashCloneDeep = require("lodash.clonedeep")
const cloneLib = require("clone")
const fastDeepEqual = require("fast-deep-equal")
const { dequal } = require("dequal")
const lodashIsEqual = require("lodash.isequal")
const { deepEqual: fastEquals } = require("fast-equals")
const deepEqualLib = require("deep-equal")

const isObj = (v) => typeof v === "object" && v !== null

// traversal: run(doc, visit) calls visit(value, key, path) once per visited node
export const traversal = {
  [CURRENT]: { run: (doc, visit) => current.syncCrawl(doc, ({ value, key, path }) => visit(value, key, path)) },
  [PREVIOUS]: { run: (doc, visit) => previous.syncCrawl(doc, ({ value, key, path }) => visit(value, key, path)) },
  traverse: {
    run: (doc, visit) => traverseLib(doc).forEach(function (x) { visit(x, this.key, this.path) }),
    note: "path is an array of string keys; recursive",
  },
  "object-traversal": {
    run: (doc, visit) => objectTraversal(doc, ({ value, key, meta }) => visit(value, key, meta.nodePath), { cycleHandling: false }),
    note: "path is a dotted string; cycle handling disabled",
  },
  "deep-for-each": {
    run: (doc, visit) => deepForEach(doc, (value, key, _subject, path) => visit(value, key, path)),
    note: "the root is not visited; path is a string like a.b[0]",
  },
  "tree-crawl": {
    run: (doc, visit) => treeCrawl(doc, (node) => visit(node), { getChildren: (n) => (isObj(n) ? Object.values(n) : []) }),
    note: "generic tree walker: no keys or paths",
  },
  "json-schema-traverse": {
    run: (doc, visit) => jsonSchemaTraverse(doc, { allKeys: true }, (schema, ptr) => visit(schema, undefined, ptr)),
    note: "visits sub-schema objects only, never primitives",
  },
}

// asynchronous traversal: only json-crawl offers it
export const asyncTraversal = {
  [CURRENT]: { run: (doc, visit) => current.crawl(doc, ({ value, key, path }) => visit(value, key, path)) },
  [PREVIOUS]: { run: (doc, visit) => previous.crawl(doc, ({ value, key, path }) => visit(value, key, path)) },
}

// clone: run(doc) returns a deep copy
export const clone = {
  [CURRENT]: { run: (doc) => current.syncClone(doc) },
  [`${CURRENT} tree`]: { run: (doc) => current.syncClone(doc, [], { circular: false }), note: "circular: false (no cycle or shared-reference tracking)" },
  [PREVIOUS]: { run: (doc) => previous.syncClone(doc) },
  rfdc: { run: rfdc, note: "no cycle handling" },
  klona: { run: klona, note: "no cycle handling" },
  "klona/json": { run: klonaJson, note: "JSON values only; no cycle handling" },
  "lodash.clonedeep": { run: lodashCloneDeep },
  clone: { run: (doc) => cloneLib(doc) },
  structuredClone: { run: (doc) => structuredClone(doc), note: "built-in" },
  "JSON.parse(JSON.stringify())": { run: (doc) => JSON.parse(JSON.stringify(doc)), note: "built-in; throws on cycles" },
}

// transforming clone: run(doc) returns a deep copy with every number doubled
const doubleNumbers = ({ value }) => (typeof value === "number" ? { value: value * 2 } : undefined)
export const cloneTransform = {
  [CURRENT]: { run: (doc) => current.syncClone(doc, doubleNumbers) },
  [PREVIOUS]: { run: (doc) => previous.syncClone(doc, doubleNumbers) },
  "traverse map": {
    run: (doc) => traverseLib(doc).map(function (x) { if (typeof x === "number") this.update(x * 2) }),
    note: "traverse(doc).map with this.update",
  },
  "rfdc + traverse update": {
    run: (doc) => {
      const copy = rfdc(doc)
      traverseLib(copy).forEach(function (x) { if (typeof x === "number") this.update(x * 2) })
      return copy
    },
    note: "two passes: rfdc copy, then an in-place traverse update",
  },
  "JSON.parse reviver": {
    run: (doc) => JSON.parse(JSON.stringify(doc), (_key, value) => (typeof value === "number" ? value * 2 : value)),
    note: "built-in; serializes the document first",
  },
}

// equal: run(a, b) returns a boolean
export const equal = {
  [CURRENT]: { run: (a, b) => current.equal(a, b) },
  [PREVIOUS]: { run: (a, b) => previous.equal(a, b) },
  "fast-deep-equal": { run: fastDeepEqual, note: "no cycle handling" },
  dequal: { run: dequal, note: "no cycle handling" },
  "fast-equals": { run: fastEquals, note: "deepEqual; no cycle handling" },
  "lodash.isequal": { run: lodashIsEqual },
  "deep-equal": { run: (a, b) => deepEqualLib(a, b, { strict: true }), note: "strict mode" },
  "util.isDeepStrictEqual": { run: isDeepStrictEqual, note: "built-in" },
}
