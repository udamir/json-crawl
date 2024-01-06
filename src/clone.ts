import type { CloneHook, CloneState, CrawlParams, SyncCloneHook } from "./types"
import { crawl, syncCrawl } from "./crawl"
import { isObject } from "./utils"

const createCloneHooks = <T extends {}, R extends {} = {}>(): SyncCloneHook<T, R>[] => {
  const nodes = new WeakMap<object, object | Array<unknown>>()
  let originalValue: unknown = undefined

  const preHook: SyncCloneHook<T, R> = ({ value }) => {
    originalValue = value
  }

  const cloneHook: SyncCloneHook<T, R> = ({ value, path, key, state }) => {
    key = path.length ? key : "#"

    if (isObject(originalValue) && isObject(value)) {
      if (nodes.has(originalValue)) {
        state.node[key] = nodes.get(originalValue)
        return { done: true }
      }
      const _value = Array.isArray(value) ? [] : {}
      state.node[key] = _value
      nodes.set(originalValue, _value)
    } else {
      state.node[key] = value
    }    

    return { value, state: { ...state, node: state.node[key] }}
  }

  return [preHook, cloneHook]
}

export const clone = async <T extends {}, R extends {} = {}>(
  data: unknown, 
  hooks: CloneHook<T, R> | CloneHook<T, R>[] | SyncCloneHook<T, R> | SyncCloneHook<T, R>[] = [],
  params: CrawlParams<T, R> = {}
): Promise<unknown> => {
  hooks = Array.isArray(hooks) ? hooks : [hooks]
  const root = { "#": undefined }

  const _params: CrawlParams<CloneState<T>, R> = { 
    state: { ...params.state ?? {} as T, root, node: root },
    ...params.rules ? { rules: params.rules } : {}
  }

  const [ preHook, cloneHook ] = createCloneHooks<T, R>()

  await crawl<CloneState<T>, R>(data, [ preHook, ...hooks, cloneHook], _params)

  return root["#"]
}

export const syncClone = <T extends {}, R extends {} = {}>(
  data: unknown,
  hooks: SyncCloneHook<T, R> | SyncCloneHook<T, R>[] = [],
  params: CrawlParams<T, R> = {}
): unknown => {
  hooks = Array.isArray(hooks) ? hooks : [hooks]
  const root = { "#": undefined }

  const _params: CrawlParams<CloneState<T>, R> = { 
    state: { ...params.state ?? {} as T, root, node: root },
    ...params.rules ? { rules: params.rules } : {}
  }

  const [ preHook, cloneHook ] = createCloneHooks<T, R>()

  syncCrawl<CloneState<T>, R>(data, [preHook, ...hooks, cloneHook], _params)

  return root["#"]
}
