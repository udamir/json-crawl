import { crawl, syncCrawl, clone, transform } from "../src"

// Block H: async variants (crawl / clone / transform)

const tick = (ms = 1) => new Promise<void>((resolve) => setTimeout(resolve, ms))

describe("H1 async hook ordering", () => {
  it("H1.1 async hooks for one node are awaited one after another, in array order", async () => {
    const events: string[] = []
    await crawl({ a: 1 }, [
      async ({ key }) => { events.push(`h1:start:${key}`); await tick(); events.push(`h1:end:${key}`) },
      async ({ key }) => { events.push(`h2:start:${key}`); await tick(); events.push(`h2:end:${key}`) },
    ])
    expect(events).toEqual([
      "h1:start:undefined", "h1:end:undefined", "h2:start:undefined", "h2:end:undefined",
      "h1:start:a", "h1:end:a", "h2:start:a", "h2:end:a",
    ])
  })

  it("H1.2 nodes are processed strictly sequentially: no two hook invocations are ever in flight at once", async () => {
    let inFlight = 0
    let maxInFlight = 0
    await crawl({ a: [1, 2, 3], b: { c: 4 } }, async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await tick()
      inFlight--
    })
    expect(maxInFlight).toBe(1)
  })

  it("H1.3 sync and async hooks can be mixed in the async crawl", async () => {
    const events: string[] = []
    await crawl({ a: 1 }, [
      ({ key }) => { events.push(`sync:${key}`) },
      async ({ key }) => { await tick(); events.push(`async:${key}`) },
    ])
    expect(events).toEqual(["sync:undefined", "async:undefined", "sync:a", "async:a"])
  })

  it("H1.4 values returned from async hooks are used for descent", async () => {
    const visited: string[] = []
    await crawl({ a: { old: 1 } }, async ({ key, path }) => {
      visited.push(path.join("."))
      if (key === "a") { await tick(); return { value: { fresh: 2 } } }
    })
    expect(visited).toEqual(["", "a", "a.fresh"])
  })

  it("H1.5 exit hooks run post-order in the async crawl, after awaited children", async () => {
    const events: string[] = []
    await crawl({ a: { b: 1 } }, async ({ path }) => {
      await tick()
      events.push(`enter:${path.join(".")}`)
      return { exitHook: () => events.push(`exit:${path.join(".")}`) }
    })
    expect(events).toEqual(["enter:", "enter:a", "enter:a.b", "exit:a.b", "exit:a", "exit:"])
  })

  it("H1.6 the returned promise resolves only after the last exit hook has run", async () => {
    let lastExitRan = false
    await crawl({ a: { b: 1 } }, async ({ path }) => ({ exitHook: () => { if (path.length === 0) { lastExitRan = true } } }))
    expect(lastExitRan).toBe(true)
  })

  it("H1.7 done and terminate are honoured when returned from async hooks", async () => {
    const visited: string[] = []
    await crawl({ a: { b: 1 }, c: { d: 2 }, e: 3 }, async ({ key, path }) => {
      visited.push(path.join("."))
      if (key === "a") { return { done: true } }
      if (key === "d") { return { terminate: true } }
    })
    expect(visited).toEqual(["", "a", "c", "c.d"])
  })

  it("H1.8 state returned from an async hook flows to children", async () => {
    const seen: Array<[string, number]> = []
    await crawl<{ depth: number }>({ a: { b: 1 } }, async ({ path, state }) => {
      seen.push([path.join("."), state.depth])
      return { state: { depth: state.depth + 1 } }
    }, { state: { depth: 0 } })
    expect(seen).toEqual([["", 0], ["a", 1], ["a.b", 2]])
  })
})

describe("H2 rejection propagation", () => {
  it("H2.1 a rejected hook rejects the crawl with the same error", async () => {
    await expect(crawl({ a: 1 }, async ({ key }) => { if (key === "a") { throw new Error("boom") } })).rejects.toThrow("boom")
  })

  it("H2.2 a synchronous throw inside an async crawl hook rejects the crawl", async () => {
    await expect(crawl({ a: 1 }, (({ key }: any) => { if (key === "a") { throw new TypeError("sync boom") } }) as any)).rejects.toThrow(TypeError)
  })

  it("H2.3 after a rejection no further nodes are visited", async () => {
    const visited: string[] = []
    await crawl({ a: 1, b: 2, c: 3 }, async ({ key, path }) => {
      visited.push(path.join("."))
      if (key === "a") { throw new Error("stop") }
    }).catch(() => {})
    await tick(5)
    expect(visited).toEqual(["", "a"])
  })

  it("H2.4 a throwing sync hook propagates synchronously from syncCrawl", () => {
    expect(() => syncCrawl({ a: 1 }, ({ key }) => { if (key === "a") { throw new Error("sync boom") } })).toThrow("sync boom")
  })

  it("H2.5 rejections from transform and clone hooks propagate", async () => {
    await expect(transform({ a: 1 }, async () => { throw new Error("t") })).rejects.toThrow("t")
    await expect(clone({ a: 1 }, async () => { throw new Error("c") })).rejects.toThrow("c")
  })
})

describe("H3 concurrency between independent crawls", () => {
  it("H3.1 two concurrent crawls do not share state or interleave their results incorrectly", async () => {
    const run = (tag: string) => {
      const visited: string[] = []
      return crawl<{ tag: string }>({ a: { b: 1 }, c: 2 }, async ({ path, state }) => {
        await tick(Math.random() * 3)
        visited.push(`${state.tag}:${path.join(".")}`)
      }, { state: { tag } }).then(() => visited)
    }
    const [x, y] = await Promise.all([run("x"), run("y")])
    expect(x).toEqual(["x:", "x:a", "x:a.b", "x:c"])
    expect(y).toEqual(["y:", "y:a", "y:a.b", "y:c"])
  })

  it("H3.2 two concurrent clones of cyclic documents produce independent correct results", async () => {
    const make = (name: string) => { const o: any = { name, child: { n: 1 } }; o.child.back = o; return o }
    const [a, b] = await Promise.all([
      clone(make("a"), async () => { await tick(Math.random() * 2) }),
      clone(make("b"), async () => { await tick(Math.random() * 2) }),
    ]) as any[]
    expect(a.name).toBe("a")
    expect(b.name).toBe("b")
    expect(a.child.back).toBe(a)
    expect(b.child.back).toBe(b)
  })
})

describe("H4 sync API with async hooks", () => {
  // Regression: a Promise returned to the sync API used to be silently destructured into an empty response
  it("H4.1 syncCrawl throws a TypeError when a hook returns a Promise", () => {
    expect(() => syncCrawl({ a: 1 }, [(async () => ({ value: 99, terminate: true })) as any, () => {}])).toThrow(TypeError)
    expect(() => syncCrawl({ a: 1 }, (() => Promise.resolve()) as any)).toThrow(/async hook/)
    // a thenable-looking plain object is also rejected
    expect(() => syncCrawl({ a: 1 }, (() => ({ then: () => {} })) as any)).toThrow(TypeError)
  })

  it("H4.2 crawl awaits only thenables: a sync hook returning a plain response is not deferred", async () => {
    const order: string[] = []
    const p = crawl({ a: 1 }, ({ key }) => { order.push(`hook:${key}`) })
    order.push("after-call")
    await p
    // the first hook runs synchronously inside crawl(), the rest after the await of the returned promise
    expect(order[0]).toBe("hook:undefined")
    expect(order).toContain("hook:a")
  })
})
