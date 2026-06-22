import { describe, expect, it } from "vitest"
import { isArray, isEmpty, isObject } from "../isEmpty"

describe("isObject", () => {
  it("is true for objects and arrays", () => {
    expect(isObject({})).toBe(true)
    expect(isObject([])).toBe(true)
  })

  it("is false for primitives and nullish values", () => {
    expect(isObject("x")).toBe(false)
    expect(isObject(1)).toBe(false)
    expect(isObject(null)).toBe(false)
    expect(isObject(undefined)).toBe(false)
  })
})

describe("isArray", () => {
  it("distinguishes arrays from objects", () => {
    expect(isArray([])).toBe(true)
    expect(isArray([1, 2])).toBe(true)
    expect(isArray({})).toBe(false)
    expect(isArray("xy")).toBe(false)
  })
})

describe("isEmpty", () => {
  it("treats null and undefined as empty", () => {
    expect(isEmpty(null)).toBe(true)
    expect(isEmpty(undefined)).toBe(true)
  })

  it("treats empty objects, arrays, and blank strings as empty", () => {
    expect(isEmpty({})).toBe(true)
    expect(isEmpty([])).toBe(true)
    expect(isEmpty("")).toBe(true)
    expect(isEmpty("   ")).toBe(true)
  })

  it("treats populated values as non-empty", () => {
    expect(isEmpty({ a: 1 })).toBe(false)
    expect(isEmpty([1])).toBe(false)
    expect(isEmpty("hello")).toBe(false)
  })
})
