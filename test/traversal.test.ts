import { syncCrawl, crawl, type CrawlContext } from "../src"

// Block A: traversal order & hook contract

const pathOf = (ctx: CrawlContext<any>) => ctx.path.join(".")

describe("A1 traversal order", () => {
  it("A1.1 visits nodes in depth-first pre-order following key insertion order", () => {
    const source = { a: { b: 1, c: { d: 2 } }, e: 3, f: { g: 4 } }
    const visited: string[] = []
    syncCrawl(source, (ctx) => { visited.push(pathOf(ctx)) })
    expect(visited).toEqual(["", "a", "a.b", "a.c", "a.c.d", "e", "f", "f.g"])
  })

  it("A1.2 visits array elements in index order with numeric keys", () => {
    const visited: Array<[string | number | undefined, unknown]> = []
    syncCrawl(["x", ["y", "z"]], ({ key, value, path }) => { if (path.length) { visited.push([key, value]) } })
    expect(visited).toEqual([[0, "x"], [1, ["y", "z"]], [0, "y"], [1, "z"]])
    visited.forEach(([key]) => expect(typeof key).toBe("number"))
  })

  it("A1.3 root node context: value is the input, path is [], key is undefined, state and rules come from params", () => {
    const state = { counter: 0 }
    const rules = { marker: 1 }
    const contexts: CrawlContext<any, any>[] = []
    syncCrawl({ a: 1 }, (ctx) => { contexts.push({ ...ctx }) }, { state, rules })
    const root = contexts[0]
    expect(root.value).toEqual({ a: 1 })
    expect(root.path).toEqual([])
    // the root key is `undefined` and CrawlContext.key is typed `string | number | undefined`
    expect(root.key).toBeUndefined()
    expect(root.state).toBe(state)
    expect(root.rules).toBe(rules)
  })

  it("A1.4 child node context carries the key and the full path from the root", () => {
    const contexts: CrawlContext<any>[] = []
    syncCrawl({ a: { b: [10] } }, (ctx) => { contexts.push({ ...ctx }) })
    expect(contexts.map((c) => [c.key, c.path, c.value])).toEqual([
      [undefined, [], { a: { b: [10] } }],
      ["a", ["a"], { b: [10] }],
      ["b", ["a", "b"], [10]],
      [0, ["a", "b", 0], 10],
    ])
  })

  it("A1.5 a primitive at the root is visited exactly once", () => {
    for (const data of [5, "str", true, 0, ""]) {
      const seen: unknown[] = []
      syncCrawl(data, ({ value, path }) => { seen.push([value, path]) })
      expect(seen).toEqual([[data, []]])
    }
  })

  it("A1.6 null at the root is visited once and not descended", () => {
    const seen: unknown[] = []
    syncCrawl(null, ({ value }) => { seen.push(value) })
    expect(seen).toEqual([null])
  })

  it("A1.7 undefined at the root is visited once", () => {
    let calls = 0
    syncCrawl(undefined, () => { calls++ })
    expect(calls).toBe(1)
  })

  it("A1.8 empty objects and arrays are visited but have no children", () => {
    const visited: string[] = []
    syncCrawl({ a: {}, b: [] }, (ctx) => { visited.push(pathOf(ctx)) })
    expect(visited).toEqual(["", "a", "b"])
  })

  it("A1.9 exit hooks run post-order, after all descendants of the node", () => {
    const events: string[] = []
    syncCrawl({ a: { b: 1 }, c: [2, 3] }, (ctx) => {
      events.push(`enter:${pathOf(ctx)}`)
      return { exitHook: () => events.push(`exit:${pathOf(ctx)}`) }
    })
    expect(events).toEqual([
      "enter:", "enter:a", "enter:a.b", "exit:a.b", "exit:a",
      "enter:c", "enter:c.0", "exit:c.0", "enter:c.1", "exit:c.1", "exit:c", "exit:",
    ])
  })

  it("A1.10 the hook is invoked exactly once per node (root included)", () => {
    const source = { name: "John", tags: ["a", "b"], address: { street: "x", geo: { lat: 1, lng: 2 } } }
    let counter = 0
    syncCrawl(source, () => { counter++ })
    // root + name + tags + 2 elements + address + street + geo + lat + lng
    expect(counter).toBe(10)
  })

  it("A1.11 non-function entries in the hooks array are skipped", () => {
    let calls = 0
    syncCrawl({ a: 1 }, [undefined as any, null as any, "nope" as any, () => { calls++ }])
    expect(calls).toBe(2)
  })

  it("A1.12 a single hook function is accepted in place of an array", () => {
    let calls = 0
    syncCrawl({ a: 1 }, () => { calls++ })
    expect(calls).toBe(2)
  })

  it("A1.13 params are optional: state and rules are undefined when not provided", () => {
    const seen: unknown[] = []
    syncCrawl({ a: 1 }, ({ state, rules }) => { seen.push([state, rules]) })
    expect(seen).toEqual([[undefined, undefined], [undefined, undefined]])
  })

  it("A1.14 crawling does not mutate the input", () => {
    const source = { a: { b: [1, 2] }, c: "x" }
    const snapshot = JSON.stringify(source)
    syncCrawl(source, () => ({ value: "replaced" }))
    expect(JSON.stringify(source)).toBe(snapshot)
  })

  it("A1.15 the async crawl visits nodes in the same order as the sync crawl", async () => {
    const source = { a: { b: 1, c: { d: 2 } }, e: [3, 4] }
    const syncOrder: string[] = []
    const asyncOrder: string[] = []
    syncCrawl(source, (ctx) => { syncOrder.push(pathOf(ctx)) })
    await crawl(source, async (ctx) => { asyncOrder.push(pathOf(ctx)) })
    expect(asyncOrder).toEqual(syncOrder)
  })

  it("A1.16 keys of non-array objects are own enumerable string keys only (no inherited, no symbols)", () => {
    const proto = { inherited: 1 }
    const source = Object.create(proto)
    source.own = 2
    source[Symbol("s")] = 3
    Object.defineProperty(source, "hidden", { value: 4, enumerable: false })
    const keys: unknown[] = []
    syncCrawl(source, ({ key, path }) => { if (path.length) { keys.push(key) } })
    expect(keys).toEqual(["own"])
  })

  it("A1.18 array holes are skipped by the crawl, explicit undefined elements are visited", () => {
    const keys: unknown[] = []
    syncCrawl([1, , 3, undefined], ({ key, path }) => { if (path.length) { keys.push(key) } })
    expect(keys).toEqual([0, 2, 3])
    const nested: unknown[] = []
    syncCrawl({ a: [, , 1] }, ({ path }) => { nested.push(path.join(".")) })
    expect(nested).toEqual(["", "a", "a.2"])
    // trailing holes only
    const trailing: unknown[] = []
    syncCrawl([1, , ,], ({ path }) => { trailing.push(path.join(".")) })
    expect(trailing).toEqual(["", "0"])
  })

  it("A1.19 async crawl skips holes too", async () => {
    const keys: unknown[] = []
    await crawl([, 1, , 2], ({ key, path }) => { if (path.length) { keys.push(key) } })
    expect(keys).toEqual([1, 3])
  })

  it("A1.20 hook responses with unknown fields do not leak into the context", () => {
    const seen: unknown[] = []
    syncCrawl({ a: 1 }, [
      () => ({ extra: 1 } as any),
      (ctx) => { seen.push("extra" in ctx) },
    ])
    expect(seen).toEqual([false, false])
  })

  it("A1.17 context fields path and key are stable across hooks for the same node", () => {
    const seen: Array<[unknown, unknown]> = []
    syncCrawl({ a: 1 }, [
      ({ key }) => key === "a" ? { value: 42 } : undefined,
      ({ key, path }) => { seen.push([key, [...path]]) },
    ])
    expect(seen).toEqual([[undefined, []], ["a", ["a"]]])
  })
})

