import { createReadStream, promises as fs } from "node:fs"
import path from "node:path"
import { Readable } from "node:stream"
import { parseEoBmfHeader, parseEoBmfLine, parseEoBmfStream } from "../parsers/eo-bmf"
import { splitDelimited } from "../parsers/lines"
import { parsePub78Line, parsePub78Stream } from "../parsers/pub78"
import { parseIrsDate, parseRevocationLine, parseRevocationStream } from "../parsers/revocation"
import { openZipEntry } from "../zip-entry"

const fixture = (name: string) => path.join(__dirname, "fixtures", name)

async function collect<T>(gen: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const item of gen) out.push(item)
  return out
}

/**
 * Fixtures are real rows from the live files of 2026-09-10 (Pub 78),
 * 2026-09-30 (revocation) and 2026-09-07 (eo_xx.csv), with ICO, STREET and
 * the revocation street address blanked. Column orders asserted here are
 * the ones observed in those files, not ones assumed from documentation.
 */
describe("Pub 78 parser", () => {
  it("reads EIN | Name | City | State | Country | Deductibility Status", () => {
    const row = parsePub78Line("000587764|Iglesia Bethesda Inc.|Lowell|MA|United States|PC\r")
    expect(row).toEqual({
      ein: "000587764",
      name: "Iglesia Bethesda Inc.",
      city: "Lowell",
      state: "MA",
      country: "United States",
      deductibility_codes: ["PC"],
    })
  })

  it("keeps multi-code deductibility as a list", () => {
    const row = parsePub78Line("010017496|Some Lodge|York Harbor|ME|United States|EO,GROUP,LODGE")
    expect(row?.deductibility_codes).toEqual(["EO", "GROUP", "LODGE"])
  })

  it("skips the blank leading/trailing lines and malformed rows", () => {
    expect(parsePub78Line("")).toBeNull()
    expect(parsePub78Line("\r")).toBeNull()
    expect(parsePub78Line("not|enough|fields")).toBeNull()
    expect(parsePub78Line("ABCDEFGHI|Name|City|ST|United States|PC")).toBeNull()
  })

  it("streams the fixture out of its zip: 50 rows, every EIN nine digits", async () => {
    const { stream } = await openZipEntry(fixture("pub78-sample.zip"))
    const rows = await collect(parsePub78Stream(stream))
    expect(rows).toHaveLength(50)
    expect(rows.every((r) => /^\d{9}$/.test(r.ein))).toBe(true)
    expect(new Set(rows.map((r) => r.ein)).size).toBe(50)
    expect(rows.some((r) => r.deductibility_codes.length > 1)).toBe(true)
  })
})

describe("revocation parser", () => {
  it("parses DD-MON-YYYY as UTC midnight and rejects impossible dates", () => {
    expect(parseIrsDate("15-NOV-2017")?.toISOString()).toBe("2017-11-15T00:00:00.000Z")
    expect(parseIrsDate("")).toBeNull()
    expect(parseIrsDate(undefined)).toBeNull()
    expect(parseIrsDate("2017-11-15")).toBeNull()
    expect(parseIrsDate("31-FEB-2017")).toBeNull()
    expect(parseIrsDate("15-XYZ-2017")).toBeNull()
  })

  it("reads the twelve observed fields, dropping the street address", () => {
    const row = parseRevocationLine(
      "000003154|OAKLEAF FOREST TENANT MANAGEMENT ||1706 GREENLEAF DR|NORFOLK|VA|23523-2112|US|03|15-NOV-2017|12-MAR-2018|\r"
    )
    expect(row).toEqual({
      ein: "000003154",
      legal_name: "OAKLEAF FOREST TENANT MANAGEMENT",
      dba_name: null,
      city: "NORFOLK",
      state: "VA",
      country: "US",
      exemption_type: "03",
      revocation_date: new Date("2017-11-15T00:00:00Z"),
      posting_date: new Date("2018-03-12T00:00:00Z"),
      reinstatement_date: null,
    })
    expect(JSON.stringify(row)).not.toContain("GREENLEAF")
  })

  it("carries the reinstatement date when the IRS has one", () => {
    const row = parseRevocationLine(
      "001037180|MIDDLESEX BARBARIANS R F C INC||37 BOW ST|WOBURN|MA|01801-3636|US|00|15-JUN-2013|21-OCT-2013|15-JUN-2013"
    )
    expect(row?.reinstatement_date).toEqual(new Date("2013-06-15T00:00:00Z"))
  })

  it("skips a row missing either defining date rather than inventing one", () => {
    expect(parseRevocationLine("000003154|X||ADDR|CITY|VA|23523|US|03||12-MAR-2018|")).toBeNull()
    expect(parseRevocationLine("000003154|X||ADDR|CITY|VA|23523|US|03|15-NOV-2017||")).toBeNull()
    expect(parseRevocationLine("only|eleven|fields|here|a|b|c|d|e|f|g")).toBeNull()
  })

  it("streams the fixture out of its zip, keeping repeated EINs as separate events", async () => {
    const { stream } = await openZipEntry(fixture("revocation-sample.zip"))
    const rows = await collect(parseRevocationStream(stream))
    expect(rows).toHaveLength(50)
    const byEin = new Map<string, number>()
    for (const r of rows) byEin.set(r.ein, (byEin.get(r.ein) ?? 0) + 1)
    expect(byEin.get("200644142")).toBe(2)
    expect(byEin.get("061681646")).toBe(2)
    expect(rows.filter((r) => r.reinstatement_date).length).toBeGreaterThan(0)
  })
})

