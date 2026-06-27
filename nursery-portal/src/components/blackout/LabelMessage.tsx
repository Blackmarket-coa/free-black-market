import type { BlackoutMessage } from "@/types"

export function LabelMessage({ msg }: { msg: BlackoutMessage }) {
  return (
    <div className="rounded-sm border border-moss bg-moss/30 px-3 py-2">
      <div className="flex items-center gap-2">
        <span aria-hidden>📬</span>
        <span className="text-sm text-cream-100 flex-1">{msg.text}</span>
        <a
          href={msg.download_url || "#"}
          onClick={(e) => !msg.download_url && e.preventDefault()}
          className="btn-primary text-xs"
        >
          ⬇ Download
        </a>
      </div>
    </div>
  )
}
