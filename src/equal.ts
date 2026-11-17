const hasOwn = Object.prototype.hasOwnProperty

// `===` plus NaN equals NaN; +0 and -0 are equal under `===` already
const sameValue = (x: unknown, y: unknown): boolean => x === y || (x !== x && y !== y)

const isContainer = (x: unknown): x is Record<string | number, unknown> => typeof x === "object" && x !== null

// Pairs above this depth are not recorded. A cycle produces unbounded depth, so it is still caught (after being
// unrolled this many levels, with the same verdict), while ordinary documents, which are shallow, skip the bookkeeping.
const UNTRACKED_DEPTH = 32

/**
 * Deep equality for JSON-like values: primitives by value (`NaN` equals `NaN`, `+0` equals `-0`), arrays by index with
 * holes compared as holes, every other object by its own enumerable string keys. Prototypes, symbol keys and the internal
 * state of `Date`, `Map`, `Set` or `RegExp` are not compared. Iterative (no recursion limit) and cycle-safe: a pair of
 * objects already under comparison is assumed equal, as in `util.isDeepStrictEqual`; pairs are recorded only below the
 * first levels, so shallow documents pay nothing for it.
 */
export const equal = (a: unknown, b: unknown): boolean => {
  if (sameValue(a, b)) { return true }
  if (!isContainer(a) || !isContainer(b)) { return false }

  // pairs of containers to compare with their depth: x, y, depth
  const stack: unknown[] = [a, b, 0]
  // containers of `a` already paired with a container of `b`; a second distinct partner goes into `morePairs`
  const pairs = new Map<object, object>()
  let morePairs: Map<object, Set<object>> | undefined

  while (stack.length) {
    const depth = stack.pop() as number
    const y = stack.pop() as Record<string | number, unknown>
    const x = stack.pop() as Record<string | number, unknown>

    if (depth >= UNTRACKED_DEPTH) {
      const seen = pairs.get(x)
      if (seen === undefined) {
        pairs.set(x, y)
      } else if (seen === y) {
        continue
      } else {
        let partners = morePairs?.get(x)
        if (!partners) { (morePairs ??= new Map()).set(x, (partners = new Set())) }
        if (partners.has(y)) { continue }
        partners.add(y)
      }
    }

    const xIsArray = Array.isArray(x)
    if (xIsArray !== Array.isArray(y)) { return false }

    if (xIsArray) {
      const length = x.length as number
      if (length !== (y.length as number)) { return false }
      for (let i = 0; i < length; i++) {
        const vx = x[i]
        const vy = y[i]
        if (sameValue(vx, vy)) {
          // a hole and an explicit undefined differ
          if (vx === undefined && (i in x) !== (i in y)) { return false }
          continue
        }
        if (!isContainer(vx) || !isContainer(vy)) { return false }
        stack.push(vx, vy, depth + 1)
      }
    } else {
      const keys = Object.keys(x)
      if (keys.length !== Object.keys(y).length) { return false }
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i]
        if (!hasOwn.call(y, key)) { return false }
        const vx = x[key]
        const vy = y[key]
        if (sameValue(vx, vy)) { continue }
        if (!isContainer(vx) || !isContainer(vy)) { return false }
        stack.push(vx, vy, depth + 1)
      }
    }
  }

  return true
}
