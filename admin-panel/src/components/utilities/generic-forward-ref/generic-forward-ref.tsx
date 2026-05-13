import type { ReactNode, Ref, RefAttributes} from "react";
import { forwardRef } from "react"

export function genericForwardRef<T, P = {}>(
  render: (props: P, ref: Ref<T>) => ReactNode
): (props: P & RefAttributes<T>) => ReactNode {
  return forwardRef(render) as any
}
