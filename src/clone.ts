import { CloneHook, CloneState, SyncCloneHook } from "./types"
import { crawl, syncCrawl } from "./crawl"
import { isObject } from "./utils"

export const clone = async <T>(data: any, hooks: CloneHook<T> | CloneHook<T>[] = [], state = {} as T) => {
  hooks = Array.isArray(hooks) ? hooks : [hooks]
  const root: any = {}

  const cloneHook: CloneHook<T> = async (value, { path, key, state }) => {
    key = path.length ? key : "#"
    state.node[key] = isObject(value) ? (Array.isArray(value) ? [] : {}) : value
    return { value, state: { ...state, node: state.node[key] } as CloneState<T> }
  }

  await crawl<CloneState<T>>(data, [...hooks, cloneHook], { ...state, root, node: root })

  return root["#"]
}

export const syncClone = <T>(data: any, hooks: SyncCloneHook<T> | SyncCloneHook<T>[] = [], state = {} as T) => {
  hooks = Array.isArray(hooks) ? hooks : [hooks]
  const root: any = {}

  const cloneHook: SyncCloneHook<T> = (value, { path, key, state }) => {
    key = path.length ? key : "#"
    state.node[key] = isObject(value) ? (Array.isArray(value) ? [] : {}) : value
    return { value, state: { ...state, node: state.node[key] } as CloneState<T> }
  }

  syncCrawl<CloneState<T>>(data, [...hooks, cloneHook], { ...state, root, node: root })

  return root["#"]
}
