import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import {
  defaultPanelLayout,
  parsePanelLayout,
  panelLayoutKey,
  type PanelLayout,
} from "./panel-layout";
export function usePanelLayout() {
  const [layout, setLayout] = useState(() => {
    let stored = null;
    try {
      stored = localStorage.getItem(panelLayoutKey);
    } catch {
      /* Storage may be unavailable. */
    }
    // Until the user picks, small windows start with the icon rail.
    return stored
      ? parsePanelLayout(stored)
      : { ...defaultPanelLayout, sidebarCollapsed: window.innerWidth < 1280 };
  });
  useEffect(() => {
    // Keep layout independent of project data and Git changes.
    try {
      localStorage.setItem(panelLayoutKey, JSON.stringify(layout));
    } catch {
      /* Storage may be unavailable. */
    }
  }, [layout]);
  const change = useCallback(
    (changes: Partial<PanelLayout>) =>
      setLayout((previous) => ({ ...previous, ...changes })),
    [],
  );
  return { layout, change };
}
export function usePanelSize() {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  useLayoutEffect(() => {
    if (!element) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      setSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, size] as const;
}
