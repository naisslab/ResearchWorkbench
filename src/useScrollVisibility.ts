import { useEffect, useRef } from "react";

export function useScrollVisibility() {
  const timers = useRef(new Map<HTMLElement, ReturnType<typeof setTimeout>>());
  useEffect(
    () => () => {
      timers.current.forEach((timer, element) => {
        clearTimeout(timer);
        delete element.dataset.scrolling;
      });
      timers.current.clear();
    },
    [],
  );
  return (event: React.UIEvent<HTMLElement>) => {
    const element = event.target as HTMLElement;
    clearTimeout(timers.current.get(element));
    element.dataset.scrolling = "true";
    timers.current.set(
      element,
      setTimeout(() => {
        delete element.dataset.scrolling;
        timers.current.delete(element);
      }, 900),
    );
  };
}
