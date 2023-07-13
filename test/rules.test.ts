import { CrawlRules, SyncCloneHook, syncClone } from "../src"

interface TestState {
  counter: number
}

type TestRule = { $: (value: any, state: TestState) => any }
type TestRules = CrawlRules<TestRule, TestState>

describe('rules test', () => {
  it('should execute function for each node base on rules', () => {
    const testRules: TestRules = {
      $: (v, s) => v.test = "test",
      "/address": {
        $: (v, s) => {
          for (const key of Object.keys(v)) {
            v[key] = v[key].toUpperCase() + ` ${ s.counter++ }`
          }
        }
      }
    }
    
    const source = {
      name: "John",
      age: 30,
      address: {
        street: "123 Main St",
        city: "New York"
      }
    }

    const hook: SyncCloneHook = (value, ctx) => {
      if (ctx.rules && "$" in ctx.rules) {
        ctx.rules.$(value, ctx.state)
      }
      return { value }
    }

    const state: TestState = { counter: 0 }

    const data = syncClone(source, hook, { rules: testRules, state })

    expect(data).toEqual({
      name: "John",
      age: 30,
      address: {
        street: "123 MAIN ST 0",
        city: "NEW YORK 1"
      },
      test: "test"
    })
  })

  it('should execute function for each node base on common rule', () => {
    const testRules: TestRules = {
      "/**": {
        $: (v) => typeof v === "string"
      }
    }

    const source = {
      name: "John",
      age: 30,
      address: {
        street: "123 Main St",
        city: "New York"
      }
    }

    const hook: SyncCloneHook = (value, ctx) => {
      if (ctx.rules && "$" in ctx.rules && ctx.rules.$(value)) {
        return { value: (value as string).toUpperCase() }
      }
      return { value }
    }

    const data = syncClone(source, hook, { rules: testRules })

    expect(data).toEqual({
      name: "JOHN",
      age: 30,
      address: {
        street: "123 MAIN ST",
        city: "NEW YORK"
      },
    })
  })
})
