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

// ---------------------------------------------------------------------------------------------------------------------
// Traversal engine: the crawl loop behind crawl, syncCrawl, clone and transform
// ---------------------------------------------------------------------------------------------------------------------

// Parameters of the engine; rule set arrays are merged by the callers.
export interface EngineParams<T extends {}, R extends {}> {
  state: T
  rules: CrawlRules<R> | undefined
  circular: boolean | undefined
}

// Internal final step of a node (the write of clone and transform), called after the user hooks with the node's
// original value. It returns the state for the node's children, POST_DONE to skip the children, or undefined to keep
// the current state; an exit hook for the node is handed over through `sink`. Returning the state itself (instead of a
// `{ state }` response) saves a response object and a rebuilt context per container.
export const POST_DONE: object = { done: true }
export interface PostSink { exitHook: ExitHook | undefined }
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
  compiled: CompiledRules | undefined // `compileRules(rules)` (objects only: array indexes never match a prefix)
  exitHooks: ExitHook[] | undefined   // exit hooks of the container, run LIFO once every child is done
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
  rules: CrawlRules<R> | undefined
): CrawlContext<T, R> => node.path ? { value, path: node.path, key, state, rules } : lazyContext(value, node, key, state, rules)

// Context of a deep node. Every instance gets the same accessor pair (defined once, read through private fields), so
// all deep contexts share one hidden class with fast properties and no closure is allocated per context. The fields
// are only declared, so that the own properties are created in the constructor in the order of a plain context
// (value, path, key, state, rules).
class DeepContext<T extends {}, R extends {}> {
  declare value: unknown
  declare path: JsonPath
  declare key: string | number | undefined
  declare state: T
  declare rules: CrawlRules<R> | undefined
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

  constructor(value: unknown, node: PathNode, key: string | number | undefined, state: T, rules: CrawlRules<R> | undefined) {
    this.value = value
    this.#node = node
    Object.defineProperty(this, "path", DeepContext.pathDescriptor)
    this.key = key
    this.state = state
    this.rules = rules
  }
}

// kept out of `createContext`, so that the class does not weigh on the common plain-object path
const lazyContext = <T extends {}, R extends {}>(
  value: unknown,
  node: PathNode,
  key: string | number | undefined,
  state: T,
  rules: CrawlRules<R> | undefined
): CrawlContext<T, R> => new DeepContext(value, node, key, state, rules)

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
  if (parent.depth < EAGER_PATH_DEPTH) {
    const path = childPath(parent.path!, key)
    cursor.node = undefined
    cursor.path = path
    // without rules there is nothing to resolve; the call (and the function context it allocates) is skipped
    const rules = frame.rules === undefined ? undefined : resolveNodeRules(frame.rules, key, path, undefined, value, frame.compiled)
    cursor.context = { value, path, key, state: frame.state, rules }
  } else {
    const node = childPathNode(parent, key)
    cursor.node = node
    cursor.path = undefined
    const rules = frame.rules === undefined ? undefined : resolveNodeRules(frame.rules, key, undefined, node, value, frame.compiled)
    cursor.context = createContext(value, node, key, frame.state, rules)
  }
  return true
}

// Applies the value/state/rules fields of a hook response to the context; fields that are present override, even with
// `undefined`, fields that are absent are kept. A new object is returned so that earlier hooks keep what they saw.
const applyResponse = <T extends {}, R extends {}>(context: CrawlContext<T, R>, cursor: Cursor<T, R>, response: CrawlHookResponse<T, R>): CrawlContext<T, R> => {
  const value = "value" in response ? response.value : context.value
  const state = "state" in response ? response.state! : context.state
  const rules = "rules" in response ? response.rules : context.rules
  return cursor.path
    ? { value, path: cursor.path, key: context.key, state, rules }
    : createContext(value, cursor.node!, context.key, state, rules)
}

const runExitHooks = (exitHooks: ExitHook[] | undefined): void => {
  if (exitHooks) {
    while (exitHooks.length) { exitHooks.pop()!() }
  }
}

// Enters a container: its own enumerable keys (objects) or its length (arrays) are captured once.
const openFrame = <T extends {}, R extends {}>(frames: Frame<T, R>[], context: CrawlContext<T, R>, cursor: Cursor<T, R>, exitHooks: ExitHook[] | undefined, state: T): Frame<T, R> => {
  // the root and deep nodes already have a path node; a shallow node gets one now, from its parent, the top frame
  const node = cursor.node ?? childPathNode(frames[frames.length - 1].node, context.key!, cursor.path)
  const data = context.value as Record<string | number, any>
  const keys = isArray(data) ? undefined : Object.keys(data)
  const { rules } = context
  // compiled once for all the children of the container, so a rule set built for this node is scanned once
  const compiled = rules && keys && keys.length ? compileRules(rules) : undefined
  return { data, node, keys, length: keys ? keys.length : data.length, index: 0, state, rules, compiled, exitHooks }
}

