import React from "react"

/**
 * A form that can only be submitted when using the meta or control key.
 */
export const KeyboundForm = React.forwardRef<
  HTMLFormElement,
  React.FormHTMLAttributes<HTMLFormElement>
>(({ onSubmit, onKeyDown, ...rest }, ref) => {
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onSubmit?.(event)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLFormElement>) => {
    if (event.key === "Enter") {
      if (
        event.target instanceof HTMLTextAreaElement &&
        !(event.metaKey || event.ctrlKey)
      ) {
        return
      }

      event.preventDefault()

      if (event.metaKey || event.ctrlKey) {
        handleSubmit(event)
      }
    }
  }

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- form-level keyboard handling (e.g. submit shortcuts)
    <form
      {...rest}
      onSubmit={handleSubmit}
      onKeyDown={onKeyDown ?? handleKeyDown}
      ref={ref}
    />
  )
})

KeyboundForm.displayName = "KeyboundForm"
