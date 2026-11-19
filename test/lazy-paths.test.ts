import { clone, crawl, syncClone, syncCrawl, transform, type CrawlContext, type JsonPath, type CrawlRulesContext } from "../src"

// Block L: lazy paths (`lazyPath: true`). `ctx.path` is an accessor on the prototype that builds the path on its first read.
// Every path must equal the one the default crawl hands out, at every node, in every function.

const chain = (levels: number): any => {
  let doc: any = { type: "string" }
  for (let i = 0; i < levels; i++) { doc = { properties: { a: doc } } }
  return doc
}

// holes, empty containers, keys that need escaping in pointers, null, nested arrays
// oxlint-disable-next-line no-sparse-arrays
const mixed = (): any => ({ a: [1, , { b: [[], {}] }], c: { "": { "~/": 1, "x.y": [null] } }, d: null, e: [{ f: 2 }] })

const eagerPaths = (doc: unknown): JsonPath[] => {
  const out: JsonPath[] = []
  syncCrawl(doc, ({ path }) => { out.push(path) })
  return out
}

describe("L1 lazy paths", () => {
  it("L1.1 a lazy context's `path` is not an own property, and it equals the default path at every node", () => {
    for (const doc of [mixed(), chain(10), [1, [2, [3]]], "primitive root"]) {
      const lazy: JsonPath[] = []
      syncCrawl(doc, (ctx) => {
        expect(Object.hasOwn(ctx, "path")).toBe(false)
        expect("path" in ctx).toBe(true)
        lazy.push(ctx.path)
      }, { lazyPath: true })
      expect(lazy).toEqual(eagerPaths(doc))
    }
  })

  it("L1.2 the other context fields are own enumerable properties, as in the default crawl; spreading leaves out path", () => {
    syncCrawl({ a: 1 }, (ctx) => {
      expect(Object.keys(ctx)).toEqual(["value", "key", "state", "rules", "parent"])
      expect({ ...ctx }).not.toHaveProperty("path")
    }, { lazyPath: true, state: {} })
  })

  it("L1.3 `path` is the same array on every read on one context, also from an exit hook after the children", () => {
    const doc = mixed()
    syncCrawl(doc, (ctx) => {
      const first = ctx.path
      expect(ctx.path).toBe(first)
      return { exitHook: () => { expect(ctx.path).toBe(first) } }
    }, { lazyPath: true })
  })

  it("L1.4 paths are right whether or not the parent's path was read, and when only some nodes read them", () => {
    const doc = mixed()
    const expected = eagerPaths(doc)
    // read at every other node only: a container whose path was not built still gives its children the right paths
    const seen: Array<[number, JsonPath]> = []
    let i = 0
    syncCrawl(doc, (ctx) => { if (i % 2) { seen.push([i, ctx.path]) } i++ }, { lazyPath: true })
    for (const [n, path] of seen) { expect(path).toEqual(expected[n]) }
  })

  it("L1.5 several hooks: a later hook after a state or value response gets the right path, and a replaced value's children too", () => {
    const paths: JsonPath[] = []
    syncCrawl<{ n: number }>({ a: { b: 1 } }, [
      ({ key, state }) => (key === "a" ? { value: { c: [1] }, state: { n: state.n + 1 } } : undefined),
      (ctx) => { paths.push(ctx.path) },
    ], { lazyPath: true, state: { n: 0 } })
    expect(paths).toEqual([[], ["a"], ["a", "c"], ["a", "c", 0]])
  })

  it("L1.6 the async crawl, clone, syncClone and transform give the same paths, also after awaited hooks", async () => {
    const doc = mixed()
    const expected = eagerPaths(doc)
    const collect = () => {
      const out: JsonPath[] = []
      return { out, hook: (ctx: CrawlContext<any>) => { out.push(ctx.path) } }
    }
    const a = collect()
    await crawl(doc, async (ctx) => { await Promise.resolve(); a.hook(ctx) }, { lazyPath: true })
    const b = collect()
    syncClone(doc, b.hook, { lazyPath: true })
    const c = collect()
    await clone(doc, async (ctx) => { c.hook(ctx) }, { lazyPath: true })
    const d = collect()
    await transform(structuredClone(doc), d.hook, { lazyPath: true })
    for (const { out } of [a, b, c, d]) { expect(out).toEqual(expected) }
  })

  it("L1.7 rule functions receive the right path, and the resolved rules equal the default crawl's", () => {
    const run = (lazy: boolean) => {
      const rulePaths: JsonPath[] = []
      const tags: unknown[] = []
      const rules = { "/**": (ctx: CrawlRulesContext) => { rulePaths.push([...ctx.path]); return { tag: ctx.key } } }
      const hook = ({ rules: r }: { rules?: { tag?: unknown } }) => { tags.push(r?.tag) }
      if (lazy) { syncCrawl(mixed(), hook, { rules, lazyPath: true }) } else { syncCrawl(mixed(), hook, { rules }) }
      return { rulePaths, tags }
    }
    expect(run(true)).toEqual(run(false))
  })

  it("L1.8 with circular: true the cycle guard still works and the paths stay right", () => {
    const doc: any = { a: { b: 1 } }
    doc.a.self = doc
    const lazy: JsonPath[] = []
    syncCrawl(doc, (ctx) => { lazy.push(ctx.path) }, { lazyPath: true, circular: true })
    const eager: JsonPath[] = []
    syncCrawl(doc, ({ path }) => { eager.push(path) }, { circular: true })
    expect(lazy).toEqual(eager)
  })

  it("L1.9 beyond the eager path depth: right paths when read at every node, and a 20 000-level chain without reads", () => {
    const doc = chain(300)
    const lazy: JsonPath[] = []
    syncCrawl(doc, (ctx) => { lazy.push(ctx.path) }, { lazyPath: true })
    expect(lazy).toEqual(eagerPaths(doc))
    let n = 0
    const start = performance.now()
    syncCrawl(chain(20_000), () => { n++ }, { lazyPath: true })
    expect(n).toBe(2 * 20_000 + 2) // every level is two objects, plus the { type } object and its leaf
    expect(performance.now() - start).toBeLessThan(2_000)
  })

  it("L1.0 lazyPath: false (or absent) gives the default contexts, with `path` an own property", () => {
    for (const params of [{ lazyPath: false }, {}]) {
      syncCrawl({ a: [1] }, (ctx) => { expect(Object.hasOwn(ctx, "path")).toBe(true) }, params)
    }
  })

  it("L1.10 destructuring `path` works (and builds it for every node it is destructured at)", () => {
    const lazy: JsonPath[] = []
    syncCrawl(mixed(), ({ path }) => { lazy.push(path) }, { lazyPath: true })
    expect(lazy).toEqual(eagerPaths(mixed()))
  })

  it("L1.11 assigning `path` makes it an own property of that context only; the children's paths are unaffected", () => {
    const children: JsonPath[] = []
    syncCrawl({ a: { b: 1 } }, (ctx) => {
      if (ctx.key === "a") {
        (ctx as { path: JsonPath }).path = ["replaced"]
        expect(Object.hasOwn(ctx, "path")).toBe(true)
        expect(ctx.path).toEqual(["replaced"])
      }
      if (ctx.key === "b") { children.push(ctx.path) }
    }, { lazyPath: true })
    expect(children).toEqual([["a", "b"]])
  })
})
