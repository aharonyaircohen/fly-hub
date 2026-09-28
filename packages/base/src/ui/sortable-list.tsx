/**
 * @fileType component
 * @domain ui
 * @pattern sortable-list
 * @ai-summary Reusable drag-to-reorder list built on dnd-kit — extracted so
 *   todos and other lists share one implementation instead of each
 *   re-wiring dnd-kit. Presentation only: it reorders the array you give it
 *   and calls `onReorder` (only when the order actually changed); the caller
 *   owns persistence. Each row's drag handle is passed to `renderItem` so
 *   features keep their own grip styling.
 */
"use client";

import * as React from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DraggableAttributes,
} from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@kody-ade/base/utils/ui";

/** Generic splice-based move; returns the same array ref when nothing moves. */
export function moveArrayItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length) return items;
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export interface SortableDragHandle {
  attributes: DraggableAttributes;
  listeners: SyntheticListenerMap | undefined;
  isDragging: boolean;
}

export interface SortableListProps<T> {
  items: T[];
  getId: (item: T) => string;
  /** Called only when the order actually changed. */
  onReorder: (nextItems: T[]) => void;
  renderItem: (item: T, handle: SortableDragHandle) => React.ReactNode;
  disabled?: boolean;
  className?: string;
}

function SortableRow<T>({
  id,
  item,
  disabled,
  renderItem,
}: {
  id: string;
  item: T;
  disabled: boolean;
  renderItem: SortableListProps<T>["renderItem"];
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "relative z-10 opacity-80" : undefined}
    >
      {renderItem(item, { attributes, listeners, isDragging })}
    </li>
  );
}

export function SortableList<T>({
  items,
  getId,
  onReorder,
  renderItem,
  disabled = false,
  className,
}: SortableListProps<T>) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const ids = React.useMemo(() => items.map(getId), [items, getId]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = moveArrayItem(items, from, to);
    if (next !== items) onReorder(next);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className={cn("space-y-2", className)}>
          {items.map((item) => (
            <SortableRow
              key={getId(item)}
              id={getId(item)}
              item={item}
              disabled={disabled}
              renderItem={renderItem}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
