import { CrawlRules, CrawlRulesFunc, CrawlRulesKey, JsonPath } from "./types"

export const getNodeRules = <R, T>(
  rules: CrawlRules<R, T> = {},
  key: string | number,
  path: JsonPath,
  state = {} as T
): CrawlRules<R, T> | undefined => {
  const rulesKey: CrawlRulesKey = `/${key}`

  let node: CrawlRules<R, T> | CrawlRulesFunc<R, T> = rules
  if (rulesKey in node) {
    node = node[rulesKey]
  } else if ("/*" in node) {
    node = node["/*"]
  } else {
    return
  }
  
  return typeof node === "function" ? node(path, state) : node
}

export const findCrawlRules = <R, T = any>(rules: CrawlRules<R, T>, path: JsonPath, state = {} as T): CrawlRules<R, T> | undefined => {
  let node: CrawlRules<R, T> | CrawlRulesFunc<R, T> = rules

  for (let index = 0; index < path.length; index++) {
    node = getNodeRules(node, path[index], path.slice(0, index), state)!
    
    if (!node) { return }
  }

  return node
}
