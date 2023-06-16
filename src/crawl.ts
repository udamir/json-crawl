import { CrawlHook, CrawlHookResponse, ExitHook, SyncCrawlHook, JsonPath } from "./types"
import { isArray, isObject } from "./utils"

interface CrawlNode<T> {
  // node path
  path: JsonPath
  // node data
  data: Record<string | number, any>
  
  // node keys
  keys: Array<number | string>
  // current key
  keyIndex: number
  
  // node state
  state: T
  // node onExit hooks 
  hooks?: ExitHook[]
}

export const crawl = async <T>(data: any, hooks: CrawlHook<T> | CrawlHook<T>[], state: T): Promise<void> => {
  hooks = isArray(hooks) ? hooks : [hooks]

  const nodes: CrawlNode<T>[] = [{ data, state, path: [], keys: [], keyIndex: -1 }]

  while (nodes.length > 0) {
    const node = nodes[nodes.length-1]

    if (node.keyIndex >= node.keys.length) {
      // execute exitHooks
      while (node.hooks?.length) { node.hooks.pop()!() }
      
      // move to parent node
      nodes.pop()
      continue
    }

    const key = node.keys[node.keyIndex++]

    const [value, path] = nodes.length > 1 
      ? [node.data[key], [...node.path, key]]
      : [node.data, node.path] // root node
    
    let result: CrawlHookResponse<T> | null = { value, state: node.state }
    const exitHooks: ExitHook[]  = []

    // execute hooks
    for (const hook of hooks) {
      if (!hook || !result) { continue }
      result = await hook(result.value, { path, key, state: result.state! })
      result?.exitHook && exitHooks.push(result.exitHook)
    }
    
    // crawl result value
    if (result && isObject(result.value)) {
      const keys = isArray(result.value) ? [...result.value.keys()] : Object.keys(result.value)
      // move to child nodes
      nodes.push({ hooks: exitHooks, state: result.state!, data: result.value, path, keys, keyIndex: 0 })
    } else {
      // execute exitHooks
      while (exitHooks.length) { exitHooks.pop()!() }
    }
  }
}

export const syncCrawl = <T>(data: any, hooks: SyncCrawlHook<T> | SyncCrawlHook<T>[], state: T): void => {
  hooks = isArray(hooks) ? hooks : [hooks]

  const nodes: CrawlNode<T>[] = [{ data, state, path: [], keys: [], keyIndex: -1 }]

  while (nodes.length > 0) {
    const node = nodes[nodes.length-1]

    if (node.keyIndex >= node.keys.length) {
      // execute exitHooks
      while (node.hooks?.length) { node.hooks.pop()!() }
      
      // move to parent node
      nodes.pop()
      continue
    }

    const key = node.keys[node.keyIndex++]

    const [value, path] = nodes.length > 1 
      ? [node.data[key], [...node.path, key]]
      : [node.data, node.path] // root node
    
    let result: CrawlHookResponse<T> | null = { value, state: node.state }
    const exitHook: ExitHook[]  = []

    // execute hooks
    for (const hook of hooks) {
      if (!hook || !result) { continue }
      result = hook(result.value, { path, key, state: result.state || node.state })
      result?.exitHook && exitHook.push(result.exitHook)
    }
    
    // crawl result value
    if (result && isObject(result.value)) {
      const keys = isArray(result.value) ? [...result.value.keys()] : Object.keys(result.value)
      // move to child nodes
      nodes.push({ hooks: exitHook, state: result.state!, data: result.value, path, keys, keyIndex: 0 })
    } else {
      // execute exitHooks
      while (exitHook.length) { exitHook.pop()!() }
    }
  }
}
