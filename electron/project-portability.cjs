const crypto = require("node:crypto");
const { validateState } = require("./core.cjs");

const projectFields = [
  "name",
  "summary",
  "stage",
  "mainFile",
  "venue",
  "notes",
  "updatedAt",
  "owner",
  "lastReviewedCommit",
  "lastSubstantiveUpdate",
  "latexEngine",
  "pageLimit",
  "anonymousReview",
  "compileOnSave",
];
const pick = (value, fields) =>
  Object.fromEntries(
    fields
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, value[key]]),
  );
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
const list = (value, name) => {
  if (!Array.isArray(value)) throw new Error(`Invalid ${name}.`);
  if (value.some((entry) => !object(entry)))
    throw new Error(`Invalid ${name}.`);
  return value;
};
function publicUrl(value) {
  if (value === undefined || value === "") return value;
  if (typeof value !== "string") throw new Error("Invalid source URL.");
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol))
    throw new Error("Source links must use HTTP or HTTPS.");
  if (
    url.username ||
    url.password ||
    [...url.searchParams.keys()].some((key) =>
      /^(token|access_token|api_key|apikey|password|secret|signature)$/i.test(
        key,
      ),
    )
  )
    return undefined;
  return url.href;
}
function safeLinks(value) {
  const result = { ...value };
  for (const key of ["url", "sourceUrl"]) {
    if (!(key in result)) continue;
    const url = publicUrl(result[key]);
    if (url === undefined) delete result[key];
    else result[key] = url;
  }
  return result;
}
function portableProject(project) {
  if (!object(project)) throw new Error("Invalid project manifest.");
  return {
    ...pick(project, projectFields),
    tasks: list(project.tasks, "tasks").map((task) =>
      pick(task, [
        "id",
        "text",
        "done",
        "pinned",
        "blocked",
        "assignee",
        "dueDate",
      ]),
    ),
    deadlines: list(project.deadlines, "deadlines").map((date) =>
      safeLinks(pick(date, ["id", "label", "date", "kind", "url"])),
    ),
    ...(project.reviewRequests === undefined
      ? {}
      : {
          reviewRequests: list(project.reviewRequests, "review requests").map(
            (review) =>
              pick(review, [
                "id",
                "title",
                "requestedAt",
                "status",
                "revision",
                "reviewedAt",
                "reviewedRevision",
              ]),
          ),
        }),
    ...(project.decisions === undefined
      ? {}
      : {
          decisions: list(project.decisions, "decisions").map((decision) =>
            pick(decision, ["id", "text", "createdAt", "revision"]),
          ),
        }),
  };
}
function portableDate(date) {
  return safeLinks(
    pick(date, [
      "id",
      "label",
      "subtitle",
      "category",
      "kind",
      "time",
      "timezone",
      "originalDate",
      "status",
      "notes",
      "url",
      "source",
      "sourceKey",
      "sourceUrl",
      "conference",
      "eventId",
      "round",
    ]),
  );
}
function validateProjectManifest(input) {
  if (
    !object(input) ||
    input.format !== "research-workbench-project" ||
    input.version !== 1 ||
    !object(input.area) ||
    typeof input.exportedAt !== "string" ||
    !Number.isFinite(Date.parse(input.exportedAt))
  )
    throw new Error(
      "Expected a version 1 Research Workbench project manifest.",
    );
  const project = portableProject(input.project);
  if (
    typeof project.mainFile !== "string" ||
    (project.mainFile &&
      (project.mainFile.startsWith("/") ||
        /^[a-z]:/i.test(project.mainFile) ||
        project.mainFile.includes("\\") ||
        project.mainFile
          .split("/")
          .some((part) => !part || part === "." || part === "..")))
  )
    throw new Error(
      "The manuscript entry file must be a relative project path.",
    );
  if (
    typeof project.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(project.updatedAt))
  )
    throw new Error("Invalid project update time.");
  const area = pick(input.area, ["name", "color", "icon"]);
  if (typeof area.icon !== "string" || area.icon.length > 100)
    throw new Error("Invalid research area icon.");
  const trackedDeadlines = list(
    input.trackedDeadlines || [],
    "tracked deadlines",
  ).map(portableDate);
  validateState({
    version: 1,
    areas: [{ id: "manifest", ...area }],
    projects: [
      {
        ...project,
        id: "manifest",
        areaId: "manifest",
        folder: "",
        sshHost: "",
      },
    ],
    trackedDeadlines,
  });
  return {
    format: "research-workbench-project",
    version: 1,
    exportedAt: input.exportedAt,
    area,
    project,
    trackedDeadlines,
  };
}
function makeProjectManifest(workspace, id) {
  validateState(workspace);
  const project = workspace.projects.find((item) => item.id === id);
  if (!project) throw new Error("Project no longer exists.");
  const area = workspace.areas.find((item) => item.id === project.areaId);
  return validateProjectManifest({
    format: "research-workbench-project",
    version: 1,
    exportedAt: new Date().toISOString(),
    area,
    project,
    trackedDeadlines: (workspace.trackedDeadlines || []).filter(
      (date) => date.projectId === id || date.projectIds?.includes(id),
    ),
  });
}
function importProjectManifest(workspace, input, { areaId, name } = {}) {
  validateState(workspace);
  const manifest = validateProjectManifest(input);
  const areas = workspace.areas.map((area) => ({ ...area }));
  let area = areaId
    ? areas.find((item) => item.id === areaId)
    : areas.find((item) => item.name === manifest.area.name);
  if (areaId && !area) throw new Error("Choose an existing research area.");
  if (!area) {
    area = { ...manifest.area, id: crypto.randomUUID() };
    areas.push(area);
  }
  const project = {
    ...manifest.project,
    id: crypto.randomUUID(),
    areaId: area.id,
    folder: "",
    sshHost: "",
    ...(name === undefined ? {} : { name }),
    tasks: manifest.project.tasks.map((item) => ({
      ...item,
      id: crypto.randomUUID(),
    })),
    deadlines: manifest.project.deadlines.map((item) => ({
      ...item,
      id: crypto.randomUUID(),
    })),
    ...(manifest.project.reviewRequests
      ? {
          reviewRequests: manifest.project.reviewRequests.map((item) => ({
            ...item,
            id: crypto.randomUUID(),
          })),
        }
      : {}),
    ...(manifest.project.decisions
      ? {
          decisions: manifest.project.decisions.map((item) => ({
            ...item,
            id: crypto.randomUUID(),
          })),
        }
      : {}),
  };
  const next = validateState({
    ...workspace,
    areas,
    projects: [...workspace.projects, project],
    trackedDeadlines: [
      ...(workspace.trackedDeadlines || []),
      ...manifest.trackedDeadlines.map((date) => ({
        ...date,
        id: crypto.randomUUID(),
        projectIds: [project.id],
      })),
    ],
  });
  return { workspace: next, project };
}

