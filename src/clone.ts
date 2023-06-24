import { CloneHook, CloneState, CrawlParams, SyncCloneHook } from "./types"
import { crawl, syncCrawl } from "./crawl"
import { isObject } from "./utils"

export const clone = async <T, R>(data: any, hooks: CloneHook<T, R> | CloneHook<T, R>[] = [], params: CrawlParams<CloneState<T>, R>  = {}) => {
  hooks = Array.isArray(hooks) ? hooks : [hooks]
  const root: any = {}

  const cloneHook: CloneHook<T, R> = async (value, { path, key, state }) => {
    key = path.length ? key : "#"
    state.node[key] = isObject(value) ? (Array.isArray(value) ? [] : {}) : value
    return { value, state: { ...state, node: state.node[key] } as CloneState<T> }
  }

  await crawl<CloneState<T>, R>(data, [...hooks, cloneHook], { ...params, state: { ...params.state, root, node: root } })

  return root["#"]
}

export const syncClone = <T, R, C>(data: any, hooks: SyncCloneHook<T, R> | SyncCloneHook<T, R>[] = [], params: CrawlParams<CloneState<T>, R> = {}) => {
  hooks = Array.isArray(hooks) ? hooks : [hooks]
  const root: any = {}

  const cloneHook: SyncCloneHook<T, R> = (value, { path, key, state }) => {
    key = path.length ? key : "#"
    state.node[key] = isObject(value) ? (Array.isArray(value) ? [] : {}) : value
    return { value, state: { ...state, node: state.node[key] } as CloneState<T> }
  }

  syncCrawl<CloneState<T>, R>(data, [...hooks, cloneHook], { ...params, state: { ...params.state, root, node: root } })

  return root["#"]
}