describe("EO BMF parser", () => {
  const header =
    "EIN,NAME,ICO,STREET,CITY,STATE,ZIP,GROUP,SUBSECTION,AFFILIATION,CLASSIFICATION,RULING,DEDUCTIBILITY,FOUNDATION,ACTIVITY,ORGANIZATION,STATUS,TAX_PERIOD,ASSET_CD,INCOME_CD,FILING_REQ_CD,PF_FILING_REQ_CD,ACCT_PD,ASSET_AMT,INCOME_AMT,REVENUE_AMT,NTEE_CD,SORT_NAME"

  it("is header-driven and refuses a file missing a retained column", () => {
    const columns = parseEoBmfHeader(header)
    expect(columns.EIN).toBe(0)
    expect(columns.SORT_NAME).toBe(27)
    expect(() => parseEoBmfHeader("EIN,NAME,CITY")).toThrow(/missing required column/)
  })

  it("retains the org-level columns and never reads ICO or STREET", () => {
    const columns = parseEoBmfHeader(header)
    const row = parseEoBmfLine(
      "010728628,INTERSECTIONS INC,% A PERSON,PO BOX 1715,PAGO PAGO,AS,96799-1715,0000,03,3,1000,200211,1,15,000000000,1,01,202412,0,0,02,0,12,0,0,0,O50,",
      columns
    )
    expect(row).toEqual({
      ein: "010728628",
      name: "INTERSECTIONS INC",
      city: "PAGO PAGO",
      state: "AS",
      zip5: "96799",
      subsection: "03",
      classification: "1000",
      ruling: "200211",
      deductibility: "1",
      foundation: "15",
      status: "01",
      ntee_cd: "O50",
      sort_name: null,
    })
    expect(JSON.stringify(row)).not.toContain("A PERSON")
    expect(JSON.stringify(row)).not.toContain("PO BOX")
    expect(Object.keys(row ?? {})).not.toContain("ico")
    expect(Object.keys(row ?? {})).not.toContain("street")
  })

  it("survives a reordered header", () => {
    const reordered = parseEoBmfHeader("NAME,EIN,CITY,STATE,ZIP,SUBSECTION,CLASSIFICATION,RULING,DEDUCTIBILITY,FOUNDATION,STATUS,NTEE_CD,SORT_NAME")
    const row = parseEoBmfLine("Org,000019818,Town,ME,04101,03,1000,199001,1,15,01,A20,", reordered)
    expect(row?.ein).toBe("000019818")
    expect(row?.name).toBe("Org")
  })

  it("handles RFC 4180 quoting in names", () => {
    expect(splitDelimited('1,"SMITH, JONES & CO",x', ",")).toEqual(["1", "SMITH, JONES & CO", "x"])
    expect(splitDelimited('1,"SAY ""HI""",x', ",")).toEqual(["1", 'SAY "HI"', "x"])
    expect(splitDelimited("plain,row", ",")).toEqual(["plain", "row"])
  })

  it("streams the 50-row fixture", async () => {
    const rows = await collect(parseEoBmfStream(createReadStream(fixture("eo-bmf-sample.csv"))))
    expect(rows).toHaveLength(50)
    expect(rows.every((r) => /^\d{9}$/.test(r.ein))).toBe(true)
    expect(rows.find((r) => r.ein === "260089814")?.subsection).toBe("07")
  })

  it("fails loudly on a file with no header", async () => {
    await expect(collect(parseEoBmfStream(Readable.from([""])))).rejects.toThrow(/no header row/)
  })

  it("fixtures contain no ICO/STREET values", async () => {
    const csv = await fs.readFile(fixture("eo-bmf-sample.csv"), "utf8")
    const [, ...lines] = csv.trim().split("\n")
    for (const line of lines) {
      const parts = splitDelimited(line, ",")
      expect(parts[2]).toBe("")
      expect(parts[3]).toBe("")
    }
    const rev = await fs.readFile(fixture("revocation-sample.txt"), "utf8")
    for (const line of rev.split("\r\n").filter(Boolean)) {
      expect(line.split("|")[3]).toBe("")
    }
  })
})
