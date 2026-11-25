// Verifies the pane state herdr-subagent-busy.ts reports for background
// subagents. The ordering matters: herdr keeps the highest seq, and the managed
// herdr integration reports "idle" from the same agent_settled we override.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const here = path.dirname(new URL(import.meta.url).pathname);
const extension = pathToFileURL(
  path.resolve(here, "../../dot_pi/agent/extensions/herdr-subagent-busy.ts"),
).href;

const socketDir = mkdtempSync(path.join(tmpdir(), "herdr-subagent-busy-"));
const socketPath = path.join(socketDir, "herdr.sock");
const requests = [];
const server = net.createServer((socket) => {
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk.toString();
    for (let index = buffer.indexOf("\n"); index >= 0; index = buffer.indexOf("\n")) {
      requests.push(JSON.parse(buffer.slice(0, index)));
      buffer = buffer.slice(index + 1);
    }
    socket.end("{}\n");
  });
});
await new Promise((resolve) => server.listen(socketPath, resolve));

function harness() {
  const handlers = new Map();
  const eventHandlers = new Map();
  return {
    pi: {
      on: (name, handler) => handlers.set(name, handler),
      events: {
        on: (name, handler) => eventHandlers.set(name, [...(eventHandlers.get(name) ?? []), handler]),
      },
    },
    fire: async (name, ...args) => handlers.get(name)?.(...args),
    emit: (name, data) => {
      for (const handler of eventHandlers.get(name) ?? []) handler(data);
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 60));
const states = () => requests.map((request) => request.params.state);

process.env.HERDR_SOCKET_PATH = socketPath;
process.env.HERDR_PANE_ID = "pane-1";
// The test runner may itself be inside herdr-core; select each transport explicitly.
delete process.env.HC_TERMINAL_ID;
delete process.env.PI_PROGRAM_STATUS;

// Outside herdr the extension must stay inert: no socket, no traffic.
process.env.HERDR_ENV = "0";
const inert = await import(`${extension}?inert`);
const inertHarness = harness();
inert.default(inertHarness.pi);
await inertHarness.fire("session_start", {}, { mode: "tui" });
inertHarness.emit("subagents:started", { id: "a1" });
await flush();
assert.deepEqual(requests, [], "no herdr env means the extension reports nothing");

process.env.HERDR_ENV = "1";
const { default: install } = await import(`${extension}?enabled`);

// A background child claims the pane, survives the parent settling, and hands
// the pane back when it finishes.
const busy = harness();
install(busy.pi);
await busy.fire("session_start", {}, { mode: "tui" });
busy.emit("subagents:started", { id: "a1", type: "general-purpose" });
await flush();
assert.deepEqual(states(), ["working"], "a started subagent claims the pane");

await busy.fire("agent_settled", {}, { isIdle: () => true });
await flush();
assert.deepEqual(
  states(),
  ["working", "working"],
  "settling with a child in flight re-claims the pane the managed integration just idled",
);

busy.emit("subagents:completed", { id: "a1" });
await flush();
assert.deepEqual(states(), ["working", "working", "idle"], "the last child hands the pane back");

const [first, second, third] = requests;
assert.deepEqual(second.params.pane_id, "pane-1");
assert.equal(second.params.agent, "pi");
assert.equal(second.params.source, "herdr:pi");
assert.ok(second.params.seq > first.params.seq, "the re-claim outranks the claim it replaces");
assert.ok(third.params.seq > second.params.seq, "the release outranks the claim it replaces");

// A child that finishes while the parent runs keeps the pane busy: the managed
// integration is already reporting that run, so only the claim belongs to us.
const busyParent = harness();
install(busyParent.pi);
await busyParent.fire("session_start", {}, { mode: "tui" });
await busyParent.fire("agent_start", {});
const runningMark = requests.length;
busyParent.emit("subagents:started", { id: "b1" });
await flush();
busyParent.emit("subagents:completed", { id: "b1" });
await flush();
assert.deepEqual(
  states().slice(runningMark),
  [],
  "the parent owns its status while running; child events must not overwrite it",
);

// A dialog waiting for input outranks a running child: repainting the pane
// working would hide that pi needs the user.
const blocked = harness();
install(blocked.pi);
await blocked.fire("session_start", {}, { mode: "tui" });
blocked.emit("herdr:blocked", { active: true, label: "Approve?" });
const blockedMark = requests.length;
blocked.emit("subagents:started", { id: "d1" });
await flush();
assert.deepEqual(states().slice(blockedMark), [], "a blocked pane is not repainted as working");
blocked.emit("herdr:blocked", { active: false });
await flush();
assert.deepEqual(
  states().slice(blockedMark),
  ["working"],
  "closing the dialog hands the pane back to the child",
);

// Headless sessions own no pane: nothing may be reported for them.
const headless = harness();
install(headless.pi);
await headless.fire("session_start", {}, { mode: "rpc" });
const headlessMark = requests.length;
headless.emit("subagents:started", { id: "c1" });
await flush();
assert.equal(states().length, headlessMark, "a headless session reports nothing");

// Core receives OSC 7501 instead of the legacy socket API. Capture terminal
// writes so this regression check never changes the runner's real status.
process.env.HERDR_ENV = "0";
process.env.HC_TERMINAL_ID = "t-test";
const osc = [];
const write = process.stdout.write;
const capture = (chunk) => {
  osc.push(String(chunk));
  return true;
};
process.stdout.write = capture;
const coreStates = () => osc.map((chunk) => {
  assert.match(chunk, /^\x1b\]7501;state=(working|done|idle|error):app=pi(?::msg=[A-Za-z0-9+/=]+)?\x1b\\$/);
  return chunk.match(/state=([^:]+)/)[1];
});
try {
  const { default: installCore } = await import(`${extension}?core`);
  const core = harness();
  installCore(core.pi);
  await core.fire("session_start", {}, { mode: "tui", isIdle: () => true });
  core.emit("subagents:started", { id: "core-a" });
  await flush();
  assert.deepEqual(coreStates(), ["working"], "core reports a child working while the parent is idle");

  const settleMark = osc.length;
  await core.fire("agent_settled", { aborted: false }, { isIdle: () => true });
  await flush(); // Another Pi extension can delay the native report past our timer.
  assert.deepEqual(coreStates().slice(settleMark), ["working"]);
  const nativeDone = "\x1b]7501;state=done:app=pi:msg=UmVwbHk=\x1b\\";
  process.stdout.write(nativeDone);
  assert.equal(coreStates().at(-1), "working", "a late native settle report cannot take status back from a running child");
  const nativeBlocked = "\x1b]7501;state=blocked:app=pi:kind=confirm\x1b\\";
  for (const chunk of [nativeBlocked, `ordinary output${nativeDone}`]) {
    assert.equal(process.stdout.write(chunk), true);
    assert.equal(osc.pop(), chunk, "blocked status and ordinary terminal output pass through unchanged");
  }
  core.emit("subagents:completed", { id: "core-a" });
  await flush();
  assert.equal(osc.at(-1), nativeDone, "child completion restores the exact native report");
  core.emit("subagents:started", { id: "core-a" });
  await flush();

  await core.fire("agent_start", {});
  const parentMark = osc.length;
  core.emit("subagents:started", { id: "core-b" });
  core.emit("subagents:completed", { id: "core-a" });
  await flush();
  assert.equal(osc.length, parentMark, "new messages hand status control back to the active parent");

  await core.fire("ui_prompt_start", {});
  core.emit("subagents:started", { id: "core-c" });
  await flush();
  assert.equal(osc.length, parentMark, "a main-agent input request takes precedence over children");
  await core.fire("ui_prompt_end", {});
  await flush();
  assert.equal(osc.length, parentMark, "closing a dialog does not override a still-active parent");

  const replyMark = osc.length;
  await core.fire("agent_settled", { aborted: false }, { isIdle: () => true });
  process.stdout.write("\x1b]7501;state=done:app=pi\x1b\\");
  await flush();
  assert.deepEqual(coreStates().slice(replyMark), ["working", "working"], "children keep working after the main's reply");
  const childrenMark = osc.length;
  core.emit("subagents:completed", { id: "core-b" });
  await flush();
  assert.equal(osc.length, childrenMark, "one remaining child keeps core busy");
  core.emit("subagents:failed", { id: "core-c" });
  await flush();
  assert.equal(coreStates().at(-1), "done", "the last failed or completed child restores the parent's done status");
  await core.fire("session_shutdown", {});
  assert.equal(process.stdout.write, capture, "shutdown restores the original terminal writer");

  // Deferred writes must re-check priority: a dialog or new main run can
  // start between the lifecycle event and the scheduled terminal write.
  const race = harness();
  installCore(race.pi);
  await race.fire("session_start", {}, { mode: "tui" });
  const raceMark = osc.length;
  race.emit("subagents:started", { id: "race" });
  await race.fire("ui_prompt_start", {});
  await flush();
  assert.equal(osc.length, raceMark, "a queued busy report cannot overwrite a newly opened dialog");
  await race.fire("ui_prompt_end", {});
  await flush();
  assert.equal(coreStates().at(-1), "working", "closing an idle parent's dialog returns status to its child");
  race.emit("subagents:completed", { id: "race" });
  await race.fire("agent_start", {});
  const resumeMark = osc.length;
  await flush();
  assert.equal(osc.length, resumeMark, "a queued release cannot overwrite a newly active parent");

  const pendingClaim = harness();
  installCore(pendingClaim.pi);
  await pendingClaim.fire("session_start", {}, { mode: "tui" });
  const claimMark = osc.length;
  pendingClaim.emit("subagents:started", { id: "pending-claim" });
  await pendingClaim.fire("agent_start", {});
  await flush();
  assert.equal(osc.length, claimMark, "a queued claim cannot overwrite a newly active parent");

  const compacting = harness();
  installCore(compacting.pi);
  let compactIdle = true;
  await compacting.fire("session_start", {}, { mode: "tui", isIdle: () => compactIdle });
  compacting.emit("subagents:started", { id: "compacting" });
  await flush();
  compactIdle = false;
  const compactMark = osc.length;
  compacting.emit("subagents:completed", { id: "compacting" });
  compacting.emit("subagents:started", { id: "after-compact" });
  await flush();
  assert.equal(osc.length, compactMark, "manual compaction keeps ownership without an agent_start");
  await compacting.fire("session_compact", { reason: "manual" });
  compactIdle = true; // Pi clears compaction after the extension hook returns.
  await flush();
  assert.equal(coreStates().at(-1), "working", "a child reclaims status after compaction finishes");
  compacting.emit("subagents:completed", { id: "after-compact" });
  await flush();
  assert.equal(coreStates().at(-1), "done", "the last child restores manual compaction's done status");

  for (const aborted of [false, true]) {
    compacting.emit("subagents:started", { id: "failed-compact" });
    await flush();
    compactIdle = false;
    await compacting.fire("session_compact_failed", { reason: "manual", aborted, errorMessage: aborted ? undefined : "failed" });
    compactIdle = true;
    await flush();
    compacting.emit("subagents:completed", { id: "failed-compact" });
    await flush();
    assert.equal(coreStates().at(-1), aborted ? "idle" : "error", "child completion preserves cancelled and failed compaction outcomes");
  }

  const closing = harness();
  installCore(closing.pi);
  await closing.fire("session_start", {}, { mode: "tui" });
  const shutdownMark = osc.length;
  closing.emit("subagents:started", { id: "closing" });
  await closing.fire("session_shutdown", {});
  await flush();
  assert.equal(osc.length, shutdownMark, "shutdown cancels pending terminal claims");

  for (const [outcome, expected] of [["error", "error"], ["aborted", "idle"]]) {
    const resting = harness();
    installCore(resting.pi);
    await resting.fire("session_start", {}, { mode: "tui" });
    await resting.fire("agent_start", {});
    resting.emit("subagents:started", { id: outcome });
    await resting.fire("message_end", { message: { role: "assistant", stopReason: outcome } });
    await resting.fire("agent_settled", { aborted: outcome === "aborted" }, { isIdle: () => true });
    await flush();
    resting.emit("subagents:completed", { id: outcome });
    await flush();
    assert.equal(coreStates().at(-1), expected, `the last child preserves the parent's ${expected} outcome`);
  }

  for (const mode of ["rpc", "json", "print"]) {
    const headlessCore = harness();
    installCore(headlessCore.pi);
    await headlessCore.fire("session_start", {}, { mode });
    const mark = osc.length;
    headlessCore.emit("subagents:started", { id: mode });
    await flush();
    assert.equal(osc.length, mark, `${mode} sessions emit no core terminal reports`);
  }

  process.env.PI_PROGRAM_STATUS = "0";
  const disabled = await import(`${extension}?core-disabled`);
  const disabledCore = harness();
  disabled.default(disabledCore.pi);
  await disabledCore.fire("session_start", {}, { mode: "tui" });
  const disabledMark = osc.length;
  disabledCore.emit("subagents:started", { id: "disabled" });
  await flush();
  assert.equal(osc.length, disabledMark, "PI_PROGRAM_STATUS=0 disables OSC reporting");

  process.env.HERDR_ENV = "1";
  delete process.env.PI_PROGRAM_STATUS;
  const both = await import(`${extension}?both`);
  const bothHarness = harness();
  both.default(bothHarness.pi);
  await bothHarness.fire("session_start", {}, { mode: "tui" });
  const bothSocketMark = requests.length;
  const bothOscMark = osc.length;
  bothHarness.emit("subagents:started", { id: "both" });
  await flush();
  await bothHarness.fire("agent_settled", { aborted: false }, { isIdle: () => true });
  await flush();
  bothHarness.emit("subagents:completed", { id: "both" });
  await flush();
  assert.deepEqual(states().slice(bothSocketMark), ["working", "working", "idle"], "legacy Herdr remains supported when core identity is present");
  assert.deepEqual(coreStates().slice(bothOscMark), ["working", "working", "done"], "core gets OSC reports independently of the legacy socket");

  process.env.PI_PROGRAM_STATUS = "0";
  const legacyOnly = await import(`${extension}?legacy-with-osc-disabled`);
  const legacyHarness = harness();
  legacyOnly.default(legacyHarness.pi);
  await legacyHarness.fire("session_start", {}, { mode: "tui" });
  const legacySocketMark = requests.length;
  const legacyOscMark = osc.length;
  legacyHarness.emit("subagents:started", { id: "legacy-only" });
  await flush();
  assert.deepEqual(states().slice(legacySocketMark), ["working"], "disabling OSC does not disable the Herdr socket API");
  assert.equal(osc.length, legacyOscMark, "legacy reporting respects the OSC opt-out");
} finally {
  process.stdout.write = write;
}

server.close();
console.log("herdr-subagent-busy: all checks passed");
