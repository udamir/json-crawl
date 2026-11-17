import type { CloneHook, CloneParams, CloneState, CrawlParams, SyncCloneHook } from "./types.ts"
import { crawl, syncCrawl } from "./crawl.ts"
import { JSON_ROOT_KEY } from "./constants.ts"
import { setOwn } from "./internal.ts"
import { isObject } from "./utils.ts"

interface CloneHooks<T extends {}, R extends {}> {
  pre: SyncCloneHook<T, R>[]    // run before the user hooks
  post: SyncCloneHook<T, R>     // run after the user hooks: writes the node into the clone
}

// empty container of the same kind; arrays keep their length so that holes, trailing ones included, stay holes
const newContainer = (value: object): object => {
  if (!Array.isArray(value)) { return {} }
  const copy: unknown[] = []
  copy.length = value.length
  return copy
}

// references are tracked unless `circular: false` declares the input a tree
const tracksReferences = (params: CloneParams<{}, {}>): boolean => params.circular !== false

const createCloneHooks = <T extends {}, R extends {} = {}>(tracked: boolean): CloneHooks<T, R> => {
  if (!tracked) {
    // no cycle or shared-reference tracking: every container is copied, cyclic input never terminates
    const treeCloneHook: SyncCloneHook<T, R> = ({ value, key, state }) => {
      const k = key === undefined ? JSON_ROOT_KEY : key
      if (!isObject(value)) {
        setOwn(state.node, k, value)
        return
      }
      const copy = newContainer(value)
      setOwn(state.node, k, copy)
      return { state: { ...state, node: copy } }
    }
    return { pre: [], post: treeCloneHook }
  }

  // the original (pre-hook) value of the node identifies shared references and cycles; the clone made for it is reused
  const nodes = new WeakMap<object, object>()
  let originalValue: unknown = undefined

  const preHook: SyncCloneHook<T, R> = ({ value }) => {
    originalValue = value
  }

  const cloneHook: SyncCloneHook<T, R> = ({ value, key, state }) => {
    const k = key === undefined ? JSON_ROOT_KEY : key

    if (!isObject(value) || !isObject(originalValue)) {
      setOwn(state.node, k, value)
      return
    }

    const existing = nodes.get(originalValue)
    if (existing) {
      setOwn(state.node, k, existing)
      return { done: true }
    }

    const copy = newContainer(value)
    setOwn(state.node, k, copy)
    nodes.set(originalValue, copy)

    return { state: { ...state, node: copy } }
  }

  return { pre: [preHook], post: cloneHook }
}

const cloneParams = <T extends {}, R extends {}>(params: CloneParams<T, R>): [{ [JSON_ROOT_KEY]: any }, CrawlParams<CloneState<T>, R>] => {
  const root: { [JSON_ROOT_KEY]: any } = { [JSON_ROOT_KEY]: undefined }
  const _params: CrawlParams<CloneState<T>, R> = {
    state: { ...(params.state ?? ({} as T)), root, node: root },
    ...(params.rules ? { rules: params.rules } : {}),
  }
  return [root, _params]
}

export const clone = async <T extends {}, R extends {} = {}>(
  data: unknown,
  hooks: CloneHook<T, R> | CloneHook<T, R>[] | SyncCloneHook<T, R> | SyncCloneHook<T, R>[] = [],
  params: CloneParams<T, R> = {}
): Promise<unknown> => {
  hooks = Array.isArray(hooks) ? hooks : [hooks]
  const [root, _params] = cloneParams(params)
  const { pre, post } = createCloneHooks<T, R>(tracksReferences(params))

  await crawl<CloneState<T>, R>(data, [...pre, ...hooks, post], _params)

  return root[JSON_ROOT_KEY]
}

export const syncClone = <T extends {}, R extends {} = {}>(
  data: unknown,
  hooks: SyncCloneHook<T, R> | SyncCloneHook<T, R>[] = [],
  params: CloneParams<T, R> = {}
): unknown => {
  hooks = Array.isArray(hooks) ? hooks : [hooks]
  const [root, _params] = cloneParams(params)
  const { pre, post } = createCloneHooks<T, R>(tracksReferences(params))

  syncCrawl<CloneState<T>, R>(data, [...pre, ...hooks, post], _params)

  return root[JSON_ROOT_KEY]
}
