import type { CloneHook, CloneState, CrawlParams, CrawlRules } from "./types"
import { isArray, isObject } from "./utils"
import { crawl } from "./crawl"

export const transform = async <T extends {}, R extends {} = {}>(data: any, hooks: CloneHook<T, R> | CloneHook<T, R>[] = [], params: CrawlParams<T, R> = {}) => {
  hooks = isArray(hooks) ? hooks : [hooks]
  const root: Record<string, unknown> = { "#": data }

  const transformHook: CloneHook<T, R> = async ({ value, path, key, state }) => {
    key = path.length ? key : "#"
    if (value === undefined) {
      if (isArray(state.node) && typeof key === "number") {
        state.node.splice(key, 1)
      } else if (isObject(state.node) && key in state.node) {
        delete state.node[key]
      }
    } else if (isObject(state.node)) {
      state.node[key] = value
    }
    return { value, state }
  }

  const _params: CrawlParams<CloneState<T>, R> = { 
    state: { ...params.state, root, node: root } as CloneState<T>,
    ...params.rules ? { rules: params.rules as CrawlRules<R> } : {}
  }

  await crawl(data, [...hooks, transformHook], _params)

  return root["#"]
}
