// Companion to herdr's managed herdr-agent-state.ts, which must not be edited
// (herdr overwrites it on every integration update). That integration reports
// "working" only while a pi run is active and clears it on agent_settled, so a
// background subagent leaves the pane reading idle while its child still works.
// This extension re-claims the pane for as long as a top-level subagent is in
// flight and hands it back when the last one settles.
// @ts-nocheck
import net from "node:net";

const HERDR_ENV = process.env.HERDR_ENV;
const socketPath = process.env.HERDR_SOCKET_PATH;
const socketEndpoint =
  process.platform === "win32" && socketPath ? `\\\\.\\pipe\\${socketPath}` : socketPath;
const paneId = process.env.HERDR_PANE_ID;
const source = "herdr:pi";

function enabled() {
  return HERDR_ENV === "1" && !!socketPath && !!paneId;
}

// Herdr keeps the report with the highest seq per pane. The managed integration
// stamps Date.now() * 1000 when it queues a report, so stamping ours at send
// time beats the idle report it fires from the same agent_settled.
let lastSeq = 0;

// Two reports can land in the same millisecond, so keep our own strictly
// increasing: an equal seq would leave herdr holding whichever arrived first.
function nextSeq() {
  const now = Date.now() * 1000;
  lastSeq = now > lastSeq ? now : lastSeq + 1;
  return lastSeq;
}

function report(state) {
  const request = {
    id: `${source}:subagents:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    method: "pane.report_agent",
    params: {
      pane_id: paneId,
      source,
      agent: "pi",
      state,
      seq: nextSeq(),
    },
  };

  const socket = net.createConnection(socketEndpoint);
  const finish = () => socket.destroy();
  socket.on("error", finish);
  socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
  socket.on("data", finish);
  socket.on("end", finish);
  setTimeout(finish, 500).unref?.();
}

export default function (pi) {
  if (!enabled()) {
    return;
  }

  // Top-level agents only: nested and workflow children report through their
  // owner, and a scoped child that outlives its visible card would hold the
  // pane busy with nothing on screen to explain it.
  const inFlight = new Set();
  let tui = false;
  let parentIdle = true;
  let claimed = false;
  let blockedCount = 0;

  // Both reports defer by a tick: the managed integration reports from the same
  // agent_settled, and sending after it leaves herdr holding our state, not its.
  function claim() {
    // A dialog waiting for input outranks a running child; the managed
    // integration owns that report and we must not paint over it.
    if (!tui || blockedCount > 0 || inFlight.size === 0) {
      return;
    }
    claimed = true;
    setTimeout(() => {
      if (inFlight.size > 0) {
        report("working");
      }
    }, 0);
  }

  function release() {
    if (!tui || !claimed || inFlight.size > 0 || !parentIdle) {
      return;
    }
    claimed = false;
    setTimeout(() => {
      if (blockedCount === 0 && inFlight.size === 0 && parentIdle) {
        report("idle");
      }
    }, 0);
  }

  pi.on("session_start", (_event, ctx) => {
    // Only a TUI owns a pane herdr can display; RPC and print modes are headless.
    tui = ctx?.mode === "tui";
  });

  pi.on("agent_start", () => {
    parentIdle = false;
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (ctx?.isIdle?.() !== true) {
      return;
    }
    parentIdle = true;
    if (inFlight.size > 0) {
      claim();
    } else {
      // The managed integration owns the state again once nothing is in flight.
      claimed = false;
    }
  });

  pi.events.on("herdr:blocked", (data) => {
    blockedCount = Math.max(0, blockedCount + (data?.active ? 1 : -1));
    // The dialog closed while a child still runs: take the pane back.
    if (blockedCount === 0) {
      claim();
    }
  });

  pi.events.on("subagents:started", (data) => {
    if (data?.id) {
      inFlight.add(data.id);
      claim();
    }
  });

  const settle = (data) => {
    if (!data?.id) {
      return;
    }
    inFlight.delete(data.id);
    release();
  };

  pi.events.on("subagents:completed", settle);
  pi.events.on("subagents:failed", settle);
}
