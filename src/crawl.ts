import type { CrawlHook, CrawlParams, SyncCrawlHook } from "./types.ts"
import { mergeRules } from "./rules.ts"
import { type EngineParams, normalizeHooks, runCrawl, runSyncCrawl } from "./internal.ts"
import { isArray } from "./utils.ts"

type Hooks<T extends {}, R extends {}> = CrawlHook<T, R> | CrawlHook<T, R>[] | SyncCrawlHook<T, R> | SyncCrawlHook<T, R>[]

const engineParams = <T extends {}, R extends {}>(params: CrawlParams<T, R>): EngineParams<T, R> => ({
  state: params.state!,
  rules: isArray(params.rules) ? mergeRules(params.rules) : params.rules,
  circular: params.circular,
  lazy: params.lazyPath === true,
})

// async, so that an error while preparing the crawl (e.g. a rule merge conflict) rejects the promise instead of throwing
export const crawl = async <T extends {}, R extends {} = {}>(data: any, hooks: Hooks<T, R>, params: CrawlParams<T, R> = {}): Promise<void> =>
  runCrawl<T, R>(data, normalizeHooks<CrawlHook<T, R> | SyncCrawlHook<T, R>>(hooks), engineParams(params))

export const syncCrawl = <T extends {}, R extends {} = {}>(data: any, hooks: SyncCrawlHook<T, R> | SyncCrawlHook<T, R>[], params: CrawlParams<T, R> = {}): void =>
  runSyncCrawl<T, R>(data, normalizeHooks(hooks), engineParams(params))
