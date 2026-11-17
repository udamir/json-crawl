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

// What the resolver needs to know about a rule set, found by one scan of its keys: its prefix rules (`"/x-*"`: a path
// key ending in a single `*`, other than `/*`) as `[prefix, ruleKey, prefix, ruleKey, ...]`, longest prefix first, and
// whether it has any exact path key at all (if not, the exact lookup is skipped). The result is cached by the rule set
// object when the set has prefix rules or more than `SCAN_LIMIT` keys. Small sets without prefix rules are scanned on
// every lookup instead: rule sets built per node (function rules) are mostly of that kind, and a `WeakMap` entry for a
// short-lived object costs several scans of a small one. Rule sets are therefore treated as immutable once used.
export interface CompiledRules {
  readonly prefixes: readonly string[]
  readonly exact: boolean
}

const STAR = 42 // "*"
const SLASH = 47 // "/"
const SCAN_LIMIT = 16
const NO_PREFIXES: CompiledRules = { prefixes: [], exact: true }
const NO_PREFIXES_NO_EXACT: CompiledRules = { prefixes: [], exact: false }
const compiledCache = new WeakMap<object, CompiledRules>()
const hasOwn = Object.prototype.hasOwnProperty

export const compileRules = (rules: object): CompiledRules => {
  const cached = compiledCache.get(rules)
  if (cached) { return cached }

  let keys: string[] | undefined
  let exact = false
  let count = 0
  for (const key in rules) {
    count++
    if (key.charCodeAt(0) !== SLASH) { continue }
    if (key.charCodeAt(key.length - 1) !== STAR) {
      exact = true
      continue
    }
    // "/" + prefix + "*", prefix non-empty; "/*" (any key) and "/**" (any depth) are not prefix rules
    if (key.length < 3 || key === "/**" || !hasOwn.call(rules, key)) { continue }
    if (key.charCodeAt(key.length - 2) === STAR) {
      throw new TypeError(`Invalid prefix rule "${key}": a key ending in "**" is reserved (only "/**" is allowed; a prefix rule ends in a single "*")`)
    }
    (keys ??= []).push(key)
  }

  if (!keys) {
    const none = exact ? NO_PREFIXES : NO_PREFIXES_NO_EXACT
    if (count > SCAN_LIMIT) { compiledCache.set(rules, none) }
    return none
  }
  // equal-length prefixes cannot both match one key, so only the length order matters
  keys.sort((a, b) => b.length - a.length)
  const prefixes: string[] = []
  for (const key of keys) { prefixes.push(key.slice(1, -1), key) }
  const compiled: CompiledRules = { prefixes, exact }
  compiledCache.set(rules, compiled)
  return compiled
}

export const matchCompiled = <R extends {}>(rules: CrawlRules<R>, prefixes: readonly string[], key: string): CrawlChildType<R> | undefined => {
  for (let i = 0; i < prefixes.length; i += 2) {
    if (key.startsWith(prefixes[i])) { return rules[prefixes[i + 1] as CrawlRulesKey] as CrawlChildType<R> }
  }
}

