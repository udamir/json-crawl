import { syncCrawl, crawl, type CrawlRules } from "../src"

// Block B: hook return handling (value / state / rules / exitHook / terminate / done)

describe("B1 value", () => {
  it("B1.1 a returned value replaces the node for the rest of the crawl and its children are crawled", () => {
    const visited: Array<[string, unknown]> = []
    syncCrawl({ a: { old: 1 } }, ({ key, path, value }) => {
      visited.push([path.join("."), value])
      if (key === "a") { return { value: { fresh: 2, deeper: { x: 3 } } } }
    })
    expect(visited).toEqual([
      ["", { a: { old: 1 } }],
      ["a", { old: 1 }],
      ["a.fresh", 2],
      ["a.deeper", { x: 3 }],
      ["a.deeper.x", 3],
    ])
  })

  it("B1.2 replacing an object with a primitive stops the descent into that node", () => {
    const visited: string[] = []
    syncCrawl({ a: { b: { c: 1 } }, d: 2 }, ({ key, path }) => {
      visited.push(path.join("."))
      if (key === "a") { return { value: "leaf" } }
    })
    expect(visited).toEqual(["", "a", "d"])
  })

  it("B1.3 replacing a value never mutates the source document", () => {
    const source = { a: { b: 1 } }
    syncCrawl(source, ({ key }) => key === "a" ? { value: { b: 2 } } : undefined)
    expect(source).toEqual({ a: { b: 1 } })
  })

  it("B1.4 returning { value: undefined } makes the node a leaf (no children are crawled)", () => {
    const visited: string[] = []
    syncCrawl({ a: { b: 1 } }, ({ key, path }) => {
      visited.push(path.join("."))
      if (key === "a") { return { value: undefined } }
    })
    expect(visited).toEqual(["", "a"])
  })

  it("B1.5 the replacement value is what later hooks of the same node observe", () => {
    const observed: unknown[] = []
    syncCrawl({ a: 1 }, [
      ({ key }) => key === "a" ? { value: 100 } : undefined,
      ({ key, value }) => { if (key === "a") { observed.push(value) } },
    ])
    expect(observed).toEqual([100])
  })
})

describe("B2 state", () => {
  it("B2.1 a returned state is passed to the children of the node only, siblings keep the parent's state", () => {
    const seen: Array<[string, unknown]> = []
    syncCrawl({ a: { b: 1 }, c: 2 }, ({ key, path, state }) => {
      seen.push([path.join("."), state])
      if (key === "a") { return { state: { depth: "a" } } }
    }, { state: { depth: "root" } })
    expect(seen).toEqual([
      ["", { depth: "root" }],
      ["a", { depth: "root" }],
      ["a.b", { depth: "a" }],
      ["c", { depth: "root" }],
    ])
  })

  it("B2.2 when no state is returned, children receive the very same state object (shared reference)", () => {
    const state = { n: 0 }
    const refs: unknown[] = []
    syncCrawl({ a: { b: 1 } }, (ctx) => { refs.push(ctx.state) }, { state })
    expect(refs.every((s) => s === state)).toBe(true)
  })

  it("B2.3 state mutations made in a hook are visible to later nodes sharing that state object", () => {
    syncCrawl({ a: 1, b: 2 }, ({ state }) => { state.n++ }, { state: { n: 0 } })
    const state = { n: 0 }
    syncCrawl({ a: 1, b: 2 }, ({ state }) => { state.n++ }, { state })
    expect(state.n).toBe(3)
  })

  it("B2.4 (characterization) returning { state: undefined } clears the state for the children", () => {
    const seen: unknown[] = []
    syncCrawl({ a: { b: 1 } }, [
      ({ key }) => key === "a" ? { state: undefined } : undefined,
      ({ path, state }) => { if (path.length === 2) { seen.push(state) } },
    ], { state: { s: 1 } })
    expect(seen).toEqual([undefined])
  })
})

describe("B3 rules", () => {
  it("B3.1 rules returned by a hook replace the rules used to resolve the node's children", () => {
    type R = { tag?: string }
    const seen: Array<[string, unknown]> = []
    syncCrawl<{}, R>({ a: { b: 1, c: 2 } }, ({ key, path, rules }) => {
      seen.push([path.join("."), rules?.tag])
      if (key === "a") { return { rules: { "/b": { tag: "from-hook" } } as CrawlRules<R> } }
    }, { rules: { "/a": { tag: "a", "/b": { tag: "original" } } } as CrawlRules<R> })
    expect(seen).toEqual([["", undefined], ["a", "a"], ["a.b", "from-hook"], ["a.c", undefined]])
  })

  it("B3.2 the root hook sees the root rule set itself; children see the resolved child rules", () => {
    type R = { tag?: string }
    const rules: CrawlRules<R> = { tag: "root", "/a": { tag: "a" } } as CrawlRules<R>
    const seen: unknown[] = []
    syncCrawl<{}, R>({ a: 1 }, ({ rules }) => { seen.push(rules) }, { rules })
    expect(seen[0]).toBe(rules)
    expect(seen[1]).toEqual({ tag: "a" })
  })
})

