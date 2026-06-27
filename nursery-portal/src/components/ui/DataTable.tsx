import { useMemo, useState } from "react"
import { classNames } from "@/lib/format"

export interface Column<T> {
  key: string
  header: string
  render: (row: T) => React.ReactNode
  sortValue?: (row: T) => string | number
  className?: string
}

// Sortable table with optional CSV export. Sorting is opt-in per column via
// sortValue. Kept dependency-free and responsive (horizontal scroll on mobile).
export function DataTable<T>({
  columns,
  rows,
  exportName,
  empty = "No rows",
}: {
  columns: Column<T>[]
  rows: T[]
  exportName?: string
  empty?: string
}) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [dir, setDir] = useState<"asc" | "desc">("asc")

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sortKey)
    if (!col?.sortValue) return rows
    const copy = [...rows]
    copy.sort((a, b) => {
      const av = col.sortValue!(a)
      const bv = col.sortValue!(b)
      if (av < bv) return dir === "asc" ? -1 : 1
      if (av > bv) return dir === "asc" ? 1 : -1
      return 0
    })
    return copy
  }, [rows, columns, sortKey, dir])

  function toggleSort(key: string) {
    const col = columns.find((c) => c.key === key)
    if (!col?.sortValue) return
    if (sortKey === key) {
      setDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setDir("asc")
    }
  }

  function exportCsv() {
    const header = columns.map((c) => c.header).join(",")
    const lines = sorted.map((row) =>
      columns
        .map((c) => {
          const v = c.sortValue ? c.sortValue(row) : ""
          return `"${String(v).replace(/"/g, '""')}"`
        })
        .join(",")
    )
    const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${exportName || "export"}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="panel overflow-hidden">
      {exportName && (
        <div className="flex justify-end p-2 border-b border-moss">
          <button onClick={exportCsv} className="btn-ghost text-xs">
            Export CSV
          </button>
        </div>
      )}
      <div className="overflow-x-auto scroll-area">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ghost border-b border-moss">
              {columns.map((c) => (
                <th
                  key={c.key}
                  onClick={() => toggleSort(c.key)}
                  className={classNames(
                    "px-3 py-2 font-medium whitespace-nowrap",
                    c.sortValue && "cursor-pointer select-none hover:text-cream-100",
                    c.className
                  )}
                >
                  {c.header}
                  {sortKey === c.key && (dir === "asc" ? " ↑" : " ↓")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-mist">
                  {empty}
                </td>
              </tr>
            ) : (
              sorted.map((row, i) => (
                <tr key={i} className="border-b border-moss/50 hover:bg-moss/30">
                  {columns.map((c) => (
                    <td key={c.key} className={classNames("px-3 py-2", c.className)}>
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
