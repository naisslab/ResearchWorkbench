import { useId, useRef, useState } from "react";
import { Check, ChevronDown, CornerUpRight, ListPlus } from "lucide-react";

export default function AIMessageDelivery({
  value,
  onChange,
  disabled,
}: {
  value: "steer" | "queue";
  onChange(value: "steer" | "queue"): void;
  disabled: boolean;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        type="button"
        ref={trigger}
        className="ai-delivery-trigger"
        aria-label="Message delivery"
        aria-haspopup="menu"
        aria-expanded={expanded}
        aria-controls={id}
        title="Choose when to send"
        disabled={disabled}
        onClick={() => {
          const node = menu.current!;
          if (node.matches(":popover-open")) {
            node.hidePopover();
            return;
          }
          const box = trigger.current!.getBoundingClientRect();
          node.style.left = `${Math.max(8, Math.min(box.right - 272, innerWidth - 280))}px`;
          node.style.top = `${box.top >= 174 ? box.top - 166 : box.bottom + 8}px`;
          node.showPopover();
          node
            .querySelector<HTMLButtonElement>('[aria-checked="true"]')
            ?.focus();
        }}
      >
        <ChevronDown size={13} />
      </button>
      <div
        ref={menu}
        id={id}
        popover="auto"
        role="menu"
        aria-label="Message delivery options"
        className="ai-delivery-menu"
        onToggle={(event) =>
          setExpanded(event.currentTarget.matches(":popover-open"))
        }
        onKeyDown={(event) => {
          if (event.key === "Escape" || event.key === "Tab") {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
            }
            menu.current?.hidePopover();
            trigger.current?.focus();
            return;
          }
          const buttons = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
              "button",
            ),
          ];
          const index = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const next =
            event.key === "ArrowDown"
              ? (index + 1) % 2
              : event.key === "ArrowUp"
                ? (index + 1) % 2
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? 1
                    : -1;
          if (next >= 0) {
            event.preventDefault();
            buttons[next]?.focus();
          }
        }}
      >
        {(
          [
            [
              "steer",
              "Steer now",
              "Add direction to the current response.",
              CornerUpRight,
            ],
            [
              "queue",
              "Queue next",
              "Run after the current response finishes.",
              ListPlus,
            ],
          ] as const
        ).map(([mode, label, description, Icon]) => (
          <button
            type="button"
            key={mode}
            role="menuitemradio"
            aria-checked={value === mode}
            disabled={disabled}
            onClick={() => {
              onChange(mode);
              menu.current?.hidePopover();
              trigger.current?.focus();
            }}
          >
            <Icon size={16} />
            <span>
              <strong>{label}</strong>
              <small>{description}</small>
            </span>
            {value === mode && <Check size={14} />}
          </button>
        ))}
      </div>
    </>
  );
}
