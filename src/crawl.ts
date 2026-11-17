import type { CrawlContext, CrawlHook, CrawlHookResponse, CrawlParams, CrawlRules, ExitHook, JsonPath, SyncCrawlHook } from "./types.ts"
import { mergeRules } from "./rules.ts"
import {
  EAGER_PATH_DEPTH,
  type PathNode,
  childPath,
  childPathNode,
  type CompiledRules,
  compileRules,
  isThenable,
  materializePath,
  releasePath,
  resolveNodeRules,
  rootPathNode,
} from "./internal.ts"
import { isArray, isObject } from "./utils.ts"

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

type Hooks<T extends {}, R extends {}> = CrawlHook<T, R> | CrawlHook<T, R>[] | SyncCrawlHook<T, R> | SyncCrawlHook<T, R>[]

// hooks may be passed as a single function or as an array that may contain non-function entries, which are skipped
const normalizeHooks = <H>(hooks: H | H[]): H[] => {
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
const openFrame = <T extends {}, R extends {}>(frames: Frame<T, R>[], context: CrawlContext<T, R>, cursor: Cursor<T, R>, exitHooks: ExitHook[] | undefined): Frame<T, R> => {
  // the root and deep nodes already have a path node; a shallow node gets one now, from its parent, the top frame
  const node = cursor.node ?? childPathNode(frames[frames.length - 1].node, context.key!, cursor.path)
  const data = context.value as Record<string | number, any>
  const keys = isArray(data) ? undefined : Object.keys(data)
  const { rules } = context
  // compiled once for all the children of the container, so a rule set built for this node is scanned once
  const compiled = rules && keys && keys.length ? compileRules(rules) : undefined
  return { data, node, keys, length: keys ? keys.length : data.length, index: 0, state: context.state, rules, compiled, exitHooks }
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

export const crawl = async <T extends {}, R extends {} = {}>(data: any, hooks: Hooks<T, R>, params: CrawlParams<T, R> = {}): Promise<void> => {
  const _hooks = normalizeHooks(hooks)
  const rules = isArray(params.rules) ? mergeRules(params.rules) : params.rules

  const frames: Frame<T, R>[] = []
  const root = rootPathNode()
  const cursor: Cursor<T, R> = { context: createContext(data, root, undefined, params.state!, rules), node: root, path: undefined }
  const open = params.circular ? new Set<object>() : undefined

  while (cursor.context) {
    let context: CrawlContext<T, R> = cursor.context
    let exitHooks: ExitHook[] | undefined
    let descend = true

    for (let i = 0; i < _hooks.length; i++) {
      // only thenables are awaited, so synchronous hooks do not pay for a microtask per node
      const result: ReturnType<CrawlHook<T, R>> = _hooks[i](context)
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

    if (descend && isObject(context.value) && !isOpenCycle(open, context.value)) {
      // only the innermost open container keeps its cached path (see the paths section of internal.ts)
      const frame = openFrame(frames, context, cursor, exitHooks)
      if (frames.length) { releasePath(frames[frames.length - 1].node) }
      frames.push(frame)
    } else {
      if (cursor.node) { releasePath(cursor.node) }
      runExitHooks(exitHooks)
    }

    advance(frames, cursor, open)
  }
}

export const syncCrawl = <T extends {}, R extends {} = {}>(data: any, hooks: SyncCrawlHook<T, R> | SyncCrawlHook<T, R>[], params: CrawlParams<T, R> = {}): void => {
  const _hooks = normalizeHooks(hooks)
  const rules = isArray(params.rules) ? mergeRules(params.rules) : params.rules

  const frames: Frame<T, R>[] = []
  const root = rootPathNode()
  const cursor: Cursor<T, R> = { context: createContext(data, root, undefined, params.state!, rules), node: root, path: undefined }
  const open = params.circular ? new Set<object>() : undefined

  while (cursor.context) {
    let context: CrawlContext<T, R> = cursor.context
    let exitHooks: ExitHook[] | undefined
    let descend = true

    for (let i = 0; i < _hooks.length; i++) {
      const response = _hooks[i](context)
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

    if (descend && isObject(context.value) && !isOpenCycle(open, context.value)) {
      // only the innermost open container keeps its cached path (see the paths section of internal.ts)
      const frame = openFrame(frames, context, cursor, exitHooks)
      if (frames.length) { releasePath(frames[frames.length - 1].node) }
      frames.push(frame)
    } else {
      if (cursor.node) { releasePath(cursor.node) }
      runExitHooks(exitHooks)
    }

    advance(frames, cursor, open)
  }
}
