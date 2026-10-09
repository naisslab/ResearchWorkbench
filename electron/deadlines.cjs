const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const yaml = require("js-yaml");
const { atomicWrite } = require("./core.cjs");
const REPO = "ccfddl/ccf-deadlines";
const TREE_URL = `https://api.github.com/repos/${REPO}/git/trees/main?recursive=1`;
const RAW_URL = `https://raw.githubusercontent.com/${REPO}/main/`;
const SOURCE_URL = `https://github.com/${REPO}`;
const macDirectory = () =>
  path.join(os.homedir(), "Library/Application Support/mac-ddl-count");
const fields = {
  abstract_deadline: "abstract",
  deadline: "submission",
  decision_deadline: "notification",
  notification: "notification",
  camera_ready: "camera-ready",
  camera_ready_deadline: "camera-ready",
  revision_deadline: "revision",
};
const kindNames = {
  abstract: "Abstract",
  submission: "Paper",
  notification: "Decision",
  "camera-ready": "Camera-ready",
  revision: "Revision",
  other: "Milestone",
};
function httpUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
function sourceKey(dblp, event, index, field) {
  return `${dblp}:${event}:${index}:${field}`;
}
function toInstant(value, timezone = "UTC") {
  if (typeof value !== "string") return null;
  const match = value
    .trim()
    .match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) return null;
  const [, date, hh = "23", mm = "59", ss = "59"] = match;
  const local = Date.parse(`${date}T${hh}:${mm}:${ss}Z`);
  if (
    !Number.isFinite(local) ||
    new Date(local).toISOString().slice(0, 10) !== date ||
    +hh > 23 ||
    +mm > 59 ||
    +ss > 59
  )
    return null;
  const fixed = /^(?:UTC|GMT)(?:([+-])(\d{1,2})(?::?(\d{2}))?)?$/i.exec(
    timezone,
  );
  if (timezone === "AoE") return new Date(local + 12 * 3600000).toISOString();
  if (fixed) {
    const minutes = fixed[2]
      ? (+fixed[2] * 60 + +(fixed[3] || 0)) * (fixed[1] === "-" ? -1 : 1)
      : 0;
    if (Math.abs(minutes) > 14 * 60) return null;
    return new Date(local - minutes * 60000).toISOString();
  }
  // Resolve IANA offsets for this specific date, including daylight saving time.
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    let guess = local;
    for (let i = 0; i < 3; i++) {
      const p = Object.fromEntries(
        formatter.formatToParts(new Date(guess)).map((x) => [x.type, x.value]),
      );
      const rendered = Date.UTC(
        +p.year,
        +p.month - 1,
        +p.day,
        +p.hour,
        +p.minute,
        +p.second,
      );
      const next = guess + local - rendered;
      if (next === guess) return new Date(guess).toISOString();
      guess = next;
    }
    return null;
  } catch {
    return null;
  }
}
function normalizeConference(conf, filePath, now = new Date()) {
  if (!conf || !Array.isArray(conf.confs)) return null;
  const dblp = String(
    conf.dblp || conf.dblpKey || path.basename(filePath, ".yml"),
  );
  const area = String(conf.sub || conf.area || filePath.split("/")[1] || "");
  const events = conf.confs
    .filter((event) => Number(event.year) >= now.getUTCFullYear() - 1)
    .map((event) => {
      const timelines = Array.isArray(event.timeline) ? event.timeline : [];
      const dates = timelines.flatMap((line, position) => {
        const index = line.originalIndex ?? position;
        const entries = { ...line };
        if (line.abstractDeadline)
          entries.abstract_deadline = line.abstractDeadline;
        return Object.entries(fields).flatMap(([field, kind]) => {
          const originalDate = entries[field];
          const time =
            typeof originalDate === "string" &&
            /Z$/.test(originalDate) &&
            Number.isFinite(Date.parse(originalDate))
              ? new Date(originalDate).toISOString()
              : toInstant(originalDate, event.timezone);
          if (!time) return [];
          const key = sourceKey(dblp, event.id, index, field);
          return [
            {
              id: `ccf:${key}`,
              label: `${conf.title} ${event.year} ${kindNames[kind]}`,
              subtitle: line.comment || "",
              category: "paper",
              kind,
              time,
              timezone: event.timezone || "UTC",
              originalDate: /Z$/.test(originalDate) ? undefined : originalDate,
              status: "notStarted",
              url: httpUrl(event.link),
              conference: conf.title,
              eventId: String(event.id),
              round: index,
              sourceKey: key,
              source: "ccfddl",
              sourceUrl: `${SOURCE_URL}/blob/main/${filePath}`,
            },
          ];
        });
      });
      return {
        id: String(event.id),
        year: Number(event.year),
        name: `${conf.title} ${event.year}`,
        timezone: event.timezone || "UTC",
        place: event.place || "",
        date: event.date || "",
        url: httpUrl(event.link),
        dates,
      };
    })
    .filter((event) => event.dates.length);
  return {
    id: dblp,
    title: String(conf.title),
    description: String(conf.description || ""),
    area,
    rank: conf.rank?.ccf || "",
    events,
  };
}
function flatten(catalog) {
  return catalog.conferences.flatMap((c) => c.events.flatMap((e) => e.dates));
}
function officialWebDates() {
  const kinds = [
    ["abstract", "2026-10-18"],
    ["submission", "2026-10-25"],
    ["notification", "2027-01-04"],
    ["camera-ready", "2027-01-31"],
  ];
  return kinds.map(([kind, date]) => ({
    id: `www27-official-${kind}`,
    label: `WWW 2027 ${kindNames[kind]}`,
    subtitle: "The Web Conference · Research & Industry tracks",
    category: "paper",
    kind,
    time: toInstant(`${date} 23:59:59`, "AoE"),
    timezone: "AoE",
    originalDate: `${date} 23:59:59`,
    status: "notStarted",
    conference: "WWW",
    eventId: "www27",
    round: 0,
    sourceKey: sourceKey(
      "www",
      "www27",
      0,
      Object.keys(fields).find((f) => fields[f] === kind),
    ),
    source: "official",
    url: "https://www2027.thewebconf.org/research-track-papers/",
    sourceUrl: "https://www2027.thewebconf.org/important-dates/",
  }));
}
function inferKind(entry) {
  if (
    entry.source?.timelineKind === "abstract" ||
    /abstract|registration/i.test(entry.title)
  )
    return "abstract";
  if (/camera.?ready|final version/i.test(entry.title)) return "camera-ready";
  if (/revision/i.test(entry.title)) return "revision";
  return entry.category === "paper" ? "submission" : "other";
}
function importTracker(workspace, tracker, catalog) {
  if (workspace.deadlineImportVersion === 1) return workspace;
  if (!tracker || !Array.isArray(tracker.deadlines))
    throw new Error("The Mac deadline tracker has an invalid format.");
  const dates = [...(workspace.trackedDeadlines || [])];
  const known = new Set(dates.map((d) => d.id));
  const feed = new Map(flatten(catalog).map((d) => [d.sourceKey, d]));
  for (const entry of tracker.deadlines) {
    if (
      typeof entry.id !== "string" ||
      typeof entry.title !== "string" ||
      !entry.title.trim() ||
      !Number.isFinite(Date.parse(entry.deadline))
    )
      throw new Error("The Mac deadline tracker contains an invalid date.");
    const id = `mac:${entry.id}`;
    if (known.has(id)) continue;
    const s = entry.source;
    const key =
      s?.kind === "ccfddl"
        ? sourceKey(
            s.dblpKey,
            s.eventID,
            s.timelineIndex,
            s.timelineKind === "abstract" ? "abstract_deadline" : "deadline",
          )
        : undefined;
    const reference = feed.get(key);
    dates.push({
      id,
      label: entry.title,
      subtitle: entry.subtitle || "",
      category: ["paper", "funding", "award", "service", "other"].includes(
        entry.category,
      )
        ? entry.category
        : "other",
      kind: inferKind(entry),
      time: new Date(entry.deadline).toISOString(),
      timezone: reference?.timezone || "UTC",
      status: ["notStarted", "ongoing", "finished"].includes(entry.status)
        ? entry.status
        : "notStarted",
      notes: entry.notes || "",
      url: httpUrl(entry.url),
      source: key ? "ccfddl" : "manual",
      sourceKey: key,
      sourceUrl: reference?.sourceUrl,
      conference: reference?.conference,
      eventId: s?.eventID,
      round: s?.timelineIndex,
      importedFrom: "mac-ddl-count",
    });
    known.add(id);
  }
  return { ...workspace, trackedDeadlines: dates, deadlineImportVersion: 1 };
}
function seedWeb(workspace) {
  if (workspace.webDeadlineSetupVersion === 1) return workspace;
  const current = workspace.trackedDeadlines || [];
  const keys = new Set(current.map((d) => d.sourceKey));
  return {
    ...workspace,
    trackedDeadlines: [
      ...current,
      ...officialWebDates().filter((d) => !keys.has(d.sourceKey)),
    ],
    webDeadlineSetupVersion: 1,
  };
}
function changes(workspace, catalog) {
  const feed = new Map(flatten(catalog).map((d) => [d.sourceKey, d]));
  return (workspace.trackedDeadlines || []).flatMap((current) => {
    if (!current.sourceKey || !["ccfddl", "official"].includes(current.source))
      return [];
    const latest = feed.get(current.sourceKey);
    // Minute-only upstream times and end-of-minute local times are equivalent.
    if (
      !latest ||
      Math.abs(Date.parse(latest.time) - Date.parse(current.time)) < 60000
    )
      return [];
    return [
      {
        id: current.id,
        label: current.label,
        previousTime: current.time,
        time: latest.time,
        latest,
      },
    ];
  });
}
function addFeedDates(workspace, catalog, keys) {
  if (
    !Array.isArray(keys) ||
    keys.length > 500 ||
    keys.some((k) => typeof k !== "string")
  )
    throw new Error("Choose valid conference deadlines.");
  const known = new Set(
    (workspace.trackedDeadlines || []).map((d) => d.sourceKey),
  );
  const feed = new Map(flatten(catalog).map((d) => [d.sourceKey, d]));
  const additions = keys.flatMap((key) => {
    const d = feed.get(key);
    if (!d)
      throw new Error(
        "This conference date is no longer available. Refresh the feed.",
      );
    if (known.has(key)) return [];
    known.add(key);
    return [{ ...d }];
  });
  return {
    ...workspace,
    trackedDeadlines: [...(workspace.trackedDeadlines || []), ...additions],
  };
}
function applyUpdates(workspace, catalog, ids) {
  if (
    !Array.isArray(ids) ||
    ids.length > 500 ||
    ids.some((id) => typeof id !== "string")
  )
    throw new Error("Choose valid deadline updates.");
  const selected = new Set(ids);
  const updates = new Map(
    changes(workspace, catalog)
      .filter((d) => selected.has(d.id))
      .map((d) => [d.id, d.latest]),
  );
  return {
    ...workspace,
    trackedDeadlines: (workspace.trackedDeadlines || []).map((d) => {
      const latest = updates.get(d.id);
      return latest
        ? {
            ...d,
            time: latest.time,
            timezone: latest.timezone,
            originalDate: latest.originalDate,
            url: latest.url || d.url,
            sourceUrl: latest.sourceUrl,
            source: "ccfddl",
          }
        : d;
    }),
  };
}
async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function macCatalog(directory = macDirectory()) {
  const cache = await readJson(path.join(directory, "ccfddl-cache.json"));
  if (
    cache?.cachedRepo &&
    (cache.cachedRepo.owner !== "ccfddl" ||
      cache.cachedRepo.name !== "ccf-deadlines")
  )
    return { conferences: [], lastSuccessAt: null };
  const conferences = Object.entries(cache?.blobs || {})
    .map(([file, blob]) => normalizeConference(blob.parsed, file))
    .filter(Boolean);
  return { conferences, lastSuccessAt: cache?.lastSuccessAt || null };
}
function createFeed(file, options = {}) {
  const fetcher = options.fetch || global.fetch;
  let cache;
  let flight;
  async function load() {
    if (cache) return cache;
    cache = (await readJson(file)) || {
      ...(await macCatalog(options.macDirectory)),
      blobs: {},
      checkedAt: null,
      error: null,
    };
    return cache;
  }
  async function request(url) {
    const r = await fetcher(url, {
      headers: {
        "User-Agent": "Research-Workbench",
        Accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok)
      throw new Error(
        r.status === 403 || r.status === 429
          ? "CCF feed rate limit reached. Try again later."
          : `CCF feed returned HTTP ${r.status}.`,
      );
    return r;
  }
  async function refresh() {
    if (flight) return flight;
    flight = (async () => {
      await load();
      const start = new Date().toISOString();
      try {
        const tree = await (await request(TREE_URL)).json();
        if (tree.truncated || !Array.isArray(tree.tree))
          throw new Error("The CCF conference index is incomplete.");
        const files = tree.tree.filter(
          (d) =>
            d.type === "blob" && /^conference\/[^/]+\/[^/]+\.yml$/.test(d.path),
        );
        if (!files.length || files.length > 2000)
          throw new Error("The CCF conference index is invalid.");
        const blobs = { ...(cache.blobs || {}) };
        let index = 0;
        const errors = [];
        await Promise.all(
          Array.from({ length: 6 }, async () => {
            while (index < files.length) {
              const file = files[index++];
              if (blobs[file.path]?.sha === file.sha) continue;
              try {
                const body = await (await request(RAW_URL + file.path)).text();
                if (body.length > 1000000)
                  throw new Error("Conference file is too large.");
                const parsed = yaml.load(body, { schema: yaml.JSON_SCHEMA });
                if (!Array.isArray(parsed) || !parsed[0]?.confs)
                  throw new Error("Conference data is invalid.");
                blobs[file.path] = { sha: file.sha, parsed: parsed[0] };
              } catch (e) {
                errors.push(`${file.path}: ${e.message}`);
              }
            }
          }),
        );
        const active = new Set(files.map((f) => f.path));
        const next = Object.fromEntries(
          Object.entries(blobs).filter(([name]) => active.has(name)),
        );
        let conferences = Object.entries(next)
          .map(([name, blob]) => normalizeConference(blob.parsed, name))
          .filter(Boolean);
        if (errors.length) {
          const available = new Set(conferences.map((c) => c.id));
          conferences = [
            ...conferences,
            ...cache.conferences.filter((c) => !available.has(c.id)),
          ];
        }
        cache = {
          conferences,
          blobs: next,
          checkedAt: start,
          lastSuccessAt: errors.length
            ? cache.lastSuccessAt
            : new Date().toISOString(),
          error: errors.length
            ? `${errors.length} conference files could not refresh. Cached dates remain available.`
            : null,
          failures: errors,
        };
      } catch (e) {
        cache = {
          ...cache,
          checkedAt: start,
          error: e.message || "Could not reach CCF Deadlines.",
        };
      }
      await atomicWrite(file, JSON.stringify(cache));
      return snapshot();
    })().finally(() => {
      flight = null;
    });
    return flight;
  }
  async function snapshot() {
    const data = await load();
    return {
      conferences: data.conferences,
      checkedAt: data.checkedAt,
      lastSuccessAt: data.lastSuccessAt,
      error: data.error,
      sourceUrl: SOURCE_URL,
    };
  }
  return { snapshot, refresh };
}
module.exports = {
  toInstant,
  normalizeConference,
  flatten,
  officialWebDates,
  importTracker,
  seedWeb,
  changes,
  addFeedDates,
  applyUpdates,
  readJson,
  macDirectory,
  macCatalog,
  createFeed,
};
