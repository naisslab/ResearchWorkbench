import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import {
  defaultPanelLayout,
  parsePanelLayout,
  panelLayoutKey,
} from "./panel-layout";
// The legacy combined layout is read only for migration/defaults.
function readLayout(key: string) {
  try {
    return localStorage.getItem(key) ?? localStorage.getItem(panelLayoutKey);
  } catch {
    return null;
  }
}
function useStoredLayout<T>(key: string, initial: () => T) {
  const [layout, setLayout] = useState(initial);
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(layout));
    } catch {}
  }, [layout, key]);
  const change = useCallback(
    (changes: Partial<T>) =>
      setLayout((previous) => ({ ...previous, ...changes })),
    [],
  );
  return { layout, change };
}
export function useSidebarLayout() {
  const key = "research-workbench.sidebar";
  return useStoredLayout(key, () => {
    const stored = readLayout(key);
    const { sidebar, sidebarCollapsed } = stored
      ? parsePanelLayout(stored)
      : { ...defaultPanelLayout, sidebarCollapsed: window.innerWidth < 1280 };
    return { sidebar, sidebarCollapsed };
  });
}
export function useProjectPanelLayout(projectId: string) {
  const key = `research-workbench.project-panels.${projectId}`;
  return useStoredLayout(key, () => {
    const {
      sidebar: _sidebar,
      sidebarCollapsed: _collapsed,
      ...layout
    } = parsePanelLayout(readLayout(key));
    return layout;
  });
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
      if (!width || !height) return;
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
