import { JSON_ROOT_KEY, REMOVE, transform } from "../src"

// Block F: transform (in-place async transformation)
//
// Regression: the internal transformHook used to return `{ value, state }` with the same state object, so `state.node`
// never left the synthetic root wrapper `{ "#": data }` and every write below the root was lost. It now advances `state.node`
// to the current container, like clone does.
// Regression: array removals were spliced while the crawl iterated over indexes materialized up-front; they are now
// recorded and compacted in the array's exit hook, so every original element is visited once.
// Removal is signalled with the exported `REMOVE` sentinel; `{ value: undefined }`
// writes `undefined` (the key is kept) instead of removing.

describe("F1 transform", () => {
  it("F1.1 replacing the root value returns the replacement", async () => {
    expect(await transform({ a: 1 }, ({ path }) => path.length === 0 ? { value: { b: 2 } } : undefined)).toEqual({ b: 2 })
  })

  it("F1.2 removing the root value (REMOVE) returns undefined", async () => {
    expect(await transform({ a: 1 }, ({ path }) => path.length === 0 ? { value: REMOVE } : undefined)).toBeUndefined()
    // replacing the root with undefined also resolves to undefined
    expect(await transform({ a: 1 }, ({ path }) => path.length === 0 ? { value: undefined } : undefined)).toBeUndefined()
  })

  it("F1.3 the same object reference is returned when nothing is changed (in-place semantics)", async () => {
    const source = { a: { b: 1 } }
    const result = await transform(source, () => {})
    expect(result).toBe(source)
    expect(result).toEqual({ a: { b: 1 } })
  })

  it("F1.4 hooks visit every node in depth-first order with paths", async () => {
    const visited: string[] = []
    await transform({ a: { b: 1 }, c: [2] }, ({ path }) => { visited.push(path.join(".")) })
    expect(visited).toEqual(["", "a", "a.b", "c", "c.0"])
  })

  it("F1.5 replacing a top-level property value is applied to the document", async () => {
    const result = await transform({ a: 1, b: 2 }, ({ key }) => key === "a" ? { value: 10 } : undefined)
    expect(result).toEqual({ a: 10, b: 2 })
  })

  it("F1.6 replacing a nested property value is applied to the document", async () => {
    const result = await transform({ a: { b: 1, c: { d: 2 } } }, ({ key }) => key === "d" ? { value: "x" } : undefined)
    expect(result).toEqual({ a: { b: 1, c: { d: "x" } } })
  })

  // removal uses the REMOVE sentinel
  it("F1.7 returning REMOVE removes a property from its parent object", async () => {
    const result: any = await transform({ a: { b: 1, c: 2 }, d: 3 }, ({ key }) => key === "b" || key === "d" ? { value: REMOVE } : undefined)
    expect(result).toEqual({ a: { c: 2 } })
    expect("b" in result.a).toBe(false)
    expect("d" in result).toBe(false)
  })

  // removal uses the REMOVE sentinel
  it("F1.8 returning REMOVE for an array element removes it and compacts the array", async () => {
    const result = await transform({ list: [1, 2, 3, 4] }, ({ value, path }) => path.length === 2 && value === 2 ? { value: REMOVE } : undefined)
    expect(result).toEqual({ list: [1, 3, 4] })
  })

  it("F1.9 removing consecutive array elements removes all of them", async () => {
    const result = await transform([1, 2, 2, 3], ({ value, path }) => path.length && value === 2 ? { value: REMOVE } : undefined)
    expect(result).toEqual([1, 3])
    expect(await transform([2, 2, 2], ({ path }) => path.length ? { value: REMOVE } : undefined)).toEqual([])
    expect(await transform([[1, 2], [3]], ({ value }) => value === 1 || value === 3 ? { value: REMOVE } : undefined)).toEqual([[2], []])
  })

  it("F1.10 every original array element is visited exactly once even when elements are removed", async () => {
    const visited: unknown[] = []
    const result = await transform([1, 2, 3, 4], ({ value, path }) => {
      if (path.length) { visited.push(value) }
      return path.length && value === 2 ? { value: REMOVE } : undefined
    })
    expect(result).toEqual([1, 3, 4])
    expect(visited).toEqual([1, 2, 3, 4])
  })

  it("F1.11 replacing a nested object makes the replacement's children the ones visited and written", async () => {
    const visited: string[] = []
    const result = await transform({ a: { old: 1 } }, ({ key, path }) => {
      visited.push(path.join("."))
      if (key === "a") { return { value: { fresh: 1 } } }
      if (key === "fresh") { return { value: 2 } }
    })
    expect(visited).toEqual(["", "a", "a.fresh"])
    expect(result).toEqual({ a: { fresh: 2 } })
  })

  it("F1.12 transforming array element values in place", async () => {
    const result = await transform([1, [2, 3]], ({ value }) => typeof value === "number" ? { value: value * 2 } : undefined)
    expect(result).toEqual([2, [4, 6]])
  })

  it("F1.13 a no-op hook leaves pre-existing undefined values and array holes untouched", async () => {
    // Removal needs the REMOVE sentinel, so a no-op hook never deletes undefined-valued keys or elements
    const obj: any = await transform({ a: undefined, b: 1 }, () => {})
    expect("a" in obj).toBe(true)
    expect(obj).toEqual({ a: undefined, b: 1 })
    const arr = await transform([1, undefined, 3], () => {}) as unknown[]
    expect(arr.length).toBe(3)
    expect(1 in arr).toBe(true)
    const sparse = await transform([1, , 3], () => {}) as unknown[]
    expect(sparse.length).toBe(3)
    expect(1 in sparse).toBe(false)
  })

  it("F1.18 { value: undefined } writes undefined and keeps the key (it no longer removes)", async () => {
    const obj: any = await transform({ a: 1, b: 2 }, ({ key }) => key === "a" ? { value: undefined } : undefined)
    expect("a" in obj).toBe(true)
    expect(obj).toEqual({ a: undefined, b: 2 })
    const arr = await transform([1, 2, 3], ({ value }) => value === 2 ? { value: undefined } : undefined) as unknown[]
    expect(arr).toEqual([1, undefined, 3])
    expect(arr.length).toBe(3)
  })

  it("F1.19 REMOVE is a shared symbol and the root key constant is \"#\"", () => {
    expect(typeof REMOVE).toBe("symbol")
    expect(REMOVE).toBe(Symbol.for("json-crawl/remove"))
    expect(JSON_ROOT_KEY).toBe("#")
  })

  it("F1.20 hooks see the root under JSON_ROOT_KEY in state.node and children under their parent", async () => {
    const parents: unknown[] = []
    const source = { a: { b: 1 } }
    await transform(source, ({ path, state }) => { parents.push(path.length ? state.node : state.root[JSON_ROOT_KEY]) })
    expect(parents[0]).toBe(source)
    expect(parents[1]).toBe(source)
    expect(parents[2]).toBe(source.a)
  })

  it("F1.21 an own __proto__ key is written as an own property by transform", async () => {
    const source = JSON.parse('{"__proto__": {"polluted": true}, "x": 1}')
    const result: any = await transform(source, ({ key }) => key === "polluted" ? { value: false } : undefined)
    expect(result).toBe(source)
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
    expect(Object.prototype.hasOwnProperty.call(result, "__proto__")).toBe(true)
    expect(result["__proto__"].polluted).toBe(false)
    expect(({} as any).polluted).toBeUndefined()
  })

  it("F1.22 removing an array element that is a container does not visit its children", async () => {
    const visited: string[] = []
    const result = await transform({ list: [{ drop: true, x: 1 }, { x: 2 }] }, ({ path, value }) => {
      visited.push(path.join("."))
      return (value as any)?.drop ? { value: REMOVE } : undefined
    })
    expect(result).toEqual({ list: [{ x: 2 }] })
    expect(visited).toEqual(["", "list", "list.0", "list.1", "list.1.x"])
  })

  it("F1.23 an exit hook returned by a user hook for an array runs after the array has been compacted", async () => {
    let seen: unknown
    await transform({ list: [1, 2, 3] }, ({ key, value, state }) => {
      if (key === "list") { return { exitHook: () => { seen = [...(state.node.list as number[])] } } }
      return value === 2 ? { value: REMOVE } : undefined
    })
    expect(seen).toEqual([1, 3])
  })

  it("F1.14 a rejected hook rejects the transform", async () => {
    await expect(transform({ a: 1 }, async ({ key }) => { if (key === "a") { throw new Error("boom") } })).rejects.toThrow("boom")
  })

  it("F1.15 state and rules are passed to transform hooks", async () => {
    type R = { tag?: string }
    const seen: Array<[string, unknown, unknown]> = []
    await transform<{ s: number }, R>({ a: 1 }, ({ path, state, rules }) => { seen.push([path.join("."), state.s, rules?.tag]) }, { state: { s: 7 }, rules: { "/a": { tag: "a" } } as any })
    expect(seen).toEqual([["", 7, undefined], ["a", 7, "a"]])
  })

  it("F1.16 (characterization) transform has no cycle detection; a cyclic document never finishes without a terminating hook", async () => {
    const source: any = { a: 1 }
    source.self = source
    let visited = 0
    await transform(source, () => { visited++; return visited >= 50 ? { terminate: true } : undefined })
    expect(visited).toBe(50)
  })

  it("F1.17 primitives at the root are returned unchanged", async () => {
    expect(await transform(5, () => {})).toBe(5)
    expect(await transform(null, () => {})).toBeNull()
    expect(await transform("s", () => {})).toBe("s")
  })

  it("F1.24 with circular: true a cyclic document is transformed and the cycle is left in place", async () => {
    const doc: any = { n: 1, child: { n: 2 } }
    doc.child.parent = doc
    const result: any = await transform(doc, ({ value }) => (typeof value === "number" ? { value: value * 10 } : undefined), { circular: true })
    expect(result).toBe(doc)
    expect(doc.n).toBe(10)
    expect(doc.child.n).toBe(20)
    expect(doc.child.parent).toBe(doc)
  })

  it("F1.25 with circular: true a cyclic reference can still be removed by a hook", async () => {
    const doc: any = { list: [1] }
    doc.list.push(doc)
    await transform(doc, ({ key, value }) => (key === 1 && value === doc ? { value: REMOVE } : undefined), { circular: true })
    expect(doc).toEqual({ list: [1] })
  })
})
