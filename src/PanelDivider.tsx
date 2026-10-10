import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { clamp } from "./panel-layout";
export default function PanelDivider({
  label,
  orientation = "vertical",
  value,
  min,
  max,
  direction = 1,
  change,
  reset,
}: {
  label: string;
  orientation?: "vertical" | "horizontal";
  value: number;
  min: number;
  max: number;
  direction?: number;
  change(value: number): void;
  reset(): void;
}) {
  // `next` holds the newest drag value until the next animation frame reports it.
  const drag = useRef<{
    id: number;
    position: number;
    value: number;
    next?: number;
    frame: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  function finish() {
    const current = drag.current;
    if (!current) return;
    cancelAnimationFrame(current.frame);
    if (current.next !== undefined) change(current.next);
    drag.current = null;
    setDragging(false);
  }
  return (
    <>
      <div
        role="separator"
        className={`panel-divider ${orientation} ${dragging ? "dragging" : ""}`}
        tabIndex={0}
        aria-label={label}
        aria-orientation={orientation}
        aria-valuemin={Math.round(min)}
        aria-valuemax={Math.round(max)}
        aria-valuenow={Math.round(value)}
        title={`${label}. Drag to resize; double-click to reset.`}
        onDoubleClick={reset}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            id: event.pointerId,
            position:
              orientation === "vertical" ? event.clientX : event.clientY,
            value,
            frame: 0,
          };
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (current?.id !== event.pointerId) return;
          const position =
            orientation === "vertical" ? event.clientX : event.clientY;
          current.next = clamp(
            current.value + (position - current.position) * direction,
            min,
            max,
          );
          current.frame ||= requestAnimationFrame(() => {
            current.frame = 0;
            if (current.next !== undefined) change(current.next);
            current.next = undefined;
          });
        }}
        // Ends on pointerup so the shield is gone before a double-click's second press.
        onPointerUp={finish}
        onLostPointerCapture={finish}
        onKeyDown={(event) => {
          const negative = orientation === "vertical" ? "ArrowLeft" : "ArrowUp";
          const positive =
            orientation === "vertical" ? "ArrowRight" : "ArrowDown";
          if (event.key === negative || event.key === positive) {
            event.preventDefault();
            change(
              clamp(
                value +
                  (event.key === positive ? 1 : -1) *
                    direction *
                    (event.shiftKey ? 50 : 10),
                min,
                max,
              ),
            );
          } else if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            change(event.key === "Home" ? min : max);
          } else if (event.key === "Enter") {
            event.preventDefault();
            reset();
          } else if (event.key === "Escape" && drag.current) {
            event.preventDefault();
            drag.current.next = drag.current.value;
            finish();
          }
        }}
      />
      {dragging &&
        createPortal(
          <div className={`drag-shield ${orientation}`} />,
          document.body,
        )}
    </>
  );
}
