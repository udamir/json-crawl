// Helpers shared by the modules of the library; not part of the public API (index.ts does not export this module).

import type { CrawlChildType, CrawlRules, CrawlRulesContext, CrawlRulesKey, JsonPath } from "./types.ts"

// ---------------------------------------------------------------------------------------------------------------------
// Own properties and promises
// ---------------------------------------------------------------------------------------------------------------------

// Writes an own property. Plain assignment of the key "__proto__" on an ordinary object replaces its prototype
// instead of creating a property, so that one key goes through Object.defineProperty.
export const setOwn = (node: Record<string | number, unknown>, key: string | number, value: unknown): void => {
  if (key === "__proto__") {
    Object.defineProperty(node, key, { value, writable: true, enumerable: true, configurable: true })
  } else {
    node[key] = value
  }
}

export const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === "object" && value !== null && typeof (value as PromiseLike<unknown>).then === "function"

// ---------------------------------------------------------------------------------------------------------------------
// Paths: parent-linked node paths
// ---------------------------------------------------------------------------------------------------------------------

// Copying the parent path for every node made a crawl O(depth²) in time and memory, so a 20 000-deep chain ran out of
// heap. A container node records its parent and its key, and the path array is built as follows:
// - up to EAGER_PATH_DEPTH the path is copied from the parent when the node is created, as before: the copy is cheap
//   for such short paths, and the contexts of these nodes stay plain objects with a `path` data property (an own
//   accessor costs far more than a short copy, so shallow documents, the common case, keep their speed); such nodes
//   get a PathNode only when they are entered as containers;
// - deeper nodes get their path on first read: it is built from the nearest ancestor with a cached path and cached on
//   the node, so every hook and every rule function of the node sees the same array. Each context also
//   keeps the array it returned, so reading it again later (e.g. from an exit hook) returns the same array. The crawler
//   keeps the cache of a deep node only while its hooks run or while it is the innermost open container (so its
//   children copy its array instead of walking up), so open ancestors do not keep O(depth²) arrays alive.
// A path array handed out is never mutated afterwards.

export interface PathNode {
  readonly parent: PathNode | undefined   // undefined for the root
  readonly key: string | number           // key of the node in its parent (unused for the root)
  readonly depth: number                  // path length
  path: JsonPath | undefined              // materialized path, created on first read
}

export const EAGER_PATH_DEPTH = 128

export const rootPathNode = (): PathNode => ({ parent: undefined, key: "", depth: 0, path: [] })

// Node of a container; `path` is its eagerly built path, or undefined for a deep node (materialized on demand).
export const childPathNode = (parent: PathNode, key: string | number, path?: JsonPath): PathNode =>
  ({ parent, key, depth: parent.depth + 1, path })

// Eager path of a child, for depths up to EAGER_PATH_DEPTH (the parent path is then always cached).
export const childPath = (parentPath: JsonPath, key: string | number): JsonPath => {
  const n = parentPath.length
  const path = new Array<string | number>(n + 1)
  for (let i = 0; i < n; i++) { path[i] = parentPath[i] }
  path[n] = key
  return path
}

// Returns the path of a node, built from the keys of its ancestors up to the nearest one with a cached path (at worst
// the node at EAGER_PATH_DEPTH): O(depth) on first read, like the eager copy it replaces, and free when nobody reads it.
export const materializePath = (node: PathNode): JsonPath => {
  if (node.path) { return node.path }

  let base: PathNode = node
  while (!base.path) { base = base.parent! }
  const basePath = base.path
  const baseDepth = base.depth

  const path = new Array<string | number>(node.depth)
  for (let i = 0; i < baseDepth; i++) { path[i] = basePath[i] }
  for (let n: PathNode = node; n !== base; n = n.parent!) { path[n.depth - 1] = n.key }

  node.path = path
  return path
}

// Drops the cached path of a deep node; eagerly built paths are kept, the children of the node copy them.
export const releasePath = (node: PathNode): void => {
  if (node.depth > EAGER_PATH_DEPTH) { node.path = undefined }
}

// ---------------------------------------------------------------------------------------------------------------------
// Rules: prefix rule compilation and child rule resolution
// ---------------------------------------------------------------------------------------------------------------------

// Prefix rule keys (`"/x-*"`): a path key ending in a single `*`, other
// than `/*` itself. A rule set is compiled into `[prefix, ruleKey, prefix, ruleKey, ...]`, longest prefix first, and
// the result is cached by the rule set object when the set has prefix rules or more than `SCAN_LIMIT` keys. Small sets
// without prefix rules are scanned on every lookup instead: rule sets built per node (the `/**` merge, function rules)
// are mostly of that kind, and a `WeakMap` entry for a short-lived object costs several scans of a small one.
const STAR = 42 // "*"
const SLASH = 47 // "/"
const SCAN_LIMIT = 16
const NO_PREFIXES: string[] = []
const prefixCache = new WeakMap<object, string[]>()
const hasOwn = Object.prototype.hasOwnProperty

