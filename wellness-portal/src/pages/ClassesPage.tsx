import { useState } from "react"
import { PageHeader } from "@/components/ui/PageHeader"
import { QueryState } from "@/components/ui/QueryState"
import { Tabs } from "@/components/ui/Tabs"
import { useClasses, useClassAttendees } from "@/hooks/useWellness"
import { money, shortDate, classNames } from "@/lib/format"
import type { ClassEvent } from "@/types"

export function ClassesPage() {
  const { data, isLoading, isError } = useClasses()
  const [tab, setTab] = useState("upcoming")
  const [openId, setOpenId] = useState<string | null>(null)

  const upcoming = (data ?? []).filter((c) => c.status !== "completed" && c.status !== "cancelled")
  const past = (data ?? []).filter((c) => c.status === "completed" || c.status === "cancelled")
  const list = tab === "upcoming" ? upcoming : past

  return (
    <div className="space-y-4">
      <PageHeader
        title="Classes & Workshops"
        subtitle="Group events with ticketing, capacity, and attendee management."
        action={<button className="btn-primary text-sm">New class</button>}
      />
      <Tabs
        tabs={[
          { key: "upcoming", label: "Upcoming", count: upcoming.length },
          { key: "past", label: "Past", count: past.length },
        ]}
        active={tab}
        onChange={setTab}
      />
      <QueryState isLoading={isLoading} isError={isError}>
        <div className="space-y-3">
          {list.map((c) => (
            <ClassCard key={c.id} cls={c} open={openId === c.id} onToggle={() => setOpenId(openId === c.id ? null : c.id)} />
          ))}
        </div>
      </QueryState>
    </div>
  )
}

function ClassCard({ cls, open, onToggle }: { cls: ClassEvent; open: boolean; onToggle: () => void }) {
  const fill = cls.capacity ? Math.round((cls.seats_taken / cls.capacity) * 100) : 0
  return (
    <div className="panel-pad">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-cream-50 font-medium">{cls.title}</div>
          <div className="text-xs text-mist mt-0.5">
            {shortDate(cls.starts_at)} · {cls.location_type} · {cls.price_amount ? money(cls.price_amount) : "Free"}
          </div>
        </div>
        <span
          className={classNames(
            "text-[10px] rounded-full px-2 py-0.5 capitalize",
            cls.status === "full" ? "bg-clay/30 text-clay" : "bg-forest-900/40 text-forest-300"
          )}
        >
          {cls.status}
        </span>
      </div>

      <div className="mt-3">
        <div className="flex justify-between text-xs text-mist mb-1">
          <span>
            {cls.seats_taken}/{cls.capacity} filled
            {cls.waitlist_count ? ` · ${cls.waitlist_count} waitlist` : ""}
          </span>
          <span>{fill}%</span>
        </div>
        <div className="h-2 rounded-full bg-moss overflow-hidden">
          <div className="h-full bg-amber-500" style={{ width: `${fill}%` }} />
        </div>
      </div>

      <div className="flex gap-2 mt-3">
        <button onClick={onToggle} className="btn-ghost text-xs">
          {open ? "Hide attendees" : "View attendees"}
        </button>
        <button className="btn-ghost text-xs">Message attendees</button>
        {cls.recording_url && <button className="btn-ghost text-xs">Recording</button>}
        <button className="btn-ghost text-xs">Share</button>
      </div>

      {open && <AttendeeTable classId={cls.id} />}
    </div>
  )
}

function AttendeeTable({ classId }: { classId: string }) {
  const { data } = useClassAttendees(classId)
  return (
    <div className="mt-3 border-t border-moss/50 pt-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-ghost">
            <th className="py-1 font-medium">Name</th>
            <th className="py-1 font-medium">Status</th>
            <th className="py-1 font-medium">Intake</th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((a) => (
            <tr key={a.id} className="border-t border-moss/40">
              <td className="py-1.5 text-cream-100">{a.customer_name ?? a.customer_email}</td>
              <td className="py-1.5 text-mist capitalize">{a.status}</td>
              <td className="py-1.5">{a.intake_received ? "✅" : "⚠️"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
