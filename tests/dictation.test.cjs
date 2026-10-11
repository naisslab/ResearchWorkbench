const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { createDictation } = require("../electron/dictation.cjs");

function fixture(t) {
  const events = [],
    children = [];
  const dictation = createDictation({
    executable: "fixture",
    platform: "darwin",
    emit: (value) => events.push(value),
    spawnProcess: () => {
      const proc = new EventEmitter();
      Object.assign(proc, {
        stdout: new PassThrough(),
        stdin: new PassThrough(),
        stderr: new PassThrough(),
        killed: false,
        kill() {
          this.killed = true;
        },
      });
      children.push(proc);
      return proc;
    },
  });
  t.after(() => dictation.cancel());
  return { dictation, events, children };
}
test("dictation preserves split UTF-8, finishes once and ignores stale child output", (t) => {
  const f = fixture(t);
  f.dictation.start("first", "zh-CN");
  const bytes = Buffer.from(
    JSON.stringify({ type: "partial", text: "添加待办：修改摘要" }) + "\n",
  );
  const split = bytes.indexOf(Buffer.from("添加")) + 1;
  f.children[0].stdout.write(bytes.subarray(0, split));
  f.children[0].stdout.write(bytes.subarray(split));
  assert.equal(f.events[0].text, "添加待办：修改摘要");
  f.children[0].stdout.write(
    JSON.stringify({ type: "final", text: "修改摘要" }) + "\n",
  );
  f.children[0].emit("close");
  assert.equal(f.events.length, 2);
  assert.equal(f.children[0].killed, true);
  f.dictation.start("second", "en-US");
  f.children[0].stdout.write('{"type":"final","text":"stale"}\n');
  f.dictation.cancel("first");
  assert.equal(f.children[1].killed, false);
  f.dictation.stop("second");
  assert.equal(f.children[1].stdin.read().toString(), "stop\n");
});
test("cancel and process failure release the microphone session without inventing text", (t) => {
  const f = fixture(t);
  assert.throws(() => f.dictation.start("x", "unknown"), /language/);
  f.dictation.start("x", "en-US");
  assert.throws(() => f.dictation.start("y", "en-US"), /Finish/);
  f.dictation.cancel("x");
  assert.deepEqual(f.events[0], { id: "x", type: "cancelled", text: "" });
  f.dictation.start("y", "en-US");
  f.children[1].emit("error", new Error("spawn failed"));
  assert.equal(f.events[1].type, "error");
  f.dictation.start("z", "en-US");
});
