import { useEffect, useRef, useState } from "react";
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
  const element = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; position: number; value: number } | null>(
    null,
  );
  const [dragging, setDragging] = useState(false);
  const changeRef = useRef(change);
  changeRef.current = change;
  function finish() {
    drag.current = null;
    setDragging(false);
    document.documentElement.classList.remove(
      "panel-dragging",
      "panel-dragging-horizontal",
      "panel-dragging-vertical",
    );
  }
  useEffect(
    () => () => {
      if (drag.current)
        document.documentElement.classList.remove(
          "panel-dragging",
          "panel-dragging-horizontal",
          "panel-dragging-vertical",
        );
    },
    [],
  );
  return (
    <div
      ref={element}
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
          position: orientation === "vertical" ? event.clientX : event.clientY,
          value,
        };
        setDragging(true);
        document.documentElement.classList.add(
          "panel-dragging",
          `panel-dragging-${orientation}`,
        );
      }}
      onPointerMove={(event) => {
        if (!drag.current || drag.current.id !== event.pointerId) return;
        const position =
          orientation === "vertical" ? event.clientX : event.clientY;
        changeRef.current(
          clamp(
            drag.current.value + (position - drag.current.position) * direction,
            min,
            max,
          ),
        );
      }}
      onPointerUp={(event) => {
        if (drag.current?.id !== event.pointerId) return;
        finish();
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={finish}
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
          change(drag.current.value);
          finish();
        }
      }}
    />
  );
}
