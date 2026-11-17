import { clone, syncClone, syncCrawl, type CloneState } from "../src"

// Block E: clone / syncClone semantics

const collectObjects = (value: unknown, acc = new Set<object>()): Set<object> => {
  if (typeof value === "object" && value !== null && !acc.has(value)) {
    acc.add(value)
    for (const key of Object.keys(value)) { collectObjects((value as any)[key], acc) }
  }
  return acc
}

describe("E1 deep copy", () => {
  it("E1.1 the clone is deeply equal and shares no object with the source", () => {
    const source = { a: { b: [1, { c: 2 }] }, d: "x", e: null }
    const result = syncClone(source)
    expect(result).toEqual(source)
    const sourceObjects = collectObjects(source)
    for (const obj of collectObjects(result)) { expect(sourceObjects.has(obj)).toBe(false) }
  })

  it("E1.2 arrays are cloned as real arrays, including nested and empty ones", () => {
    const result: any = syncClone({ a: [1, [2, []], { b: [] }] })
    expect(Array.isArray(result.a)).toBe(true)
    expect(Array.isArray(result.a[1])).toBe(true)
    expect(Array.isArray(result.a[1][1])).toBe(true)
    expect(Array.isArray(result.a[2].b)).toBe(true)
    expect(result).toEqual({ a: [1, [2, []], { b: [] }] })
  })

  it("E1.3 an array at the root is cloned as an array", () => {
    const result = syncClone([1, { a: 2 }])
    expect(Array.isArray(result)).toBe(true)
    expect(result).toEqual([1, { a: 2 }])
  })

  it("E1.4 mutating the clone does not affect the source and vice versa", () => {
    const source: any = { a: { b: [1] } }
    const result: any = syncClone(source)
    result.a.b.push(2)
    result.a.c = 3
    source.a.d = 4
    expect(source).toEqual({ a: { b: [1], d: 4 } })
    expect(result).toEqual({ a: { b: [1, 2], c: 3 } })
  })

  it("E1.5 null, undefined, booleans, numbers and strings are preserved", () => {
    const source = { n: null, u: undefined, t: true, f: false, z: 0, neg: -1.5, s: "", big: Number.MAX_SAFE_INTEGER }
    const result: any = syncClone(source)
    expect(result).toEqual(source)
    expect("u" in result).toBe(true)
    expect(Object.keys(result)).toEqual(Object.keys(source))
  })

  it("E1.6 primitives, null and undefined at the root are returned as is", () => {
    expect(syncClone(5)).toBe(5)
    expect(syncClone("s")).toBe("s")
    expect(syncClone(null)).toBeNull()
    expect(syncClone(undefined)).toBeUndefined()
    expect(syncClone(false)).toBe(false)
  })

  it("E1.7 the source is not mutated by cloning", () => {
    const source = { a: { b: [1, 2] } }
    const snapshot = JSON.stringify(source)
    syncClone(source)
    expect(JSON.stringify(source)).toBe(snapshot)
  })

  it("E1.8 nested keys named \"#\" (the internal root key) are cloned normally", () => {
    expect(syncClone({ "#": { "#": 1 }, a: "#" })).toEqual({ "#": { "#": 1 }, a: "#" })
  })
})

