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
  ["working"],
  "a child inside a run claims the pane and never reports it idle",
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

server.close();
console.log("herdr-subagent-busy: all checks passed");
