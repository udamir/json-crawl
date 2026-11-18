import { crawl, syncCrawl, syncClone, clone, equal, isObject, isArray, type CrawlRulesContext } from "../src"

// Block I: robustness (scale, stack safety, odd roots, utilities)

const wide = (n: number) => { const o: Record<string, number> = {}; for (let i = 0; i < n; i++) { o[`key${i}`] = i } return o }
const deep = (n: number) => { const root: any = {}; let cur = root; for (let i = 0; i < n; i++) { cur.n = { i }; cur = cur.n } return root }
const countNodes = (data: unknown) => { let n = 0; syncCrawl(data, () => { n++ }); return n }

describe("I1 scale and stack safety", () => {
  it("I1.1 a 10k-key object is fully visited", () => {
    expect(countNodes(wide(10_000))).toBe(10_001)
  })

  it("I1.2 a 100k-key object is fully visited and cloned", () => {
    const source = wide(100_000)
    expect(countNodes(source)).toBe(100_001)
    expect(Object.keys(syncClone(source) as object)).toHaveLength(100_000)
  })

  it("I1.3 5000 levels of nesting are crawled iteratively without a RangeError", () => {
    const source = deep(5_000)
    expect(() => countNodes(source)).not.toThrow()
    expect(countNodes(source)).toBe(5_000 * 2 + 1)
  })

  it("I1.4 5000 levels of nesting are cloned and compared without a RangeError", () => {
    const source = deep(5_000)
    let result: unknown
    expect(() => { result = syncClone(source) }).not.toThrow()
    expect(equal(source, result)).toBe(true)
  })

  it("I1.5 5000 levels of nesting are handled by the async crawl and clone", async () => {
    const source = deep(5_000)
    let n = 0
    await crawl(source, () => { n++ })
    expect(n).toBe(10_001)
    // the recursive matchers (toEqual, and toBe for its failure message) overflow the stack at this depth, so the
    // comparison uses a reference check and the library's iterative equal
    const result = await clone(source)
    expect(result === source).toBe(false)
    expect(countNodes(result)).toBe(10_001)
    expect(equal(source, result)).toBe(true)
  })

  it("I1.6 a 100k element array of objects is fully visited and cloned", () => {
    const source = Array.from({ length: 100_000 }, (_, i) => ({ id: i, tags: ["a"] }))
    expect(countNodes(source)).toBe(1 + 100_000 * 4)
    const result = syncClone(source) as any[]
    expect(result).toHaveLength(100_000)
    expect(result[99_999]).toEqual({ id: 99_999, tags: ["a"] })
    expect(result[0]).not.toBe(source[0])
  })

  it("I1.7 the path reported at depth matches the depth (paths are not shared between siblings)", () => {
    const paths: string[] = []
    syncCrawl({ a: { x: 1, y: 1 }, b: { x: 1 } }, ({ path }) => { paths.push(path.join(".")) })
    expect(paths).toEqual(["", "a", "a.x", "a.y", "b", "b.x"])
  })

  it("I1.8 function rules are evaluated once per node at depth and receive the full path", () => {
    const paths: string[] = []
    syncCrawl(deep(50), () => {}, { rules: { "/**": ({ path }: CrawlRulesContext) => { paths.push(path.join(".")); return {} } } as any })
    expect(paths).toHaveLength(100)
    expect(paths[0]).toBe("n")
    expect(paths[1]).toBe("n.i")
    expect(paths[2]).toBe("n.n")
    expect(paths[paths.length - 1].split(".")).toHaveLength(51)
  })

  it("I1.9 many hooks (50) on a wide object all run for every node", () => {
    const counters = new Array(50).fill(0)
    syncCrawl(wide(1_000), counters.map((_, i) => () => { counters[i]++ }))
    expect(counters.every((c) => c === 1_001)).toBe(true)
  })
})

describe("I2 odd roots and inputs", () => {
  it("I2.1 primitives, null and undefined at the root are visited once and nothing is descended", () => {
    for (const data of [1, "s", true, null, undefined, Symbol("x"), BigInt(10)]) {
      let n = 0
      syncCrawl(data, () => { n++ })
      expect(n).toBe(1)
    }
  })

  it("I2.2 functions at the root or as values are treated as leaves", () => {
    const fn = () => 1
    const seen: unknown[] = []
    syncCrawl({ fn }, ({ value }) => { seen.push(value) })
    expect(seen).toEqual([{ fn }, fn])
    expect(countNodes(fn)).toBe(1)
  })

  it("I2.3 an empty hooks array is a valid no-op crawl", () => {
    expect(() => syncCrawl({ a: { b: 1 } }, [])).not.toThrow()
    expect(syncClone({ a: { b: 1 } }, [])).toEqual({ a: { b: 1 } })
  })

  it("I2.4 objects with a null prototype are crawled and cloned", () => {
    const source = Object.assign(Object.create(null), { a: 1, b: { c: 2 } })
    expect(countNodes(source)).toBe(4)
    expect(syncClone(source)).toEqual({ a: 1, b: { c: 2 } })
  })

  it("I2.5 frozen objects can be crawled and cloned (clone is not frozen)", () => {
    const source = Object.freeze({ a: Object.freeze({ b: 1 }) })
    expect(countNodes(source)).toBe(3)
    const result: any = syncClone(source)
    expect(result).toEqual(source)
    expect(Object.isFrozen(result)).toBe(false)
  })

  it("I2.6 string values are leaves and are not iterated character by character", () => {
    expect(countNodes({ s: "hello" })).toBe(2)
  })

  it("I2.7 array-like objects (with a length key) are crawled as plain objects", () => {
    const seen: unknown[] = []
    syncCrawl({ 0: "a", length: 1 }, ({ key, path }) => { if (path.length) { seen.push(key) } })
    expect(seen).toEqual(["0", "length"])
  })

  it("I2.8 typed arrays and ArrayBuffer are objects: their indexed entries are visited", () => {
    const seen: unknown[] = []
    syncCrawl(new Uint8Array([7, 8]), ({ value, path }) => { if (path.length) { seen.push(value) } })
    expect(seen).toEqual([7, 8])
  })
})

describe("I3 utilities", () => {
  it("I3.1 isObject is true for objects and arrays and false for null and primitives", () => {
    expect(isObject({})).toBe(true)
    expect(isObject([])).toBe(true)
    expect(isObject(new Date())).toBe(true)
    expect(isObject(null)).toBe(false)
    expect(isObject(undefined)).toBe(false)
    expect(isObject(1)).toBe(false)
    expect(isObject("s")).toBe(false)
    expect(isObject(() => {})).toBe(false)
  })

  it("I3.2 isArray mirrors Array.isArray", () => {
    expect(isArray([])).toBe(true)
    expect(isArray([1])).toBe(true)
    expect(isArray({ length: 1 })).toBe(false)
    expect(isArray("s")).toBe(false)
    expect(isArray(null)).toBe(false)
    expect(isArray(new Uint8Array(1))).toBe(false)
  })
})
