import { useEffect, useRef } from "react";
import { useWorkbenchVisible } from "./WorkbenchVisibility";

/** An action offered in ⌘K and the application menu. */
export interface Command {
  id: string;
  title: string;
  group: string;
  shortcut?: string;
  run(): void;
}

const providers = new Set<{ current: () => Command[] }>();

/**
 * Offers `list()` while the calling component is mounted. The list is read
 * when ⌘K opens or a menu item is chosen, so it can depend on current state.
 */
export function useCommands(list: () => Command[]) {
  const visible = useWorkbenchVisible();
  const latest = useRef(list);
  latest.current = () => (visible ? list() : []);
  useEffect(() => {
    providers.add(latest);
    return () => {
      providers.delete(latest);
    };
  }, []);
}

const currentCommands = () =>
  [...providers].flatMap((provider) => provider.current());

export const runCommand = (id: string) =>
  currentCommands()
    .find((command) => command.id === id)
    ?.run();

/** Every word of the query appears in the command's group or title. */
export function matchCommands(query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return currentCommands().filter((command) => {
    const text = `${command.group} ${command.title}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}
