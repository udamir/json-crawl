import type { CrawlChildType, CrawlRules, CrawlRulesContext, CrawlRulesFunc, JsonPath } from "./types.ts"
import { compileRules, matchCompiled, resolveNodeRules } from "./internal.ts"

/**
 * Returns the rule of the longest prefix rule (`"/<prefix>*"`) of `rules` that `key` starts with (unresolved: a rule
 * object or a function rule), or `undefined` when none matches. Throws a `TypeError` for a key ending in `**` other
 * than `/**`.
 */
export const matchPrefixRule = <R extends {} = {}>(rules: CrawlRules<R>, key: string): CrawlChildType<R> | undefined =>
  matchCompiled(rules, compileRules(rules).prefixes, key)

/**
 * Resolves the rules of a child node from the rules of its parent.
 *
 * Resolution order: exact key `/<key>` > longest matching prefix `/<prefix>*` > `/*` > `/**`, merged with higher-priority
 * fields overriding lower ones, and `/**` is carried into the result so that it propagates to every descendant.
 * Prefix rules apply to string keys only (array indexes never match a prefix). Returns `undefined` when the parent has
 * neither an exact rule for the key, nor a matching prefix, nor `/*`, nor `/**`. Function rules receive
 * `{ key, path, value }` and may return `undefined` to contribute nothing at this node; a `/**` function returning
 * `undefined` still keeps `/**` for the subtree.
 */
export const getNodeRules = <R extends {} = {}>(
  rules: CrawlRules<R> | undefined,
  key: string | number,
  path: JsonPath,
  value: unknown
): CrawlRules<R> | undefined => resolveNodeRules(rules, key, path, undefined, value, undefined)

// Rule of a path key present in several rule sets: resolved lazily with the real rules context, `undefined` results
// are dropped and the rest is merged recursively.
const mergeChildRules = <R extends {}>(values: CrawlChildType<R>[]): CrawlRulesFunc<R> => (ctx: CrawlRulesContext) => {
  const resolved: CrawlRules<R>[] = []
  for (const v of values) {
    const r = typeof v === "function" ? v(ctx) : v
    if (r !== undefined) { resolved.push(r as CrawlRules<R>) }
  }
  return resolved.length ? mergeRules(resolved) : undefined
}

/**
 * Merges several rule sets into one. Keys present in a single set are copied by reference; path keys (`/...`) present
 * in several sets are merged lazily, when the path is resolved, so nested conflicts surface only for the nodes that
 * reach them (prefix rules `/<prefix>*` are path keys too); a non-path key present in several sets is a conflict and
 * throws immediately.
 */
export const mergeRules = <R extends {} = {}>(rules: CrawlRules<R>[]): CrawlRules<R> => {
  const _rules: any = {}

  const keys = new Set<string>()
  for (const r of rules) {
    for (const key of Object.keys(r)) { keys.add(key) }
  }

  for (const key of keys) {
    const arr: any[] = rules.filter((v) => key in v)
    if (arr.length === 1) {
      _rules[key] = arr[0][key]
      continue
    }

    if (key.charAt(0) === "/") {
      // merge rules path; function rules receive the real rules context and may return undefined
      _rules[key] = mergeChildRules(arr.map((v) => v[key]))
    } else {
      throw new Error(`Cannot merge rules. Duplicate key: ${key}. Rules should not have same Rule key`)
    }
  }

  return _rules
}
