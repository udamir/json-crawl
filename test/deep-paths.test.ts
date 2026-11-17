import { crawl, syncCrawl, syncClone, clone, transform, equal, type JsonPath, type CrawlRulesContext } from "../src"

// Block I4: deep documents. Paths are parent-linked and materialized on demand, so a crawl is O(1) per node
// when no hook reads `path`, and the arrays handed to hooks stay correct and unchanged after the crawl.

// `levels` levels of { properties: { a: ... } }: the JSON nesting depth is 2 * levels
const chain = (levels: number): any => {
  let doc: any = { type: "string" }
  for (let i = 0; i < levels; i++) { doc = { properties: { a: doc } } }
  return doc
}
const chainPath = (depth: number): JsonPath => Array.from({ length: depth }, (_, i) => (i % 2 ? "a" : "properties"))

// bottom of a cloned chain, walked iteratively (the recursive toEqual matcher overflows at this depth)
const bottom = (doc: any, levels: number): any => {
  let cur = doc
  for (let i = 0; i < levels; i++) { cur = cur.properties.a }
  return cur
}

const timed = <T>(fn: () => T): [T, number] => {
  const start = performance.now()
  const result = fn()
  return [result, performance.now() - start]
}

describe("I4 deep documents", () => {
  it("I4.1 syncClone of a 20 000-level chain completes quickly", () => {
    const source = chain(20_000)
    const [result, ms] = timed(() => syncClone(source))
    expect(ms).toBeLessThan(2_000)
    expect(result === source).toBe(false) // a reference check: the matcher formats its operands recursively
    expect(bottom(result, 20_000)).toEqual({ type: "string" })
    expect(equal(source, result)).toBe(true)
  })

  it("I4.2 syncClone and syncCrawl of a 100 000-level chain complete without a RangeError", () => {
    const source = chain(100_000)
    let count = 0
    const [, crawlMs] = timed(() => syncCrawl(source, () => { count++ }))
    expect(count).toBe(2 * 100_000 + 2)
    const [result, cloneMs] = timed(() => syncClone(source))
    expect(crawlMs).toBeLessThan(2_000)
    expect(cloneMs).toBeLessThan(3_000)
    expect(bottom(result, 100_000)).toEqual({ type: "string" })
  })

  it("I4.3 async crawl, clone and transform of a 20 000-level chain complete", async () => {
    const source = chain(20_000)
    let count = 0
    await crawl(source, () => { count++ })
    expect(count).toBe(2 * 20_000 + 2)
    const result = await clone(source)
    expect(bottom(result, 20_000)).toEqual({ type: "string" })
    const transformed: any = await transform(source, [({ key }) => (key === "type" ? { value: "number" } : undefined)])
    expect(transformed).toBe(source)
    expect(bottom(source, 20_000)).toEqual({ type: "number" })
  })

  it("I4.4 function rules of a 20 000-level chain complete without reading paths", () => {
    const source = chain(20_000)
    let count = 0
    const [, ms] = timed(() => syncCrawl(source, () => {}, { rules: { "/**": () => { count++; return {} } } }))
    expect(count).toBe(2 * 20_000 + 1)
    expect(ms).toBeLessThan(2_000)
  })

  it("I4.5 hooks receive correct paths at sampled depths, and the arrays are unchanged after the crawl", () => {
    const levels = 1_000
    const depths = [0, 1, 2, 127, 128, 129, 130, 500, 1_999, 2_000, 2_001]
    const seen = new Map<number, JsonPath>()
    syncCrawl(chain(levels), ({ path }) => { if (depths.includes(path.length)) { seen.set(path.length, path) } })
    expect([...seen.keys()].sort((a, b) => a - b)).toEqual(depths)
    for (const [depth, path] of seen) {
      const expected = depth === 2 * levels + 1 ? [...chainPath(2 * levels), "type"] : chainPath(depth)
      expect(path).toEqual(expected)
    }
  })

  it("I4.6 paths read at every node of a deep chain are distinct, correct and stay unchanged", () => {
    const levels = 300
    const paths: JsonPath[] = []
    syncCrawl(chain(levels), (ctx) => { paths.push(ctx.path) })
    expect(paths).toHaveLength(2 * levels + 2)
    for (let i = 0; i <= 2 * levels; i++) { expect(paths[i]).toEqual(chainPath(i)) }
    expect(paths[2 * levels + 1]).toEqual([...chainPath(2 * levels), "type"])
    expect(new Set(paths).size).toBe(paths.length)
  })

  it("I4.7 deep siblings visited after a deep subtree get correct paths", () => {
    // at depth 300 a node has a deep child chain `x` and then a sibling `y` with its own children
    const levels = 150
    const doc = chain(levels)
    const node = bottom(doc, levels)
    node.x = chain(200)
    node.y = { z: [1, { w: 2 }] }
    const base = chainPath(2 * levels)
    const recorded: Record<string, JsonPath> = {}
    syncCrawl(doc, ({ path, key }) => {
      if (key === "y" || key === "z" || key === "w" || key === 1) { recorded[String(key)] = path }
    })
    expect(recorded.y).toEqual([...base, "y"])
    expect(recorded.z).toEqual([...base, "y", "z"])
    expect(recorded["1"]).toEqual([...base, "y", "z", 1])
    expect(recorded.w).toEqual([...base, "y", "z", 1, "w"])
  })

  it("I4.8 at depth, every hook and rule function of a node and its exit hook see the same path array", () => {
    const levels = 200
    const target = 2 * levels - 1
    const arrays: JsonPath[] = []
    syncCrawl(chain(levels), [
      (ctx) => {
        if (ctx.path.length !== target) { return }
        arrays.push(ctx.path)
        return { state: {}, exitHook: () => { arrays.push(ctx.path) } }
      },
      (ctx) => { if (ctx.path.length === target) { arrays.push(ctx.path) } },
    ], {
      rules: { "/**": (rctx: CrawlRulesContext) => { if (rctx.path.length === target) { arrays.push(rctx.path) } return {} } },
    })
    expect(arrays).toHaveLength(4)
    expect(arrays[0]).toEqual(chainPath(target))
    for (const a of arrays) { expect(a).toBe(arrays[0]) }
  })

  it("I4.9 a deep context keeps `path` as an own enumerable property and accepts an assignment", () => {
    const levels = 100
    const target = 2 * levels
    let spread: any
    let assigned: unknown
    syncCrawl(chain(levels), (ctx) => {
      if (ctx.path.length !== target) { return }
      spread = { ...ctx }
      expect(Object.keys(ctx)).toContain("path");
      (ctx as any).path = ["replaced"]
      assigned = ctx.path
    })
    expect(spread.path).toEqual(chainPath(target))
    expect(assigned).toEqual(["replaced"])
  })

  it("I4.10 retained deep paths are not mutated by the rest of the crawl", () => {
    const doc: any = {}
    let cur = doc
    for (let i = 0; i < 300; i++) { cur.n = { m: i }; cur = cur.n }
    const kept: [JsonPath, JsonPath][] = []
    syncCrawl(doc, ({ path }) => { if (path.length > 250) { kept.push([path, [...path]]) } })
    expect(kept.length).toBeGreaterThan(0)
    for (const [path, snapshot] of kept) { expect(path).toEqual(snapshot) }
  })
})
