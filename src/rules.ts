import { CrawlChildType, CrawlRules, CrawlRulesFunc, CrawlRulesKey, JsonPath } from "./types"

export const getNodeRules = <T extends {}, R extends {} = {}>(
  rules = {} as CrawlRules<R, T>,
  key: string | number,
  path: JsonPath,
  state = {} as T
): CrawlRules<R, T> | undefined => {
  const rulesKey: CrawlRulesKey = `/${key}`

  let node: CrawlChildType<R, T> = rules
  if (rulesKey in node) {
    node = node[rulesKey] as CrawlChildType<R, T>
  } else if ("/*" in node) {
    node = node["/*"] as CrawlChildType<R, T>
  } else if ("/**" in node) {
    node = node["/**"] as CrawlChildType<R, T>
    return { ...typeof node === "function" ? node(path, state) : node, "/**": node }
  } else {
    return
  }
  
  return typeof node === "function" ? node(path, state) : node
}

export const findCrawlRules = <T extends {}, R extends {} = {}>(rules: CrawlRules<R, T>, path: JsonPath, state = {} as T): CrawlRules<R | {}, T> | undefined => {
  let node: CrawlRules<R, T> | CrawlRulesFunc<R, T> = rules

  for (let index = 0; index < path.length; index++) {
    node = getNodeRules(node, path[index], path.slice(0, index), state)!
    
    if (!node) { return }
  }

  return node
}

export const mergeRules = <T extends {}, R extends {} = {}>(rules: CrawlRules<R, T>[]): CrawlRules<R, T> => {
  const _rules: any = {}

  const keys: Set<string> = rules.reduce((set, r) => { 
    Object.keys(r).forEach((key) => set.add(key))
    return set
  }, new Set<string>())

  for (const key of keys.keys()) {
    const arr: any = rules.filter((v) => key in v)
    if (arr.length === 1) {
      _rules[key] = arr[0][key]
      continue
    } 

    if (key.charAt(0) === "/") {
      // merge rules path
      _rules[key] = (path: JsonPath, state: T) => {
        const _arr = arr.map((v: any) => typeof v[key] === "function" ? v[key](path, state) : v[key])
        return mergeRules(_arr)
      }
    } else {
      throw new Error(`Cannot merge rules. Duplicate key: ${key}. Rules should not have same Rule key`)
    }
  }

  return _rules
}
