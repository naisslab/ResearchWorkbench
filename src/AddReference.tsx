import { useMemo, useState } from "react";
import { LoaderCircle, Search } from "lucide-react";
import Modal from "./Modal";
import type { ReferenceCandidate } from "./types";
import {
  foldKey,
  parseBibliography,
  referenceKey,
  rekeyEntry,
  type BibEntry,
} from "./bibliography.ts";

/**
 * Finds a reference by DOI, arXiv ID or title and appends its BibTeX to one
 * of the manuscript's .bib files, optionally citing it at the cursor.
 */
export default function AddReference({
  files,
  entries,
  canCite,
  add,
  cite,
  onClose,
}: {
  files: string[];
  entries: BibEntry[];
  canCite: boolean;
  add(file: string, bibtex: string): Promise<void>;
  cite(key: string): void;
  onClose(): void;
}) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [candidates, setCandidates] = useState<ReferenceCandidate[]>();
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState(files[0] || "");
  const [citeIt, setCiteIt] = useState(canCite);
  // BibTeX treats keys that differ only in case as the same key.
  const keys = useMemo(
    () => new Set(entries.map((e) => foldKey(e.key))),
    [entries],
  );
  const parsed = useMemo(
    () => parseBibliography(draft, file)[0],
    [draft, file],
  );
  // The same DOI or arXiv ID may already be cited under another key.
  const existing = useMemo(() => {
    const id = (e?: BibEntry) =>
      [e?.fields.doi, e?.fields.eprint]
        .filter(Boolean)
        .map((value) => value!.toLowerCase());
    const ids = id(parsed);
    return entries.find((e) => id(e).some((value) => ids.includes(value)));
  }, [parsed, entries]);
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const prepare = (bibtex: string) => {
    setDraft(rekeyEntry(bibtex, (fields) => referenceKey(fields, keys)));
    setCandidates(undefined);
  };
  const find = () =>
    run(async () => {
      setDraft("");
      const result = await window.research!.lookupReference(query);
      if (result.bibtex) prepare(result.bibtex);
      else setCandidates(result.candidates || []);
    });
  const choose = (candidate: ReferenceCandidate) =>
    run(async () =>
      prepare(
        await window.research!.referenceBibtex(candidate.kind, candidate.id),
      ),
    );
  const save = () =>
    run(async () => {
      if (!parsed) throw new Error("The entry is not valid BibTeX.");
      if (keys.has(foldKey(parsed.key)))
        throw new Error(`The key '${parsed.key}' is already used.`);
      await add(file, draft);
      if (citeIt) cite(parsed.key);
      onClose();
    });
  return (
    <Modal title="Add reference" onClose={onClose} locked={busy}>
      <form
        className="reference-search"
        onSubmit={(event) => {
          event.preventDefault();
          void find();
        }}
      >
        <input
          aria-label="DOI, arXiv ID or title"
          placeholder="DOI, arXiv ID or link, or paper title"
          value={query}
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          className="button primary"
          disabled={busy || query.trim().length < 4}
        >
          {busy ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <Search size={14} />
          )}
          Find
        </button>
      </form>
      <p className="muted">
        Looks up doi.org, arXiv and Crossref. DBLP blocks automated requests, so
        paste the DOI from a DBLP record instead.
      </p>
      {error && (
        <p role="alert" className="reference-error">
          {error}
        </p>
      )}
      {candidates && !draft && (
        <ul className="reference-candidates">
          {!candidates.length && <li className="muted">No matching papers.</li>}
          {candidates.map((c) => (
            <li key={`${c.kind}:${c.id}`}>
              <button disabled={busy} onClick={() => void choose(c)}>
                <strong>{c.title}</strong>
                <small>
                  {[
                    c.authors.slice(0, 3).join(", ") +
                      (c.authors.length > 3 ? " et al." : ""),
                    [c.venue, c.year].filter(Boolean).join(" "),
                    c.kind === "arxiv" ? `arXiv:${c.id}` : c.id,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {draft && (
        <>
          <textarea
            aria-label="BibTeX entry"
            className="reference-draft"
            spellCheck={false}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          {existing && (
            <p className="muted">
              Already in {existing.file} as '{existing.key}'.{" "}
              {canCite && (
                <button
                  className="reference-link"
                  onClick={() => {
                    cite(existing.key);
                    onClose();
                  }}
                >
                  Cite '{existing.key}' instead
                </button>
              )}
            </p>
          )}
          <div className="modal-actions">
            {files.length > 1 && (
              <select
                aria-label="Bibliography file"
                value={file}
                onChange={(event) => setFile(event.target.value)}
              >
                {files.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            )}
            {canCite && (
              <label>
                <input
                  type="checkbox"
                  checked={citeIt}
                  onChange={(event) => setCiteIt(event.target.checked)}
                />
                Cite at the cursor
              </label>
            )}
            <button
              className="button primary"
              disabled={busy || !file || !parsed}
              onClick={() => void save()}
            >
              Add to {file.split("/").pop() || "bibliography"}
            </button>
          </div>
        </>
      )}
      {!files.length && (
        <p className="muted">
          Add a .bib file to the project folder to store references.
        </p>
      )}
    </Modal>
  );
}
