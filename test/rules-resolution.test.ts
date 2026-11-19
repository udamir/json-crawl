import { getNodeRules, matchPrefixRule, mergeRules, syncCrawl, type CrawlRules, type CrawlRulesContext } from "../src"

// Block D: rules resolution (getNodeRules / mergeRules and their integration with crawl)

type R = { tag?: string, g?: number, l?: number, e?: number, x?: number, y?: number, z?: number, k?: unknown }
type Rules = CrawlRules<R>
const rules = (r: any): Rules => r as Rules

describe("D1 getNodeRules", () => {
  it("D1.1 an exact key rule is returned for a matching key", () => {
    expect(getNodeRules(rules({ "/a": { tag: "a" } }), "a", ["a"], 1)).toEqual({ tag: "a" })
  })

  it("D1.2 returns undefined when no exact, /* or /** rule matches (consumers rely on this)", () => {
    expect(getNodeRules(rules({ "/a": { tag: "a" } }), "b", ["b"], 1)).toBeUndefined()
    expect(getNodeRules(rules({ tag: "root-only" }), "b", ["b"], 1)).toBeUndefined()
  })

  it("D1.3 returns undefined when the rule set itself is undefined", () => {
    expect(getNodeRules(undefined, "a", ["a"], 1)).toBeUndefined()
  })

  it("D1.4 /* applies to any key that has no exact rule", () => {
    const r = rules({ "/*": { tag: "any" }, "/a": { tag: "a" } })
    expect(getNodeRules(r, "b", ["b"], 1)).toEqual({ tag: "any" })
    expect(getNodeRules(r, 0, [0], 1)).toEqual({ tag: "any" })
    expect(getNodeRules(r, "a", ["a"], 1)).toEqual({ tag: "a" })
  })

  it("D1.5 the exact key rule is shallow-merged over the sibling /* rule: exact fields win, other /* fields are inherited", () => {
    const r = rules({ "/a": { x: 1 }, "/*": { x: 2, y: 3, "/child": { z: 1 } } })
    // (characterization) nested path rules declared on /* are inherited by the exact-key node too
    expect(getNodeRules(r, "a", ["a"], 1)).toEqual({ x: 1, y: 3, "/child": { z: 1 } })
    expect(getNodeRules(r, "other", ["other"], 1)).toEqual({ x: 2, y: 3, "/child": { z: 1 } })
  })

  it("D1.6 precedence is exact key > /* > /**", () => {
    const r = rules({ "/**": { tag: "g", g: 1 }, "/*": { tag: "l", l: 1 }, "/a": { tag: "e", e: 1 } })
    expect(getNodeRules(r, "a", ["a"], 1)).toMatchObject({ tag: "e", g: 1, l: 1, e: 1 })
    expect(getNodeRules(r, "b", ["b"], 1)).toMatchObject({ tag: "l", g: 1, l: 1 })
    expect(getNodeRules(rules({ "/**": { tag: "g", g: 1 } }), "c", ["c"], 1)).toMatchObject({ tag: "g", g: 1 })
  })

  it("D1.7 /** is propagated to every descendant level via the returned rule set", () => {
    const r = rules({ "/**": { g: 1 } })
    const level1 = getNodeRules(r, "a", ["a"], {})!
    expect(level1).toEqual({ "/**": { g: 1 }, g: 1 })
    const level2 = getNodeRules(level1, "b", ["a", "b"], {})!
    expect(level2).toEqual({ "/**": { g: 1 }, g: 1 })
    const level3 = getNodeRules(level2, 0, ["a", "b", 0], 1)!
    expect(level3).toMatchObject({ g: 1 })
  })

  it("D1.8 a nested /** declared on an exact key rule overrides the inherited /** for that subtree", () => {
    const r = rules({ "/**": { g: 1 }, "/a": { "/**": { g: 2 } } })
    const a = getNodeRules(r, "a", ["a"], {})!
    expect(a["/**"]).toEqual({ g: 2 })
    expect(getNodeRules(a, "b", ["a", "b"], 1)).toMatchObject({ g: 2 })
    expect(getNodeRules(getNodeRules(r, "other", ["other"], {}), "b", ["other", "b"], 1)).toMatchObject({ g: 1 })
  })

  it("D1.9 function rules (exact, /* and /**) receive { key, path, value } and their result is used", () => {
    const calls: CrawlRulesContext[] = []
    const fn = (tag: string) => (ctx: CrawlRulesContext) => { calls.push(ctx); return { tag, k: ctx.key } }
    const r = rules({ "/a": fn("exact"), "/*": fn("local"), "/**": fn("global") })
    const path = ["p", "a"]
    const value = { v: 1 }
    const result = getNodeRules(r, "a", path, value)
    expect(result).toMatchObject({ tag: "exact", k: "a" })
    expect(calls).toHaveLength(3)
    calls.forEach((c) => expect(c).toEqual({ key: "a", path, value }))
    expect(getNodeRules(r, "zzz", ["zzz"], 2)).toMatchObject({ tag: "local", k: "zzz" })
  })

  it("D1.10 numeric keys (array indexes) match `/<index>` rules", () => {
    expect(getNodeRules(rules({ "/0": { tag: "first" } }), 0, [0], "x")).toEqual({ tag: "first" })
    expect(getNodeRules(rules({ "/0": { tag: "first" } }), 1, [1], "x")).toBeUndefined()
  })

  it("D1.11 keys that exist on Object.prototype never match inherited properties", () => {
    const r = rules({ "/a": { tag: "a" } })
    for (const key of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
      expect(getNodeRules(r, key, [key], 1)).toBeUndefined()
    }
  })

  it("D1.12 (characterization) an exact key function rule returning undefined falls back to the /* rule", () => {
    expect(getNodeRules(rules({ "/a": () => undefined, "/*": { x: 2 } }), "a", ["a"], 1)).toEqual({ x: 2 })
    expect(getNodeRules(rules({ "/a": () => undefined }), "a", ["a"], 1)).toBeUndefined()
  })

  it("D1.13 a /** function returning undefined contributes nothing at that node but /** keeps propagating", () => {
    const fn = ({ key }: CrawlRulesContext) => key === "skip" ? undefined : { g: 1 }
    const r = rules({ "/**": fn })
    const skipped = getNodeRules(r, "skip", ["skip"], {})!
    expect(skipped).toEqual({ "/**": fn })
    expect(getNodeRules(skipped, "b", ["skip", "b"], 1)).toMatchObject({ g: 1 })
    const kept = getNodeRules(r, "a", ["a"], {})!
    expect(getNodeRules(kept, "b", ["a", "b"], 1)).toMatchObject({ g: 1 })
    // the same inside a crawl: the node below "skip" still receives the /** rule
    const seen: Array<[string, unknown]> = []
    syncCrawl<{}, R>({ skip: { b: 1 }, a: { b: 1 } }, ({ path, rules }) => { seen.push([path.join("."), rules?.g]) }, { rules: r })
    expect(seen).toEqual([["", undefined], ["skip", undefined], ["skip.b", 1], ["a", 1], ["a.b", 1]])
  })

  it("D1.14 the literal key \"*\" resolves to the /* rule (api-smart-diff resolves wildcard children this way)", () => {
    expect(getNodeRules(rules({ "/*": { tag: "any" } }), "*", ["x", "*"], {})).toEqual({ tag: "any" })
    expect(getNodeRules(rules({ "/a": { tag: "a" } }), "*", ["x", "*"], {})).toBeUndefined()
  })

  it("D1.15 (characterization) an exact-only match returns the rule object itself, not a copy", () => {
    const exact = { tag: "a" }
    expect(getNodeRules(rules({ "/a": exact }), "a", ["a"], 1)).toBe(exact)
    // with /* or /** present the result is a fresh object
    expect(getNodeRules(rules({ "/a": exact, "/*": { l: 1 } }), "a", ["a"], 1)).not.toBe(exact)
  })

  it("D1.16 getNodeRules does not mutate the rule set", () => {
    const r = rules({ "/**": { g: 1 }, "/*": { l: 1 }, "/a": { e: 1 } })
    const snapshot = JSON.stringify(r)
    getNodeRules(r, "a", ["a"], 1)
    getNodeRules(r, "b", ["b"], 1)
    expect(JSON.stringify(r)).toBe(snapshot)
  })

  it("D1.17 a key containing a slash matches a rule key with the same text", () => {
    expect(getNodeRules(rules({ "/a/b": { tag: "slash" } }), "a/b", ["a/b"], 1)).toEqual({ tag: "slash" })
  })

  it("D1.18 the resolved rules do not carry the parent's /* rule or sibling exact rules", () => {
    const r = rules({ "/*": { l: 1 }, "/a": { e: 1 }, "/b": { x: 1 } })
    const a = getNodeRules(r, "a", ["a"], 1)!
    expect(a).toEqual({ l: 1, e: 1 })
    expect("/*" in a).toBe(false)
    expect("/b" in a).toBe(false)
  })
})

