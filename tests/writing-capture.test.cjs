const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateCapture,
  createWritingCapture,
} = require("../electron/writing.cjs");
test("writing captures append to the current project and retries do not duplicate tasks or notes", async () => {
  const { applyWritingCapture } = await import("../src/writing-capture.ts");
  const source = {
    projects: [
      {
        id: "one",
        tasks: [{ id: "existing", text: "Check references", done: false }],
        notes: "Existing observation",
      },
      { id: "two", tasks: [], notes: "Other project" },
    ],
  };
  const capture = validateCapture({
    tasks: ["check references", " 改写摘要 ", "改写摘要"],
    note: "把贡献写清楚",
  });
  const saved = applyWritingCapture(source, "one", capture);
  assert.equal(saved.projects[0].tasks.length, 2);
  assert.equal(saved.projects[0].notes, "Existing observation\n\n把贡献写清楚");
  assert.deepEqual(saved.projects[1], source.projects[1]);
  const repeated = applyWritingCapture(saved, "one", capture);
  assert.deepEqual(repeated.projects[0].tasks, saved.projects[0].tasks);
  assert.equal(repeated.projects[0].notes, saved.projects[0].notes);
  assert.equal(source.projects[0].tasks.length, 1);
  assert.throws(
    () => applyWritingCapture(source, "missing", capture),
    /no longer exists/,
  );
  assert.throws(() => validateCapture({ tasks: [], note: "" }));
  assert.throws(() =>
    validateCapture({ tasks: ["x"], note: "", projectId: "other" }),
  );
});
test("writing tool reports success only after a confirmed save, and abort releases pending calls", async () => {
  let request;
  const broker = createWritingCapture((value) => {
    request = value;
  });
  const controller = new AbortController();
  const first = broker.request(
    "project",
    { tasks: ["Check citations"], note: "" },
    controller.signal,
  );
  assert.equal(request.projectId, "project");
  assert.equal(broker.complete("unknown", { saved: true }), false);
  broker.complete(request.id, { saved: true });
  assert.equal((await first).saved, true);
  const second = broker.request(
    "project",
    { tasks: [], note: "Not yet confirmed" },
    controller.signal,
  );
  const rejected = assert.rejects(second, /stopped/);
  controller.abort();
  await rejected;
  assert.equal(broker.complete(request.id, { saved: true }), false);
});
