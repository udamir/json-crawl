import { syncCrawl, type CrawlRules } from "../src"

// Block C: composition of multiple hooks on the same node

describe("C1 multiple hooks", () => {
  it("C1.1 hooks run in array order for every node", () => {
    const events: string[] = []
    syncCrawl({ a: 1 }, [
      ({ path }) => { events.push(`h1:${path.join(".")}`) },
      ({ path }) => { events.push(`h2:${path.join(".")}`) },
      ({ path }) => { events.push(`h3:${path.join(".")}`) },
    ])
    expect(events).toEqual(["h1:", "h2:", "h3:", "h1:a", "h2:a", "h3:a"])
  })

  it("C1.2 a later hook sees the value returned by an earlier hook", () => {
    const seen: unknown[] = []
    syncCrawl({ a: 1 }, [
      ({ key, value }) => key === "a" ? { value: (value as number) + 1 } : undefined,
      ({ key, value }) => key === "a" ? { value: (value as number) * 10 } : undefined,
      ({ key, value }) => { if (key === "a") { seen.push(value) } },
    ])
    expect(seen).toEqual([20])
  })

  it("C1.3 a later hook sees the state returned by an earlier hook for the same node", () => {
    const seen: unknown[] = []
    syncCrawl({ a: 1 }, [
      () => ({ state: { fromFirst: true } }),
      ({ state }) => { seen.push(state) },
    ], { state: { fromFirst: false } })
    expect(seen).toEqual([{ fromFirst: true }, { fromFirst: true }])
  })

  it("C1.4 a later hook sees the rules returned by an earlier hook for the same node", () => {
    type R = { tag?: string }
    const seen: unknown[] = []
    syncCrawl<{}, R>({ a: 1 }, [
      () => ({ rules: { tag: "injected" } as CrawlRules<R> }),
      ({ rules }) => { seen.push(rules?.tag) },
    ])
    expect(seen).toEqual(["injected", "injected"])
  })

  it("C1.5 the last hook to return a value wins for descending into children", () => {
    const visited: string[] = []
    syncCrawl({ a: 1 }, [
      ({ key }) => key === "a" ? { value: { fromFirst: 1 } } : undefined,
      ({ key }) => key === "a" ? { value: { fromSecond: 2 } } : undefined,
      ({ path }) => { visited.push(path.join(".")) },
    ])
    expect(visited).toEqual(["", "a", "a.fromSecond"])
  })

  it("C1.6 fields not present in a hook response are left untouched (partial responses merge)", () => {
    const seen: Array<[unknown, unknown]> = []
    syncCrawl({ a: 1 }, [
      () => ({ state: { s: 2 } }),
      ({ key }) => key === "a" ? { value: 99 } : undefined,
      ({ key, value, state }) => { if (key === "a") { seen.push([value, state]) } },
    ], { state: { s: 1 } })
    expect(seen).toEqual([[99, { s: 2 }]])
  })

  it("C1.7 the merged context (value, state, rules) is what children are crawled with", () => {
    type R = { tag?: string }
    const seen: Array<[string, unknown, unknown, unknown]> = []
    syncCrawl<{ d: number }, R>({ a: { b: 1 } }, [
      ({ key }) => key === "a" ? { value: { z: 1 } } : undefined,
      ({ key }) => key === "a" ? { state: { d: 1 } } : undefined,
      ({ key }) => key === "a" ? { rules: { "/z": { tag: "z" } } as CrawlRules<R> } : undefined,
      ({ path, value, state, rules }) => { seen.push([path.join("."), value, state, rules?.tag]) },
    ], { state: { d: 0 } })
    expect(seen).toEqual([
      ["", { a: { b: 1 } }, { d: 0 }, undefined],
      ["a", { z: 1 }, { d: 1 }, undefined],
      ["a.z", 1, { d: 1 }, "z"],
    ])
  })

  it("C1.8 exit hooks from several hooks are collected per node and run LIFO after children", () => {
    const events: string[] = []
    syncCrawl({ a: { b: 1 } }, [
      ({ path }) => ({ exitHook: () => events.push(`h1:${path.join(".")}`) }),
      ({ path }) => ({ exitHook: () => events.push(`h2:${path.join(".")}`) }),
    ])
    expect(events).toEqual(["h2:a.b", "h1:a.b", "h2:a", "h1:a", "h2:", "h1:"])
  })

  it("C1.9 terminate from a middle hook prevents later hooks from running on that node", () => {
    const events: string[] = []
    syncCrawl({ a: 1 }, [
      () => { events.push("h1") },
      () => ({ terminate: true }),
      () => { events.push("h3") },
    ])
    expect(events).toEqual(["h1"])
  })
})
