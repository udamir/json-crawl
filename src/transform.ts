import type { CloneHook, CloneState, CrawlHook, CrawlParams } from "./types.ts"
import { JSON_ROOT_KEY, REMOVE } from "./constants.ts"
import { setOwn } from "./internal.ts"
import { isArray, isObject } from "./utils.ts"
import { crawl } from "./crawl.ts"

// internal state of the transform: `pending` collects the indexes removed from the array `node`, compacted on exit
type TransformState<T extends {}> = CloneState<T> & { pending?: number[] }

/**
 * Transforms a document in place. Hooks return `{ value }` to replace the current node in its parent (at the root the
 * replacement becomes the result), `{ value: REMOVE }` to delete it (object keys are deleted, array elements are spliced
 * out once the array has been crawled, so every original element is still visited), or nothing to leave it untouched.
 * Returns the (mutated) input, the root replacement, or `undefined` when the root was removed. Cycles are followed
 * unless `circular: true` is passed: a cyclic document otherwise needs a hook that stops the descent.
 */
export const transform = async <T extends {}, R extends {} = {}>(
  data: any,
  hooks: CloneHook<T, R> | CloneHook<T, R>[] = [],
  params: CrawlParams<T, R> = {}
): Promise<unknown> => {
  hooks = isArray(hooks) ? hooks : [hooks]
  const root: { [JSON_ROOT_KEY]: unknown } = { [JSON_ROOT_KEY]: data }

  const transformHook: CrawlHook<TransformState<T>, R> = ({ value, key, state }) => {
    const k = key === undefined ? JSON_ROOT_KEY : key
    const parent = state.node

    if (value === REMOVE) {
      if (isArray(parent)) {
        (state.pending ??= []).push(k as number)
      } else {
        delete parent[k]
      }
      return { done: true }
    }

    if (parent[k] !== value) {
      setOwn(parent, k, value)
    }

    if (!isObject(value)) { return }

    // children are written into the current (possibly replaced) container
    const childState: TransformState<T> = { ...state, node: value, pending: undefined }
    if (!isArray(value)) {
      return { state: childState }
    }
    return {
      state: childState,
      exitHook: () => {
        const pending = childState.pending
        if (pending) {
          // indexes were recorded in ascending order; splicing from the end keeps the remaining indexes valid
          for (let i = pending.length - 1; i >= 0; i--) { value.splice(pending[i], 1) }
        }
      },
    }
  }

  const _params: CrawlParams<TransformState<T>, R> = {
    state: { ...(params.state ?? ({} as T)), root, node: root },
    ...(params.rules ? { rules: params.rules } : {}),
    ...(params.circular ? { circular: true } : {}),
  }

  await crawl<TransformState<T>, R>(data, [...(hooks as CrawlHook<TransformState<T>, R>[]), transformHook], _params)

  return root[JSON_ROOT_KEY]
}
