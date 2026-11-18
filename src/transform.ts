import type { CloneHook, CloneState, CrawlContext, CrawlParams } from "./types.ts"
import { JSON_ROOT_KEY, REMOVE } from "./constants.ts"
import { type EngineParams, POST_DONE, type PostSink, normalizeHooks, runCrawl, setOwn } from "./internal.ts"
import { mergeRules } from "./rules.ts"
import { isArray, isObject } from "./utils.ts"

// internal state of the transform: `pending` collects the indexes removed from the array `node`, compacted on exit
type TransformState<T extends {}> = CloneState<T> & { pending?: number[] }

// Exit hook of an array node: splices out the elements removed while the array was crawled. Built here rather than
// inline, so that the transform hook itself captures nothing and allocates no context per call.
const compactArray = (array: unknown[], childState: { pending?: number[] }) => (): void => {
  const pending = childState.pending
  if (pending) {
    // indexes were recorded in ascending order; splicing from the end keeps the remaining indexes valid
    for (let i = pending.length - 1; i >= 0; i--) { array.splice(pending[i], 1) }
  }
}

// The write step of a transform, run by the engine after the user hooks: writes a replaced value into its parent,
// removes a node returned as REMOVE (object keys at once, array elements when the array is left), and makes a container
// the target of its children.
const transformStep = <T extends {}, R extends {}>(
  { value, key, state }: CrawlContext<TransformState<T>, R>,
  _original: unknown,
  sink: PostSink
): TransformState<T> | typeof POST_DONE | undefined => {
  const k = key === undefined ? JSON_ROOT_KEY : key
  const parent = state.node

  if (value === REMOVE) {
    if (isArray(parent)) {
      (state.pending ??= []).push(k as number)
    } else {
      delete parent[k]
    }
    return POST_DONE
  }

  if (parent[k] !== value) {
    setOwn(parent, k, value)
  }

  if (!isObject(value)) { return }

  // children are written into the current (possibly replaced) container
  const childState: TransformState<T> = { ...state, node: value, pending: undefined }
  if (isArray(value)) { sink.exitHook = compactArray(value, childState) }
  return childState
}

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
  const root: { [JSON_ROOT_KEY]: unknown } = { [JSON_ROOT_KEY]: data }
  const _params: EngineParams<TransformState<T>, R> = {
    state: { ...(params.state ?? ({} as T)), root, node: root },
    rules: isArray(params.rules) ? mergeRules(params.rules) : params.rules,
    circular: params.circular,
  }

  await runCrawl<TransformState<T>, R>(data, normalizeHooks(hooks), _params, transformStep<T, R>)

  return root[JSON_ROOT_KEY]
}
