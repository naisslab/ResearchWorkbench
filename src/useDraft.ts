import { useEffect, useRef, useState } from "react";
import { readChatDraft } from "./workbench-state";

/**
 * The composer's text, saved per chat under `key`. While a signed-in chat
 * loads, its key is null: the previous chat's text is cleared, typing stays
 * in memory and is kept when the chat arrives. Switching between known chats
 * restores that chat's text and calls `onSwitch`. Returns the text and a
 * setter that also saves it.
 */
export function useDraft(
  key: string | null,
  legacyKey: string | undefined,
  onSwitch: () => void,
) {
  const [draft, setDraft] = useState("");
  const latest = useRef({ draft, onSwitch });
  latest.current = { draft, onSwitch };
  const previous = useRef<string | null>(null);
  function save(value: string) {
    setDraft(value);
    if (!key) return;
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch {
      /* Keep the draft in memory. */
    }
  }
  useEffect(() => {
    const before = previous.current;
    previous.current = key;
    if (!key) {
      if (before) setDraft("");
      return;
    }
    let saved = "";
    try {
      saved = readChatDraft(localStorage, key, legacyKey);
    } catch {}
    if (before === null) {
      if (latest.current.draft) save(latest.current.draft);
      else setDraft(saved);
      return;
    }
    setDraft(saved);
    latest.current.onSwitch();
  }, [key]);
  return [draft, save] as const;
}
