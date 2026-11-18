import type { CloneHook, CloneParams, CloneState, SyncCloneHook } from "./types.ts"
import { JSON_ROOT_KEY } from "./constants.ts"
import { type EngineParams, POST_DONE, type PostStep, normalizeHooks, runCrawl, runSyncCrawl, setOwn } from "./internal.ts"
import { mergeRules } from "./rules.ts"
import { isArray, isObject } from "./utils.ts"

// empty container of the same kind; arrays are preallocated with the source length (faster than growing `[]`), so
// holes, trailing ones included, stay holes
const newContainer = (value: object): object => (Array.isArray(value) ? new Array(value.length) : {})

// references are tracked unless `circular: false` declares the input a tree
const tracksReferences = (params: CloneParams<{}, {}>): boolean => params.circular !== false

// The write step of a clone, run by the engine after the user hooks: it writes the (possibly replaced) value into the
// copy under construction and, for a container, makes the copy the target of the children. With `tracked`, the node's
// original value identifies shared references and cycles: the copy made for it is reused and not descended again.
const cloneStep = <T extends {}, R extends {}>(tracked: boolean): PostStep<CloneState<T>, R> => {
  const nodes = tracked ? new WeakMap<object, object>() : undefined
  return ({ value, key, state }, original) => {
    const k = key === undefined ? JSON_ROOT_KEY : key

    if (!isObject(value) || (nodes !== undefined && !isObject(original))) {
      setOwn(state.node, k, value)
      return
    }

    if (nodes !== undefined) {
      const existing = nodes.get(original as object)
      if (existing) {
        setOwn(state.node, k, existing)
        return POST_DONE
      }
    }

    const copy = newContainer(value)
    setOwn(state.node, k, copy)
    nodes?.set(original as object, copy)

    return { ...state, node: copy }
  }
}

// Copy without hooks and rules: there is nothing to observe, so the crawl machinery (contexts, paths, frames, hook
// calls) is replaced by one iterative loop over [source, copy] pairs with the same output: own enumerable string keys,
// holes and array lengths kept, an own "__proto__" key written as a property, and with `tracked` every source
// container mapped to its single copy, so shared references and cycles are preserved.
const plainClone = (data: unknown, tracked: boolean): unknown => {
  if (!isObject(data)) { return data }
  const nodes = tracked ? new WeakMap<object, object>() : undefined
  const rootCopy = newContainer(data)
  nodes?.set(data, rootCopy)

  // pairs of containers still to fill: source at even, copy at odd positions
  const stack: object[] = [data, rootCopy]
  while (stack.length) {
    const copy = stack.pop() as Record<string | number, unknown>
    const source = stack.pop() as Record<string | number, unknown>
    if (Array.isArray(source)) {
      const length = (copy as unknown as unknown[]).length
      for (let i = 0; i < length; i++) {
        if (!(i in source)) { continue }
        const value = source[i]
        if (!isObject(value)) { copy[i] = value; continue }
        const seen = nodes?.get(value)
        if (seen !== undefined) { copy[i] = seen; continue }
        const child = newContainer(value)
        copy[i] = child
        nodes?.set(value, child)
        stack.push(value, child)
      }
    } else {
      const keys = Object.keys(source)
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i]
        const value = source[key]
        if (!isObject(value)) { setOwn(copy, key, value); continue }
        const seen = nodes?.get(value)
        if (seen !== undefined) { setOwn(copy, key, seen); continue }
        const child = newContainer(value)
        setOwn(copy, key, child)
        nodes?.set(value, child)
        stack.push(value, child)
      }
    }
  }
  return rootCopy
}

const cloneParams = <T extends {}, R extends {}>(params: CloneParams<T, R>): [{ [JSON_ROOT_KEY]: any }, EngineParams<CloneState<T>, R>] => {
  const root: { [JSON_ROOT_KEY]: any } = { [JSON_ROOT_KEY]: undefined }
  const _params: EngineParams<CloneState<T>, R> = {
    state: { ...(params.state ?? ({} as T)), root, node: root },
    rules: isArray(params.rules) ? mergeRules(params.rules) : params.rules,
    // the clone tracks references itself; the engine's cycle guard is not used
    circular: undefined,
  }
  return [root, _params]
}

export const clone = async <T extends {}, R extends {} = {}>(
  data: unknown,
  hooks: CloneHook<T, R> | CloneHook<T, R>[] | SyncCloneHook<T, R> | SyncCloneHook<T, R>[] = [],
  params: CloneParams<T, R> = {}
): Promise<unknown> => {
  const _hooks = normalizeHooks<CloneHook<T, R> | SyncCloneHook<T, R>>(hooks)
  if (!params.rules && !_hooks.length) { return plainClone(data, tracksReferences(params)) }
  const [root, _params] = cloneParams(params)

  await runCrawl<CloneState<T>, R>(data, _hooks, _params, cloneStep<T, R>(tracksReferences(params)))

  return root[JSON_ROOT_KEY]
}

export const syncClone = <T extends {}, R extends {} = {}>(
  data: unknown,
  hooks: SyncCloneHook<T, R> | SyncCloneHook<T, R>[] = [],
  params: CloneParams<T, R> = {}
): unknown => {
  const _hooks = normalizeHooks(hooks)
  if (!params.rules && !_hooks.length) { return plainClone(data, tracksReferences(params)) }
  const [root, _params] = cloneParams(params)

  runSyncCrawl<CloneState<T>, R>(data, _hooks, _params, cloneStep<T, R>(tracksReferences(params)))

  return root[JSON_ROOT_KEY]
}
