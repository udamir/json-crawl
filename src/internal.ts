// Helpers shared by the modules of the library; not part of the public API (index.ts does not export this module).

import type {
  CrawlChildType,
  CrawlContext,
  CrawlHook,
  CrawlHookResponse,
  CrawlRules,
  CrawlRulesContext,
  CrawlRulesKey,
  ExitHook,
  JsonPath,
  SyncCrawlHook,
} from "./types.ts"
import { isArray, isObject } from "./utils.ts"

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

// The crawler compiles the rules of every container; neighbouring containers mostly share one rule set (all the
// properties of a schema, all the operations of a path), so the last result is kept in front of the cache. It holds the
// last rule set strongly, which is one object.
let lastRules: object | undefined
let lastCompiled: CompiledRules | undefined

export const compileRules = (rules: object): CompiledRules => {
  if (rules === lastRules) { return lastCompiled! }
  const compiled = compileRuleSet(rules)
  lastRules = rules
  lastCompiled = compiled
  return compiled
}

const compileRuleSet = (rules: object): CompiledRules => {
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
// A class with the accessor on the prototype: an object literal with its own `get path()` creates closures per object
// and falls back to dictionary mode, which made rule functions of lazily pathed nodes 20% slower.
class LazyRulesContext implements CrawlRulesContext {
  declare key: string | number
  declare value: unknown
  #node: PathNode

  constructor(key: string | number, node: PathNode, value: unknown) {
    this.key = key
    this.value = value
    this.#node = node
  }

  get path(): JsonPath { return materializePath(this.#node) }
  set path(path: JsonPath) { Object.defineProperty(this, "path", { value: path, writable: true, enumerable: true, configurable: true }) }
}

const lazyRulesContext = (key: string | number, node: PathNode, value: unknown): CrawlRulesContext =>
  node.path ? { key, path: node.path, value } : new LazyRulesContext(key, node, value)

const rulesContext = (key: string | number, path: JsonPath | undefined, pathNode: PathNode | undefined, value: unknown): CrawlRulesContext =>
  path ? { key, path, value } : lazyRulesContext(key, pathNode!, value)

// Rule of a path key that several merged rule sets share (see mergeRules) when all of them are rule objects: it always
// resolves to the same merged object, which is built on first use, so the resolver treats it like a static rule object
// (no rules context, results shared between nodes) instead of a function rule called per node. Without it, two
// overlapping `/**` sets made a crawl 4 times slower than one set with the same rules.
export const STATIC_MERGE: unique symbol = Symbol("json-crawl/static-merge")
export type StaticMergeRule = (() => object | undefined) & { [STATIC_MERGE]: true }
const isStaticMerge = (rule: Function): rule is StaticMergeRule => (rule as Partial<StaticMergeRule>)[STATIC_MERGE] === true

// `{ "/**": globalRule, ...globalRules, ...node }` for a static `/**` rule (an object, or a static merge whose merged
// object is `globalRules`) and a node rule that comes unchanged from one static rule object (or no node rule): the merge
// depends on these objects only, so it is built once and shared by every node that resolves to it, instead of a fresh
// object per node.
interface GlobalMerges {
  none: object | undefined
  readonly byNode: WeakMap<object, object>
}
const globalMerges = new WeakMap<object, GlobalMerges>()

const mergeGlobal = (globalRule: object, globalRules: object, node: object | undefined): object => {
  let merges = globalMerges.get(globalRule)
  if (merges === undefined) { globalMerges.set(globalRule, merges = { none: undefined, byNode: new WeakMap() }) }
  if (node === undefined) { return merges.none ??= { "/**": globalRule, ...globalRules } }
  let merged = merges.byNode.get(node)
  if (merged === undefined) { merges.byNode.set(node, merged = { "/**": globalRule, ...globalRules, ...node }) }
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
): CrawlRules<R> | undefined =>
  rules
    ? resolveRules(rules, rules["/**"] as CrawlChildType<R> | undefined, rules["/*"] as CrawlChildType<R> | undefined, key, path, pathNode, value, compiled)
    : undefined

// `globalRule` and `localRule` are `rules["/**"]` and `rules["/*"]`. The crawler reads them once per container instead
// of once per child: rule sets have many shapes, so these loads are megamorphic.
export const resolveRules = <R extends {} = {}>(
  rules: CrawlRules<R>,
  globalRule: CrawlChildType<R> | undefined,
  localRule: CrawlChildType<R> | undefined,
  key: string | number,
  path: JsonPath | undefined,
  pathNode: PathNode | undefined,
  value: unknown,
  compiled: CompiledRules | undefined
): CrawlRules<R> | undefined => {
  let ctx: CrawlRulesContext | undefined
  // false once a part of the result comes from a function rule or from a merge, which cannot be shared between nodes
  let stable = true

  // a static merge stands for its merged object and keeps the result shareable; other function rules do not
  const staticGlobal = typeof globalRule === "function" && isStaticMerge(globalRule)
  const globalRules = typeof globalRule !== "function"
    ? globalRule
    : staticGlobal ? globalRule() as CrawlRules<R> : globalRule(ctx = rulesContext(key, path, pathNode, value))

  let localRules: CrawlRules<R> | undefined
  if (typeof localRule === "function" && isStaticMerge(localRule)) {
    localRules = localRule() as CrawlRules<R>
  } else if (typeof localRule === "function") {
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
      if (typeof prefixRule === "function" && isStaticMerge(prefixRule)) {
        prefixRules = prefixRule() as CrawlRules<R>
      } else if (typeof prefixRule === "function") {
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
  if (typeof exactRule === "function" && isStaticMerge(exactRule)) {
    node = exactRule() as CrawlRules<R>
  } else if (typeof exactRule === "function") {
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
  if ((typeof globalRule === "function" && !staticGlobal) || (node && !stable)) {
    return { "/**": globalRule, ...globalRules, ...node } as unknown as CrawlRules<R>
  }
  return mergeGlobal(globalRule, globalRules as object, node) as CrawlRules<R>
}

// ---------------------------------------------------------------------------------------------------------------------
// Traversal engine: the crawl loop behind crawl, syncCrawl, clone and transform
// ---------------------------------------------------------------------------------------------------------------------

// Parameters of the engine; rule set arrays are merged by the callers.
export interface EngineParams<T extends {}, R extends {}> {
  state: T
  rules: CrawlRules<R> | undefined
  circular: boolean | undefined
  lazy: boolean // `lazyPath: true`: `path` is built on its first read
}

// Internal final step of a node (the write of clone and transform), called after the user hooks with the node's
// original value. It returns the state for the node's children, POST_DONE to skip the children, or undefined to keep
// the current state; an exit hook for the node is handed over through `sink`. Returning the state itself (instead of a
// `{ state }` response) saves a response object and a rebuilt context per container.
const rootContext = <T extends {}, R extends {}>(data: unknown, root: PathNode, params: EngineParams<T, R>): CrawlContext<T, R> =>
  params.lazy
    ? new LazyContext(data, undefined, undefined, params.state, params.rules, undefined) as unknown as CrawlContext<T, R>
    : createContext(data, root, undefined, params.state, params.rules, undefined)

export const POST_DONE: object = { done: true }
export interface PostSink { exitHook: ExitHook | undefined }

// Exit hooks of a node: most nodes have none, most of the others exactly one, so a single hook is kept as the function
// itself and an array is only created for the second one. An empty array and its first push cost 184 bytes, which
// made a crawl whose hook returns an exit hook for every node 19% slower than it needs to be.
type ExitHooks = ExitHook | ExitHook[] | undefined

const addExitHook = (exitHooks: ExitHooks, hook: ExitHook): ExitHooks => {
  if (exitHooks === undefined) { return hook }
  if (typeof exitHooks === "function") { return [exitHooks, hook] }
  exitHooks.push(hook)
  return exitHooks
}
export type PostStep<T extends {}, R extends {}> = (context: CrawlContext<T, R>, original: unknown, sink: PostSink) => T | typeof POST_DONE | undefined

// One open container on the traversal stack.
interface Frame<T extends {}, R extends {}> {
  data: Record<string | number, any>  // container value being iterated
  node: PathNode                      // path of the container (parent-linked, materialized on demand)
  keys: string[] | undefined          // own enumerable keys for objects; undefined for arrays, which are iterated by index
  length: number                      // number of keys, or the array length captured when the container was entered
  index: number                       // position of the next child
  state: T                            // state the children are crawled with
  rules: CrawlRules<R> | undefined    // rules the children are resolved from
  globalRule: CrawlChildType<R> | undefined // rules["/**"], read once for all the children
  localRule: CrawlChildType<R> | undefined  // rules["/*"], read once for all the children
  compiled: CompiledRules | undefined // `compileRules(rules)` (objects only: array indexes never match a prefix)
  exitHooks: ExitHooks                // exit hooks of the container, run LIFO once every child is done
}

// hooks may be passed as a single function or as an array that may contain non-function entries, which are skipped
export const normalizeHooks = <H>(hooks: H | H[]): H[] => {
  const list = isArray(hooks) ? hooks : [hooks]
  const result: H[] = []
  for (const hook of list) {
    if (typeof hook === "function") { result.push(hook) }
  }
  return result
}

// Position of the crawl: the context handed to the hooks, and either the eager path of the node or, for the root and
// for deep nodes, its path node.
interface Cursor<T extends {}, R extends {}> {
  context: CrawlContext<T, R> | undefined
  node: PathNode | undefined
  path: JsonPath | undefined
  lazy: boolean
  eagerDepth: number // depth up to which children get an eager path: EAGER_PATH_DEPTH, or -1 with lazy paths
}

// The context of a node. A node with a cached path (always the case up to EAGER_PATH_DEPTH) gets a plain object.
// A deep node without one gets an own enumerable `path` accessor (so spreading or `Object.assign` of a context still
// copies the array) that materializes the path on first read: a crawl whose hooks never read `path` is O(1)
// per node, and every hook of a node sees the same, never mutated, array. Assigning `path` replaces the
// accessor with a plain property on that context object only.
const createContext = <T extends {}, R extends {}>(
  value: unknown,
  node: PathNode,
  key: string | number | undefined,
  state: T,
  rules: CrawlRules<R> | undefined,
  parent: unknown
): CrawlContext<T, R> => node.path ? { value, path: node.path, key, state, rules, parent } : lazyContext(value, node, key, state, rules, parent)

// Context of a deep node. Every instance gets the same accessor pair (defined once, read through private fields), so
// all deep contexts share one hidden class with fast properties and no closure is allocated per context. The fields
// are only declared, so that the own properties are created in the constructor in the order of a plain context
// (value, path, key, state, rules, parent).
class DeepContext<T extends {}, R extends {}> {
  declare value: unknown
  declare path: JsonPath
  declare key: string | number | undefined
  declare state: T
  declare rules: CrawlRules<R> | undefined
  declare parent: unknown
  #node: PathNode
  #path: JsonPath | undefined = undefined

  static readonly pathDescriptor: PropertyDescriptor = {
    get(this: DeepContext<{}, {}>): JsonPath { return this.#path ??= materializePath(this.#node) },
    set(this: DeepContext<{}, {}>, value: JsonPath): void {
      Object.defineProperty(this, "path", { value, writable: true, enumerable: true, configurable: true })
    },
    enumerable: true,
    configurable: true,
  }

  constructor(value: unknown, node: PathNode, key: string | number | undefined, state: T, rules: CrawlRules<R> | undefined, parent: unknown) {
    this.value = value
    this.#node = node
    Object.defineProperty(this, "path", DeepContext.pathDescriptor)
    this.key = key
    this.state = state
    this.rules = rules
    this.parent = parent
  }
}

// kept out of `createContext`, so that the class does not weigh on the common plain-object path
const lazyContext = <T extends {}, R extends {}>(
  value: unknown,
  node: PathNode,
  key: string | number | undefined,
  state: T,
  rules: CrawlRules<R> | undefined,
  parent: unknown
): CrawlContext<T, R> => new DeepContext(value, node, key, state, rules, parent)

// Rules of a child of a frame with rules. A separate function, so that a crawl without rules never calls it and
// nextChild stays small (it is inlined into the crawl loop, which is close to TurboFan's inlining budget).
const childRules = <T extends {}, R extends {}>(frame: Frame<T, R>, key: string | number, path: JsonPath | undefined, node: PathNode | undefined, value: unknown): CrawlRules<R> | undefined =>
  resolveRules(frame.rules!, frame.globalRule, frame.localRule, key, path, node, value, frame.compiled)

// ---------------------------------------------------------------------------------------------------------------------
// Lazy paths (`lazyPath: true`)
// ---------------------------------------------------------------------------------------------------------------------

// The context of a node in a crawl with `lazyPath: true`. Its `path` is an accessor on the prototype: the path is built on
// the first read from the path node of the parent container and the key, and the same array is returned on later reads.
// Leaves allocate nothing for their path (containers keep the path node they get when they are entered), and a path a
// hook has already built is handed to the container's path node, so its children copy it instead of walking up to the
// root. The accessor is defined once on the class, so all instances share one hidden class with fast properties (an own
// accessor per object, as in DeepContext, would need a defineProperty per node). Unlike the default contexts, `path` is
// not an own property: spreading a lazy context or listing its keys leaves it out. Assigning `path` makes it a plain own
// property of that context.
export class LazyContext<T extends {}, R extends {}> {
  declare value: unknown
  declare key: string | number | undefined
  declare state: T
  declare rules: CrawlRules<R> | undefined
  declare parent: unknown
  #parentNode: PathNode | undefined
  #path: JsonPath | undefined = undefined

  constructor(value: unknown, parentNode: PathNode | undefined, key: string | number | undefined, state: T, rules: CrawlRules<R> | undefined, parent: unknown) {
    this.value = value
    this.key = key
    this.state = state
    this.rules = rules
    this.parent = parent
    this.#parentNode = parentNode
  }

  get path(): JsonPath {
    if (this.#path !== undefined) { return this.#path }
    return this.#path = this.#parentNode === undefined ? [] : childPath(materializePath(this.#parentNode), this.key!)
  }

  set path(path: JsonPath) {
    Object.defineProperty(this, "path", { value: path, writable: true, enumerable: true, configurable: true })
  }

  // the path if a hook has built it, for the container's path node (static, so that it is not visible on contexts)
  static builtPath(context: object): JsonPath | undefined {
    return context instanceof LazyContext ? context.#path : undefined
  }

  // the context with the fields of a hook response applied, for the next hook of the same node
  static rebuild<T extends {}, R extends {}>(context: LazyContext<T, R>, value: unknown, state: T, rules: CrawlRules<R> | undefined): LazyContext<T, R> {
    return new LazyContext(value, context.#parentNode, context.key, state, rules, context.parent)
  }
}

// rules of a lazily pathed child: a path node for the rule functions' context, only when the parent has rules
const lazyChildRules = <T extends {}, R extends {}>(frame: Frame<T, R>, key: string | number, value: unknown): CrawlRules<R> | undefined =>
  childRules(frame, key, undefined, childPathNode(frame.node, key), value)

// A separate function, so that nextChild, which is inlined into the crawl loop, stays small.
const lazyChild = <T extends {}, R extends {}>(frame: Frame<T, R>, cursor: Cursor<T, R>, key: string | number, value: unknown): void => {
  cursor.node = undefined
  cursor.path = undefined
  const rules = frame.rules === undefined ? undefined : lazyChildRules(frame, key, value)
  cursor.context = new LazyContext(value, frame.node, key, frame.state, rules, frame.data) as unknown as CrawlContext<T, R>
}

// Builds the context the children of `frame` are crawled with and advances the frame; `false` when the frame is exhausted.
const nextChild = <T extends {}, R extends {}>(frame: Frame<T, R>, cursor: Cursor<T, R>): boolean => {
  const { data } = frame
  let key: string | number
  if (frame.keys) {
    key = frame.keys[frame.index++]
  } else {
    // arrays: holes are skipped, like Object.keys does for objects
    do {
      key = frame.index++
      if (frame.index > frame.length) { return false }
    } while (!(key in data))
  }
  const value = data[key]
  const parent = frame.node
  // eagerDepth is EAGER_PATH_DEPTH, or -1 with lazy paths, which sends every child to deepChild: nextChild keeps its
  // size (one more branch here took a helper out of the crawl loop's inlining budget: exit-hook crawls +15%)
  if (parent.depth < cursor.eagerDepth) {
    const path = childPath(parent.path!, key)
    cursor.node = undefined
    cursor.path = path
    // without rules there is nothing to resolve; the call (and the function context it allocates) is skipped
    const rules = frame.rules === undefined ? undefined : childRules(frame, key, path, undefined, value)
    cursor.context = { value, path, key, state: frame.state, rules, parent: data }
  } else {
    deepChild(frame, cursor, key, value)
  }
  return true
}

// The child of a node deeper than EAGER_PATH_DEPTH: a parent-linked path node and a lazy context. A separate function,
// so that its bytecode stays out of nextChild, which is inlined into the crawl loop: the loop is close to TurboFan's
// inlining budget, and one more field in the contexts was enough to push nextChild out of it (-16% → -1% on a crawl
// whose hook returns a state per container).
const deepChild = <T extends {}, R extends {}>(frame: Frame<T, R>, cursor: Cursor<T, R>, key: string | number, value: unknown): void => {
  if (cursor.lazy) {
    lazyChild(frame, cursor, key, value)
    return
  }
  const node = childPathNode(frame.node, key)
  cursor.node = node
  cursor.path = undefined
  const rules = frame.rules === undefined ? undefined : childRules(frame, key, undefined, node, value)
  cursor.context = createContext(value, node, key, frame.state, rules, frame.data)
}

// Applies the value/state/rules fields of a hook response to the context; fields that are present override, even with
// `undefined`, fields that are absent are kept. A new object is returned so that earlier hooks keep what they saw.
const applyResponse = <T extends {}, R extends {}>(context: CrawlContext<T, R>, cursor: Cursor<T, R>, response: CrawlHookResponse<T, R>): CrawlContext<T, R> => {
  const value = "value" in response ? response.value : context.value
  const state = "state" in response ? response.state! : context.state
  const rules = "rules" in response ? response.rules : context.rules
  if (cursor.lazy) { return LazyContext.rebuild(context as unknown as LazyContext<T, R>, value, state, rules) as unknown as CrawlContext<T, R> }
  return cursor.path
    ? { value, path: cursor.path, key: context.key, state, rules, parent: context.parent }
    : createContext(value, cursor.node!, context.key, state, rules, context.parent)
}

// Callers check for `undefined` before calling, so that a crawl without exit hooks never calls (and never inlines) this:
// the crawl loop is close to TurboFan's inlining budget, and any extra inlined bytecode can push the frame helpers out
// of it, which made the plain crawl about 20% slower in one prototype.
const runExitHooks = (exitHooks: ExitHook | ExitHook[]): void => {
  if (typeof exitHooks === "function") {
    exitHooks()
    return
  }
  while (exitHooks.length) { exitHooks.pop()!() }
}

// Enters a container (the node's final value, after the hooks): its own enumerable keys (objects) or its length
// (arrays) are captured once.
const openFrame = <T extends {}, R extends {}>(
  frames: Frame<T, R>[],
  data: Record<string | number, any>,
  key: string | number | undefined,
  rules: CrawlRules<R> | undefined,
  cursor: Cursor<T, R>,
  exitHooks: ExitHooks,
  state: T
): Frame<T, R> => {
  // the root and deep nodes already have a path node; a shallow node gets one now, from its parent, the top frame
  const node = cursor.node ?? childPathNode(frames[frames.length - 1].node, key!, cursor.path)
  const keys = isArray(data) ? undefined : Object.keys(data)
  // compiled once for all the children of the container, so a rule set built for this node is scanned once
  const compiled = rules && keys && keys.length ? compileRules(rules) : undefined
  return {
    data, node, keys, length: keys ? keys.length : data.length, index: 0, state, rules,
    globalRule: rules === undefined ? undefined : rules["/**"] as CrawlChildType<R> | undefined,
    localRule: rules === undefined ? undefined : rules["/*"] as CrawlChildType<R> | undefined,
    compiled, exitHooks,
  }
}

// Pops exhausted frames (running their exit hooks) and moves the cursor to the next node to visit; its context is
// `undefined` when the crawl is done. `open` holds the containers of the open frames when cycles are guarded.
const advance = <T extends {}, R extends {}>(frames: Frame<T, R>[], cursor: Cursor<T, R>, open: Set<object> | undefined): void => {
  while (frames.length) {
    const frame = frames[frames.length - 1]
    if (frame.index < frame.length && nextChild(frame, cursor)) { return }
    if (frame.exitHooks !== undefined) { runExitHooks(frame.exitHooks) }
    releasePath(frame.node)
    if (open) { open.delete(frame.data) }
    frames.pop()
  }
  cursor.context = undefined
}

// With `circular: true` a container that is one of its own ancestors is visited but not descended, as if a hook had
// returned `done`; shared (non-cyclic) references are still crawled each time they are reached.
const isOpenCycle = (open: Set<object> | undefined, value: object): boolean => {
  if (!open) { return false }
  if (open.has(value)) { return true }
  open.add(value)
  return false
}

// The async crawl. It runs the same loop as the synchronous crawl and leaves it only when a hook returns a thenable: the
// position (the node's context and exit hooks, the index of the hook) is saved, the thenable is awaited, `finishNode`
// completes that node and the loop is entered again. A crawl whose hooks are synchronous therefore runs at the speed of
// syncCrawl; an async loop, and resumption checks inside the hot loop, both cost 16-20%.
interface AsyncCrawl<T extends {}, R extends {}> {
  readonly hooks: Array<CrawlHook<T, R> | SyncCrawlHook<T, R>>
  readonly post: PostStep<T, R> | undefined
  readonly frames: Frame<T, R>[]
  readonly cursor: Cursor<T, R>
  readonly open: Set<object> | undefined
  readonly sink: PostSink
  context: CrawlContext<T, R> | undefined  // the suspended node: its context, its exit hooks so far, the hook awaited
  exitHooks: ExitHooks
  index: number
}

type Pending<T extends {}, R extends {}> = PromiseLike<CrawlHookResponse<T, R> | void>

export const runCrawl = <T extends {}, R extends {} = {}>(
  data: unknown,
  hooks: Array<CrawlHook<T, R> | SyncCrawlHook<T, R>>,
  params: EngineParams<T, R>,
  post?: PostStep<T, R>
): Promise<void> | undefined => {
  const root = rootPathNode()
  const crawl: AsyncCrawl<T, R> = {
    hooks,
    post,
    frames: [],
    cursor: { context: rootContext(data, root, params), node: root, path: undefined, lazy: params.lazy, eagerDepth: params.lazy ? -1 : EAGER_PATH_DEPTH },
    open: params.circular ? new Set<object>() : undefined,
    sink: { exitHook: undefined },
    context: undefined,
    exitHooks: undefined,
    index: 0,
  }
  const pending = driveCrawl(crawl)
  return pending === undefined ? undefined : resumeCrawl(crawl, pending)
}

const resumeCrawl = async <T extends {}, R extends {}>(crawl: AsyncCrawl<T, R>, pending: Pending<T, R> | undefined): Promise<void> => {
  while (pending !== undefined) { pending = finishNode(crawl, await pending) }
}

// The crawl loop of runSyncCrawl, except that a thenable suspends it (see AsyncCrawl); keep the two in step.
const driveCrawl = <T extends {}, R extends {}>(crawl: AsyncCrawl<T, R>): Pending<T, R> | undefined => {
  const { hooks, post, frames, cursor, open, sink } = crawl

  while (cursor.context) {
    let context: CrawlContext<T, R> = cursor.context
    let exitHooks: ExitHooks
    let descend = true
    let last: CrawlHookResponse<T, R> | undefined

    for (let i = 0; i < hooks.length; i++) {
      const response = hooks[i](context)
      if (!response || typeof response !== "object") { continue }
      if (isThenable(response)) {
        crawl.context = context
        crawl.exitHooks = exitHooks
        crawl.index = i
        return response
      }
      if (response.terminate) {
        cursor.context = undefined
        return
      }
      if (response.exitHook) { exitHooks = addExitHook(exitHooks, response.exitHook) }
      if ("value" in response || "state" in response || "rules" in response) {
        if (i + 1 < hooks.length || post !== undefined) { context = applyResponse(context, cursor, response) } else { last = response }
      }
      if (response.done) {
        descend = false
        break
      }
    }

    let value = context.value
    let childState = context.state
    let rules = context.rules
    if (last !== undefined) {
      if ("value" in last) { value = last.value }
      if ("state" in last) { childState = last.state! }
      if ("rules" in last) { rules = last.rules }
    }
    if (post !== undefined && descend) {
      const result = post(context, cursor.context.value, sink)
      if (result === POST_DONE) {
        descend = false
      } else if (result !== undefined) {
        childState = result as T
      }
      if (sink.exitHook !== undefined) {
        exitHooks = addExitHook(exitHooks, sink.exitHook)
        sink.exitHook = undefined
      }
    }

    if (descend && isObject(value) && !isOpenCycle(open, value)) {
      if (cursor.lazy) { cursor.path = LazyContext.builtPath(context) }
      const frame = openFrame(frames, value, context.key, rules, cursor, exitHooks, childState)
      if (frames.length) { releasePath(frames[frames.length - 1].node) }
      frames.push(frame)
    } else {
      if (cursor.node) { releasePath(cursor.node) }
      if (exitHooks !== undefined) { runExitHooks(exitHooks) }
    }

    advance(frames, cursor, open)
  }
}

// Completes the suspended node with the awaited response and the hooks after it (any of which may suspend again), then
// re-enters the crawl loop. Runs once per awaited thenable, so it is kept out of the hot loop.
const finishNode = <T extends {}, R extends {}>(crawl: AsyncCrawl<T, R>, resolved: CrawlHookResponse<T, R> | void): Pending<T, R> | undefined => {
  const { hooks, post, frames, cursor, open, sink } = crawl
  let context = crawl.context!
  let exitHooks = crawl.exitHooks
  let descend = true
  let last: CrawlHookResponse<T, R> | undefined
  let response: ReturnType<CrawlHook<T, R>> = resolved

  for (let i = crawl.index; ;) {
    if (response && typeof response === "object") {
      const r = response as CrawlHookResponse<T, R>
      if (r.terminate) {
        cursor.context = undefined
        return
      }
      if (r.exitHook) { exitHooks = addExitHook(exitHooks, r.exitHook) }
      if ("value" in r || "state" in r || "rules" in r) {
        if (i + 1 < hooks.length || post !== undefined) { context = applyResponse(context, cursor, r) } else { last = r }
      }
      if (r.done) {
        descend = false
        break
      }
    }
    if (++i >= hooks.length) { break }
    response = hooks[i](context)
    if (isThenable(response)) {
      crawl.context = context
      crawl.exitHooks = exitHooks
      crawl.index = i
      return response
    }
  }
  crawl.context = undefined
  crawl.exitHooks = undefined

  let value = context.value
  let childState = context.state
  let rules = context.rules
  if (last !== undefined) {
    if ("value" in last) { value = last.value }
    if ("state" in last) { childState = last.state! }
    if ("rules" in last) { rules = last.rules }
  }
  if (post !== undefined && descend) {
    const result = post(context, cursor.context!.value, sink)
    if (result === POST_DONE) {
      descend = false
    } else if (result !== undefined) {
      childState = result as T
    }
    if (sink.exitHook !== undefined) {
      exitHooks = addExitHook(exitHooks, sink.exitHook)
      sink.exitHook = undefined
    }
  }
  if (descend && isObject(value) && !isOpenCycle(open, value)) {
    if (cursor.lazy) { cursor.path = LazyContext.builtPath(context) }
    const frame = openFrame(frames, value, context.key, rules, cursor, exitHooks, childState)
    if (frames.length) { releasePath(frames[frames.length - 1].node) }
    frames.push(frame)
  } else {
    if (cursor.node) { releasePath(cursor.node) }
    if (exitHooks !== undefined) { runExitHooks(exitHooks) }
  }
  advance(frames, cursor, open)

  return driveCrawl(crawl)
}

export const runSyncCrawl = <T extends {}, R extends {} = {}>(
  data: unknown,
  hooks: SyncCrawlHook<T, R>[],
  params: EngineParams<T, R>,
  post?: PostStep<T, R>
): void => {
  const frames: Frame<T, R>[] = []
  const root = rootPathNode()
  const cursor: Cursor<T, R> = { context: rootContext(data, root, params), node: root, path: undefined, lazy: params.lazy, eagerDepth: params.lazy ? -1 : EAGER_PATH_DEPTH }
  const open = params.circular ? new Set<object>() : undefined
  const sink: PostSink = { exitHook: undefined }

  while (cursor.context) {
    let context: CrawlContext<T, R> = cursor.context
    let exitHooks: ExitHooks
    let descend = true
    let last: CrawlHookResponse<T, R> | undefined

    for (let i = 0; i < hooks.length; i++) {
      const response = hooks[i](context)
      if (!response || typeof response !== "object") { continue }
      if (isThenable(response)) {
        throw new TypeError("syncCrawl received an async hook (the hook returned a Promise); use crawl() for async hooks")
      }
      if (response.terminate) { return }
      if (response.exitHook) { exitHooks = addExitHook(exitHooks, response.exitHook) }
      if ("value" in response || "state" in response || "rules" in response) {
        // a new context is built only for a later hook or the internal step to read; after the last hook the engine
        // needs just its value, state and rules (deep nodes: one DeepContext less per responding node, -30%)
        if (i + 1 < hooks.length || post !== undefined) { context = applyResponse(context, cursor, response) } else { last = response }
      }
      if (response.done) {
        descend = false
        break
      }
    }

    // the internal final step (clone, transform) runs from its own call site, after the user hooks, unless they stopped
    // the descent; it receives the node's original value (cursor.context is the context before any hook ran)
    let value = context.value
    let childState = context.state
    let rules = context.rules
    if (last !== undefined) {
      if ("value" in last) { value = last.value }
      if ("state" in last) { childState = last.state! }
      if ("rules" in last) { rules = last.rules }
    }
    if (post !== undefined && descend) {
      const result = post(context, cursor.context.value, sink)
      if (result === POST_DONE) {
        descend = false
      } else if (result !== undefined) {
        childState = result as T
      }
      if (sink.exitHook !== undefined) {
        exitHooks = addExitHook(exitHooks, sink.exitHook)
        sink.exitHook = undefined
      }
    }

    if (descend && isObject(value) && !isOpenCycle(open, value)) {
      // only the innermost open container keeps its cached path (see the paths section of internal.ts)
      if (cursor.lazy) { cursor.path = LazyContext.builtPath(context) }
      const frame = openFrame(frames, value, context.key, rules, cursor, exitHooks, childState)
      if (frames.length) { releasePath(frames[frames.length - 1].node) }
      frames.push(frame)
    } else {
      if (cursor.node) { releasePath(cursor.node) }
      if (exitHooks !== undefined) { runExitHooks(exitHooks) }
    }

    advance(frames, cursor, open)
  }
}
