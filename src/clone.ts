import type { CloneHook, CloneState, CrawlParams, SyncCloneHook } from "./types"
import { crawl, syncCrawl } from "./crawl"
import { isObject } from "./utils"

export const clone = async <T extends {}, R extends {} = {}>(data: unknown, hooks: CloneHook<T, R> | CloneHook<T, R>[] = [], params: CrawlParams<T, R> = {}) => {
  hooks = Array.isArray(hooks) ? hooks : [hooks]
  const root: any = {}
  const nodes = new WeakMap<object, object | Array<unknown>>()

  const cloneHook: CloneHook<T, R> = async ({ value, path, key, state }) => {
    key = path.length ? key : "#"

    if (isObject(value)) {
      if (nodes.has(value)) {
        state.node[key] = nodes.get(value)
        return { done: true }
      }
      const _value = Array.isArray(value) ? [] : {}
      state.node[key] = _value
      nodes.set(value, _value)
    } else {
      state.node[key] = value
    }    

    return { value, state: { ...state, node: state.node[key] }}
  }

  const _params: CrawlParams<CloneState<T>, R> = { 
    state: { ...params.state ?? {} as T, root, node: root },
    ...params.rules ? { rules: params.rules } : {}
  }

  await crawl<CloneState<T>, R>(data, [...hooks, cloneHook], _params)

  return root["#"]
}

export const syncClone = <T extends {}, R extends {} = {}>(data: unknown, hooks: SyncCloneHook<T, R> | SyncCloneHook<T, R>[] = [], params: CrawlParams<T, R> = {}) => {
  hooks = Array.isArray(hooks) ? hooks : [hooks]
  const root: any = {}
  const nodes = new WeakMap<object, object | Array<unknown>>()

  const cloneHook: SyncCloneHook<T, R> = ({ value, path, key, state }) => {
    key = path.length ? key : "#"

    if (isObject(value)) {
      if (nodes.has(value)) {
        state.node[key] = nodes.get(value)
        return { done: true }
      }
      const _value = Array.isArray(value) ? [] : {}
      state.node[key] = _value
      nodes.set(value, _value)
    } else {
      state.node[key] = value
    }    
    
    return { value, state: { ...state, node: state.node[key] }}
  }

  const _params: CrawlParams<CloneState<T>, R> = { 
    state: { ...params.state ?? {} as T, root, node: root },
    ...params.rules ? { rules: params.rules } : {}
  }

  syncCrawl<CloneState<T>, R>(data, [...hooks, cloneHook], _params)

  return root["#"]
}