describe("A2 cycle guard (circular: true)", () => {
  it("A2.1 a node whose value is an ancestor is visited but not descended", () => {
    const a: any = { x: 1, child: { y: 2 } }
    a.child.back = a
    const seen: string[] = []
    syncCrawl(a, ({ path }) => { seen.push(path.join(".")) }, { circular: true })
    expect(seen).toEqual(["", "x", "child", "child.y", "child.back"])
  })

  it("A2.2 shared references that are not cycles are crawled every time they are reached", () => {
    const shared = { v: 1 }
    const doc = { a: shared, b: shared, list: [shared] }
    const seen: string[] = []
    syncCrawl(doc, ({ path }) => { seen.push(path.join(".")) }, { circular: true })
    expect(seen).toEqual(["", "a", "a.v", "b", "b.v", "list", "list.0", "list.0.v"])
  })

  it("A2.3 mutual cycles and self-referencing arrays terminate; exit hooks of the cut node run", () => {
    const a: any = { name: "a" }
    const b: any = { name: "b", a }
    a.b = b
    const list: any[] = [1]
    list.push(list)
    const exits: string[] = []
    let n = 0
    syncCrawl({ a, list }, ({ path }) => { n++; return { exitHook: () => { exits.push(path.join(".")) } } }, { circular: true })
    expect(n).toBe(9) // root, a, a.name, a.b, a.b.name, a.b.a (cut), list, list.0, list.1 (cut)
    expect(exits).toContain("a.b.a")
    expect(exits).toContain("list.1")
  })

  it("A2.4 the async crawl guards cycles too", async () => {
    const a: any = { x: 1 }
    a.self = a
    const seen: string[] = []
    await crawl(a, async ({ path }) => { seen.push(path.join(".")) }, { circular: true })
    expect(seen).toEqual(["", "x", "self"])
  })

  it("A2.5 a value replaced by an ancestor in a hook is cut as well", () => {
    const doc: any = { a: { b: 1 } }
    const seen: string[] = []
    syncCrawl(doc, ({ path, key }) => {
      seen.push(path.join("."))
      if (key === "b") { return { value: doc } }
    }, { circular: true })
    expect(seen).toEqual(["", "a", "a.b"])
  })

  it("A2.6 without the flag nothing changes: the guard is off by default", () => {
    const shared = { v: 1 }
    let n = 0
    syncCrawl({ a: shared, b: shared }, () => { n++ })
    expect(n).toBe(5)
  })
})

