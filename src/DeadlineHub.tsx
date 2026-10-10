import { useEffect, useMemo, useState } from "react";
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
  Milestone,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Trophy,
} from "lucide-react";
import type {
  Commit,
  CommitWithUndo,
  ConferenceFeed,
  DateCategory,
  Deadline,
  DeadlineFeedResult,
  DeadlineUpdate,
  TrackedDeadline,
  Workspace,
} from "./types";
import {
  linkedProjectIds,
  localDate,
  sourceTime,
  timeLabel,
  type DatedItem,
} from "./dates";
import Modal from "./Modal";
import { SearchField, Stat, Tabs } from "./components/ui";
import ProjectMilestones, {
  DateBlock,
  MilestoneEditor,
  Urgency,
  kindLabel,
  kindOptions,
} from "./ProjectMilestones";

const categories: { id: DateCategory; name: string; icon: typeof FileText }[] =
  [
    { id: "paper", name: "Paper", icon: FileText },
    { id: "funding", name: "Funding", icon: Landmark },
    { id: "award", name: "Award", icon: Trophy },
    { id: "service", name: "Service", icon: ShieldCheck },
    { id: "other", name: "Other", icon: CalendarDays },
  ];
const tabs = [
  { id: "tracked", label: "My dates", icon: CalendarDays },
  { id: "feed", label: "CCF conferences", icon: BookOpen },
  { id: "projects", label: "Project milestones", icon: Milestone },
];
const monthYear = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
});
// Read on use, so a date saved after the Mac changes zone records the new one.
const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const withDates =
  (fn: (list: TrackedDeadline[]) => TrackedDeadline[]) =>
  (s: Workspace): Workspace => ({
    ...s,
    trackedDeadlines: fn(s.trackedDeadlines),
  });