const escapeText = (text) =>
  String(text)
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
const utc = (time) =>
  new Date(time)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
// RFC 5545 lines fold at 75 octets, including the continuation space.
function fold(line) {
  const lines = [];
  let current = "",
    bytes = 0;
  for (const character of line) {
    const size = Buffer.byteLength(character);
    if (bytes + size > 75) {
      lines.push(current);
      current = " ";
      bytes = 1;
    }
    current += character;
    bytes += size;
  }
  lines.push(current);
  return lines.join("\r\n");
}
function exportCalendar(
  workspace,
  { projectId, now = new Date().toISOString() } = {},
) {
  validateState(workspace);
  if (
    projectId &&
    !workspace.projects.some((project) => project.id === projectId)
  )
    throw new Error("Project no longer exists.");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Research Workbench//Research Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  const event = ({
    key,
    title,
    date,
    time,
    description = "",
    url,
    done = false,
  }) => {
    const uid = crypto.createHash("sha256").update(key).digest("hex");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid}@research-workbench`,
      `DTSTAMP:${utc(now)}`,
    );
    if (date) {
      const end = new Date(`${date}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() + 1);
      lines.push(
        `DTSTART;VALUE=DATE:${date.replace(/-/g, "")}`,
        `DTEND;VALUE=DATE:${end.toISOString().slice(0, 10).replace(/-/g, "")}`,
      );
    } else lines.push(`DTSTART:${utc(time)}`);
    lines.push(
      `SUMMARY:${escapeText(title)}`,
      `DESCRIPTION:${escapeText(description)}`,
    );
    if (url && publicUrl(url)) lines.push(`URL:${publicUrl(url)}`);
    if (done) lines.push("STATUS:CONFIRMED", "TRANSP:TRANSPARENT");
    lines.push("END:VEVENT");
  };
  for (const project of workspace.projects.filter(
    (item) => !projectId || item.id === projectId,
  )) {
    for (const date of project.deadlines)
      event({
        key: `milestone:${project.id}:${date.id}`,
        title: `${project.name}: ${date.label}`,
        date: date.date,
        description: date.kind,
        url: date.url,
      });
    for (const task of project.tasks.filter(
      (item) => item.dueDate && !item.done,
    ))
      event({
        key: `task:${project.id}:${task.id}`,
        title: `${project.name}: ${task.text}`,
        date: task.dueDate,
        description: [
          task.assignee && `Assignee: ${task.assignee}`,
          task.blocked && `Blocked: ${task.blocked}`,
        ]
          .filter(Boolean)
          .join("\n"),
      });
  }
  for (const date of workspace.trackedDeadlines || []) {
    const ids = [
      ...new Set([
        ...(date.projectIds || []),
        ...(date.projectId ? [date.projectId] : []),
      ]),
    ];
    if (projectId && !ids.includes(projectId)) continue;
    const names = workspace.projects
      .filter((project) => ids.includes(project.id))
      .map((project) => project.name);
    event({
      key: `tracked:${date.id}`,
      title: date.label,
      time: date.time,
      url: date.url || date.sourceUrl,
      done: date.status === "finished",
      description: [
        date.subtitle,
        names.join(", "),
        `Source timezone: ${date.timezone}`,
        date.originalDate && `Source date: ${date.originalDate}`,
        date.notes,
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
module.exports = {
  makeProjectManifest,
  validateProjectManifest,
  importProjectManifest,
  exportCalendar,
};