export const compilePrefixes = (rules: object): string[] => {
  let compiled = prefixCache.get(rules)
  if (compiled) { return compiled }

  let keys: string[] | undefined
  let count = 0
  for (const key in rules) {
    count++
    // "/" + prefix + "*", prefix non-empty; "/*" (any key) and "/**" (any depth) are not prefix rules
    if (key.length < 3 || key.charCodeAt(key.length - 1) !== STAR || key.charCodeAt(0) !== SLASH || key === "/**" || !hasOwn.call(rules, key)) { continue }
    if (key.charCodeAt(key.length - 2) === STAR) {
      throw new TypeError(`Invalid prefix rule "${key}": a key ending in "**" is reserved (only "/**" is allowed; a prefix rule ends in a single "*")`)
    }
    (keys ??= []).push(key)
  }

  if (!keys) {
    if (count > SCAN_LIMIT) { prefixCache.set(rules, NO_PREFIXES) }
    return NO_PREFIXES
  }
  // equal-length prefixes cannot both match one key, so only the length order matters
  keys.sort((a, b) => b.length - a.length)
  compiled = []
  for (const key of keys) { compiled.push(key.slice(1, -1), key) }
  prefixCache.set(rules, compiled)
  return compiled
}

export const matchCompiled = <R extends {}>(rules: CrawlRules<R>, compiled: string[], key: string): CrawlChildType<R> | undefined => {
  for (let i = 0; i < compiled.length; i += 2) {
    if (key.startsWith(compiled[i])) { return rules[compiled[i + 1] as CrawlRulesKey] as CrawlChildType<R> }
  }
}

// Rules context of a deep crawled node without a cached path: the path is materialized only if a rule function reads
// it.
const lazyRulesContext = (key: string | number, node: PathNode, value: unknown): CrawlRulesContext => {
  if (node.path) { return { key, path: node.path, value } }
  return {
    key,
    get path() { return materializePath(node) },
    set path(path: JsonPath) { Object.defineProperty(this, "path", { value: path, writable: true, enumerable: true, configurable: true }) },
    value,
  }
}

// Implementation of `getNodeRules`: the crawler passes the path array of a shallow node, or `undefined` and the
// parent-linked path node of a deep one. The two are separate parameters so that the common call stays monomorphic.
// `prefixes` is `compilePrefixes(rules)` when the caller already has it: the crawler compiles the rules of a container
// once for all its children, which keeps rule sets built per node out of the cache.
export const resolveNodeRules = <R extends {} = {}>(
  rules: CrawlRules<R> | undefined,
  key: string | number,
  path: JsonPath | undefined,
  pathNode: PathNode | undefined,
  value: unknown,
  prefixes: string[] | undefined
): CrawlRules<R> | undefined => {
  if (!rules) { return }

  // the rules context is only needed by function rules, so it is created on first use
  let ctx: CrawlRulesContext | undefined
  const resolve = (rule: CrawlChildType<R> | undefined): CrawlRules<R> | undefined =>
    typeof rule === "function" ? rule(ctx ?? (ctx = (path ? { key, path, value } : lazyRulesContext(key, pathNode!, value)))) : rule

  const globalRule = rules["/**"] as CrawlChildType<R> | undefined
  const globalRules = resolve(globalRule)
  const localRules = resolve(rules["/*"] as CrawlChildType<R> | undefined)

  // prefix rules apply to string keys only; a string key ending in "*" skips the exact lookup, because its exact rule
  // key ("/x-*") is a prefix rule (or "/*", "/**") that the key already reaches as such. The exact lookup is one get
  // instead of `in` + get: a rule key always starts with "/", so it never hits an Object.prototype member, and an
  // explicit `undefined` rule resolves to nothing either way
  let prefixRules: CrawlRules<R> | undefined
  let exactRule: CrawlChildType<R> | undefined
  if (typeof key === "string") {
    prefixRules = resolve(matchCompiled(rules, prefixes ?? compilePrefixes(rules), key))
    if (key.charCodeAt(key.length - 1) !== STAR) { exactRule = rules[`/${key}` as CrawlRulesKey] as CrawlChildType<R> | undefined }
  } else {
    exactRule = rules[`/${key}` as CrawlRulesKey] as CrawlChildType<R> | undefined
  }
  let node = exactRule !== undefined ? resolve(exactRule) : undefined

  if (!node && !prefixRules && !localRules && globalRule === undefined) { return }

  if (prefixRules) {
    node = node ? { ...prefixRules, ...node } : prefixRules
  }
  if (localRules) {
    node = node ? { ...localRules, ...node } : localRules
  }
  if (globalRule !== undefined) {
    return { "/**": globalRule, ...globalRules, ...node } as unknown as CrawlRules<R>
  }

  return node
}
