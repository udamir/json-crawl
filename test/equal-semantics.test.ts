import { execFileSync } from "node:child_process"
import { pathToFileURL } from "node:url"
import { equal, syncClone } from "../src"

// Block G: deep equality

describe("G1 equal basics", () => {
  it("G1.1 primitives compare by value, mismatching primitives are not equal", () => {
    expect(equal(1, 1)).toBe(true)
    expect(equal("a", "a")).toBe(true)
    expect(equal(true, true)).toBe(true)
    expect(equal(null, null)).toBe(true)
    expect(equal(undefined, undefined)).toBe(true)
    expect(equal(1, 2)).toBe(false)
    expect(equal("a", "b")).toBe(false)
    expect(equal(true, false)).toBe(false)
  })

  it("G1.2 values of different types are not equal", () => {
    expect(equal(1, "1")).toBe(false)
    expect(equal(null, undefined)).toBe(false)
    expect(equal(0, false)).toBe(false)
    expect(equal("", null)).toBe(false)
    expect(equal(null, {})).toBe(false)
    expect(equal(null, [])).toBe(false)
  })

  it("G1.3 the same reference is always equal", () => {
    const obj = { a: [1, { b: 2 }] }
    expect(equal(obj, obj)).toBe(true)
  })

  it("G1.4 structurally equal nested objects and arrays are equal", () => {
    const a = { name: "John", tags: ["x", "y"], address: { city: "NY", geo: [1, 2] }, n: null }
    const b = { name: "John", tags: ["x", "y"], address: { city: "NY", geo: [1, 2] }, n: null }
    expect(equal(a, b)).toBe(true)
    expect(equal(syncClone(a), a)).toBe(true)
  })

  it("G1.5 key order does not matter", () => {
    expect(equal({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(true)
  })

  it("G1.6 arrays of different length are not equal (either side longer)", () => {
    expect(equal([1, 2], [1, 2, 3])).toBe(false)
    expect(equal([1, 2, 3], [1, 2])).toBe(false)
    expect(equal({ a: [1] }, { a: [] })).toBe(false)
  })

  it("G1.7 array element order matters", () => {
    expect(equal([1, 2], [2, 1])).toBe(false)
    expect(equal({ a: [{ b: 1 }, { b: 2 }] }, { a: [{ b: 2 }, { b: 1 }] })).toBe(false)
  })

  it("G1.8 a missing key differs from an extra key and from an undefined value", () => {
    expect(equal({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(equal({ a: 1, b: 2 }, { a: 1 })).toBe(false)
    expect(equal({ a: undefined }, {})).toBe(false)
    expect(equal({}, { a: undefined })).toBe(false)
    expect(equal({ a: undefined }, { a: undefined })).toBe(true)
  })

  it("G1.9 a nested primitive mismatch makes the whole document unequal", () => {
    expect(equal({ a: { b: { c: 1 } } }, { a: { b: { c: 2 } } })).toBe(false)
    expect(equal({ a: [1, [2, 3]] }, { a: [1, [2, 4]] })).toBe(false)
  })

  it("G1.10 a nested type mismatch makes the whole document unequal", () => {
    expect(equal({ a: { b: 1 } }, { a: 5 })).toBe(false)
    expect(equal({ a: 5 }, { a: { b: 1 } })).toBe(false)
    expect(equal({ a: "1" }, { a: 1 })).toBe(false)
  })

  it("G1.11 nested null versus object is unequal in both directions", () => {
    expect(equal({ a: null }, { a: {} })).toBe(false)
    expect(equal({ a: null }, { a: [] })).toBe(false)
  })

  it("G1.12 an object on the left and null on the right at the same path is unequal and does not throw", () => {
    expect(equal({}, null)).toBe(false)
    expect(equal([], null)).toBe(false)
    expect(equal({ a: {}, b: {} }, { a: null, b: {} })).toBe(false)
    expect(equal({ a: [1] }, { a: null })).toBe(false)
  })

  it("G1.13 a plain object is never equal to an array", () => {
    expect(equal({}, [])).toBe(false)
    expect(equal({ 0: "a" }, ["a"])).toBe(false)
    expect(equal({ a: { 0: 1, 1: 2 } }, { a: [1, 2] })).toBe(false)
  })

  it("G1.14 an array is not equal to a plain object with the same keys (array on the left)", () => {
    expect(equal([], {})).toBe(false)
    expect(equal(["a"], { 0: "a" })).toBe(false)
  })

  it("G1.15 a type mismatch followed by an equal object sibling is still unequal", () => {
    expect(equal({ a: 1, b: {} }, { a: "1", b: {} })).toBe(false)
    expect(equal({ a: 1, b: { c: 1 } }, { a: "1", b: { c: 1 } })).toBe(false)
    expect(equal([1, [2]], ["1", [2]])).toBe(false)
    expect(equal({ a: { x: 1 }, b: [] }, { a: 5, b: [] })).toBe(false)
  })

  it("G1.16 a type mismatch that is the last node is reported correctly", () => {
    expect(equal({ b: {}, a: 1 }, { b: {}, a: "1" })).toBe(false)
  })
})

describe("G2 edge values", () => {
  it("G2.1 NaN is equal to NaN", () => {
    expect(equal(NaN, NaN)).toBe(true)
    expect(equal({ a: NaN }, { a: NaN })).toBe(true)
    expect(equal([NaN], [NaN])).toBe(true)
    expect(equal(NaN, 0)).toBe(false)
    expect(equal({ a: NaN }, { a: "NaN" })).toBe(false)
  })

  it("G2.2 +0 and -0 are equal", () => {
    expect(equal(0, -0)).toBe(true)
    expect(equal({ a: -0 }, { a: 0 })).toBe(true)
    expect(equal([-0], [0])).toBe(true)
  })

  it("G2.3 (characterization) sparse holes and explicit undefined elements are not equal (own keys differ)", () => {
    expect(equal([, 1], [undefined, 1])).toBe(false)
    expect(equal([, 1], [, 1])).toBe(true)
  })

  // Holes are preserved by clone and compared as holes by equal
  it("G2.4 a clone of a sparse array is equal to its source", () => {
    const source = [1, , 3]
    expect(equal(source, syncClone(source))).toBe(true)
    expect(equal([1, , 3], [1, undefined, 3])).toBe(false)
    expect(equal([1, undefined, 3], [1, , 3])).toBe(false)
    expect(equal({ a: [, , ] }, { a: [, , ] })).toBe(true)
    expect(equal([, ], [undefined])).toBe(false)
  })

  it("G2.5 (characterization, JSON values only) objects without own enumerable keys (Date, Map, RegExp) compare equal regardless of content; prototypes are not compared", () => {
    expect(equal(new Date(1), new Date(2))).toBe(true)
    expect(equal(new Map([[1, 2]]), new Map())).toBe(true)
    expect(equal(/a/, /b/)).toBe(true)
    expect(equal(Object.assign(Object.create(null), { a: 1 }), { a: 1 })).toBe(true)
    class P { a = 1 }
    expect(equal(new P(), { a: 1 })).toBe(true)
  })

  it("G2.6 empty containers equal empty containers of the same kind", () => {
    expect(equal({}, {})).toBe(true)
    expect(equal([], [])).toBe(true)
    expect(equal({ a: {} }, { a: {} })).toBe(true)
    expect(equal({ a: [] }, { a: [] })).toBe(true)
  })

  it("G2.7 deeply nested (5000 levels) documents compare without a stack overflow", () => {
    const build = () => { const root: any = {}; let cur = root; for (let i = 0; i < 5000; i++) { cur.n = { i }; cur = cur.n } return root }
    expect(equal(build(), build())).toBe(true)
    const other = build()
    let cur = other
    for (let i = 0; i < 4999; i++) { cur = cur.n }
    cur.i = -1
    expect(equal(build(), other)).toBe(false)
  })

  it("G2.8 wide objects (10k keys) compare correctly", () => {
    const wide = (n: number, tweak = false) => { const o: any = {}; for (let i = 0; i < n; i++) { o[`k${i}`] = i } if (tweak) { o.k9999 = -1 } return o }
    expect(equal(wide(10_000), wide(10_000))).toBe(true)
    expect(equal(wide(10_000), wide(10_000, true))).toBe(false)
  })

  it("G2.9 equal does not mutate its inputs", () => {
    const a = { x: [1, { y: 2 }] }
    const b = { x: [1, { y: 3 }] }
    const sa = JSON.stringify(a)
    const sb = JSON.stringify(b)
    equal(a, b)
    expect(JSON.stringify(a)).toBe(sa)
    expect(JSON.stringify(b)).toBe(sb)
  })

  // A pair of objects already under comparison is assumed equal, so cycles terminate. The check runs in a child process
  // (Node loads the TypeScript sources natively) with a timeout, so that a regression shows up as a failure instead of a
  // hung test run.
  it("G2.10 cyclic documents are compared without hanging", () => {
    const entry = pathToFileURL(new URL("../src/index.ts", import.meta.url).pathname).href
    const script = `
      const { equal } = await import(${JSON.stringify(entry)})
      const a = { x: 1 }; a.self = a
      const b = { x: 1 }; b.self = b
      process.stdout.write(String(equal(a, b)))
    `
    const out = execFileSync(process.execPath, ["--input-type=module", "--no-warnings", "-e", script], {
      timeout: 4000,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
    expect(out.trim()).toBe("true")
  }, 10_000)

  it("G2.11 cyclic documents compare by structure", () => {
    const a: any = { x: 1, list: [] }; a.self = a; a.list.push(a)
    const b: any = { x: 1, list: [] }; b.self = b; b.list.push(b)
    expect(equal(a, b)).toBe(true)
    const c: any = { x: 1, list: [] }; c.self = c; c.list.push({ x: 2, list: [], self: c })
    expect(equal(a, c)).toBe(false)
    // a cycle on one side only, a finite unrolled copy on the other: the finite side ends with a difference
    const d: any = { x: 1, list: [] }; d.self = { x: 1, list: [], self: null }; d.list.push(d)
    expect(equal(a, d)).toBe(false)
  })

  it("G2.12 a shared object paired with two different objects is compared against both", () => {
    const shared = { v: 1 }
    expect(equal({ a: shared, b: shared }, { a: { v: 1 }, b: { v: 1 } })).toBe(true)
    expect(equal({ a: shared, b: shared }, { a: { v: 1 }, b: { v: 2 } })).toBe(false)
    expect(equal({ a: { v: 1 }, b: { v: 2 } }, { a: shared, b: shared })).toBe(false)
    expect(equal([shared, shared, shared], [{ v: 1 }, { v: 1 }, { v: 3 }])).toBe(false)
  })

  it("G2.13 keys with undefined values, non-enumerable and symbol keys", () => {
    const sym = Symbol("s")
    expect(equal({ a: 1, [sym]: 1 }, { a: 1, [sym]: 2 })).toBe(true)
    const hidden = Object.defineProperty({ a: 1 }, "h", { value: 1, enumerable: false })
    expect(equal(hidden, { a: 1 })).toBe(true)
    expect(equal({ a: 1 }, hidden)).toBe(true)
    expect(equal({ a: 1, b: undefined }, { a: 1, c: undefined })).toBe(false)
  })

  it("G2.14 a 100k element array compares in linear time", () => {
    const make = (last: unknown) => { const a: unknown[] = Array.from({ length: 100_000 }, (_, i) => (i % 2 ? `s${i}` : i)); a[99_999] = last; return a }
    const t0 = performance.now()
    expect(equal(make("x"), make("x"))).toBe(true)
    expect(equal(make("x"), make("y"))).toBe(false)
    expect(performance.now() - t0).toBeLessThan(1_000)
  })

  // pairs are recorded only below the first 32 levels: cycles that start shallow or deep must still terminate
  const nest = (depth: number, leaf: any): any => { let doc = leaf; for (let i = 0; i < depth; i++) { doc = { d: i, child: doc } } return doc }

  it("G2.15 a cycle entered below the untracked levels is compared by structure", () => {
    const loopA: any = { v: 1 }; loopA.self = loopA
    const loopB: any = { v: 1 }; loopB.self = loopB
    const loopC: any = { v: 2 }; loopC.self = loopC
    for (const depth of [0, 1, 31, 32, 33, 100]) {
      expect(equal(nest(depth, loopA), nest(depth, loopB))).toBe(true)
      expect(equal(nest(depth, loopA), nest(depth, loopC))).toBe(false)
    }
  })

  it("G2.16 (characterization) cycles of different periods that unroll to the same structure are equal (util.isDeepStrictEqual says false)", () => {
    const one: any = { v: 1 }; one.next = one
    const two: any = { v: 1, next: { v: 1 } }; two.next.next = two
    const odd: any = { v: 1, next: { v: 2 } }; odd.next.next = odd
    expect(equal(one, two)).toBe(true)
    expect(equal(one, odd)).toBe(false)
  })

  it("G2.17 a long cycle (longer than the untracked levels) terminates", () => {
    const ring = (length: number, mark: number): any => {
      const head: any = { i: 0 }
      let cur = head
      for (let i = 1; i < length; i++) { cur.next = { i: i === length - 1 ? mark : i }; cur = cur.next }
      cur.next = head
      return head
    }
    expect(equal(ring(100, 99), ring(100, 99))).toBe(true)
    expect(equal(ring(100, 99), ring(100, -1))).toBe(false)
  })

  // regression: recording pairs only below a depth threshold explored every path down to it, which is exponential when
  // objects reach the same object more than once (dereferenced OpenAPI documents share schemas everywhere)
  it("G2.18 objects that reference the same object several times are compared in linear time", () => {
    const selfRefs = (fan: number): any => { const o: any = { x: 1 }; for (let i = 0; i < fan; i++) { o[`r${i}`] = o } return o }
    // a lattice: every level references the next one twice, 40 levels deep (2^40 paths, 41 distinct objects)
    const lattice = (levels: number, leaf: number): any => {
      let node: any = { leaf }
      for (let i = 0; i < levels; i++) { node = { left: node, right: node, list: [node, node] } }
      return node
    }
    const start = performance.now()
    for (const fan of [2, 3, 8]) {
      expect(equal(selfRefs(fan), selfRefs(fan))).toBe(true)
    }
    expect(equal(lattice(40, 1), lattice(40, 1))).toBe(true)
    expect(equal(lattice(40, 1), lattice(40, 2))).toBe(false)
    expect(performance.now() - start).toBeLessThan(1000)
  })
})
