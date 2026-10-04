import { createInterface } from "node:readline"
import type { Readable } from "node:stream"

/**
 * Lines from a byte stream, one at a time, CRLF-tolerant. The IRS text files
 * end every line with `\r\n` and open with two blank lines; `crlfDelay:
 * Infinity` keeps `\r\n` as one break instead of yielding a phantom empty
 * line, and callers skip blanks themselves.
 */
export async function* readLines(stream: Readable): AsyncGenerator<string> {
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      yield line
    }
  } finally {
    rl.close()
  }
}

/**
 * Split one RFC 4180 line into fields: quoted fields may hold the delimiter
 * and doubled quotes. Embedded newlines inside quotes are not supported; the
 * EO BMF rows observed carry none.
 */
export function splitDelimited(line: string, delimiter: string): string[] {
  if (!line.includes('"')) return line.split(delimiter)
  const out: string[] = []
  let field = ""
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === delimiter) {
      out.push(field)
      field = ""
    } else {
      field += ch
    }
  }
  out.push(field)
  return out
}
