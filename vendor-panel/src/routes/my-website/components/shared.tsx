import { CheckCircleSolid } from "@medusajs/icons"
import { Button, Text, clx, toast } from "@medusajs/ui"
import copy from "copy-to-clipboard"
import { useState } from "react"

/** A small copy-to-clipboard button with a transient "Copied" state. */
export const CopyButton = ({
  value,
  label = "Copy",
  size = "small",
}: {
  value: string
  label?: string
  size?: "small" | "base"
}) => {
  const [done, setDone] = useState(false)

  const onCopy = () => {
    copy(value)
    setDone(true)
    toast.success("Copied to clipboard")
    setTimeout(() => setDone(false), 2000)
  }

  return (
    <Button
      variant="secondary"
      size={size}
      onClick={onCopy}
      aria-label={label}
      type="button"
    >
      {done ? (
        <>
          <CheckCircleSolid className="text-ui-tag-green-icon" />
          Copied
        </>
      ) : (
        label
      )}
    </Button>
  )
}

/** A monospace code block with an inline copy button. */
export const CodeBlock = ({
  code,
  className,
}: {
  code: string
  className?: string
}) => {
  return (
    <div
      className={clx(
        "bg-ui-bg-subtle border-ui-border-base relative rounded-lg border",
        className
      )}
    >
      <pre className="text-ui-fg-base overflow-x-auto p-4 pr-24 text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
      <div className="absolute right-2 top-2">
        <CopyButton value={code} />
      </div>
    </div>
  )
}

/** A numbered step heading used to walk vendors through setup. */
export const Step = ({
  n,
  title,
  children,
}: {
  n: number
  title: string
  children?: React.ReactNode
}) => {
  return (
    <div className="flex gap-3">
      <div className="bg-ui-bg-base border-ui-border-strong text-ui-fg-base flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold">
        {n}
      </div>
      <div className="flex-1">
        <Text className="text-ui-fg-base font-medium" size="small">
          {title}
        </Text>
        <div className="mt-2">{children}</div>
      </div>
    </div>
  )
}
