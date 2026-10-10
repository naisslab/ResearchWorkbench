import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { X } from "lucide-react";

// Open dialogs, newest last. While one is open everything outside it is inert,
// so a toast renders inside the newest dialog.
const open: { dialog: HTMLDialogElement; openers: (HTMLElement | null)[] }[] =
  [];
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
export const useTopDialog = () =>
  useSyncExternalStore(subscribe, () => open.at(-1)?.dialog);

export default function Modal({
  title,
  onClose,
  locked = false,
  className = "",
  children,
}: {
  title: ReactNode;
  onClose(): void;
  /** Ignores Esc, backdrop clicks and the close button, e.g. while busy. */
  locked?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // A dialog that replaces another in one update finds its opener detached;
  // focus then returns to where the replaced dialog was opened from.
  const [openers] = useState(() => [
    document.activeElement as HTMLElement | null,
    ...(open.at(-1)?.openers ?? []),
  ]);
  // showModal() focuses the first focusable child; React's autoFocus runs too
  // early to count, so a child marks itself with data-autofocus instead.
  useEffect(() => {
    const node = dialog.current!;
    const entry = { dialog: node, openers };
    open.push(entry);
    changed();
    if (!node.open) node.showModal();
    node.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => {
      open.splice(open.indexOf(entry), 1);
      changed();
      openers.find((element) => element?.isConnected)?.focus();
    };
  }, [openers]);
  const dismiss = () => {
    if (!locked) onClose();
  };
  return (
    <dialog
      ref={dialog}
      className="modal-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      // Chromium closes the dialog on a repeated Esc that it will not let the
      // page cancel; reopen it while it is still rendered.
      onClose={(event) => {
        if (event.currentTarget.isConnected) event.currentTarget.showModal();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <div className={`modal ${className}`}>
        <h2 id={titleId}>{title}</h2>
        {children}
        <button
          type="button"
          className="icon-button modal-close"
          aria-label="Close"
          disabled={locked}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
    </dialog>
  );
}