describe("B4 exitHook", () => {
  it("B4.1 the exit hook of an object node runs after all its descendants have been visited", () => {
    const events: string[] = []
    syncCrawl({ a: { b: { c: 1 } } }, ({ path }) => {
      events.push(`enter:${path.join(".")}`)
      return { exitHook: () => events.push(`exit:${path.join(".")}`) }
    })
    expect(events).toEqual(["enter:", "enter:a", "enter:a.b", "enter:a.b.c", "exit:a.b.c", "exit:a.b", "exit:a", "exit:"])
  })

  it("B4.2 several exit hooks registered for the same node by different hooks run in reverse registration order (LIFO)", () => {
    const events: string[] = []
    syncCrawl({ a: 1 }, [
      ({ path }) => ({ exitHook: () => events.push(`first:${path.length}`) }),
      ({ path }) => ({ exitHook: () => events.push(`second:${path.length}`) }),
    ])
    expect(events).toEqual(["second:1", "first:1", "second:0", "first:0"])
  })

  it("B4.3 exit hooks registered before a `done` response still run (immediately, since the node is not descended)", () => {
    const events: string[] = []
    syncCrawl({ a: { b: 1 } }, [
      ({ path }) => ({ exitHook: () => events.push(`exit:${path.join(".")}`) }),
      ({ key, path }) => { events.push(`second:${path.join(".")}`); return key === "a" ? { done: true } : undefined },
    ])
    expect(events).toEqual(["second:", "second:a", "exit:a", "exit:"])
  })

  it("B4.4 exit hooks of a leaf run right after the hooks of that leaf, before the next sibling is entered", () => {
    const events: string[] = []
    syncCrawl({ a: 1, b: 2 }, ({ key, path }) => {
      if (path.length) { events.push(`enter:${key}`) }
      return { exitHook: () => events.push(`exit:${path.length ? key : "root"}`) }
    })
    expect(events).toEqual(["enter:a", "exit:a", "enter:b", "exit:b", "exit:root"])
  })

  it("B4.5 (characterization) pending exit hooks of ancestors are not run when the crawl is terminated", () => {
    const events: string[] = []
    syncCrawl({ a: { b: 1 } }, ({ key, path }) => {
      if (key === "b") { return { terminate: true } }
      return { exitHook: () => events.push(`exit:${path.join(".")}`) }
    })
    expect(events).toEqual([])
  })

  it("B4.6 falsy exitHook values are ignored", () => {
    expect(() => syncCrawl({ a: 1 }, () => ({ exitHook: undefined }))).not.toThrow()
    expect(() => syncCrawl({ a: 1 }, () => ({ exitHook: null as any }))).not.toThrow()
  })
})

describe("B5 terminate", () => {
  it("B5.1 terminate stops the whole crawl: no further nodes and no further hooks for the current node", () => {
    const visited: string[] = []
    let laterHookCalls = 0
    syncCrawl({ a: 1, b: { c: 2 }, d: 3 }, [
      ({ key, path }) => { visited.push(path.join(".")); return key === "b" ? { terminate: true } : undefined },
      () => { laterHookCalls++ },
    ])
    expect(visited).toEqual(["", "a", "b"])
    expect(laterHookCalls).toBe(2) // root and "a" only
  })

  it("B5.2 terminate from the root hook visits nothing else", () => {
    let calls = 0
    syncCrawl({ a: 1, b: 2 }, () => { calls++; return { terminate: true } })
    expect(calls).toBe(1)
  })

  it("B5.3 terminate in the async crawl resolves the promise and stops the traversal", async () => {
    const visited: unknown[] = []
    await crawl({ a: 1, b: 2 }, async ({ key }) => { visited.push(key); return key === "a" ? { terminate: true } : undefined })
    expect(visited).toEqual([undefined, "a"])
  })
})

describe("B6 done", () => {
  it("B6.1 done skips the remaining hooks for the current node", () => {
    let secondCalls = 0
    syncCrawl({ a: 1, b: 2 }, [
      ({ key }) => key === "a" ? { done: true } : undefined,
      () => { secondCalls++ },
    ])
    expect(secondCalls).toBe(2) // root and "b"
  })

  it("B6.2 done prevents descending into the node's children", () => {
    const visited: string[] = []
    syncCrawl({ a: { b: 1 }, c: { d: 2 } }, ({ key, path }) => {
      visited.push(path.join("."))
      return key === "a" ? { done: true } : undefined
    })
    expect(visited).toEqual(["", "a", "c", "c.d"])
  })

  it("B6.3 done on one node does not affect its siblings or the rest of the crawl", () => {
    const visited: string[] = []
    syncCrawl({ a: { b: 1 }, c: 2, d: { e: 3 } }, ({ path }) => {
      visited.push(path.join("."))
      return path.join(".") === "a" ? { done: true } : undefined
    })
    expect(visited).toEqual(["", "a", "c", "d", "d.e"])
  })

  it("B6.4 a value returned together with done is ignored for descent (node is not crawled further)", () => {
    const visited: string[] = []
    syncCrawl({ a: 1 }, ({ key, path }) => {
      visited.push(path.join("."))
      return key === "a" ? { done: true, value: { x: 1 } } : undefined
    })
    expect(visited).toEqual(["", "a"])
  })
})

describe("B7 void responses", () => {
  it("B7.1 returning undefined or null is a no-op", () => {
    const visited: string[] = []
    syncCrawl({ a: { b: 1 } }, [() => undefined, () => null as any, ({ path }) => { visited.push(path.join(".")) }])
    expect(visited).toEqual(["", "a", "a.b"])
  })

  it("B7.2 returning an empty object is a no-op", () => {
    const visited: string[] = []
    syncCrawl({ a: { b: 1 } }, [() => ({}), ({ path }) => { visited.push(path.join(".")) }])
    expect(visited).toEqual(["", "a", "a.b"])
  })
})
