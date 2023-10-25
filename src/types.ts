export type JsonPath = (string | number)[]

export interface CrawlParams<T extends {}, R extends {} = {}> {
  state?: T
  rules?: CrawlRules<R, T> | CrawlRules<R, T>[]
}

export interface CrawlContext<T extends {}, R extends {} = {}> {
  readonly value: unknown         // current node value
  readonly path: JsonPath         // path to current node
  readonly key: string | number   // current node key
  state: T                        // crawl state
  rules?: CrawlRules<R, T>        // current node rules
}

export type ExitHook = () => void

export interface CrawlHookResponse<T extends {}, R extends {}> {
  value?: unknown,                        // updated value of current node for crawl
  state?: T                               // state for next crawl step
  rules?: CrawlRules<R, T>                // rules for next crawl step
  exitHook?: ExitHook                     // on exit hook for current node
  terminate?: boolean                     // crawl should be terminated
  done?: boolean                          // crawl of current node should be terminated
}

export type CloneState<T extends {} = {}> = {
  root: { "#": any } 
  node: any
} & T

export type CloneHook<T extends {} = {}, R extends {} = {}> = CrawlHook<CloneState<T>, R>
export type CrawlHook<T extends {} = {}, R extends {} = {}> = (ctx: CrawlContext<T, R>) => Promise<CrawlHookResponse<T, R> | void> | CrawlHookResponse<T, R> | void

export type SyncCloneHook<T extends {} = {}, R extends {} = {}> = SyncCrawlHook<CloneState<T>, R>
export type SyncCrawlHook<T extends {} = {}, R extends {} = {}> = (ctx: CrawlContext<T, R>) => CrawlHookResponse<T, R> | void

export type CrawlRulesFunc<R extends {}, T extends {} = {}> = (path: JsonPath, state: T) => CrawlRules<R, T>
export type CrawlRulesKey = `/${string | number}`
export type CrawlChildType<R extends {}, T extends {}> = CrawlRules<R, T> | CrawlRulesFunc<R, T>

export type CrawlRules<R extends {} = {}, T extends {} = {}> = {
  [key: CrawlRulesKey | '/*']: CrawlChildType<R | {}, T>
} & R