describe("D2 rules inside crawl", () => {
  it("D2.1 every node receives rules resolved from its parent's rules by key", () => {
    const seen: Array<[string, unknown]> = []
    syncCrawl<{}, R>({ a: { b: 1, c: 2 }, d: [3] }, ({ path, rules }) => { seen.push([path.join("."), rules?.tag]) }, {
      rules: rules({ tag: "root", "/a": { tag: "a", "/b": { tag: "b" } }, "/d": { "/*": { tag: "item" } } }),
    })
    expect(seen).toEqual([["", "root"], ["a", "a"], ["a.b", "b"], ["a.c", undefined], ["d", undefined], ["d.0", "item"]])
  })

  it("D2.2 an array of rule sets passed in params is merged before crawling", () => {
    const seen: Array<[string, unknown]> = []
    syncCrawl<{}, R>({ a: 1, b: 2 }, ({ path, rules }) => { seen.push([path.join("."), rules]) }, {
      rules: [rules({ "/a": { tag: "a" } }), rules({ "/b": { tag: "b" } })],
    })
    expect(seen).toEqual([["", { "/a": { tag: "a" }, "/b": { tag: "b" } }], ["a", { tag: "a" }], ["b", { tag: "b" }]])
  })

  it("D2.3 function rules are evaluated with the crawled (possibly hook-replaced) value of the node", () => {
    const values: unknown[] = []
    syncCrawl<{}, R>({ a: 1 }, () => {}, { rules: rules({ "/*": ({ value }: CrawlRulesContext) => { values.push(value); return {} } }) })
    expect(values).toEqual([1])
  })

  it("D2.4 /** rules reach array elements and deep descendants during a crawl", () => {
    const seen: Array<[string, unknown]> = []
    syncCrawl<{}, R>({ a: [{ b: { c: 1 } }] }, ({ path, rules }) => { if (path.length) { seen.push([path.join("."), rules?.g]) } }, { rules: rules({ "/**": { g: 1 } }) })
    expect(seen).toEqual([["a", 1], ["a.0", 1], ["a.0.b", 1], ["a.0.b.c", 1]])
  })
})

