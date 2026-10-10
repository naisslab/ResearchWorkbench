// Turns a DOI, an arXiv identifier or a title into BibTeX. Requests go only to
// doi.org, arxiv.org and Crossref; DBLP refuses automated clients.
// New-style IDs such as 2005.11401 and old ones such as cs/0112017.
const arxivPattern = String.raw`(\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})`;
const arxivId = new RegExp(`^${arxivPattern}$`, "i");
// A bare ID, an arxiv.org link, an arXiv: prefix or arXiv's own DOI.
const arxivReference = new RegExp(
  String.raw`(?:^|arxiv\.org\/(?:abs|pdf)\/|arxiv:\s*|10\.48550\/arxiv\.)` +
    arxivPattern +
    String.raw`(?:v\d+)?(?:\.pdf)?\/?$`,
  "i",
);
const services = {
  doi: "doi.org",
  arxiv: "arXiv",
  crossref: "Crossref",
};

function identify(input) {
  const text = typeof input === "string" ? input.trim() : "";
  if (text.length < 4 || text.length > 300)
    throw new Error("Enter a DOI, an arXiv ID or link, or a paper title.");
  // arXiv's own DOIs resolve to sparser DataCite records than arXiv's BibTeX.
  const arxiv = arxivReference.exec(text);
  if (arxiv) return { kind: "arxiv", id: arxiv[1] };
  const doi = /\b(10\.\d{4,9}\/[^\s"<>]+)/.exec(text);
  if (doi) return { kind: "doi", id: doi[1].replace(/[.,;)\]]+$/, "") };
  return { kind: "search", query: text };
}

function createReferences(fetch, { timeout = 15000 } = {}) {
  async function get(kind, url, headers = {}) {
    let response;
    try {
      response = await fetch(url, {
        headers: { "User-Agent": "ResearchWorkbench/0.1", ...headers },
        signal: AbortSignal.timeout(timeout),
      });
    } catch {
      throw new Error(
        `Could not reach ${services[kind]}. Check your connection.`,
      );
    }
    if (response.status === 404)
      throw new Error(`${services[kind]} has no record for this identifier.`);
    if (!response.ok)
      throw new Error(`${services[kind]} returned HTTP ${response.status}.`);
    return response.text();
  }
  const bibtexOnly = (kind, text) => {
    const at = text.indexOf("@");
    if (at < 0 || !/^@[a-zA-Z]+\s*[{(]/.test(text.slice(at)))
      throw new Error(`${services[kind]} returned no BibTeX entry.`);
    return text.slice(at).trim() + "\n";
  };
  async function bibtex(kind, id) {
    if (kind === "doi" && typeof id === "string" && /^10\.\d{4,9}\//.test(id))
      return bibtexOnly(
        kind,
        await get(kind, `https://doi.org/${encodeURI(id)}`, {
          Accept: "application/x-bibtex; charset=utf-8",
        }),
      );
    if (kind === "arxiv" && typeof id === "string" && arxivId.test(id))
      return bibtexOnly(
        kind,
        await get(kind, `https://arxiv.org/bibtex/${id}`),
      );
    throw new Error("Choose a DOI or arXiv reference.");
  }
  const decode = (text) =>
    text
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
  async function searchArxiv(query) {
    const phrase = query.replace(/["\\]/g, " ");
    const atom = await get(
      "arxiv",
      `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(`ti:"${phrase}"`)}&max_results=5`,
    );
    return [...atom.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(
      ([, entry]) => {
        const tag = (name) =>
          decode(
            new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(
              entry,
            )?.[1] || "",
          );
        return {
          kind: "arxiv",
          id: tag("id")
            .replace(/^.*\/abs\//, "")
            .replace(/v\d+$/, ""),
          title: tag("title"),
          authors: [...entry.matchAll(/<name>([\s\S]*?)<\/name>/g)].map(
            ([, name]) => decode(name),
          ),
          year: tag("published").slice(0, 4),
          venue: tag("arxiv:journal_ref") || "arXiv",
        };
      },
    );
  }
  async function searchCrossref(query) {
    const data = JSON.parse(
      await get(
        "crossref",
        `https://api.crossref.org/works?rows=5&select=DOI,title,author,issued,container-title&query.bibliographic=${encodeURIComponent(query)}`,
      ),
    );
    return (data.message?.items || []).map((item) => ({
      kind: "doi",
      id: item.DOI,
      title: decode(item.title?.[0] || ""),
      authors: (item.author || []).map((a) =>
        [a.given, a.family].filter(Boolean).join(" "),
      ),
      year: String(item.issued?.["date-parts"]?.[0]?.[0] || ""),
      venue: decode(item["container-title"]?.[0] || ""),
    }));
  }
  async function lookup(input) {
    const target = identify(input);
    if (target.kind !== "search")
      return { bibtex: await bibtex(target.kind, target.id) };
    const settled = await Promise.allSettled([
      searchArxiv(target.query),
      searchCrossref(target.query),
    ]);
    const seen = new Set();
    const candidates = settled
      .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
      .filter((item) => {
        const title = item.title.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (!item.id || !title || seen.has(title)) return false;
        seen.add(title);
        return true;
      });
    if (!candidates.length && settled.every((r) => r.status === "rejected"))
      throw settled[0].reason;
    return { candidates };
  }
  return { lookup, bibtex };
}

module.exports = { identify, createReferences };
