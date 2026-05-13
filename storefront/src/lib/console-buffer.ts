const BUFFER_LIMIT = 50

let installed = false
const buffer: string[] = []

function pushLine(level: string, args: unknown[]): void {
  try {
    const parts = args.map((a) => {
      if (typeof a === "string") return a
      try {
        return JSON.stringify(a)
      } catch {
        return String(a)
      }
    })
    const line = `[${level}] ${parts.join(" ")}`
    buffer.push(line)
    if (buffer.length > BUFFER_LIMIT) {
      buffer.shift()
    }
  } catch {
    // never let logging crash the app
  }
}

export function installConsoleBuffer(): void {
  if (installed) return
  if (typeof window === "undefined") return
  installed = true

  const levels: Array<"log" | "info" | "warn" | "error"> = ["log", "info", "warn", "error"]
  for (const level of levels) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      pushLine(level, args)
      original(...args)
    }
  }
}

export function getConsoleTail(): string {
  return buffer.join("\n")
}

export function clearConsoleBuffer(): void {
  buffer.length = 0
}
