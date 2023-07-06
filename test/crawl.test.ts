import { syncCrawl } from "../src"

describe('crawl test', () => {
  it('should crawl all nodes', () => {
    const source = {
      name: "John",
      age: 30,
      address: {
        street: "123 Main St",
        city: "New York"
      }
    }

    let counter = 0
    syncCrawl(source, (value) => { 
      counter++
      return { value }
    })

    expect(counter).toEqual(6)
  })
})
