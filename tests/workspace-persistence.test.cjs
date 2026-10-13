const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createWorkspacePersistence,
} = require("../electron/workspace-persistence.cjs");

test("failed workspace writes preserve authoritative memory and later transforms use the committed state", async () => {
  let state = { value: 0 },
    fail = true;
  const persisted = [];
  const store = createWorkspacePersistence({
    read: () => state,
    validate: (x) => x,
    persist: async (next) => {
      if (fail) throw new Error("Disk full");
      persisted.push(next);
    },
    commit: (next) => {
      state = next;
    },
  });
  await assert.rejects(store.replace({ value: 1 }), /Disk full/);
  assert.deepEqual(state, { value: 0 });
  fail = false;
  await store.update((latest) => ({ value: latest.value + 2 }));
  assert.deepEqual(state, { value: 2 });
  assert.deepEqual(persisted, [{ value: 2 }]);
});
test("queued saves persist their own immutable snapshot and acknowledge only after persistence", async () => {
  let state = { value: 0 },
    release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const writes = [];
  const store = createWorkspacePersistence({
    read: () => state,
    validate: (x) => x,
    persist: async (next) => {
      if (next.value === 1) await gate;
      writes.push(next.value);
    },
    commit: (next) => {
      state = next;
    },
  });
  const input = { value: 1 },
    first = store.replace(input);
  input.value = 99;
  const second = store.update((latest) => ({ value: latest.value + 1 }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.value, 0);
  release();
  assert.deepEqual(await first, { value: 1 });
  assert.deepEqual(await second, { value: 2 });
  assert.deepEqual(writes, [1, 2]);
});
