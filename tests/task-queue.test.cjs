const test = require("node:test");
const assert = require("node:assert/strict");
const { createTaskQueue } = require("../electron/task-queue.cjs");

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
test("one queue preserves submission order while unrelated keys continue independently", async () => {
  const queue = createTaskQueue(),
    gate = deferred(),
    entered = deferred();
  const order = [];
  const first = queue(async () => {
    order.push("first started");
    entered.resolve();
    await gate.promise;
    order.push("first saved");
    return 1;
  }, "project-a");
  const second = queue(() => {
    order.push("second saved");
    return 2;
  }, "project-a");
  const third = queue(() => {
    order.push("third saved");
    return 3;
  }, "project-a");
  await entered.promise;
  assert.equal(
    await queue(() => "independent saved", "project-b"),
    "independent saved",
  );
  assert.deepEqual(order, ["first started"]);
  gate.resolve();
  assert.deepEqual(await Promise.all([first, second, third]), [1, 2, 3]);
  assert.deepEqual(order, [
    "first started",
    "first saved",
    "second saved",
    "third saved",
  ]);
});
test("a failed task rejects its caller and the next write still succeeds", async () => {
  const queue = createTaskQueue(),
    error = new Error("Cannot save fixture");
  const failed = queue(() => {
    throw error;
  });
  const later = queue(() => "saved after failure");
  await assert.rejects(failed, (caught) => caught === error);
  assert.equal(await later, "saved after failure");
  assert.equal(await queue(() => "new batch"), "new batch");
});
test("completed tasks cannot release a newer queued task or let subsequent work overtake it", async () => {
  const queue = createTaskQueue(),
    gate = deferred(),
    entered = deferred();
  const first = queue(() => "first", "project");
  const order = [];
  const second = queue(async () => {
    entered.resolve();
    await gate.promise;
    order.push("second");
  }, "project");
  await first;
  await entered.promise;
  const third = queue(() => {
    order.push("third");
  }, "project");
  await queue(() => {}, "unrelated");
  assert.deepEqual(order, []);
  gate.resolve();
  await Promise.all([second, third]);
  assert.deepEqual(order, ["second", "third"]);
});
test("settled waits for every queued key until the last task finishes", async () => {
  const queue = createTaskQueue(),
    gate = deferred();
  const slow = queue(() => gate.promise, "a");
  const failed = queue(() => {
    throw new Error("Cannot save fixture");
  }, "b");
  await assert.rejects(failed);
  let settled = false;
  const done = queue.settled().then(() => (settled = true));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  gate.resolve("saved");
  await done;
  assert.equal(await slow, "saved");
});
