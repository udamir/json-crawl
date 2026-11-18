import type { JSON_ROOT_KEY } from "./constants.ts"

export type JsonPath = (string | number)[]

export interface CrawlParams<T extends {}, R extends {} = {}> {
  state?: T
  rules?: CrawlRules<R> | CrawlRules<R>[]
  /**
   * `crawl`, `syncCrawl`, `transform`: guard against cycles (default `false`). A node whose value is one of its own
   * ancestors is visited but its children are not, as if a hook had returned `done`. Without it a cyclic document
   * never finishes unless a hook stops the descent.
   */
  circular?: boolean
}

export interface CloneParams<T extends {}, R extends {} = {}> extends CrawlParams<T, R> {
  /**
   * `clone`, `syncClone`: preserve cycles and shared references (default `true`). With `false` the input is treated as
   * a tree: every reference is copied separately, which is faster, and a cyclic input never finishes.
   */
  circular?: boolean
}

export interface CrawlContext<T extends {}, R extends {} = {}> {
  readonly value: unknown                     // current node value
  readonly path: JsonPath                     // path to current node ([] for the root)
  readonly key: string | number | undefined   // current node key (undefined for the root)
  state: T                                    // crawl state
  rules?: CrawlRules<R>                       // current node rules
}

export type ExitHook = () => void

export interface CrawlHookResponse<T extends {}, R extends {}> {
  value?: unknown,                        // updated value of current node for crawl
  state?: T                               // state for next crawl step
  rules?: CrawlRules<R>                   // rules for next crawl step
  exitHook?: ExitHook                     // on exit hook for current node
  terminate?: boolean                     // crawl should be terminated
  done?: boolean                          // crawl of current node should be terminated
}

export type CloneState<T extends {} = {}> = {
  root: { [JSON_ROOT_KEY]: any }
  node: Record<string | number, unknown>
} & T

export type CloneHook<T extends {} = {}, R extends {} = {}> = CrawlHook<CloneState<T>, R>
export type CrawlHook<T extends {} = {}, R extends {} = {}> = (ctx: CrawlContext<T, R>) => Promise<CrawlHookResponse<T, R> | void> | CrawlHookResponse<T, R> | void

export type SyncCloneHook<T extends {} = {}, R extends {} = {}> = SyncCrawlHook<CloneState<T>, R>
export type SyncCrawlHook<T extends {} = {}, R extends {} = {}> = (ctx: CrawlContext<T, R>) => CrawlHookResponse<T, R> | void

export type CrawlRulesContext = {
  key: string | number
  path: JsonPath
  value: unknown
}
export type CrawlRulesFunc<R extends {}> = (ctx: CrawlRulesContext) => CrawlRules<R> | undefined
export type CrawlRulesKey = `/${string | number}`
export type CrawlChildType<R extends {}> = CrawlRules<R> | CrawlRulesFunc<R>

// Path keys of a rule set: `/<key>` exact key, `/<prefix>*` any string key starting with `<prefix>` (prefix rule,
// longest prefix wins, array indexes never match), `/*` any key, `/**` any key at any depth.
export type CrawlRules<R extends {} = {}> = {
  [key: CrawlRulesKey | "/*" | "/**"]: CrawlChildType<R | {}>
} & R
