const { test } = require("node:test");
const assert = require("node:assert/strict");
const { identify, createReferences } = require("../electron/references.cjs");

test("identifiers are recognized from DOIs, arXiv IDs, links and titles", () => {
  assert.deepEqual(identify("10.1145/3589334.3645393"), {
    kind: "doi",
    id: "10.1145/3589334.3645393",
  });
  assert.deepEqual(identify("https://doi.org/10.1109/SP.2024.00012."), {
    kind: "doi",
    id: "10.1109/SP.2024.00012",
  });
  for (const input of [
    "2005.11401",
    "arXiv:2005.11401v4",
    "https://arxiv.org/abs/2005.11401",
    "https://arxiv.org/pdf/2005.11401v2.pdf",
    "10.48550/arXiv.2005.11401",
  ])
    assert.deepEqual(
      identify(input),
      { kind: "arxiv", id: "2005.11401" },
      input,
    );
  assert.deepEqual(identify("cs/0112017"), { kind: "arxiv", id: "cs/0112017" });
  assert.deepEqual(identify("Retrieval augmented generation"), {
    kind: "search",
    query: "Retrieval augmented generation",
  });
  assert.throws(() => identify("ab"), /Enter a DOI/);
});

function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    const route = routes.find(([pattern]) => pattern.test(url));
    if (!route) throw new TypeError("network down");
    const [, status, body] = route;
    return { ok: status < 400, status, text: async () => body };
  };
  return { fetch, calls };
}

test("DOIs and arXiv IDs fetch BibTeX from fixed services", async () => {
  const { fetch, calls } = fakeFetch([
    [/^https:\/\/doi\.org\//, 200, " @inproceedings{X, title={T}}"],
    [/^https:\/\/arxiv\.org\/bibtex\//, 200, "@misc{y, title={A}}"],
  ]);
  const references = createReferences(fetch);
  assert.equal(
    (await references.lookup("doi:10.1145/1.2")).bibtex,
    "@inproceedings{X, title={T}}\n",
  );
  assert.equal(
    calls[0].options.headers.Accept,
    "application/x-bibtex; charset=utf-8",
  );
  assert.equal(
    (await references.lookup("2005.11401")).bibtex,
    "@misc{y, title={A}}\n",
  );
  assert.equal(calls[1].url, "https://arxiv.org/bibtex/2005.11401");
  await assert.rejects(
    references.bibtex("doi", "https://evil.example/"),
    /Choose a DOI/,
  );
  await assert.rejects(references.bibtex("arxiv", "../../etc"), /Choose a DOI/);
});

test("title searches merge arXiv and Crossref candidates and explain failures", async () => {
  const atom = `<feed><entry><id>http://arxiv.org/abs/2005.11401v4</id>
    <title>Retrieval-Augmented Generation for
      Knowledge-Intensive NLP Tasks</title><published>2020-05-22T21:34:34Z</published>
    <author><name>Patrick Lewis</name></author><author><name>Ethan Perez</name></author></entry></feed>`;
  const crossref = JSON.stringify({
    message: {
      items: [
        {
          DOI: "10.5555/dup",
          title: [
            "Retrieval-augmented generation for knowledge-intensive NLP tasks",
          ],
        },
        {
          DOI: "10.1145/3",
          title: ["RAG &amp; Friends"],
          author: [{ given: "A", family: "B" }],
          issued: { "date-parts": [[2024]] },
          "container-title": ["WWW"],
        },
      ],
    },
  });
  const { fetch } = fakeFetch([
    [/export\.arxiv\.org\/api\/query/, 200, atom],
    [/api\.crossref\.org\/works/, 200, crossref],
  ]);
  const { candidates } = await createReferences(fetch).lookup(
    "retrieval augmented generation",
  );
  assert.deepEqual(candidates, [
    {
      kind: "arxiv",
      id: "2005.11401",
      title: "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks",
      authors: ["Patrick Lewis", "Ethan Perez"],
      year: "2020",
      venue: "arXiv",
    },
    {
      kind: "doi",
      id: "10.1145/3",
      title: "RAG & Friends",
      authors: ["A B"],
      year: "2024",
      venue: "WWW",
    },
  ]);
  const offline = createReferences(fakeFetch([]).fetch);
  await assert.rejects(
    offline.lookup("retrieval augmented generation"),
    /Could not reach arXiv/,
  );
  const missing = createReferences(
    fakeFetch([[/doi\.org/, 404, "Not found"]]).fetch,
  );
  await assert.rejects(missing.lookup("10.1145/xyz"), /doi.org has no record/);
  const html = createReferences(fakeFetch([[/doi\.org/, 200, "<html>"]]).fetch);
  await assert.rejects(html.lookup("10.1145/xyz"), /no BibTeX entry/);
});
