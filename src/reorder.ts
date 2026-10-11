import { useState, type DragEvent, type KeyboardEvent } from "react";

/** Items listed in `order` first, in that order; the rest keep their order after them. */
export function applyOrder<T>(
  items: T[],
  key: (item: T) => string,
  order: string[] = [],
): T[] {
  const rank = new Map(order.map((id, index) => [id, index]));
  return items
    .map((item, index) => ({
      item,
      rank: rank.get(key(item)) ?? order.length + index,
    }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ item }) => item);
}

/**
 * `ids` with `moved` next to `target`: after it when moving forward, before
 * it when moving back, unless `after` says otherwise.
 */
export function moveId(
  ids: string[],
  moved: string,
  target: string,
  after = ids.indexOf(moved) < ids.indexOf(target),
) {
  if (moved === target || !ids.includes(moved) || !ids.includes(target))
    return ids;
  const next = ids.filter((id) => id !== moved);
  const at = next.indexOf(target);
  next.splice(after ? at + 1 : at, 0, moved);
  return next;
}

/**
 * Drag-and-drop and Alt+↑/↓ reordering for items of one `type`. `ids` is the
 * displayed order; `row(id, siblings)` gives an item's props, where
 * `siblings` are the ids the keyboard moves among.
 */
export function useReorder(
  type: string,
  ids: string[],
  move: (moved: string, target: string) => void,
) {
  const [drag, setDrag] = useState<{ moved: string; over?: string }>();
  const accepts = (event: DragEvent) => event.dataTransfer.types.includes(type);
  const row = (id: string, siblings: string[] = ids) => ({
    draggable: true,
    "data-drop":
      drag?.over === id && drag.moved !== id
        ? ids.indexOf(drag.moved) < ids.indexOf(id)
          ? "after"
          : "before"
        : undefined,
    onDragStart(event: DragEvent) {
      event.stopPropagation();
      event.dataTransfer.setData(type, id);
      event.dataTransfer.effectAllowed = "move";
      setDrag({ moved: id });
    },
    onDragOver(event: DragEvent) {
      if (!accepts(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      setDrag((current) =>
        current && current.over !== id ? { ...current, over: id } : current,
      );
    },
    onDrop(event: DragEvent) {
      if (!accepts(event)) return;
      event.preventDefault();
      event.stopPropagation();
      setDrag(undefined);
      const moved = event.dataTransfer.getData(type);
      if (moved && moved !== id) move(moved, id);
    },
    onDragEnd: () => setDrag(undefined),
    onKeyDown(event: KeyboardEvent) {
      if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key))
        return;
      const target =
        siblings[siblings.indexOf(id) + (event.key === "ArrowUp" ? -1 : 1)];
      if (!target) return;
      event.preventDefault();
      move(id, target);
    },
  });
  return { row, dragging: drag?.moved };
}
