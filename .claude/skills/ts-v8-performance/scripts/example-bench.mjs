// Template for a bench file used by compare.mjs and alloc.mjs. Copy it next to your project and edit.
// `lib` is the module under test, imported from the variant path given on the command line, so the same bench file
// runs against the old and the new build. Build inputs once here, outside the timed functions; a timed function must
// only do the work being measured (no cloning or parsing of inputs inside it).
import { readFileSync } from "node:fs"

export default async (lib) => {
  const doc = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8"))
  const noop = () => {}
  return {
    "walk, no-op visitor": () => lib.walk(doc, noop),
    "clone": () => lib.clone(doc),
    "async variant": () => lib.walkAsync(doc, noop), // promises are awaited by the runner
  }
}
