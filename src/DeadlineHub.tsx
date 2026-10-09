import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  BellRing,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  ExternalLink,
  FileText,
  Landmark,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trophy,
  X,
  Pencil,
  Trash2,
} from "lucide-react";
import type {
  ConferenceFeed,
  DateCategory,
  DeadlineFeedResult,
  DeadlineUpdate,
  TrackedDeadline,
  Workspace,
} from "./types";
import { deadlineKinds } from "./types";
import { linkedProjectIds } from "./linked-dates";
const categories: { id: DateCategory; name: string; icon: typeof FileText }[] =
  [
    { id: "paper", name: "Paper", icon: FileText },
    { id: "funding", name: "Funding", icon: Landmark },
    { id: "award", name: "Award", icon: Trophy },
    { id: "service", name: "Service", icon: ShieldCheck },
    { id: "other", name: "Other", icon: CalendarDays },
  ];
const kinds = (kind: string) =>
  kind === "submission"
    ? "Paper"
    : deadlineKinds.find((k) => k.id === kind)?.name || "Milestone";
export function localDate(time: string) {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function countdown(time: string, now = Date.now()) {
  const ms = Date.parse(time) - now;
  if (ms < 0) return "Past";
  const hours = Math.floor(ms / 3600000);
  return hours >= 24
    ? `In ${Math.floor(hours / 24)}d ${hours % 24}h`
    : hours > 0
      ? `In ${hours}h`
      : `In ${Math.max(0, Math.floor(ms / 60000))}m`;
}
export function timeLabel(time: string) {
  return new Date(time).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  });
}
function sourceTime(d: TrackedDeadline) {
  if (d.originalDate) return `${d.originalDate.slice(0, 16)} ${d.timezone}`;
  if (d.timezone === "AoE" || /^UTC[+-]/.test(d.timezone)) {
    const m = /^UTC([+-])(\d{1,2})(?::(\d{2}))?$/.exec(d.timezone);
    const hours =
      d.timezone === "AoE"
        ? -12
        : m
          ? (+m[2] + +(m[3] || 0) / 60) * (m[1] === "-" ? -1 : 1)
          : 0;
    return `${new Date(Date.parse(d.time) + hours * 3600000).toISOString().slice(0, 16).replace("T", " ")} ${d.timezone}`;
  }
  try {
    return (
      new Date(d.time).toLocaleString("en-US", {
        timeZone: d.timezone,
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }) + ` ${d.timezone}`
    );
  } catch {
    return d.time;
  }
}
function Urgency({ time, now }: { time: string; now: number }) {
  const remaining = Date.parse(time) - now;
  const tone =
    remaining < 0
      ? "past"
      : remaining < 86400000
        ? "urgent"
        : remaining < 7 * 86400000
          ? "soon"
          : remaining < 30 * 86400000
            ? "month"
            : "later";
  return (
    <span className={`date-urgency urgency-${tone}`}>
      <Clock3 size={12} />
      {countdown(time, now)}
    </span>
  );
}
export default function DeadlineHub({
  state,
  commit,
  received,
  report,
  notify,
  projectMilestones,
  openProject,
}: {
  state: Workspace;
  commit(fn: (current: Workspace) => Workspace): Promise<void>;
  received(state: Workspace): void;
  report(message: string): void;
  notify(message: string): void;
  projectMilestones: (editDate: (id: string) => void) => React.ReactNode;
  openProject(id: string): void;
}) {
  const [tab, setTab] = useState("tracked");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [includePast, setIncludePast] = useState(false);
  const [feed, setFeed] = useState<ConferenceFeed>();
  const [updates, setUpdates] = useState<DeadlineUpdate[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState("");
  const [editing, setEditing] = useState<TrackedDeadline | null | undefined>();
  const [now, setNow] = useState(Date.now());
  const [feedArea, setFeedArea] = useState("all");
  const [showUpdates, setShowUpdates] = useState(false);
  function result(data: DeadlineFeedResult) {
    setFeed(data.feed);
    setUpdates(data.updates);
  }
  useEffect(() => {
    let active = true;
    void window
      .research!.deadlineFeed()
      .then((d) => {
        if (active) result(d);
      })
      .catch((e) => report(e.message));
    const off = window.research!.onDeadlineFeed((d) => {
      if (active) result(d);
    });
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => {
      active = false;
      off();
      clearInterval(timer);
    };
  }, [report]);
  useEffect(() => {
    void window
      .research!.deadlineFeed()
      .then(result)
      .catch((e) => report(e.message));
  }, [state.trackedDeadlines, report]);
  const dates = state.trackedDeadlines || [];
  const upcoming = dates.filter(
    (d) => Date.parse(d.time) >= now && d.status !== "finished",
  );
  const filtered = dates
    .filter(
      (d) =>
        (category === "all" || category === d.category) &&
        (includePast || Date.parse(d.time) >= now) &&
        (
          d.label +
          " " +
          d.subtitle +
          " " +
          d.conference +
          " " +
          d.notes +
          " " +
          state.projects
            .filter((p) => linkedProjectIds(d).includes(p.id))
            .map((p) => p.name)
            .join(" ")
        )
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const trackedKeys = new Set(dates.map((d) => d.sourceKey));
  const events =
    feed?.conferences
      .flatMap((conf) => conf.events.map((event) => ({ conf, event })))
      .filter(
        ({ conf, event }) =>
          (feedArea === "all" || conf.area === feedArea) &&
          (includePast || event.dates.some((d) => Date.parse(d.time) >= now)) &&
          (
            conf.title +
            " " +
            conf.description +
            " " +
            (conf.id === "www" ? "The Web Conference " : "") +
            event.year
          )
            .toLowerCase()
            .includes(query.toLowerCase()),
      )
      .sort((a, b) => {
        const next = (dates: TrackedDeadline[]) =>
          Math.min(
            ...dates
              .filter((d) => includePast || Date.parse(d.time) >= now)
              .map((d) => Date.parse(d.time)),
          );
        return next(a.event.dates) - next(b.event.dates);
      }) || [];
  async function action(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      report((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function track(keys: string[]) {
    await action("track", async () => {
      received(await window.research!.trackConferenceDates(keys));
      notify("Conference dates added to your tracker.");
    });
  }
  async function refresh() {
    setRefreshing(true);
    try {
      const next = await window.research!.refreshDeadlineFeed();
      result(next);
      if (!next.feed.error) notify("CCF Deadlines is up to date.");
    } catch (e) {
      report((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }
  const groups = [
    ...new Set(
      filtered.map((d) =>
        Date.parse(d.time) < now
          ? "Past dates"
          : new Date(d.time).toLocaleDateString("en-US", {
              month: "long",
              year: "numeric",
            }),
      ),
    ),
  ];
  return (
    <div className="deadline-hub">
      <div className="date-summary-grid">
        <div className="date-summary summary-coral">
          <CalendarDays size={22} />
          <div>
            <strong>{upcoming.length}</strong>
            <span>Upcoming dates</span>
          </div>
          <small>
            {
              upcoming.filter((d) => Date.parse(d.time) < now + 7 * 86400000)
                .length
            }{" "}
            in the next 7 days
          </small>
        </div>
        <div className="date-summary summary-indigo">
          <FileText size={22} />
          <div>
            <strong>
              {upcoming.filter((d) => d.category === "paper").length}
            </strong>
            <span>Paper deadlines</span>
          </div>
          <small>Abstracts, submissions & decisions</small>
        </div>
        <button
          className="date-summary summary-violet"
          onClick={() => {
            setShowUpdates((x) => !x);
            setTab("tracked");
          }}
        >
          <BellRing size={22} />
          <div>
            <strong>{updates.length}</strong>
            <span>Feed changes</span>
          </div>
          <small>Review changed dates</small>
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="deadline-hub-nav">
        <div className="date-tabs" role="tablist" aria-label="Deadline views">
          <button
            role="tab"
            aria-selected={tab === "tracked"}
            onClick={() => {
              setTab("tracked");
              setQuery("");
            }}
          >
            <CalendarDays size={15} />
            My dates <span>{dates.length}</span>
          </button>
          <button
            role="tab"
            aria-selected={tab === "feed"}
            onClick={() => {
              setTab("feed");
              setQuery("");
            }}
          >
            <BookOpen size={15} />
            CCF conferences
          </button>
          <button
            role="tab"
            aria-selected={tab === "projects"}
            onClick={() => {
              setTab("projects");
              setQuery("");
            }}
          >
            Project milestones
          </button>
        </div>
        <div className="date-actions">
          <button
            className="button"
            disabled={!!busy}
            onClick={() =>
              void action("import", async () => {
                const r = await window.research!.importMacDeadlines();
                received(r.state);
                notify(`${r.count} new dates imported from mac-ddl-count.`);
              })
            }
          >
            <ArrowDownToLine size={14} />
            Import Mac dates
          </button>
          <button className="button primary" onClick={() => setEditing(null)}>
            <Plus size={14} />
            Add date
          </button>
        </div>
      </div>
      {tab !== "projects" && (
        <>
          <div className="date-feed-status">
            <span className={feed?.error ? "feed-offline" : "feed-ready"}>
              <i />
              {refreshing
                ? "Checking CCF Deadlines…"
                : feed?.error
                  ? "Using cached conference dates"
                  : "CCF Deadlines"}
            </span>
            <span>
              {feed?.lastSuccessAt
                ? `Updated ${timeLabel(feed.lastSuccessAt)}`
                : "Local catalog · refresh for the latest dates"}
            </span>
            <button
              className="button text small"
              disabled={refreshing}
              onClick={() => void refresh()}
            >
              <RefreshCw size={13} className={refreshing ? "spin" : ""} />
              {refreshing ? "Refreshing…" : "Refresh feed"}
            </button>
            <button
              className="icon-button"
              title="Open CCF Deadlines"
              onClick={() =>
                void window.research!.openLink("https://ccfddl.com/")
              }
            >
              <ExternalLink size={13} />
            </button>
          </div>
          {feed?.error && (
            <p className="feed-error" role="status">
              {feed.error}
            </p>
          )}
          {(showUpdates || updates.length > 0) && tab === "tracked" && (
            <section className="feed-changes">
              <div className="section-heading">
                <h2>
                  <BellRing size={16} />
                  Conference date changes
                </h2>
                {updates.length > 0 && (
                  <button
                    className="button small"
                    disabled={!!busy}
                    onClick={() =>
                      void action("updates", async () => {
                        received(
                          await window.research!.acceptDeadlineUpdates(
                            updates.map((u) => u.id),
                          ),
                        );
                        notify("Conference date changes applied.");
                      })
                    }
                  >
                    Apply all changes
                  </button>
                )}
              </div>
              {updates.length ? (
                updates.map((u) => (
                  <div className="feed-change-row" key={u.id}>
                    <div>
                      <strong>{u.label}</strong>
                      <span>
                        <s>{timeLabel(u.previousTime)}</s>
                        <ChevronRight size={12} />
                        {timeLabel(u.time)}
                      </span>
                    </div>
                    <button
                      className="button small"
                      disabled={!!busy}
                      onClick={() =>
                        void action(u.id, async () =>
                          received(
                            await window.research!.acceptDeadlineUpdates([
                              u.id,
                            ]),
                          ),
                        )
                      }
                    >
                      Update date
                    </button>
                  </div>
                ))
              ) : (
                <p className="muted">
                  Your tracked CCF dates match the available feed.
                </p>
              )}
            </section>
          )}
          <div className="date-filters">
            {tab === "tracked" ? (
              <div className="date-category-tabs">
                <button
                  className={category === "all" ? "active" : ""}
                  onClick={() => setCategory("all")}
                >
                  All
                </button>
                {categories.map(({ id, name, icon: Glyph }) => (
                  <button
                    key={id}
                    className={`${category === id ? "active" : ""} date-category-${id}`}
                    onClick={() => setCategory(id)}
                  >
                    <Glyph size={14} />
                    {name}
                  </button>
                ))}
              </div>
            ) : (
              <select
                aria-label="Conference area"
                value={feedArea}
                onChange={(e) => setFeedArea(e.target.value)}
              >
                <option value="all">All conference areas</option>
                {[...new Set(feed?.conferences.map((c) => c.area))]
                  .sort()
                  .map((area) => (
                    <option key={area}>{area}</option>
                  ))}
              </select>
            )}
            <div className="date-search">
              <Search size={14} />
              <input
                aria-label={
                  tab === "feed" ? "Search CCF conferences" : "Search deadlines"
                }
                placeholder={
                  tab === "feed"
                    ? "Conference, e.g. WWW or SIGMETRICS"
                    : "Search your deadlines…"
                }
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button
                  title="Clear deadline search"
                  onClick={() => setQuery("")}
                >
                  <X size={13} />
                </button>
              )}
            </div>
            <label className="date-past-toggle">
              <input
                type="checkbox"
                checked={includePast}
                onChange={(e) => setIncludePast(e.target.checked)}
              />
              Include past
            </label>
          </div>
        </>
      )}
      {tab === "tracked" && (
        <div className="tracked-date-list">
          {groups.map((group) => (
            <section className="date-month" key={group}>
              <h2>
                {group}
                <span>
                  {
                    filtered.filter(
                      (d) =>
                        (Date.parse(d.time) < now
                          ? "Past dates"
                          : new Date(d.time).toLocaleDateString("en-US", {
                              month: "long",
                              year: "numeric",
                            })) === group,
                    ).length
                  }
                </span>
              </h2>
              {filtered
                .filter(
                  (d) =>
                    (Date.parse(d.time) < now
                      ? "Past dates"
                      : new Date(d.time).toLocaleDateString("en-US", {
                          month: "long",
                          year: "numeric",
                        })) === group,
                )
                .map((d) => {
                  const Glyph = categories.find(
                    (c) => c.id === d.category,
                  )!.icon;
                  const linked = state.projects.filter((p) =>
                    linkedProjectIds(d).includes(p.id),
                  );
                  return (
                    <article
                      className={`tracked-date-row date-category-${d.category} ${d.status === "finished" ? "date-finished" : ""}`}
                      key={d.id}
                    >
                      <div className="date-category-icon">
                        <Glyph size={19} />
                      </div>
                      <div className="date-calendar-day">
                        <strong>{new Date(d.time).getDate()}</strong>
                        <span>
                          {new Date(d.time).toLocaleDateString("en-US", {
                            month: "short",
                          })}
                        </span>
                      </div>
                      <div className="tracked-date-copy">
                        <div className="tracked-date-title">
                          <button onClick={() => setEditing(d)}>
                            {d.label}
                          </button>
                          <span className={`date-kind kind-${d.kind}`}>
                            {kinds(d.kind)}
                          </span>
                        </div>
                        <p>
                          {d.subtitle}
                          {linked.map((project) => (
                            <button
                              key={project.id}
                              className="date-project-link"
                              onClick={() => openProject(project.id)}
                            >
                              {" "}
                              · {project.name}
                              <ChevronRight size={12} />
                            </button>
                          ))}
                        </p>
                        <div className="date-time-detail">
                          <span>{timeLabel(d.time)}</span>
                          {d.timezone !== "UTC" && (
                            <span title="Original source timezone">
                              {sourceTime(d)}
                            </span>
                          )}
                          <span className="date-source-label">
                            {d.source === "ccfddl"
                              ? "CCF feed"
                              : d.source === "official"
                                ? "Official CFP"
                                : d.importedFrom === "mac-ddl-count"
                                  ? "Mac import"
                                  : "Manual"}
                          </span>
                        </div>
                      </div>
                      <Urgency time={d.time} now={now} />
                      <select
                        aria-label={`Status for ${d.label}`}
                        className={`date-status status-${d.status}`}
                        value={d.status}
                        onChange={(e) =>
                          void commit((s) => ({
                            ...s,
                            trackedDeadlines: (s.trackedDeadlines || []).map(
                              (item) =>
                                item.id === d.id
                                  ? {
                                      ...item,
                                      status: e.target
                                        .value as TrackedDeadline["status"],
                                    }
                                  : item,
                            ),
                          })).catch(() => {})
                        }
                      >
                        <option value="notStarted">Not started</option>
                        <option value="ongoing">In progress</option>
                        <option value="finished">Finished</option>
                      </select>
                      <div className="date-row-tools">
                        {d.url && (
                          <button
                            className="icon-button"
                            title={`Open source for ${d.label}`}
                            onClick={() =>
                              void window.research!.openLink(d.url!)
                            }
                          >
                            <ExternalLink size={14} />
                          </button>
                        )}
                        <button
                          className="icon-button"
                          title={`Edit ${d.label}`}
                          onClick={() => setEditing(d)}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          className="icon-button"
                          title={`Remove ${d.label}`}
                          onClick={() =>
                            void commit((s) => ({
                              ...s,
                              trackedDeadlines: (
                                s.trackedDeadlines || []
                              ).filter((item) => item.id !== d.id),
                            })).catch(() => {})
                          }
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </article>
                  );
                })}
            </section>
          ))}
          {!filtered.length && (
            <div className="dates-empty">
              <CalendarDays size={30} />
              <h3>{query ? "No matching dates" : "No dates in this view"}</h3>
              <p>
                Browse CCF conferences to track a deadline, or add your own
                date.
              </p>
              <button
                className="button"
                onClick={() => {
                  setTab("feed");
                  setQuery("");
                }}
              >
                Browse conferences
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>
      )}
      {tab === "feed" && (
        <div className="conference-browser">
          <p className="conference-intro">
            Track individual Abstract and Paper deadlines, or add every upcoming
            date in a conference round.
          </p>
          {events.map(({ conf, event }) => {
            const visible = event.dates.filter(
              (d) => includePast || Date.parse(d.time) >= now,
            );
            const untracked = visible.filter(
              (d) => !trackedKeys.has(d.sourceKey),
            );
            return (
              <article
                className="conference-card"
                key={`${conf.id}-${event.id}`}
              >
                <div className="conference-heading">
                  <div className="conference-monogram">
                    {conf.title.replace(/[^A-Z]/g, "").slice(0, 2)}
                  </div>
                  <div>
                    <h2>
                      {conf.title === "WWW"
                        ? "The Web Conference (WWW)"
                        : conf.title}{" "}
                      {event.year}
                    </h2>
                    <p>
                      {event.date} · {event.place}
                    </p>
                  </div>
                  <span className="conference-area-tag">
                    {conf.area}
                    {conf.rank && ` · CCF ${conf.rank}`}
                  </span>
                  <button
                    className="button small"
                    disabled={!!busy || !untracked.length}
                    onClick={() =>
                      void track(untracked.map((d) => d.sourceKey!))
                    }
                  >
                    {untracked.length ? (
                      <>
                        <Plus size={14} />
                        Track upcoming
                      </>
                    ) : (
                      <>
                        <Check size={14} />
                        Tracked
                      </>
                    )}
                  </button>
                  {event.url && (
                    <button
                      className="icon-button"
                      title={`Open ${event.name} website`}
                      onClick={() => void window.research!.openLink(event.url!)}
                    >
                      <ExternalLink size={14} />
                    </button>
                  )}
                </div>
                <div className="conference-dates">
                  {visible.map((d) => (
                    <div className="conference-date" key={d.id}>
                      <div>
                        <span className={`date-kind kind-${d.kind}`}>
                          {kinds(d.kind)}
                        </span>
                        <small>{d.subtitle || `Round ${d.round! + 1}`}</small>
                      </div>
                      <div>
                        <strong>{sourceTime(d)}</strong>
                        <span>Local: {timeLabel(d.time)}</span>
                      </div>
                      <Urgency time={d.time} now={now} />
                      <button
                        className={`button small ${trackedKeys.has(d.sourceKey) ? "date-tracked" : ""}`}
                        aria-label={`${trackedKeys.has(d.sourceKey) ? "Tracked" : "Track"} ${d.label} ${d.subtitle}`}
                        disabled={!!busy || trackedKeys.has(d.sourceKey)}
                        onClick={() => void track([d.sourceKey!])}
                      >
                        {trackedKeys.has(d.sourceKey) ? (
                          <CheckCircle2 size={14} />
                        ) : (
                          <Plus size={14} />
                        )}{" "}
                        {trackedKeys.has(d.sourceKey) ? "Tracked" : "Track"}
                      </button>
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
          {!events.length && (
            <div className="dates-empty">
              <Search size={28} />
              <h3>No conferences match</h3>
              <p>Try another conference name or refresh the feed.</p>
            </div>
          )}
        </div>
      )}
      {tab === "projects" &&
        projectMilestones((id) => setEditing(dates.find((d) => d.id === id)))}
      <p className="date-hub-footer">
        <Clock3 size={13} />
        Countdowns use the exact deadline time. Local times use{" "}
        {Intl.DateTimeFormat().resolvedOptions().timeZone}. AoE means UTC−12.
      </p>
      {editing !== undefined && (
        <DateEditor
          date={editing}
          state={state}
          close={() => setEditing(undefined)}
          save={async (d) => {
            await commit((s) => ({
              ...s,
              trackedDeadlines: editing
                ? (s.trackedDeadlines || []).map((item) =>
                    item.id === d.id ? d : item,
                  )
                : [...(s.trackedDeadlines || []), d],
            }));
            setEditing(undefined);
          }}
        />
      )}
    </div>
  );
}
function DateEditor({
  date,
  state,
  close,
  save,
}: {
  date: TrackedDeadline | null;
  state: Workspace;
  close(): void;
  save(d: TrackedDeadline): Promise<void>;
}) {
  const localInput = (time: string) =>
    `${localDate(time)}T${new Date(time).toTimeString().slice(0, 8)}`;
  const [label, setLabel] = useState(date?.label || "");
  const [time, setTime] = useState(date ? localInput(date.time) : "");
  const [category, setCategory] = useState(date?.category || "paper");
  const [kind, setKind] = useState(date?.kind || "submission");
  const [url, setUrl] = useState(date?.url || "");
  const [notes, setNotes] = useState(date?.notes || "");
  const [projectIds, setProjectIds] = useState(
    date ? linkedProjectIds(date) : [],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <form
        className="modal date-editor"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setError("");
          try {
            const instant = new Date(time).toISOString();
            const changed = !date || instant !== date.time;
            await save({
              ...date,
              id: date?.id || crypto.randomUUID(),
              label: label.trim(),
              subtitle: date?.subtitle || "",
              category,
              kind,
              time: instant,
              timezone: changed
                ? Intl.DateTimeFormat().resolvedOptions().timeZone
                : date.timezone,
              originalDate: changed ? undefined : date.originalDate,
              source: changed ? "manual" : date.source,
              sourceKey: changed ? undefined : date.sourceKey,
              status: date?.status || "notStarted",
              url: url.trim() || undefined,
              notes,
              projectId: undefined,
              projectIds,
            });
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setSaving(false);
          }
        }}
      >
        <button
          type="button"
          className="modal-close icon-button"
          title="Close date editor"
          onClick={close}
        >
          <X size={18} />
        </button>
        <div className="modal-icon">
          <CalendarDays size={23} />
        </div>
        <h2>{date ? "Edit date" : "Add a date"}</h2>
        <p className="modal-description">
          Keep a conference deadline or personal milestone in sight.
        </p>
        <label>
          Title
          <input
            autoFocus
            required
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <div className="form-row">
          <label>
            Category
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as DateCategory)}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Deadline type
            <select
              value={kind}
              onChange={(e) =>
                setKind(e.target.value as TrackedDeadline["kind"])
              }
            >
              {deadlineKinds.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.id === "submission" ? "Paper" : k.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Local date and time
          <input
            type="datetime-local"
            step="1"
            required
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
          <small>{Intl.DateTimeFormat().resolvedOptions().timeZone}</small>
        </label>
        <fieldset className="linked-project-choices">
          <legend>Linked projects</legend>
          <div>
            {state.projects.map((p) => (
              <label key={p.id}>
                <input
                  type="checkbox"
                  checked={projectIds.includes(p.id)}
                  onChange={(e) =>
                    setProjectIds((ids) =>
                      e.target.checked
                        ? [...ids, p.id]
                        : ids.filter((id) => id !== p.id),
                    )
                  }
                />
                {p.name}
              </label>
            ))}
          </div>
          <small>
            Select all projects sharing this date. Leave empty for a standalone
            date.
          </small>
        </fieldset>
        <label>
          Source URL
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
          />
        </label>
        <label>
          Notes
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button" onClick={close}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={saving || !label.trim() || !time}
          >
            {saving ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <Check size={14} />
            )}
            Save date
          </button>
        </div>
      </form>
    </div>
  );
}
