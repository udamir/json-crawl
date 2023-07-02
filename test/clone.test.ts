import { syncClone } from "../src"

describe('clone test', () => {
  it('should clone object', () => {
    const source = {
      name: "John",
      age: 30,
      address: {
        street: "123 Main St",
        city: "New York"
      }
    }

    const data = syncClone(source)

    expect(data).toEqual(source)
  })
})
