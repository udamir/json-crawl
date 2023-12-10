import type { CrawlHook, ExitHook, SyncCrawlHook, JsonPath, CrawlRules, CrawlParams, CrawlContext } from "./types"
import { getNodeRules, mergeRules } from "./rules"
import { isArray, isObject } from "./utils"

interface CrawlNode<T extends {}, R extends {}> {
  // node path
  path: JsonPath
  // node data
  data: Record<string | number, any>
  
  // node keys
  keys: Array<number | string>
  // current key
  keyIndex: number
  
  // node rules
  rules?: CrawlRules<R> 

  // node state
  state: T
  // node onExit hooks 
  hooks?: ExitHook[]
}

export const crawl = async <T extends {}, R extends {} = {}>(data: any, hooks: CrawlHook<T, R> | CrawlHook<T, R>[], params: CrawlParams<T, R> = {}): Promise<void> => {
  hooks = isArray(hooks) ? hooks : [hooks]
  const _rules = isArray(params.rules) ? mergeRules(params.rules) : params.rules

  const nodes: CrawlNode<T, R>[] = [{ data, state: params.state!, path: [], keys: [], keyIndex: -1, rules: _rules! }]

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

    const [value, path, rules] = nodes.length > 1 
      ? [node.data[key], [...node.path, key], getNodeRules(node.rules, key, [...node.path, key], node.data[key])]
      : [node.data, node.path, _rules] // root node
    
    let context: CrawlContext<T, R> | null = { value, path, key, state: node.state, rules }
    const exitHooks: ExitHook[]  = []

    // execute hooks
    for (const hook of hooks) {
      if (!hook || typeof hook !== 'function') { continue }
      const { terminate, done, exitHook, ...rest } = await hook(context) ?? {}
      if (terminate) { return }
      context = { ...context, ...rest }
      exitHook && exitHooks.push(exitHook)
      if (done) { 
        context = null
        break
      }
    }
    
    // crawl result value
    if (context && isObject(context.value)) {
      const keys = isArray(context.value) ? [...context.value.keys()] : Object.keys(context.value)
      // move to child nodes
      nodes.push({ hooks: exitHooks, state: context.state, data: context.value, path, keys, keyIndex: 0, rules: context.rules })
    } else {
      // execute exitHooks
      while (exitHooks.length) { exitHooks.pop()!() }
    }
  }
}

export const syncCrawl = <T extends {}, R extends {} = {}>(data: any, hooks: SyncCrawlHook<T, R> | SyncCrawlHook<T, R>[], params: CrawlParams<T, R> = {}): void => {
  hooks = isArray(hooks) ? hooks : [hooks]
  const _rules = isArray(params.rules) ? mergeRules(params.rules) : params.rules

  const nodes: CrawlNode<T, R>[] = [{ data, state: params.state!, path: [], keys: [], keyIndex: -1, rules: _rules! }]

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

    const [value, path, rules] = nodes.length > 1 
      ? [node.data[key], [...node.path, key], getNodeRules(node.rules, key, [...node.path, key], node.data[key])]
      : [node.data, node.path, _rules] // root node
    
    let context: CrawlContext<T, R> | null = { value, path, key, state: node.state, rules }
    const exitHooks: ExitHook[]  = []

    // execute hooks
    for (const hook of hooks) {
      if (!hook || typeof hook !== 'function') { continue }
      const { terminate, done, exitHook, ...rest } = hook(context) ?? {}
      if (terminate) { return }
      exitHook && exitHooks.push(exitHook)
      context = { ...context, ...rest } 
      if (done) { 
        context = null
        break
      }
    }
    
    // crawl result value
    if (context && isObject(context.value)) {
      const keys = isArray(context.value) ? [...context.value.keys()] : Object.keys(context.value)
      // move to child nodes
      nodes.push({ hooks: exitHooks, state: context.state!, data: context.value, path, keys, keyIndex: 0, rules: context.rules })
    } else {
      // execute exitHooks
      while (exitHooks.length) { exitHooks.pop()!() }
    }
  }
}
