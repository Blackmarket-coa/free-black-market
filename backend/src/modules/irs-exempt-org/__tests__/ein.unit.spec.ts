import { formatEin, normalizeEin } from "../ein"

/**
 * The IRS files key everything on a zero-padded nine-character EIN. Every
 * way an EIN reaches us from outside must land on the same nine characters
 * or the lookup misses an org that is in the file — silently, as `not_found`.
 */
describe("normalizeEin", () => {
  it("keeps a file-shaped EIN as is", () => {
    expect(normalizeEin("000019818")).toBe("000019818")
    expect(normalizeEin("999999062")).toBe("999999062")
  })

  it("accepts the hyphenated form from a determination letter", () => {
    expect(normalizeEin("12-3456789")).toBe("123456789")
    expect(normalizeEin("00-0587764")).toBe("000587764")
  })

  it("restores leading zeros a spreadsheet stripped", () => {
    expect(normalizeEin("1347537")).toBe("001347537")
    expect(normalizeEin(1347537)).toBe("001347537")
    expect(normalizeEin("19818")).toBe("000019818")
  })

  it("tolerates surrounding and internal whitespace", () => {
    expect(normalizeEin("  12-3456789 ")).toBe("123456789")
    expect(normalizeEin("12 3456789")).toBe("123456789")
  })

  it("rejects what cannot be an EIN rather than guessing", () => {
    expect(normalizeEin("")).toBeNull()
    expect(normalizeEin("   ")).toBeNull()
    expect(normalizeEin(null)).toBeNull()
    expect(normalizeEin(undefined)).toBeNull()
    expect(normalizeEin("1234567890")).toBeNull() // ten digits
    expect(normalizeEin("12-34567A9")).toBeNull()
    expect(normalizeEin("000000000")).toBeNull()
    expect(normalizeEin("0")).toBeNull()
  })
})

describe("formatEin", () => {
  it("renders the conventional XX-XXXXXXX", () => {
    expect(formatEin("000019818")).toBe("00-0019818")
  })
})