// Rule keys of child keys ("/" + key), cached so that the exact lookup uses an interned string instead of building a
// new one per node; the cache is bounded and starts over when full.
const SLASH_KEYS_LIMIT = 4096
let slashKeys = new Map<string | number, CrawlRulesKey>()
const slashKey = (key: string | number): CrawlRulesKey => {
  let ruleKey = slashKeys.get(key)
  if (ruleKey === undefined) {
    if (slashKeys.size >= SLASH_KEYS_LIMIT) { slashKeys = new Map() }
    ruleKey = `/${key}`
    slashKeys.set(key, ruleKey)
  }
  return ruleKey
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

const rulesContext = (key: string | number, path: JsonPath | undefined, pathNode: PathNode | undefined, value: unknown): CrawlRulesContext =>
  path ? { key, path, value } : lazyRulesContext(key, pathNode!, value)

// `{ "/**": globalRule, ...globalRule, ...node }` for a static `/**` rule object and a node rule that comes unchanged
// from one static rule object (or no node rule): the merge depends on these two objects only, so it is built once and
// shared by every node that resolves to it, instead of a fresh object per node.
interface GlobalMerges {
  none: object | undefined
  readonly byNode: WeakMap<object, object>
}
const globalMerges = new WeakMap<object, GlobalMerges>()

const mergeGlobal = (globalRule: object, node: object | undefined): object => {
  let merges = globalMerges.get(globalRule)
  if (merges === undefined) { globalMerges.set(globalRule, merges = { none: undefined, byNode: new WeakMap() }) }
  if (node === undefined) { return merges.none ??= { "/**": globalRule, ...globalRule } }
  let merged = merges.byNode.get(node)
  if (merged === undefined) { merges.byNode.set(node, merged = { "/**": globalRule, ...globalRule, ...node }) }
  return merged
}

// Implementation of `getNodeRules`: the crawler passes the path array of a shallow node, or `undefined` and the
// parent-linked path node of a deep one. The two are separate parameters so that the common call stays monomorphic.
// `compiled` is `compileRules(rules)` when the caller already has it: the crawler compiles the rules of a container
// once for all its children, which keeps rule sets built per node out of the cache. Function rules are called inline
// with one lazily created rules context, so that no closure is allocated per call.
export const resolveNodeRules = <R extends {} = {}>(
  rules: CrawlRules<R> | undefined,
  key: string | number,
  path: JsonPath | undefined,
  pathNode: PathNode | undefined,
  value: unknown,
  compiled: CompiledRules | undefined
): CrawlRules<R> | undefined => {
  if (!rules) { return }

  let ctx: CrawlRulesContext | undefined
  // false once a part of the result comes from a function rule or from a merge, which cannot be shared between nodes
  let stable = true

  const globalRule = rules["/**"] as CrawlChildType<R> | undefined
  const globalRules = typeof globalRule === "function" ? globalRule(ctx = rulesContext(key, path, pathNode, value)) : globalRule

  const localRule = rules["/*"] as CrawlChildType<R> | undefined
  let localRules: CrawlRules<R> | undefined
  if (typeof localRule === "function") {
    stable = false
    localRules = localRule(ctx ??= rulesContext(key, path, pathNode, value))
  } else {
    localRules = localRule
  }

  // prefix rules apply to string keys only; a string key ending in "*" skips the exact lookup, because its exact rule
  // key ("/x-*") is a prefix rule (or "/*", "/**") that the key already reaches as such, and so does a rule set without
  // exact path keys. The exact lookup is one get instead of `in` + get: a rule key always starts with "/", so it never
  // hits an Object.prototype member, and an explicit `undefined` rule resolves to nothing either way
  let prefixRules: CrawlRules<R> | undefined
  let exactRule: CrawlChildType<R> | undefined
  if (typeof key === "string") {
    const { prefixes, exact } = compiled ?? compileRules(rules)
    if (prefixes.length) {
      const prefixRule = matchCompiled(rules, prefixes, key)
      if (typeof prefixRule === "function") {
        stable = false
        prefixRules = prefixRule(ctx ??= rulesContext(key, path, pathNode, value))
      } else {
        prefixRules = prefixRule
      }
    }
    if (exact && key.charCodeAt(key.length - 1) !== STAR) { exactRule = rules[slashKey(key)] as CrawlChildType<R> | undefined }
  } else {
    exactRule = rules[slashKey(key)] as CrawlChildType<R> | undefined
  }

  let node: CrawlRules<R> | undefined
  if (typeof exactRule === "function") {
    stable = false
    node = exactRule(ctx ??= rulesContext(key, path, pathNode, value))
  } else {
    node = exactRule
  }

  if (!node && !prefixRules && !localRules && globalRule === undefined) { return }

  if (prefixRules) {
    if (node) {
      stable = false
      node = { ...prefixRules, ...node }
    } else {
      node = prefixRules
    }
  }
  if (localRules) {
    if (node) {
      stable = false
      node = { ...localRules, ...node }
    } else {
      node = localRules
    }
  }
  if (globalRule === undefined) { return node }
  if (typeof globalRule === "function" || (node && !stable)) {
    return { "/**": globalRule, ...globalRules, ...node } as unknown as CrawlRules<R>
  }
  return mergeGlobal(globalRule, node) as CrawlRules<R>
}
