// Every library under test, wrapped so that all libraries of one feature share a call shape. `note` marks semantics
// that differ from json-crawl's; the report prints it as a footnote. `cycles` says whether the call handles cyclic
// input (traversal terminates; clone reproduces the cycle in the copy; equal compares cyclic documents correctly).
// Libraries with and without cycle support are reported in separate tables, because tracking visited objects is work
// the others skip; run.mjs verifies every `cycles` flag on a cyclic document before timing anything.
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
const { deepEqual: fastEquals, circularDeepEqual: fastEqualsCircular } = require("fast-equals")
const rfdcCircles = require("rfdc")({ circles: true })
const deepEqualLib = require("deep-equal")

const isObj = (v) => typeof v === "object" && v !== null

// traversal: run(doc, visit) calls visit(value, key, path) once per visited node
export const traversal = {
  [CURRENT]: { cycles: false, run: (doc, visit) => current.syncCrawl(doc, ({ value, key, path }) => visit(value, key, path)) },
  [`${CURRENT} circular`]: {
    cycles: true,
    run: (doc, visit) => current.syncCrawl(doc, ({ value, key, path }) => visit(value, key, path), { circular: true }),
    note: "circular: true (a node whose value is an ancestor is visited, its children are not)",
  },
  [PREVIOUS]: { cycles: false, run: (doc, visit) => previous.syncCrawl(doc, ({ value, key, path }) => visit(value, key, path)) },
  traverse: {
    cycles: true,
    run: (doc, visit) => traverseLib(doc).forEach(function (x) { visit(x, this.key, this.path) }),
    note: "path is an array of string keys; recursive; cycle detection always on",
  },
  "object-traversal": {
    cycles: false,
    run: (doc, visit) => objectTraversal(doc, ({ value, key, meta }) => visit(value, key, meta.nodePath), { cycleHandling: false }),
    note: "cycleHandling: false; path is a dotted string",
  },
  "object-traversal cycles": {
    cycles: true,
    run: (doc, visit) => objectTraversal(doc, ({ value, key, meta }) => visit(value, key, meta.nodePath), { cycleHandling: true }),
    note: "cycleHandling: true; path is a dotted string",
  },
  "deep-for-each": {
    cycles: false,
    run: (doc, visit) => deepForEach(doc, (value, key, _subject, path) => visit(value, key, path)),
    note: "the root is not visited; path is a string like a.b[0]",
  },
  "tree-crawl": {
    cycles: false,
    run: (doc, visit) => treeCrawl(doc, (node) => visit(node), { getChildren: (n) => (isObj(n) ? Object.values(n) : []) }),
    note: "generic tree walker: no keys or paths",
  },
  "json-schema-traverse": {
    cycles: false,
    run: (doc, visit) => jsonSchemaTraverse(doc, { allKeys: true }, (schema, ptr) => visit(schema, undefined, ptr)),
    note: "visits sub-schema objects only, never primitives",
  },
}

// asynchronous traversal: only json-crawl offers it
export const asyncTraversal = {
  [CURRENT]: { cycles: false, run: (doc, visit) => current.crawl(doc, ({ value, key, path }) => visit(value, key, path)) },
  [PREVIOUS]: { cycles: false, run: (doc, visit) => previous.crawl(doc, ({ value, key, path }) => visit(value, key, path)) },
}

// clone: run(doc) returns a deep copy
export const clone = {
  [CURRENT]: { cycles: true, run: (doc) => current.syncClone(doc) },
  [`${CURRENT} tree`]: { cycles: false, run: (doc) => current.syncClone(doc, [], { circular: false }), note: "circular: false (tree input: no cycle or shared-reference tracking)" },
  [PREVIOUS]: { cycles: true, run: (doc) => previous.syncClone(doc) },
  "rfdc circles": { cycles: true, run: rfdcCircles, note: "rfdc({ circles: true })" },
  "lodash.clonedeep": { cycles: true, run: lodashCloneDeep },
  clone: { cycles: true, run: (doc) => cloneLib(doc) },
  structuredClone: { cycles: true, run: (doc) => structuredClone(doc), note: "built-in" },
  rfdc: { cycles: false, run: rfdc, note: "default options" },
  klona: { cycles: false, run: klona },
  "klona/json": { cycles: false, run: klonaJson, note: "JSON values only" },
  "JSON.parse(JSON.stringify())": { cycles: false, run: (doc) => JSON.parse(JSON.stringify(doc)), note: "built-in; throws on cycles" },
}

// transforming clone: run(doc) returns a deep copy with every number doubled
const doubleNumbers = ({ value }) => (typeof value === "number" ? { value: value * 2 } : undefined)
const traverseDouble = (copy) => {
  traverseLib(copy).forEach(function (x) { if (typeof x === "number") this.update(x * 2) })
  return copy
}
export const cloneTransform = {
  [CURRENT]: { cycles: true, run: (doc) => current.syncClone(doc, doubleNumbers) },
  [`${CURRENT} tree`]: { cycles: false, run: (doc) => current.syncClone(doc, doubleNumbers, { circular: false }), note: "circular: false" },
  [PREVIOUS]: { cycles: true, run: (doc) => previous.syncClone(doc, doubleNumbers) },
  "rfdc circles + traverse update": {
    cycles: true,
    run: (doc) => traverseDouble(rfdcCircles(doc)),
    note: "two passes: rfdc({ circles: true }) copy, then an in-place traverse update",
  },
  "rfdc + traverse update": {
    cycles: false,
    run: (doc) => traverseDouble(rfdc(doc)),
    note: "two passes: rfdc copy, then an in-place traverse update",
  },
  "traverse map": {
    cycles: false,
    run: (doc) => traverseLib(doc).map(function (x) { if (typeof x === "number") this.update(x * 2) }),
    note: "traverse(doc).map with this.update; terminates on cycles but does not reproduce them in the copy",
  },
  "JSON.parse reviver": {
    cycles: false,
    run: (doc) => JSON.parse(JSON.stringify(doc), (_key, value) => (typeof value === "number" ? value * 2 : value)),
    note: "built-in; serializes the document first",
  },
}

// equal: run(a, b) returns a boolean
export const equal = {
  [CURRENT]: { cycles: true, run: (a, b) => current.equal(a, b) },
  "fast-equals circular": { cycles: true, run: fastEqualsCircular, note: "circularDeepEqual" },
  "lodash.isequal": { cycles: true, run: lodashIsEqual },
  "deep-equal": { cycles: true, run: (a, b) => deepEqualLib(a, b, { strict: true }), note: "strict mode" },
  "util.isDeepStrictEqual": { cycles: true, run: isDeepStrictEqual, note: "built-in" },
  [PREVIOUS]: { cycles: false, run: (a, b) => previous.equal(a, b) },
  "fast-deep-equal": { cycles: false, run: fastDeepEqual },
  dequal: { cycles: false, run: dequal },
  "fast-equals": { cycles: false, run: fastEquals, note: "deepEqual" },
}