describe("E2 cycles and shared references", () => {
  it("E2.1 a self-referencing object is cloned with an equivalent cycle", () => {
    const source: any = { name: "root" }
    source.self = source
    const result: any = syncClone(source)
    expect(result).not.toBe(source)
    expect(result.self).toBe(result)
    expect(result.name).toBe("root")
  })

  it("E2.2 mutual cycles between two objects are preserved in the clone", () => {
    const a: any = { name: "a" }
    const b: any = { name: "b", a }
    a.b = b
    const result: any = syncClone({ a, b })
    expect(result.a.b).toBe(result.b)
    expect(result.b.a).toBe(result.a)
    expect(result.a).not.toBe(a)
  })

  it("E2.3 a cycle through an array back to a distant ancestor is preserved", () => {
    const root: any = { child: { list: [] } }
    root.child.list.push(root)
    const result: any = syncClone(root)
    expect(result.child.list[0]).toBe(result)
  })

  it("E2.4 shared (non-cyclic) references are cloned once and stay shared in the clone", () => {
    const shared = { s: 1 }
    const result: any = syncClone({ a: shared, b: shared, c: [shared] })
    expect(result.a).toBe(result.b)
    expect(result.c[0]).toBe(result.a)
    expect(result.a).not.toBe(shared)
    expect(result.a).toEqual(shared)
  })

  it("E2.5 (characterization) circular: false duplicates shared references instead of preserving them", () => {
    const shared = { s: 1 }
    const result: any = syncClone({ a: shared, b: shared }, [], { circular: false })
    expect(result.a).toEqual(shared)
    expect(result.a).not.toBe(result.b)
  })

  it("E2.6 (characterization) circular: false performs no cycle detection and would loop forever on cyclic input", () => {
    const source: any = { x: 1 }
    source.self = source
    let visited = 0
    const guard = () => { visited++; return visited >= 100 ? { terminate: true } : undefined }
    syncClone(source, guard, { circular: false })
    expect(visited).toBe(100)
    // the default (safe) mode stops after the 3 real nodes: root, x, self
    visited = 0
    syncClone(source, guard)
    expect(visited).toBe(3)
  })

  it("E2.7 the async clone handles cycles too", async () => {
    const source: any = { a: { b: 1 } }
    source.a.back = source
    const result: any = await clone(source)
    expect(result.a.back).toBe(result)
    expect(result.a.b).toBe(1)
  })

  it("E2.8 circular: false treats the input as a tree: shared references are copied separately", () => {
    const shared = { v: 1 }
    const result = syncClone({ a: shared, b: shared }, [], { circular: false }) as any
    expect(result).toEqual({ a: { v: 1 }, b: { v: 1 } })
    expect(result.a === result.b).toBe(false)
  })

  it("E2.9 circular: true (the default) keeps shared references and cycles", () => {
    const shared = { v: 1 }
    const a: any = { shared, again: shared }
    a.self = a
    for (const params of [{}, { circular: true }]) {
      const result = syncClone(a, [], params) as any
      expect(result.self === result).toBe(true)
      expect(result.shared === result.again).toBe(true)
    }
  })

  it("E2.10 circular applies to the async clone as well", async () => {
    const shared = { v: 1 }
    const tree = await clone({ a: shared, b: shared }, [], { circular: false }) as any
    const graph = await clone({ a: shared, b: shared }, [], { circular: true }) as any
    expect(tree.a === tree.b).toBe(false)
    expect(graph.a === graph.b).toBe(true)
  })
})

