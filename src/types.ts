export type JsonPath = (string | number)[]

export interface CrawlParams<T, R = any> {
  state?: T
  rules?: CrawlRules<R, T>
}

export interface CrawlContext<T, R = any> {
  readonly path: JsonPath         // path to current node
  readonly key: string | number   // current node key
  state: T                        // crawl state
  rules?: CrawlRules<R, T>        // current node rules
}

export type ExitHook = () => void

export interface CrawlHookResponse<T> {
  value?: unknown,                        // updated value of current node for crawl
  state?: T,                              // state for next crawl step
  exitHook?: ExitHook                     // on exit hook for current node
}

export type CloneState<T> = {
  root: { "#": any } 
  node: any
} & (T | {})

export type CloneHook<T = any, R = any> = CrawlHook<CloneState<T>, R>
export type CrawlHook<T = any, R = any> = (value: unknown, ctx: CrawlContext<T, R>) => Promise<CrawlHookResponse<T> | null> | CrawlHookResponse<T> | null

export type SyncCloneHook<T = any, R = any> = SyncCrawlHook<CloneState<T>, R>
export type SyncCrawlHook<T = any, R = any> = (value: unknown, ctx: CrawlContext<T, R>) => CrawlHookResponse<T> | null

export type CrawlRulesFunc<R, T = any> = (path: JsonPath, state: T) => CrawlRules<R, T>
export type CrawlRulesKey = `/${string | number}`

export type CrawlRules<R, T = any> = {
  [key: CrawlRulesKey | '/*']: CrawlRules<R, T> | CrawlRulesFunc<R, T>
} & (R | {})
