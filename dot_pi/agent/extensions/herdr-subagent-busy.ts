// Reports top-level background subagent activity to Herdr's socket API and
// herdr-core's OSC 7501 protocol. Parent work and input requests take precedence;
// this companion only holds "working" while the parent is idle.
// @ts-nocheck
import net from "node:net";

const HERDR_ENV = process.env.HERDR_ENV;
const socketPath = process.env.HERDR_SOCKET_PATH;
const socketEndpoint =
  process.platform === "win32" && socketPath ? `\\\\.\\pipe\\${socketPath}` : socketPath;
const paneId = process.env.HERDR_PANE_ID;
const source = "herdr:pi";

const herdrEnabled = HERDR_ENV === "1" && Boolean(socketPath && paneId);
const coreEnabled = Boolean(process.env.HC_TERMINAL_ID) && process.env.PI_PROGRAM_STATUS !== "0";

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

function report(state, settledState = "idle") {
  if (coreEnabled) {
    const coreState = state === "idle" ? settledState : state;
    process.stdout.write(`\x1b]7501;state=${coreState}:app=pi\x1b\\`);
  }
  if (!herdrEnabled) return;

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
  if (!herdrEnabled && !coreEnabled) {
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
  let uiBlocked = false;
  let runResult = "done";
  let restingState = "idle";
  let sessionContext;

  function parentIsIdle() {
    return parentIdle && sessionContext?.isIdle?.() !== false;
  }

  function canClaim() {
    return tui && parentIsIdle() && blockedCount === 0 && !uiBlocked && inFlight.size > 0;
  }

  // Defer past the native parent report, but re-check priority at send time:
  // a new main run or dialog may have started while this write was queued.
  function claim() {
    if (!tui || inFlight.size === 0) return;
    setTimeout(() => {
      if (canClaim()) {
        claimed = true;
        report("working");
      }
    }, 0);
  }

  function release() {
    if (!tui || !claimed || inFlight.size > 0 || !parentIdle) {
      return;
    }
    setTimeout(() => {
      if (tui && claimed && blockedCount === 0 && !uiBlocked && inFlight.size === 0 && parentIsIdle()) {
        claimed = false;
        report("idle", restingState);
      }
    }, 0);
  }

  pi.on("session_start", (_event, ctx) => {
    // RPC and print modes are headless, even if they inherit terminal identity.
    tui = ctx?.mode === "tui";
    sessionContext = ctx;
    parentIdle = ctx?.isIdle?.() !== false;
  });

  pi.on("session_shutdown", () => {
    tui = false;
    inFlight.clear();
    claimed = false;
  });

  pi.on("agent_start", () => {
    parentIdle = false;
    claimed = false;
    runResult = "done";
  });

  pi.on("message_end", (event) => {
    if (event.message?.role === "assistant") {
      runResult = event.message.stopReason === "error" ? "error" : "done";
    }
  });

  pi.on("agent_settled", (event, ctx) => {
    if (ctx?.isIdle?.() !== true) {
      return;
    }
    parentIdle = true;
    sessionContext = ctx;
    restingState = event?.aborted ? "idle" : runResult;
    if (inFlight.size > 0) {
      claim();
    } else {
      // The managed integration owns the state again once nothing is in flight.
      claimed = false;
    }
  });

  // Manual compaction also owns the native status, without an agent_start.
  function compacted(event) {
    if (event.reason === "manual") {
      restingState = event.errorMessage ? "error" : "done";
      if (event.aborted) restingState = "idle";
    }
    claim();
    release();
  }
  pi.on("session_compact", compacted);
  pi.on("session_compact_failed", compacted);

  pi.on("ui_prompt_start", () => {
    uiBlocked = true;
  });

  pi.on("ui_prompt_end", () => {
    uiBlocked = false;
    claim();
    release();
  });

  pi.events.on("herdr:blocked", (data) => {
    blockedCount = Math.max(0, blockedCount + (data?.active ? 1 : -1));
    // The dialog closed while a child still runs: take the pane back.
    if (blockedCount === 0) {
      claim();
      release();
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