describe("D3 mergeRules", () => {
  it("D3.1 throws on a duplicate non-path key", () => {
    expect(() => mergeRules([rules({ tag: "x" }), rules({ tag: "y" })])).toThrow(/Duplicate key: tag/)
  })

  it("D3.2 keys present in only one rule set are copied as is", () => {
    const a = { tag: "a" }
    const merged = mergeRules([rules({ "/a": a, tag: "root" }), rules({ "/b": { tag: "b" } })])
    expect(merged).toEqual({ "/a": a, tag: "root", "/b": { tag: "b" } })
    expect(merged["/a"]).toBe(a)
  })

  it("D3.3 duplicate path keys are merged lazily into a function rule", () => {
    const merged = mergeRules([rules({ "/a": { x: 1 } }), rules({ "/a": { y: 2 } })])
    expect(typeof merged["/a"]).toBe("function")
  })

  it("D3.4 a merged path rule resolves to the union of the rule sets", () => {
    const merged = mergeRules([rules({ "/a": { x: 1, "/c": { z: 1 } } }), rules({ "/a": { y: 2 } })])
    const a = getNodeRules(merged, "a", ["a"], {})!
    expect(a).toEqual({ x: 1, y: 2, "/c": { z: 1 } })
    expect(getNodeRules(a, "c", ["a", "c"], 1)).toEqual({ z: 1 })
  })

  it("D3.5 duplicate non-path keys nested under a duplicated path throw lazily when that path is resolved", () => {
    const merged = mergeRules([rules({ "/a": { x: 1 } }), rules({ "/a": { x: 2 } })])
    expect(() => getNodeRules(merged, "a", ["a"], 1)).toThrow(/Duplicate key: x/)
    expect(() => getNodeRules(merged, "b", ["b"], 1)).not.toThrow()
  })

  it("D3.6 an empty array merges to an empty rule set and a single set is returned with the same content", () => {
    expect(mergeRules([])).toEqual({})
    expect(mergeRules([rules({ x: 1, "/a": { y: 2 } })])).toEqual({ x: 1, "/a": { y: 2 } })
  })

  it("D3.7 function rules on both sides of a duplicated path receive the rules context", () => {
    const merged = mergeRules([
      rules({ "/a": (ctx: CrawlRulesContext) => ({ x: ctx.key }) }),
      rules({ "/a": (ctx: CrawlRulesContext) => ({ y: ctx.path.length }) }),
    ])
    expect(getNodeRules(merged, "a", ["p", "a"], 1)).toEqual({ x: "a", y: 2 })
  })

  // Regression: undefined results are filtered before merging
  it("D3.8 a merged path rule tolerates a function rule that returns undefined", () => {
    const merged = mergeRules([rules({ "/a": () => undefined }), rules({ "/a": { x: 2 } })])
    expect(getNodeRules(merged, "a", ["a"], 1)).toEqual({ x: 2 })
    // every merged function returning undefined resolves to no rule at all
    const none = mergeRules([rules({ "/a": () => undefined }), rules({ "/a": () => undefined })])
    expect(getNodeRules(none, "a", ["a"], 1)).toBeUndefined()
    expect(getNodeRules(mergeRules([none, rules({ "/*": { x: 1 } })]), "a", ["a"], 1)).toEqual({ x: 1 })
  })

  it("D3.9 mergeRules does not mutate its inputs", () => {
    const r1 = rules({ "/a": { x: 1 }, tag: "r1" })
    const r2 = rules({ "/a": { y: 2 } })
    const s1 = JSON.stringify(r1)
    const s2 = JSON.stringify(r2)
    mergeRules([r1, r2])
    expect(JSON.stringify(r1)).toBe(s1)
    expect(JSON.stringify(r2)).toBe(s2)
  })

  it("D3.10 duplicated /** rules merge and keep propagating to deeper levels", () => {
    const merged = mergeRules([rules({ "/**": { g: 1 } }), rules({ "/**": { l: 2 } })])
    const level1 = getNodeRules(merged, "a", ["a"], {})!
    expect(level1).toMatchObject({ g: 1, l: 2 })
    expect(getNodeRules(level1, "b", ["a", "b"], 1)).toMatchObject({ g: 1, l: 2 })
  })

  it("D3.11 the first duplicate non-path key is reported and nothing is partially merged", () => {
    expect(() => mergeRules([rules({ "/a": { x: 1 }, tag: "t" }), rules({ tag: "u" }), rules({ tag: "v" })])).toThrow(/Duplicate key: tag/)
  })

  // overlaps of rule objects only are merged once and resolved like a static rule; these pin that this is invisible
  // the resolved fields of a node (path keys hold merge functions for merged sets, objects for a single set)
  const fieldsOf = (r: unknown) => (r && typeof r === "object" ? Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith("/"))) : r)
  const resolvedAt = (ruleSet: Rules, doc: unknown) => {
    const out: Array<[string, unknown]> = []
    syncCrawl<{}, R>(doc, ({ path, rules: r }) => { out.push([path.join("."), fieldsOf(r)]) }, { rules: ruleSet })
    return out
  }

  it("D3.12 merged rule objects resolve at every node like the single set with the same rules", () => {
    const doc = { a: { b: [1, { c: 2 }], "x-a": 1 }, d: 3 }
    const cases: Array<[Rules[], Rules]> = [
      [[rules({ "/**": { g: 1 } }), rules({ "/**": { l: 2 } })], rules({ "/**": { g: 1, l: 2 } })],
      [[rules({ "/*": { g: 1, "/*": { x: 1 } } }), rules({ "/*": { l: 2, "/*": { y: 2 } } })], rules({ "/*": { g: 1, l: 2, "/*": { x: 1, y: 2 } } })],
      [[rules({ "/a": { x: 1 } }), rules({ "/a": { y: 2 } })], rules({ "/a": { x: 1, y: 2 } })],
      [[rules({ "/a": { "/x-*": { x: 1 } } }), rules({ "/a": { "/x-*": { y: 2 } } })], rules({ "/a": { "/x-*": { x: 1, y: 2 } } })],
    ]
    for (const [sets, single] of cases) {
      expect(resolvedAt(mergeRules(sets), doc)).toEqual(resolvedAt(single, doc))
    }
  })

  it("D3.13 a merged /** overlap keeps the merge function in the `/**` slot and its results are shared between nodes", () => {
    const merged = mergeRules([rules({ "/**": { g: 1 } }), rules({ "/**": { l: 2 } })])
    const seen: Rules[] = []
    syncCrawl<{}, R>({ a: 1, b: { c: 1 } }, ({ path, rules: r }) => { if (path.length && r) { seen.push(r) } }, { rules: merged })
    expect(seen.length).toBe(3)
    for (const r of seen) {
      expect(typeof r["/**"]).toBe("function")
      expect(r).toMatchObject({ g: 1, l: 2 })
    }
    expect(seen[0]).toBe(seen[1])
    expect(seen[1]).toBe(seen[2])
  })

  it("D3.14 merged rule objects still conflict lazily, only at the nodes that reach the path, and every time", () => {
    const merged = mergeRules([rules({ "/a": { x: 1 } }), rules({ "/a": { x: 2 } })])
    expect(() => syncCrawl<{}, R>({ b: { a: 1 } }, () => {}, { rules: merged })).not.toThrow()
    expect(() => syncCrawl<{}, R>({ a: 1 }, () => {}, { rules: merged })).toThrow(/Duplicate key: x/)
    expect(() => syncCrawl<{}, R>({ a: 1 }, () => {}, { rules: merged })).toThrow(/Duplicate key: x/)
  })

  it("D3.15 an explicit undefined rule in one of the merged sets contributes nothing", () => {
    const merged = mergeRules([rules({ "/a": undefined }), rules({ "/a": { x: 2 } })])
    expect(getNodeRules(merged, "a", ["a"], 1)).toEqual({ x: 2 })
    const none = mergeRules([rules({ "/a": undefined }), rules({ "/a": undefined })])
    expect(getNodeRules(none, "a", ["a"], 1)).toBeUndefined()
  })
})

