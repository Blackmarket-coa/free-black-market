import { cn } from "@/lib/utils"

import Spinner from "@/icons/spinner"

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "filled" | "tonal" | "text" | "destructive"
  size?: "small" | "large"
  loading?: boolean
}

export function Button({
  children,
  variant = "filled",
  size = "small",
  loading = false,
  disabled = false,
  className,
  ...props
}: ButtonProps) {
  const baseClasses =
    "text-md button-text rounded-md focus-solarpunk disabled:bg-disabled disabled:text-disabled dark:bg-action-tertiary dark:hover:bg-action-tertiary-hover dark:active:bg-action-tertiary-pressed dark:disabled:bg-disabled transition-all duration-200"

  const variantClasses = {
    filled: `bg-action text-action-on-primary hover:bg-action-hover active:bg-action-pressed ${
      loading && "button-text-filled"
    }`,
    tonal:
      "bg-action-secondary hover:bg-action-secondary-hover active:bg-action-secondary-pressed text-action-on-secondary shadow-solarpunk-sm border border-amber",
    text: "bg-primary dark:bg-primary hover:bg-action-secondary-hover active:bg-action-secondary-pressed text-primary border border-forest shadow-solarpunk-sm",
    destructive: `text-negative-on-primary bg-negative hover:bg-negative-hover active:bg-negative-pressed ${
      loading && "button-text-filled"
    }`,
  }

  const sizeClasses = {
    small: "px-[16px] py-[8px]",
    large: "px-[24px] py-[8px]",
  }

  return (
    // A button that is loading is working on the last click: it takes no
    // other, so "Place order" cannot send a second completion of the same
    // cart (one gets the order, the other a 500 from Mercur, SD-147 (e)).
    <button
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        variantClasses[variant],
        sizeClasses[size],
        baseClasses,
        className
      )}
      {...props}
    >
      {loading ? <Spinner /> : children}
    </button>
  )
}
