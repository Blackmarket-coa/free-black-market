import type { UniqueIdentifier } from "@dnd-kit/core"
import type { AnimateLayoutChanges} from "@dnd-kit/sortable";
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import type { CSSProperties } from "react"

import type { TreeItemProps } from "./tree-item";
import { TreeItem } from "./tree-item"
import { iOS } from "./utils"

interface SortableTreeItemProps extends TreeItemProps {
  id: UniqueIdentifier
}

const animateLayoutChanges: AnimateLayoutChanges = ({
  isSorting,
  wasDragging,
}) => {
  return isSorting || wasDragging ? false : true
}

export function SortableTreeItem({
  id,
  depth,
  disabled,
  ...props
}: SortableTreeItemProps) {
  const {
    attributes,
    isDragging,
    isSorting,
    listeners,
    setDraggableNodeRef,
    setDroppableNodeRef,
    transform,
    transition,
  } = useSortable({
    id,
    animateLayoutChanges,
    disabled,
  })
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  }

  return (
    <TreeItem
      ref={setDraggableNodeRef}
      wrapperRef={setDroppableNodeRef}
      style={style}
      depth={depth}
      ghost={isDragging}
      disableSelection={iOS}
      disableInteraction={isSorting}
      disabled={disabled}
      handleProps={{
        listeners,
        attributes,
      }}
      {...props}
    />
  )
}