export default function DeadlineHub({
  state,
  items,
  now,
  commit,
  commitWithUndo,
  received,
  report,
  notify,
  openProject,
}: {
  state: Workspace;
  items: DatedItem[];
  now: number;
  commit: Commit;
  commitWithUndo: CommitWithUndo;
  received(state: Workspace): void;
  report(message: string, source?: string): void;
  notify(message: string): void;
  openProject(id: string): void;
}) {
  const [tab, setTab] = useState("tracked");
  const [category, setCategory] = useState("all");
  const [area, setArea] = useState("all");
  const [query, setQuery] = useState("");
  const [includePast, setIncludePast] = useState(false);
  const [feed, setFeed] = useState<ConferenceFeed>();
  const [updates, setUpdates] = useState<DeadlineUpdate[]>([]);
  const [busy, setBusy] = useState("");
  const [editing, setEditing] = useState<TrackedDeadline | null>();
  const [milestone, setMilestone] = useState<{
    projectId: string;
    milestone?: Deadline;
  }>();
  function result(d: DeadlineFeedResult) {
    setFeed(d.feed);
    setUpdates(d.updates);
  }
  useEffect(() => {
    void window
      .research!.deadlineFeed()
      .then(result)
      .catch((e) => report(e.message));
    return window.research!.onDeadlineFeed(result);
  }, [report]);
  useEffect(() => {
    let active = true;
    void window
      .research!.deadlineUpdates()
      .then((u) => active && setUpdates(u))
      .catch((e) => report(e.message));
    return () => {
      active = false;
    };
  }, [state.trackedDeadlines, report]);
  const dates = state.trackedDeadlines;
  const upcoming = items.filter((i) => i.upcoming);
  const projects = new Map(state.projects.map((p) => [p.id, p]));
  const linked = (d: TrackedDeadline) =>
    linkedProjectIds(d).flatMap((id) => projects.get(id) || []);
  const zone = localZone();
  const q = query.toLowerCase();
  const groups = new Map<string, TrackedDeadline[]>();
  const shown = tab === "tracked" ? [...dates] : [];
  shown.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  for (const d of shown) {
    const past = Date.parse(d.time) < now;
    if (
      (category !== "all" && category !== d.category) ||
      (past && !includePast) ||
      ![d.label, d.subtitle, d.conference, d.notes]
        .concat(linked(d).map((p) => p.name))
        .join(" ")
        .toLowerCase()
        .includes(q)
    )
      continue;
    const group = past ? "Past dates" : monthYear.format(new Date(d.time));
    groups.set(group, [...(groups.get(group) || []), d]);
  }
  const trackedKeys = new Set(dates.map((d) => d.sourceKey));
  const events = useMemo(
    () =>
      tab !== "feed" || !feed
        ? []
        : feed.conferences
            .flatMap((conf) =>
              conf.events.flatMap((event) => {
                const visible = event.dates.filter(
                  (d) => includePast || Date.parse(d.time) >= now,
                );
                const text = `${conf.title} ${conf.description} ${conf.id === "www" ? "The Web Conference " : ""}${event.year}`;
                return visible.length &&
                  (area === "all" || conf.area === area) &&
                  text.toLowerCase().includes(q)
                  ? [
                      {
                        conf,
                        event,
                        visible,
                        next: Math.min(
                          ...visible.map((d) => Date.parse(d.time)),
                        ),
                      },
                    ]
                  : [];
              }),
            )
            .sort((a, b) => a.next - b.next),
    [tab, feed, includePast, now, area, q],
  );
  const areas =
    tab === "feed"
      ? [...new Set(feed?.conferences.map((c) => c.area))]
          .sort()
          .map((a) => [a, a])
      : state.areas.map((a) => [a.id, a.name]);
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
  const track = (keys: string[]) =>
    action("track", async () => {
      received(await window.research!.trackConferenceDates(keys));
      notify("Conference dates added to your tracker.");
    });
  const accept = (ids: string[]) =>
    action("updates", async () => {
      received(await window.research!.acceptDeadlineUpdates(ids));
      notify("Conference date changes applied.");
    });
  function openTab(next: string) {
    setTab(next);
    setQuery("");
    setArea("all");
  }
  return (
    <div className="deadline-hub">
      <div className="stats-grid">
        <Stat
          icon={<CalendarDays size={18} />}
          label="Upcoming dates"
          number={upcoming.length}
        />
        <Stat
          icon={<FileText size={18} />}
          label="Paper deadlines"
          number={upcoming.filter((i) => i.category === "paper").length}
        />
      </div>
      <div className="deadline-hub-nav">
        <Tabs
          label="Deadline views"
          panel="date-panel"
          active={tab}
          select={openTab}
          tabs={tabs.map(({ id, label, icon: Icon }) => ({
            id,
            label: (
              <>
                <Icon size={15} />
                {label}
              </>
            ),
          }))}
        />
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
          {tab === "projects" ? (
            <button
              className="button primary"
              disabled={!state.projects.length}
              onClick={() => setMilestone({ projectId: "" })}
            >
              <Plus size={14} />
              Add milestone
            </button>
          ) : (
            <button className="button primary" onClick={() => setEditing(null)}>
              <Plus size={14} />
              Add date
            </button>
          )}
        </div>
      </div>
      <div
        role="tabpanel"
        id="date-panel"
        aria-labelledby={`date-panel-${tab}`}
      >
        {tab !== "projects" && (
          <>
            <div className="date-feed-status">
              <span className={feed?.error ? "feed-offline" : "feed-ready"}>
                <i />
                {busy === "refresh"
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
                disabled={!!busy}
                onClick={() =>
                  void action("refresh", async () => {
                    const next = await window.research!.refreshDeadlineFeed();
                    result(next);
                    if (!next.feed.error)
                      notify("CCF Deadlines is up to date.");
                  })
                }
              >
                <RefreshCw
                  size={13}
                  className={busy === "refresh" ? "spin" : ""}
                />
                {busy === "refresh" ? "Refreshing…" : "Refresh feed"}
              </button>
            </div>
            {feed?.error && (
              <p className="feed-error" role="status">
                {feed.error}
              </p>
            )}
          </>
        )}
        {updates.length > 0 && tab === "tracked" && (
          <section className="feed-changes">
            <div className="section-heading">
              <h2>
                <BellRing size={16} />
                Conference date changes
              </h2>
              <button
                className="button small"
                disabled={!!busy}
                onClick={() => void accept(updates.map((u) => u.id))}
              >
                Apply all changes
              </button>
            </div>
            {updates.map((u) => (
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
                  onClick={() => void accept([u.id])}
                >
                  Update date
                </button>
              </div>
            ))}
          </section>
        )}
        <div className="date-filters">
          {tab === "tracked" ? (
            <div className="date-category-tabs">
              {[{ id: "all", name: "All", icon: null }, ...categories].map(
                ({ id, name, icon: Glyph }) => (
                  <button
                    key={id}
                    aria-pressed={category === id}
                    className={`${category === id ? "active" : ""} date-category-${id}`}
                    onClick={() => setCategory(id)}
                  >
                    {Glyph && <Glyph size={14} />}
                    {name}
                  </button>
                ),
              )}
            </div>
          ) : (
            <select
              aria-label={tab === "feed" ? "Conference area" : "Research area"}
              value={area}
              onChange={(e) => setArea(e.target.value)}
            >
              <option value="all">
                {tab === "feed" ? "All conference areas" : "All research areas"}
              </option>
              {areas.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          )}
          <SearchField
            label={
              tab === "feed" ? "Search CCF conferences" : "Search deadlines"
            }
            placeholder={
              tab === "feed"
                ? "Conference, e.g. WWW or SIGMETRICS"
                : "Search your deadlines…"
            }
            value={query}
            onChange={setQuery}
          />
          <label className="date-past-toggle">
            <input
              type="checkbox"
              checked={includePast}
              onChange={(e) => setIncludePast(e.target.checked)}
            />
            Include past
          </label>
        </div>
        {tab === "tracked" && (
          <div className="tracked-date-list">
            {[...groups].map(([group, rows]) => (
              <section className="date-month" key={group}>
                <h2>
                  {group}
                  <span>{rows.length}</span>
                </h2>
                {rows.map((d) => {
                  const Glyph = categories.find(
                    (c) => c.id === d.category,
                  )!.icon;
                  const note =
                    d.category === "paper"
                      ? d.subtitle.replace(
                          /^research paper(\s*[-—:·]\s*|$)/i,
                          "",
                        )
                      : d.subtitle;
                  return (
                    <article
                      className={`tracked-date-row date-category-${d.category}${d.status === "finished" ? " date-finished" : ""}`}
                      key={d.id}
                    >
                      <DateBlock time={d.time} />
                      <div className="tracked-date-copy">
                        <div className="tracked-date-title">
                          <button onClick={() => setEditing(d)}>
                            {d.label}
                          </button>
                          <span className={`date-kind kind-${d.kind}`}>
                            <Glyph size={11} />
                            {kindLabel(d.kind)}
                          </span>
                        </div>
                        <p className="date-time-detail">
                          <span>{timeLabel(d.time)}</span>
                          {d.timezone !== "UTC" && d.timezone !== zone && (
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
                          {note && <span>{note}</span>}
                          {linked(d).map((p) => (
                            <button
                              key={p.id}
                              className="date-project-link"
                              onClick={() => openProject(p.id)}
                            >
                              {p.name}
                              <ChevronRight size={12} />
                            </button>
                          ))}
                        </p>
                      </div>
                      <Urgency
                        time={d.time}
                        now={now}
                        done={d.status === "finished"}
                      />
                      <select
                        aria-label={`Status for ${d.label}`}
                        className={`date-status status-${d.status}`}
                        value={d.status}
                        onChange={(e) => {
                          const status = e.target
                            .value as TrackedDeadline["status"];
                          void commit(
                            withDates((list) =>
                              list.map((item) =>
                                item.id === d.id ? { ...item, status } : item,
                              ),
                            ),
                          );
                        }}
                      >
                        <option value="notStarted">Not started</option>
                        <option value="ongoing">In progress</option>
                        <option value="finished">Finished</option>
                      </select>
                      <div className="date-row-tools">
                        <button
                          className="icon-button"
                          title={`Edit ${d.label}`}
                          onClick={() => setEditing(d)}
                        >
                          <Pencil size={14} />
                        </button>
                        {d.url ? (
                          <button
                            className="icon-button"
                            title={`Open source for ${d.label}`}
                            onClick={() =>
                              void window.research!.openLink(d.url!)
                            }
                          >
                            <ExternalLink size={14} />
                          </button>
                        ) : (
                          <span />
                        )}
                        <button
                          className="icon-button"
                          title={`Remove ${d.label}`}
                          onClick={() =>
                            void commitWithUndo(
                              `Removed “${d.label}”`,
                              withDates((list) =>
                                list.filter((item) => item.id !== d.id),
                              ),
                            )
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
            {!groups.size && (
              <div className="dates-empty">
                <CalendarDays size={30} />
                <h3>{query ? "No matching dates" : "No dates in this view"}</h3>
                <p>
                  Browse CCF conferences to track a deadline, or add your own
                  date.
                </p>
                <button className="button" onClick={() => openTab("feed")}>
                  Browse conferences
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </div>
        )}
        {tab === "feed" && (
          <div className="conference-browser">
            {events.map(({ conf, event, visible }) => {
              const untracked = visible.filter(
                (d) => !trackedKeys.has(d.sourceKey),
              );
              return (
                <article
                  className="conference-card"
                  key={`${conf.id}-${event.id}`}
                >
                  <div className="conference-heading">
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
                        <Plus size={14} />
                      ) : (
                        <Check size={14} />
                      )}
                      {untracked.length ? "Track upcoming" : "Tracked"}
                    </button>
                    {event.url && (
                      <button
                        className="icon-button"
                        title={`Open ${event.name} website`}
                        onClick={() =>
                          void window.research!.openLink(event.url!)
                        }
                      >
                        <ExternalLink size={14} />
                      </button>
                    )}
                  </div>
                  <div className="conference-dates">
                    {visible.map((d) => {
                      const tracked = trackedKeys.has(d.sourceKey);
                      return (
                        <div className="conference-date" key={d.id}>
                          <div>
                            <span className={`date-kind kind-${d.kind}`}>
                              {kindLabel(d.kind)}
                            </span>
                            <small>
                              {d.subtitle || `Round ${d.round! + 1}`}
                            </small>
                          </div>
                          <div>
                            <strong>{timeLabel(d.time)}</strong>
                            <span>{sourceTime(d)}</span>
                          </div>
                          <Urgency time={d.time} now={now} />
                          <button
                            className={`button small ${tracked ? "date-tracked" : ""}`}
                            aria-label={`${tracked ? "Tracked" : "Track"} ${d.label} ${d.subtitle}`}
                            disabled={!!busy || tracked}
                            onClick={() => void track([d.sourceKey!])}
                          >
                            {tracked ? (
                              <CheckCircle2 size={14} />
                            ) : (
                              <Plus size={14} />
                            )}
                            {tracked ? "Tracked" : "Track"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </article>
              );
            })}
            {!events.length && (
              <div className="dates-empty">
                <Search size={28} />
                <h3>
                  {feed ? "No conferences match" : "Loading conferences…"}
                </h3>
                {feed && (
                  <p>Try another conference name or refresh the feed.</p>
                )}
              </div>
            )}
          </div>
        )}
        {tab === "projects" && (
          <ProjectMilestones
            state={state}
            items={items}
            area={area}
            query={query}
            includePast={includePast}
            now={now}
            commitWithUndo={commitWithUndo}
            openProject={openProject}
            onEdit={(item, project) =>
              item.trackedId
                ? setEditing(dates.find((d) => d.id === item.trackedId))
                : setMilestone({
                    projectId: project.id,
                    milestone: project.deadlines.find(
                      (d) => d.id === item.deadlineId,
                    ),
                  })
            }
          />
        )}
      </div>
      <p className="date-hub-footer">
        <Clock3 size={13} />
        Countdowns use the exact deadline time; a project milestone is due at
        the end of its day. Local times use {zone}. AoE means UTC−12.
      </p>
      {editing !== undefined && (
        <DateEditor
          date={editing}
          state={state}
          commit={commit}
          close={() => setEditing(undefined)}
        />
      )}
      {milestone && (
        <MilestoneEditor
          projects={state.projects}
          {...milestone}
          commit={commit}
          close={() => setMilestone(undefined)}
        />
      )}
    </div>
  );
}

export function DateEditor({
  date,
  state,
  commit,
  close,
}: {
  date: TrackedDeadline | null;
  state: Workspace;
  commit: Commit;
  close(): void;
}) {
  const [label, setLabel] = useState(date?.label || "");
  const [time, setTime] = useState(
    date
      ? `${localDate(date.time)}T${new Date(date.time).toTimeString().slice(0, 8)}`
      : "",
  );
  const [category, setCategory] = useState(date?.category || "paper");
  const [kind, setKind] = useState(date?.kind || "submission");
  const [url, setUrl] = useState(date?.url || "");
  const [notes, setNotes] = useState(date?.notes || "");
  const [projectIds, setProjectIds] = useState(
    date ? linkedProjectIds(date) : [],
  );
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <Modal
      title={date ? "Edit date" : "Add a date"}
      className="date-editor"
      onClose={close}
      locked={saving}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          const instant = new Date(time).toISOString();
          const changed = !date || instant !== date.time;
          const next: TrackedDeadline = {
            ...date,
            id: date?.id || crypto.randomUUID(),
            label: label.trim(),
            subtitle: date?.subtitle || "",
            category,
            kind,
            time: instant,
            timezone: changed ? localZone() : date.timezone,
            originalDate: changed ? undefined : date.originalDate,
            source: changed ? "manual" : date.source,
            sourceKey: changed ? undefined : date.sourceKey,
            status: date?.status || "notStarted",
            url: url.trim() || undefined,
            notes,
            projectId: undefined,
            projectIds,
          };
          const saved = await commit(
            withDates((list) =>
              date
                ? list.map((d) => (d.id === next.id ? next : d))
                : [...list, next],
            ),
          );
          setSaving(false);
          if (saved) close();
        }}
      >
        <label>
          Title
          <input
            required
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <div className="form-grid">
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
              {kindOptions}
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
          <small>{localZone()}</small>
        </label>
        <fieldset className="linked-project-choices">
          <legend>Linked projects</legend>
          <input
            type="search"
            aria-label="Filter projects"
            placeholder="Filter projects…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div>
            {state.projects
              .filter(
                (p) =>
                  projectIds.includes(p.id) ||
                  p.name.toLowerCase().includes(filter.toLowerCase()),
              )
              .map((p) => (
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
          <small>Leave empty for a standalone date.</small>
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
        <div className="modal-actions">
          <button
            className="button primary"
            disabled={saving || !label.trim() || !time}
          >
            <Check size={14} />
            Save date
          </button>
        </div>
      </form>
    </Modal>
  );
}