describe("E3 non-JSON inputs", () => {
  it("E3.1 sparse array holes stay holes, length is preserved", () => {
    const result = syncClone([1, , 3]) as unknown[]
    expect(result.length).toBe(3)
    expect(result[1]).toBeUndefined()
    expect(1 in result).toBe(false)
    expect(Object.keys(result)).toEqual(["0", "2"])
    // a trailing hole keeps the length too
    const trailing = syncClone([1, , ]) as unknown[]
    expect(trailing.length).toBe(2)
    expect(1 in trailing).toBe(false)
    // explicit undefined elements are kept as own elements
    const explicit = syncClone([1, undefined, 3]) as unknown[]
    expect(1 in explicit).toBe(true)
  })

  it("E3.2 (characterization) symbol-keyed properties are dropped", () => {
    const sym = Symbol("s")
    const result = syncClone({ [sym]: 1, a: 2 }) as any
    expect(result).toEqual({ a: 2 })
    expect(Object.getOwnPropertySymbols(result)).toHaveLength(0)
  })

  it("E3.3 (characterization) Date, Map, Set and RegExp instances are cloned as empty plain objects", () => {
    expect(syncClone(new Date(0))).toEqual({})
    expect(syncClone(new Map([[1, 2]]))).toEqual({})
    expect(syncClone(new Set([1]))).toEqual({})
    expect(syncClone(/x/g)).toEqual({})
    expect(Object.getPrototypeOf(syncClone(new Date(0)))).toBe(Object.prototype)
  })

  it("E3.4 (characterization) class instances lose their prototype; only own enumerable fields are copied", () => {
    class Point { x = 1; y = 2; get sum() { return this.x + this.y } }
    const result: any = syncClone(new Point())
    expect(result).toEqual({ x: 1, y: 2 })
    expect(result instanceof Point).toBe(false)
    expect(result.sum).toBeUndefined()
  })

  it("E3.5 non-enumerable and inherited properties are not copied", () => {
    const source = Object.create({ inherited: 1 })
    source.own = 2
    Object.defineProperty(source, "hidden", { value: 3, enumerable: false })
    expect(syncClone(source)).toEqual({ own: 2 })
  })

  // Regression: own "__proto__" keys are written with Object.defineProperty
  it("E3.6 an own \"__proto__\" key (as produced by JSON.parse) is copied as an own property, not as the prototype", () => {
    const source = JSON.parse('{"__proto__": {"polluted": true}, "x": 1}')
    const result: any = syncClone(source)
    expect(Object.prototype.hasOwnProperty.call(result, "__proto__")).toBe(true)
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
    expect(result.polluted).toBeUndefined()
    expect(Object.keys(result).sort()).toEqual(["__proto__", "x"])
    expect(result["__proto__"]).toEqual({ polluted: true })
    // same with circular: false and for a nested __proto__ key
    const tree: any = syncClone(JSON.parse('{"a": {"__proto__": {"p": 1}}}'), [], { circular: false })
    expect(Object.prototype.hasOwnProperty.call(tree.a, "__proto__")).toBe(true)
    expect(Object.getPrototypeOf(tree.a)).toBe(Object.prototype)
    expect(tree.a.p).toBeUndefined()
  })

  it("E3.7 cloning an own \"__proto__\" key never pollutes Object.prototype", () => {
    syncClone(JSON.parse('{"__proto__": {"polluted": true}}'))
    syncClone(JSON.parse('{"a": {"__proto__": {"polluted": true}}}'), [], { circular: false })
    expect(({} as any).polluted).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted")).toBe(false)
  })

  it("E3.8 keys named like Object.prototype members (constructor, toString) are copied as own properties", () => {
    const source = { constructor: 1, toString: "s", hasOwnProperty: null }
    const result = syncClone(source) as any
    expect(Object.keys(result).sort()).toEqual(["constructor", "hasOwnProperty", "toString"])
    expect(result.constructor).toBe(1)
    expect(result.toString).toBe("s")
  })
})