describe("D5 prefix rules /<prefix>*", () => {
  it("D5.1 a prefix rule applies to every string key starting with the prefix; no match still resolves to undefined", () => {
    // typed without casts: "/x-*" is a path key of CrawlRules, function entries get a contextual ctx type
    const r: CrawlRules<R> = { "/x-*": { tag: "ext" }, "/y-*": (ctx) => ({ tag: String(ctx.key), "/*": { tag: "child" } }) }
    expect(getNodeRules(r, "x-internal", ["x-internal"], 1)).toEqual({ tag: "ext" })
    expect(getNodeRules(r, "x-", ["x-"], 1)).toEqual({ tag: "ext" })
    expect(getNodeRules(r, "y-a", ["y-a"], 1)).toEqual({ tag: "y-a", "/*": { tag: "child" } })
    expect(getNodeRules(r, "z-internal", ["z-internal"], 1)).toBeUndefined()
    expect(getNodeRules(r, "X-internal", ["X-internal"], 1)).toBeUndefined() // case-sensitive
    expect(getNodeRules(r, "x", ["x"], 1)).toBeUndefined() // the whole prefix is required
  })

  it("D5.2 precedence is exact key > longest prefix > /* > /**, merged with higher-priority fields winning", () => {
    const r = rules({
      "/**": { tag: "g", g: 1 },
      "/*": { tag: "l", l: 1 },
      "/x-*": { tag: "p", x: 1 },
      "/x-exact": { tag: "e", e: 1 },
    })
    expect(getNodeRules(r, "x-exact", ["x-exact"], 1)).toMatchObject({ tag: "e", g: 1, l: 1, x: 1, e: 1 })
    expect(getNodeRules(r, "x-other", ["x-other"], 1)).toMatchObject({ tag: "p", g: 1, l: 1, x: 1 })
    expect(getNodeRules(r, "other", ["other"], 1)).toEqual({ "/**": { tag: "g", g: 1 }, tag: "l", g: 1, l: 1 })
    expect(getNodeRules(rules({ "/**": { tag: "g" }, "/x-*": { tag: "p" } }), "x-a", ["x-a"], 1)).toMatchObject({ tag: "p" })
  })

  it("D5.3 the longest matching prefix wins whatever the declaration order, and only that prefix applies", () => {
    const r = rules({ "/x-*": { tag: "short", x: 1 }, "/x-apihub-sla-*": { tag: "longest" }, "/x-apihub-*": { tag: "long", y: 1 } })
    expect(getNodeRules(r, "x-apihub-sla-tier", ["x-apihub-sla-tier"], 1)).toEqual({ tag: "longest" })
    expect(getNodeRules(r, "x-apihub-owner", ["x-apihub-owner"], 1)).toEqual({ tag: "long", y: 1 })
    expect(getNodeRules(r, "x-rate", ["x-rate"], 1)).toEqual({ tag: "short", x: 1 })
    expect(getNodeRules(r, "x-apihub", ["x-apihub"], 1)).toEqual({ tag: "short", x: 1 })
    expect(matchPrefixRule(r, "x-apihub-x")).toEqual({ tag: "long", y: 1 })
    expect(matchPrefixRule(r, "nope")).toBeUndefined()
    expect(matchPrefixRule(rules({ "/*": { tag: "any" } }), "x-a")).toBeUndefined() // "/*" is not a prefix rule
  })

  it("D5.4 numeric keys (array indexes) never match a prefix; numeric-looking string keys of objects do", () => {
    const r = rules({ "/1*": { tag: "one" }, "/2*": { tag: "success" } })
    expect(getNodeRules(r, 1, [1], "x")).toBeUndefined()
    expect(getNodeRules(r, 10, [10], "x")).toBeUndefined()
    expect(getNodeRules(r, "10", ["10"], "x")).toEqual({ tag: "one" })
    expect(getNodeRules(r, "201", ["201"], "x")).toEqual({ tag: "success" })
    // inside a crawl: object keys "200"/"404" are strings, array indexes are numbers
    const seen: Array<[string, unknown]> = []
    syncCrawl<{}, R>({ "200": 1, "404": 2, list: [1, 2, 3] }, ({ path, rules }) => { if (path.length) { seen.push([path.join("."), rules?.tag]) } }, {
      rules: rules({ "/2*": { tag: "2xx" }, "/list": { "/1*": { tag: "never" } } }),
    })
    expect(seen).toEqual([["200", "2xx"], ["404", undefined], ["list", undefined], ["list.0", undefined], ["list.1", undefined], ["list.2", undefined]])
  })

  it("D5.5 the resolved rules carry neither the parent's prefix rules nor sibling prefixes, and the rule set is not mutated", () => {
    const ext = { x: 1 }
    const r = rules({ "/x-*": ext, "/y-*": { y: 1 }, "/*": { l: 1 } })
    const snapshot = JSON.stringify(r)
    const keysBefore = Object.keys(r)
    const resolved = getNodeRules(r, "x-a", ["x-a"], 1)!
    expect(resolved).toEqual({ l: 1, x: 1 })
    expect("/x-*" in resolved || "/y-*" in resolved).toBe(false)
    expect(JSON.stringify(r)).toBe(snapshot)
    expect(Object.keys(r)).toEqual(keysBefore)
    // (characterization) a prefix-only match returns the prefix rule object itself, like an exact-only match (D1.15)
    expect(getNodeRules(rules({ "/x-*": ext }), "x-a", ["x-a"], 1)).toBe(ext)
  })

  it("D5.6 a prefix entry may be a function rule: it receives { key, path, value }; undefined falls back to /*, not to a shorter prefix", () => {
    const calls: CrawlRulesContext[] = []
    const r = rules({
      "/x-*": { tag: "short" },
      "/x-fn-*": (ctx: CrawlRulesContext) => { calls.push(ctx); return typeof ctx.value === "object" ? { tag: "fn", k: ctx.key } : undefined },
      "/*": { tag: "any" },
    })
    const value = { a: 1 }
    expect(getNodeRules(r, "x-fn-a", ["p", "x-fn-a"], value)).toEqual({ tag: "fn", k: "x-fn-a" })
    expect(calls).toEqual([{ key: "x-fn-a", path: ["p", "x-fn-a"], value }])
    // (characterization) the longest prefix is selected before its rule is resolved; an undefined result contributes nothing
    expect(getNodeRules(r, "x-fn-b", ["x-fn-b"], 1)).toEqual({ tag: "any" })
    expect(getNodeRules(rules({ "/x-*": () => undefined }), "x-a", ["x-a"], 1)).toBeUndefined()
  })

  it("D5.7 prefix rules of a rule set produced by a function rule (a fresh object per node) are honoured", () => {
    // the prefix set may depend on the node: the parent's function rule returns a different rule set per path
    const r = rules({ "/*": (ctx: CrawlRulesContext) => (ctx.path.length > 1 ? { "/x-*": { tag: "deep" } } : { "/x-*": { tag: "top" }, "/y-*": { tag: "y" } }) })
    const top = getNodeRules(r, "a", ["a"], {})!
    const deep = getNodeRules(r, "b", ["p", "b"], {})!
    expect(getNodeRules(top, "x-1", ["a", "x-1"], 1)).toEqual({ tag: "top" })
    expect(getNodeRules(top, "y-1", ["a", "y-1"], 1)).toEqual({ tag: "y" })
    expect(getNodeRules(deep, "x-1", ["p", "b", "x-1"], 1)).toEqual({ tag: "deep" })
    expect(getNodeRules(deep, "y-1", ["p", "b", "y-1"], 1)).toBeUndefined()
  })

  it("D5.8 a path key ending in \"**\" other than /** is rejected with a TypeError on first use by a string key", () => {
    expect(() => getNodeRules(rules({ "/x-**": { tag: "x" } }), "a", ["a"], 1)).toThrow(TypeError)
    expect(() => getNodeRules(rules({ "/x-**": { tag: "x" } }), "a", ["a"], 1)).toThrow(/reserved/)
    expect(() => getNodeRules(rules({ "/***": {} }), "a", ["a"], 1)).toThrow(TypeError)
    expect(() => getNodeRules(mergeRules([rules({ "/x-**": {} }), rules({ "/x-*": {} })]), "a", ["a"], 1)).toThrow(TypeError)
    expect(() => matchPrefixRule(rules({ "/x-**": {} }), "a")).toThrow(TypeError)
    // numeric keys never consult the prefix rules, so they do not trigger the check
    expect(getNodeRules(rules({ "/x-**": {} }), 0, [0], 1)).toBeUndefined()
    // "/**" itself stays the any-depth rule
    expect(getNodeRules(rules({ "/**": { g: 1 } }), "a", ["a"], 1)).toMatchObject({ g: 1 })
  })

  it("D5.9 interaction with /**: a prefix rule declared in /** applies at every depth, and /** keeps propagating through prefix matches", () => {
    const r = rules({ "/**": { g: 1, "/x-*": { tag: "ext" } } })
    const a = getNodeRules(r, "a", ["a"], {})!
    expect(a).toMatchObject({ g: 1 })
    const ext = getNodeRules(a, "x-deep", ["a", "x-deep"], {})!
    expect(ext).toMatchObject({ g: 1, tag: "ext" })
    expect(getNodeRules(ext, "x-deeper", ["a", "x-deep", "x-deeper"], 1)).toMatchObject({ g: 1, tag: "ext" })
    // a /** declared on the prefix rule overrides the inherited one for that subtree
    const r2 = rules({ "/**": { g: 1 }, "/x-*": { "/**": { g: 2 } } })
    const x = getNodeRules(r2, "x-a", ["x-a"], {})!
    expect(getNodeRules(x, "b", ["x-a", "b"], 1)).toMatchObject({ g: 2 })
    expect(getNodeRules(getNodeRules(r2, "a", ["a"], {}), "b", ["a", "b"], 1)).toMatchObject({ g: 1 })
  })

  it("D5.10 interaction with /*: prefix fields override /* fields, other /* fields (nested path rules included) are inherited", () => {
    const r = rules({ "/*": { x: 2, y: 3, "/child": { z: 1 } }, "/x-*": { x: 1 } })
    expect(getNodeRules(r, "x-a", ["x-a"], 1)).toEqual({ x: 1, y: 3, "/child": { z: 1 } })
    expect(getNodeRules(r, "a", ["a"], 1)).toEqual({ x: 2, y: 3, "/child": { z: 1 } })
  })

  it("D5.11 keys ending in \"*\" skip the exact lookup; only a trailing \"*\" is special, and \"/^\" is an ordinary exact key", () => {
    // the key "x-*" reaches "/x-*" as a prefix rule, once (not again as its exact rule)
    let calls = 0
    const r = rules({ "/x-*": () => { calls++; return { tag: "ext" } } })
    expect(getNodeRules(r, "x-*", ["x-*"], 1)).toEqual({ tag: "ext" })
    expect(calls).toBe(1)
    // the key "*" gets "/*" as the any-key rule only
    expect(getNodeRules(rules({ "/*": { tag: "any" } }), "*", ["*"], 1)).toEqual({ tag: "any" })
    // a "*" inside the prefix is literal; a key with a leading "*" and no trailing one is an exact key
    const lit = rules({ "/a*b*": { tag: "a*b" }, "/*-id": { tag: "exact" } })
    expect(getNodeRules(lit, "a*bc", ["a*bc"], 1)).toEqual({ tag: "a*b" })
    expect(getNodeRules(lit, "abc", ["abc"], 1)).toBeUndefined()
    expect(getNodeRules(lit, "*-id", ["*-id"], 1)).toEqual({ tag: "exact" })
    expect(getNodeRules(lit, "x-id", ["x-id"], 1)).toBeUndefined()
    // keys starting with "^" (JSON Schema patternProperties) keep their exact rules
    const caret = rules({ "/^x-": { tag: "pattern" }, "/x-*": { tag: "ext" } })
    expect(getNodeRules(caret, "^x-", ["^x-"], 1)).toEqual({ tag: "pattern" })
    expect(getNodeRules(caret, "x-a", ["x-a"], 1)).toEqual({ tag: "ext" })
  })

  it("D5.12 prefix rules are compiled once per rule set object; small sets without them are scanned, at most once per container in a crawl", () => {
    let ownKeysCalls = 0
    const counted = (target: object) => new Proxy(target, { ownKeys: (t) => { ownKeysCalls++; return Reflect.ownKeys(t) } })
    // a set with prefix rules is compiled once and cached
    const r = rules(counted({ "/x-*": { tag: "ext" }, "/x-a-*": { tag: "a" } }))
    for (let i = 0; i < 1000; i++) { getNodeRules(r, `x-a-${i}`, [`x-a-${i}`], i) }
    expect(getNodeRules(r, "x-b", ["x-b"], 1)).toEqual({ tag: "ext" })
    expect(ownKeysCalls).toBe(1)
    // so is a set without prefix rules that has more than 16 keys
    const large: Record<string, unknown> = { "/*": { tag: "any" } }
    for (let i = 0; i < 20; i++) { large[`/a${i}`] = { tag: `a${i}` } }
    const big = rules(counted(large))
    for (let i = 0; i < 1000; i++) { getNodeRules(big, `k${i}`, [`k${i}`], i) }
    expect(ownKeysCalls).toBe(2)
    // (characterization) a small set without prefix rules is not cached by object, but the last compiled set is
    // remembered: repeated use of the same set scans it once, until another set is compiled in between
    const small = rules(counted({ "/a": { tag: "a" }, "/*": { tag: "any" } }))
    getNodeRules(small, "k1", ["k1"], 1)
    getNodeRules(small, "k2", ["k2"], 1)
    expect(ownKeysCalls).toBe(3)
    getNodeRules(r, "x-c", ["x-c"], 1)
    getNodeRules(small, "k3", ["k3"], 1)
    expect(ownKeysCalls).toBe(4)
    // a crawl compiles it once per container, whatever the number of children; it is still the last set here
    const doc: Record<string, number> = {}
    for (let i = 0; i < 100; i++) { doc[`k${i}`] = i }
    syncCrawl<{}, R>(doc, () => {}, { rules: small })
    expect(ownKeysCalls).toBe(4)
    getNodeRules(r, "x-c", ["x-c"], 1)
    syncCrawl<{}, R>(doc, () => {}, { rules: small })
    expect(ownKeysCalls).toBe(5)
  })

  it("D5.13 mergeRules merges prefix rules like path keys: distinct prefixes by reference, duplicate prefixes lazily", () => {
    const ext = { tag: "ext" }
    const merged = mergeRules([
      rules({ "/x-*": ext, "/x-a-*": { x: 1, "/c": { z: 1 } } }),
      rules({ "/x-a-*": { y: 2 }, "/x-b-*": { tag: "b" } }),
    ])
    expect(merged["/x-*"]).toBe(ext)
    expect(typeof merged["/x-a-*"]).toBe("function")
    expect(getNodeRules(merged, "x-z", ["x-z"], 1)).toBe(ext)
    expect(getNodeRules(merged, "x-b-1", ["x-b-1"], 1)).toEqual({ tag: "b" })
    const a = getNodeRules(merged, "x-a-1", ["x-a-1"], {})!
    expect(a).toEqual({ x: 1, y: 2, "/c": { z: 1 } })
    expect(getNodeRules(a, "c", ["x-a-1", "c"], 1)).toEqual({ z: 1 })
    // duplicate non-path keys inside a duplicated prefix throw lazily, only for keys that reach that prefix
    const conflict = mergeRules([rules({ "/x-*": { tag: "1" } }), rules({ "/x-*": { tag: "2" } })])
    expect(() => getNodeRules(conflict, "x-a", ["x-a"], 1)).toThrow(/Duplicate key: tag/)
    expect(() => getNodeRules(conflict, "y-a", ["y-a"], 1)).not.toThrow()
    // a prefix shared by three sets merges all three
    const three = mergeRules([rules({ "/x-*": { x: 1 } }), rules({ "/x-*": { y: 2 } }), rules({ "/x-*": { z: 3 } })])
    expect(getNodeRules(three, "x-a", ["x-a"], 1)).toEqual({ x: 1, y: 2, z: 3 })
  })

  it("D5.14 spreading a rule set adds or overrides single prefix rules and keeps the others", () => {
    const base = rules({ "/x-*": { tag: "ext" }, "/x-internal-*": { tag: "private" }, "/*": { tag: "any" } })
    const custom: Rules = { ...base, "/x-sla-*": { tag: "sla" }, "/x-internal-*": { tag: "hidden" } }
    expect(getNodeRules(custom, "x-a", ["x-a"], 1)).toEqual({ tag: "ext" })
    expect(getNodeRules(custom, "x-sla-tier", ["x-sla-tier"], 1)).toEqual({ tag: "sla" })
    expect(getNodeRules(custom, "x-internal-id", ["x-internal-id"], 1)).toEqual({ tag: "hidden" })
    // the base set is unaffected (it is compiled separately)
    expect(getNodeRules(base, "x-sla-tier", ["x-sla-tier"], 1)).toEqual({ tag: "ext" })
    expect(getNodeRules(base, "x-internal-id", ["x-internal-id"], 1)).toEqual({ tag: "private" })
  })

  it("D5.15 prefix rules inside a crawl: extensions are matched at every level, real keys keep their exact rules", () => {
    const seen: Array<[string, unknown]> = []
    const ext = { tag: "ext", "/**": { tag: "ext-child" } }
    const objectRules = (): Rules => rules({ "/x-*": ext, "/*": () => objectRules(), "/name": { tag: "name" } })
    syncCrawl<{}, R>(
      { name: "n", "x-a": { deep: 1 }, child: { "x-b": 1, name: "m", list: [{ "x-c": true }] } },
      ({ path, rules }) => { if (path.length) { seen.push([path.join("."), rules?.tag]) } },
      { rules: objectRules() },
    )
    expect(seen).toEqual([
      ["name", "name"],
      ["x-a", "ext"],
      ["x-a.deep", "ext-child"],
      ["child", undefined],
      ["child.x-b", "ext"],
      ["child.name", "name"],
      ["child.list", undefined],
      ["child.list.0", undefined],
      ["child.list.0.x-c", "ext"],
    ])
  })
})

