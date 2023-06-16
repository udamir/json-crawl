import type { CloneHook } from "./types"
import { isArray } from "./utils"
import { crawl } from "./crawl"

export const transform = async <T>(data: any, hooks: CloneHook<T> | CloneHook<T>[] = [], state = {} as  T) => {
  hooks = isArray(hooks) ? hooks : [hooks]
  const root = { "#": data }

  const transformHook: CloneHook<T> = async (value, { path, key, state }) => {
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

  await crawl(data, [...hooks, transformHook], { ...state, root, node: root })

  return root["#"]
}
