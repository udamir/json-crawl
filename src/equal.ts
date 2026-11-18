const hasOwn = Object.prototype.hasOwnProperty

// `===` plus NaN equals NaN; +0 and -0 are equal under `===` already
const sameValue = (x: unknown, y: unknown): boolean => x === y || (x !== x && y !== y)

const isContainer = (x: unknown): x is Record<string | number, unknown> => typeof x === "object" && x !== null

// Records that x is being compared with y. The first partner of x is kept in `pairs`; further distinct partners (x
// shared by objects that are compared with different objects) go into a set in `more`, created on first need.
interface Visited {
  readonly pairs: Map<object, object>
  more: Map<object, Set<object>> | undefined
}
const recordPair = (visited: Visited, x: object, y: object): void => {
  if (!visited.pairs.has(x)) { visited.pairs.set(x, y); return }
  let partners = visited.more?.get(x)
  if (!partners) { (visited.more ??= new Map()).set(x, (partners = new Set())) }
  partners.add(y)
}
const wasVisited = (visited: Visited, x: object, y: object): boolean => {
  const first = visited.pairs.get(x)
  return first !== undefined && (first === y || visited.more?.get(x)?.has(y) === true)
}

/**
 * Deep equality for JSON-like values: primitives by value (`NaN` equals `NaN`, `+0` equals `-0`), arrays by index with
 * holes compared as holes, every other object by its own enumerable string keys. Prototypes, symbol keys and the internal
 * state of `Date`, `Map`, `Set` or `RegExp` are not compared. Iterative (no recursion limit) and cycle-safe: a pair of
 * objects already under comparison is assumed equal, as in `util.isDeepStrictEqual`, and a pair reached again through a
 * shared reference is not compared twice.
 */
export const equal = (a: unknown, b: unknown): boolean => {
  if (sameValue(a, b)) { return true }
  if (!isContainer(a) || !isContainer(b)) { return false }

  // pairs of containers to compare (x at even, y at odd positions)
  const stack: unknown[] = [a, b]
  // pairs already under comparison; only pairs with container children are recorded: a cycle or a shared reference
  // always leads back through such a pair, while a container of primitives cannot lead anywhere and is simply compared
  // again when it is reached twice (bounded by its size), which saves the bookkeeping for most containers
  const visited: Visited = { pairs: new Map(), more: undefined }

  while (stack.length) {
    const y = stack.pop() as Record<string | number, unknown>
    const x = stack.pop() as Record<string | number, unknown>

    if (wasVisited(visited, x, y)) { continue }
    let recorded = false

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
        if (!recorded) { recordPair(visited, x, y); recorded = true }
        stack.push(vx, vy)
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
        if (!recorded) { recordPair(visited, x, y); recorded = true }
        stack.push(vx, vy)
      }
    }
  }

  return true
}
