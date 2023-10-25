import { CloneHook, CloneState, CrawlParams, CrawlRules, SyncCloneHook } from "./types"
import { crawl, syncCrawl } from "./crawl"
import { isObject } from "./utils"

export const clone = async <T extends {}, R extends {} = {}>(data: any, hooks: CloneHook<T, R> | CloneHook<T, R>[] = [], params: CrawlParams<T, R> = {}) => {
  hooks = Array.isArray(hooks) ? hooks : [hooks]
  const root: any = {}

  const cloneHook: CloneHook<T, R> = async ({ value, path, key, state }) => {
    key = path.length ? key : "#"
    state.node[key] = isObject(value) ? (Array.isArray(value) ? [] : {}) : value
    return { value, state: { ...state, node: state.node[key] } as CloneState<T> }
  }

  const _params: CrawlParams<CloneState<T>, R> = { 
    state: { ...params.state, root, node: root } as CloneState<T>,
    ...params.rules ? { rules: params.rules as CrawlRules<R, CloneState<T>> } : {}
  }

  await crawl<CloneState<T>, R>(data, [...hooks, cloneHook], _params)

  return root["#"]
}

export const syncClone = <T extends {}, R extends {} = {}>(data: any, hooks: SyncCloneHook<T, R> | SyncCloneHook<T, R>[] = [], params: CrawlParams<T, R> = {}) => {
  hooks = Array.isArray(hooks) ? hooks : [hooks]
  const root: any = {}

  const cloneHook: SyncCloneHook<T, R> = ({ value, path, key, state }) => {
    key = path.length ? key : "#"
    state.node[key] = isObject(value) ? (Array.isArray(value) ? [] : {}) : value
    return { value, state: { ...state, node: state.node[key] } as CloneState<T> }
  }

  const _params: CrawlParams<CloneState<T>, R> = { 
    state: { ...params.state, root, node: root } as CloneState<T>,
    ...params.rules ? { rules: params.rules as CrawlRules<R, CloneState<T>> } : {}
  }

  syncCrawl<CloneState<T>, R>(data, [...hooks, cloneHook], _params)

  return root["#"]
}