describe("E4 clone hooks", () => {
  it("E4.1 a hook returning a value changes what is written into the clone", () => {
    const result = syncClone({ a: 1, b: { c: 2 } }, ({ value }) => typeof value === "number" ? { value: value * 10 } : undefined)
    expect(result).toEqual({ a: 10, b: { c: 20 } })
  })

  it("E4.2 a hook replacing an object with another object clones the replacement's children", () => {
    const replacement = { z: { deep: 1 } }
    const result: any = syncClone({ a: { b: 1 } }, ({ key }) => key === "a" ? { value: replacement } : undefined)
    expect(result).toEqual({ a: { z: { deep: 1 } } })
    expect(result.a).not.toBe(replacement)
    expect(result.a.z).not.toBe(replacement.z)
  })

  it("E4.3 (characterization) a hook returning done omits the node from the clone", () => {
    expect(syncClone({ a: 1, b: 2 }, ({ key }) => key === "a" ? { done: true } : undefined)).toEqual({ b: 2 })
    expect(syncClone({ a: 1 }, ({ path }) => path.length === 0 ? { done: true } : undefined)).toBeUndefined()
  })

  it("E4.4 (characterization) a hook returning { value: undefined } keeps the key with an undefined value", () => {
    const result: any = syncClone({ a: 1, b: 2 }, ({ key }) => key === "a" ? { value: undefined } : undefined)
    expect(result).toEqual({ a: undefined, b: 2 })
    expect("a" in result).toBe(true)
  })

  it("E4.5 hooks see the user state plus the internal root and node fields", () => {
    const seen: Array<[string, unknown]> = []
    syncClone<{ tag: string }>({ a: { b: 1 } }, ({ path, state }) => {
      seen.push([path.join("."), state.tag])
      expect(state.root).toBeDefined()
      expect(state.node).toBeDefined()
    }, { state: { tag: "t" } })
    expect(seen).toEqual([["", "t"], ["a", "t"], ["a.b", "t"]])
  })

  it("E4.6 state.node points at the clone object under construction for the current parent", () => {
    const nodes: unknown[] = []
    const result = syncClone({ a: { b: 1 } }, ({ path, state }) => { if (path.length === 2) { nodes.push(state.node) } })
    expect(nodes[0]).toBe((result as any).a)
  })

  it("E4.7 state returned by a user hook is propagated to children and still carries node/root", () => {
    const seen: unknown[] = []
    const result = syncClone<{ depth: number }>({ a: { b: 1 } }, ({ state, path }) => {
      seen.push([path.join("."), state.depth])
      return { state: { ...state, depth: state.depth + 1 } as CloneState<{ depth: number }> }
    }, { state: { depth: 0 } })
    expect(seen).toEqual([["", 0], ["a", 1], ["a.b", 2]])
    expect(result).toEqual({ a: { b: 1 } })
  })

  it("E4.8 rules are passed to clone hooks and resolved per node", () => {
    type R = { upper?: boolean }
    const result = syncClone<{}, R>({ name: "john", city: "nyc" }, ({ value, rules }) => rules?.upper ? { value: (value as string).toUpperCase() } : undefined, { rules: { "/name": { upper: true } } as any })
    expect(result).toEqual({ name: "JOHN", city: "nyc" })
  })

  it("E4.9 a terminating hook yields the partially built clone", () => {
    const result = syncClone({ a: 1, b: 2, c: 3 }, ({ key }) => key === "c" ? { terminate: true } : undefined)
    expect(result).toEqual({ a: 1, b: 2 })
  })

  it("E4.10 exit hooks run with the clone node already populated", () => {
    let snapshot: unknown
    syncClone({ a: { b: 1, c: 2 } }, ({ key, state }) => key === "a" ? { exitHook: () => { snapshot = JSON.stringify(state.node) } } : undefined)
    expect(snapshot).toBe(JSON.stringify({ a: { b: 1, c: 2 } }))
  })
})

describe("E5 async clone", () => {
  it("E5.1 async hooks can transform values", async () => {
    const result = await clone({ a: [1, { b: 2 }] }, async ({ value }) => typeof value === "number" ? { value: value * 2 } : undefined)
    expect(result).toEqual({ a: [2, { b: 4 }] })
  })

  it("E5.2 clone without hooks produces an independent deep copy", async () => {
    const source = { a: { b: [1, 2] } }
    const result: any = await clone(source)
    expect(result).toEqual(source)
    expect(result.a).not.toBe(source.a)
    expect(result.a.b).not.toBe(source.a.b)
  })

  it("E5.3 a rejected hook rejects the clone", async () => {
    await expect(clone({ a: 1 }, async ({ key }) => { if (key === "a") { throw new Error("boom") } })).rejects.toThrow("boom")
  })

  it("E5.4 clone and syncClone produce identical results for the same input", async () => {
    const source = { a: [1, { b: null }], c: { d: "x", e: [[]] } }
    expect(await clone(source)).toEqual(syncClone(source))
  })
})

describe("E6 clone of crawled replacements", () => {
  it("E6.1 cloning the output of a crawl-free syncClone twice gives equal results (idempotence)", () => {
    const source = { a: [1, { b: 2 }], c: { d: null } }
    const once = syncClone(source)
    const twice = syncClone(once)
    expect(twice).toEqual(source)
    expect(twice).not.toBe(once)
  })

  it("E6.2 syncCrawl over a clone sees the same node count as over the source", () => {
    const source = { a: [1, { b: 2 }], c: { d: null } }
    const count = (v: unknown) => { let n = 0; syncCrawl(v, () => { n++ }); return n }
    expect(count(syncClone(source))).toBe(count(source))
  })
})