// Pops exhausted frames (running their exit hooks) and moves the cursor to the next node to visit; its context is
// `undefined` when the crawl is done. `open` holds the containers of the open frames when cycles are guarded.
const advance = <T extends {}, R extends {}>(frames: Frame<T, R>[], cursor: Cursor<T, R>, open: Set<object> | undefined): void => {
  while (frames.length) {
    const frame = frames[frames.length - 1]
    if (frame.index < frame.length && nextChild(frame, cursor)) { return }
    runExitHooks(frame.exitHooks)
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

export const runCrawl = async <T extends {}, R extends {} = {}>(
  data: unknown,
  hooks: Array<CrawlHook<T, R> | SyncCrawlHook<T, R>>,
  params: EngineParams<T, R>,
  post?: PostStep<T, R>
): Promise<void> => {
  const { rules } = params
  const frames: Frame<T, R>[] = []
  const root = rootPathNode()
  const cursor: Cursor<T, R> = { context: createContext(data, root, undefined, params.state, rules), node: root, path: undefined }
  const open = params.circular ? new Set<object>() : undefined
  const sink: PostSink = { exitHook: undefined }

  while (cursor.context) {
    let context: CrawlContext<T, R> = cursor.context
    let exitHooks: ExitHook[] | undefined
    let descend = true

    for (let i = 0; i < hooks.length; i++) {
      // only thenables are awaited, so synchronous hooks do not pay for a microtask per node
      const result: ReturnType<CrawlHook<T, R>> = hooks[i](context)
      const response: CrawlHookResponse<T, R> | void = isThenable(result) ? await result : result
      if (!response || typeof response !== "object") { continue }
      if (response.terminate) { return }
      if (response.exitHook) { (exitHooks ??= []).push(response.exitHook) }
      if ("value" in response || "state" in response || "rules" in response) { context = applyResponse(context, cursor, response) }
      if (response.done) {
        descend = false
        break
      }
    }

    // the internal final step (clone, transform) runs from its own call site, after the user hooks, unless they stopped
    // the descent; it receives the node's original value (cursor.context is the context before any hook ran)
    let childState = context.state
    if (post !== undefined && descend) {
      const result = post(context, cursor.context.value, sink)
      if (result === POST_DONE) {
        descend = false
      } else if (result !== undefined) {
        childState = result as T
      }
      if (sink.exitHook !== undefined) {
        (exitHooks ??= []).push(sink.exitHook)
        sink.exitHook = undefined
      }
    }

    if (descend && isObject(context.value) && !isOpenCycle(open, context.value)) {
      // only the innermost open container keeps its cached path (see the paths section of internal.ts)
      const frame = openFrame(frames, context, cursor, exitHooks, childState)
      if (frames.length) { releasePath(frames[frames.length - 1].node) }
      frames.push(frame)
    } else {
      if (cursor.node) { releasePath(cursor.node) }
      runExitHooks(exitHooks)
    }

    advance(frames, cursor, open)
  }
}

export const runSyncCrawl = <T extends {}, R extends {} = {}>(
  data: unknown,
  hooks: SyncCrawlHook<T, R>[],
  params: EngineParams<T, R>,
  post?: PostStep<T, R>
): void => {
  const { rules } = params
  const frames: Frame<T, R>[] = []
  const root = rootPathNode()
  const cursor: Cursor<T, R> = { context: createContext(data, root, undefined, params.state, rules), node: root, path: undefined }
  const open = params.circular ? new Set<object>() : undefined
  const sink: PostSink = { exitHook: undefined }

  while (cursor.context) {
    let context: CrawlContext<T, R> = cursor.context
    let exitHooks: ExitHook[] | undefined
    let descend = true

    for (let i = 0; i < hooks.length; i++) {
      const response = hooks[i](context)
      if (!response || typeof response !== "object") { continue }
      if (isThenable(response)) {
        throw new TypeError("syncCrawl received an async hook (the hook returned a Promise); use crawl() for async hooks")
      }
      if (response.terminate) { return }
      if (response.exitHook) { (exitHooks ??= []).push(response.exitHook) }
      if ("value" in response || "state" in response || "rules" in response) { context = applyResponse(context, cursor, response) }
      if (response.done) {
        descend = false
        break
      }
    }

    // the internal final step (clone, transform) runs from its own call site, after the user hooks, unless they stopped
    // the descent; it receives the node's original value (cursor.context is the context before any hook ran)
    let childState = context.state
    if (post !== undefined && descend) {
      const result = post(context, cursor.context.value, sink)
      if (result === POST_DONE) {
        descend = false
      } else if (result !== undefined) {
        childState = result as T
      }
      if (sink.exitHook !== undefined) {
        (exitHooks ??= []).push(sink.exitHook)
        sink.exitHook = undefined
      }
    }

    if (descend && isObject(context.value) && !isOpenCycle(open, context.value)) {
      // only the innermost open container keeps its cached path (see the paths section of internal.ts)
      const frame = openFrame(frames, context, cursor, exitHooks, childState)
      if (frames.length) { releasePath(frames[frames.length - 1].node) }
      frames.push(frame)
    } else {
      if (cursor.node) { releasePath(cursor.node) }
      runExitHooks(exitHooks)
    }

    advance(frames, cursor, open)
  }
}
