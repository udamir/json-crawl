import { CrawlChildType, CrawlRules, CrawlRulesKey, JsonPath } from "./types"

export const getNodeRules = <R extends {} = {}>(
  rules = {} as CrawlRules<R>,
  key: string | number,
  path: JsonPath,
  value: unknown
): CrawlRules<R> | undefined => {
  const rulesKey: CrawlRulesKey = `/${key}`

  let node: CrawlChildType<R> = rules
  if (rulesKey in node) {
    node = node[rulesKey] as CrawlChildType<R>
  } else if ("/*" in node) {
    node = node["/*"] as CrawlChildType<R>
  } else if ("/**" in node) {
    node = node["/**"] as CrawlChildType<R>
    return { ...typeof node === "function" ? node({ key,  path, value }) : node, "/**": node }
  } else {
    return
  }
  
  return typeof node === "function" ? node({ key, path, value }) : node
}

export const mergeRules = <T extends {}, R extends {} = {}>(rules: CrawlRules<R>[]): CrawlRules<R> => {
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
