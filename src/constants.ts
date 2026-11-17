// Key under which `clone`, `syncClone` and `transform` store the root value in their synthetic wrapper object,
// and the key passed to clone/transform hooks for the root node (the crawl context itself has `key === undefined` at the root).
export const JSON_ROOT_KEY = "#"

// Removal marker for `transform`: a hook that returns `{ value: REMOVE }` deletes the current node from its parent
// (objects: the key is deleted, arrays: the element is spliced out once the array has been crawled). At the root the
// transform resolves to `undefined`. `Symbol.for` makes the marker shared between duplicated copies of the library.
export const REMOVE: unique symbol = Symbol.for("json-crawl/remove")