describe("D6 rule resolution caches", () => {
  it("D6.1 (characterization) under a static /** rule, nodes that resolve to the same static rules share one merged object", () => {
    const exact = { tag: "e" }
    const r = rules({ "/**": { g: 1 }, "/a": exact })
    const first = getNodeRules(r, "a", ["a"], 1)
    const second = getNodeRules(r, "a", ["p", "a"], 2)
    expect(first).toEqual({ "/**": { g: 1 }, g: 1, tag: "e" })
    expect(second).toBe(first)
    // no node rule: one shared merge of /** alone, different from the one with a node rule
    const other = getNodeRules(r, "b", ["b"], 1)
    expect(other).toEqual({ "/**": { g: 1 }, g: 1 })
    expect(getNodeRules(r, "c", ["c"], 1)).toBe(other)
    expect(other).not.toBe(first)
  })

  it("D6.2 results built from function rules or from merges are fresh per node", () => {
    const r = rules({ "/**": { g: 1 }, "/*": ({ key }: CrawlRulesContext) => ({ tag: String(key) }), "/a": { e: 1 } })
    const a1 = getNodeRules(r, "a", ["a"], 1)!
    const a2 = getNodeRules(r, "a", ["p", "a"], 1)!
    expect(a1).toEqual({ "/**": { g: 1 }, g: 1, tag: "a", e: 1 })
    expect(a2).toEqual(a1)
    expect(a2).not.toBe(a1)
    expect(getNodeRules(r, "b", ["b"], 1)).toMatchObject({ tag: "b" })
    // a /** function is called per node as before
    let calls = 0
    const fn = rules({ "/**": () => { calls++; return { g: calls } } })
    expect(getNodeRules(fn, "a", ["a"], 1)).toMatchObject({ g: 1 })
    expect(getNodeRules(fn, "a", ["a"], 1)).toMatchObject({ g: 2 })
  })

  it("D6.3 rule sets with and without exact keys resolve the same way, also when large enough to be cached", () => {
    const noExact = rules({ "/**": { g: 1 }, "/x-*": { tag: "ext" }, "/*": { l: 1 } })
    expect(getNodeRules(noExact, "a", ["a"], 1)).toEqual({ "/**": { g: 1 }, g: 1, l: 1 })
    expect(getNodeRules(noExact, "x-a", ["x-a"], 1)).toMatchObject({ tag: "ext", l: 1, g: 1 })
    const large: Record<string, unknown> = { "/*": { l: 1 } }
    for (let i = 0; i < 40; i++) { large[`/k${i}`] = { tag: `k${i}` } }
    const big = rules(large)
    for (let round = 0; round < 3; round++) {
      expect(getNodeRules(big, "k7", ["k7"], 1)).toEqual({ l: 1, tag: "k7" })
      expect(getNodeRules(big, "zz", ["zz"], 1)).toEqual({ l: 1 })
    }
    // array indexes still find exact rules
    expect(getNodeRules(rules({ "/0": { tag: "first" }, "/x-*": {} }), 0, [0], 1)).toEqual({ tag: "first" })
  })

  it("D6.4 exact rules resolve correctly for more distinct keys than the bounded key cache holds", () => {
    const r: Record<string, unknown> = {}
    for (let i = 0; i < 10_000; i++) { r[`/key${i}`] = { i } }
    const set = rules(r)
    for (let i = 0; i < 10_000; i += 1) { expect(getNodeRules(set, `key${i}`, [`key${i}`], 1)).toEqual({ i }) }
    expect(getNodeRules(set, "key17", ["key17"], 1)).toEqual({ i: 17 })
  })
})

