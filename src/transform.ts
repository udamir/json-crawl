import type { CloneHook, CloneState, CrawlParams } from "./types"
import { isArray } from "./utils"
import { crawl } from "./crawl"

export const transform = async <T, R>(data: any, hooks: CloneHook<T, R> | CloneHook<T, R>[] = [], params: CrawlParams<CloneState<T>, R> = {}) => {
  hooks = isArray(hooks) ? hooks : [hooks]
  const root = { "#": data }

  const transformHook: CloneHook<T, R> = async (value, { path, key, state }) => {
    key = path.length ? key : "#"
    if (value === undefined) {
      if (isArray(state.node) && typeof key === "number") {
        state.node.splice(key, 1)
      } else {
        delete state.node[key]
      }
    } else {
      state.node[key] = value
    }
    return { value, state }
  }

  await crawl(data, [...hooks, transformHook], { ...params, state: { ...params.state, root, node: root } })

  return root["#"]
}
