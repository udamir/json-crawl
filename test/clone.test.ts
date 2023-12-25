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
    expect(data === source).toEqual(false)
  })

  it('should clone object with cycle reference', () => {
    const source: any = {
      name: "John",
      age: 30,
      address: {
        street: "123 Main St",
        city: "New York"
      }
    }

    source.cycle = source

    const data = syncClone(source)

    expect(data).toEqual(source)
    expect(data === source).toEqual(false)
  })
})
