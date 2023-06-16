export type JsonPath = (string | number)[]

export interface CrawlContext<T> {
  readonly path: JsonPath         // path to current node
  readonly key: string | number   // current node key
  state: T                        // crawl state
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
} & T

export type CloneHook<T> = CrawlHook<CloneState<T>>
export type CrawlHook<T> = (value: unknown, ctx: CrawlContext<T>) => Promise<CrawlHookResponse<T> | null> | CrawlHookResponse<T> | null

export type SyncCloneHook<T> = SyncCrawlHook<CloneState<T>>
export type SyncCrawlHook<T> = (value: unknown, ctx: CrawlContext<T>) => CrawlHookResponse<T> | null
