import { experimental_upgradeWebSocket } from "@vercel/functions";

export const runtime = "nodejs";
export const maxDuration = 300;

const globalState = globalThis;

if (!globalState.__miniChatRooms) {
  globalState.__miniChatRooms = new Map();
}

const rooms = globalState.__miniChatRooms;

function openSocket(ws) {
  return ws && ws.readyState === 1;
}

function sendJSON(ws, payload) {
  if (!openSocket(ws)) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch {}
}

function cleanCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 6);
}

function roomMembers(code) {
  if (!rooms.has(code)) rooms.set(code, new Set());
  return rooms.get(code);
}

function leave(ws, notify = true) {
  const code = ws.__roomCode;
  if (!code) return;

  const room = rooms.get(code);
  ws.__roomCode = null;

  if (!room) return;

  room.delete(ws);

  for (const member of [...room]) {
    if (!openSocket(member)) room.delete(member);
  }

  if (room.size === 0) {
    rooms.delete(code);
    return;
  }

  if (notify) {
    for (const member of room) {
      sendJSON(member, { type: "peer_left" });
    }
  }
}

function relay(ws, data, isBinary = false) {
  const code = ws.__roomCode;
  if (!code) return;

  const room = rooms.get(code);
  if (!room) return;

  for (const member of [...room]) {
    if (!openSocket(member)) {
      room.delete(member);
      continue;
    }
    if (member === ws) continue;

    try {
      member.send(data, { binary: isBinary });
    } catch {}
  }
}

function handleControl(ws, message) {
  const type = message?.type;

  if (type === "create") {
    const code = cleanCode(message.code);
    if (code.length !== 6) {
      sendJSON(ws, { type: "error", message: "Неверный код комнаты" });
      return;
    }

    const existing = rooms.get(code);
    if (existing) {
      for (const member of [...existing]) {
        if (!openSocket(member)) existing.delete(member);
      }
      if (existing.size === 0) rooms.delete(code);
    }

    if (rooms.has(code) && rooms.get(code).size > 0) {
      sendJSON(ws, { type: "taken" });
      return;
    }

    leave(ws, false);
    ws.__roomCode = code;
    ws.__role = "owner";
    roomMembers(code).add(ws);

    sendJSON(ws, { type: "created", code });
    return;
  }

  if (type === "join") {
    const code = cleanCode(message.code);
    if (code.length !== 6) {
      sendJSON(ws, { type: "not_found" });
      return;
    }

    const room = rooms.get(code);
    if (!room) {
      sendJSON(ws, { type: "not_found" });
      return;
    }

    for (const member of [...room]) {
      if (!openSocket(member)) room.delete(member);
    }

    if (room.size === 0) {
      rooms.delete(code);
      sendJSON(ws, { type: "not_found" });
      return;
    }

    if (room.size >= 2) {
      sendJSON(ws, { type: "full" });
      return;
    }

    leave(ws, false);
    ws.__roomCode = code;
    ws.__role = "guest";
    room.add(ws);

    for (const member of room) {
      sendJSON(member, { type: "peer_ready", code });
    }
    return;
  }

  if (type === "chat" || type === "file_meta" || type === "file_end" || type === "typing" || type === "receipt") {
    relay(ws, JSON.stringify(message), false);
    return;
  }

  if (type === "ping") {
    sendJSON(ws, { type: "pong", now: Date.now() });
    return;
  }

  if (type === "leave") {
    leave(ws, true);
  }
}

export function GET() {
  return experimental_upgradeWebSocket((ws) => {
    ws.__roomCode = null;
    ws.__role = null;

    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        relay(ws, data, true);
        return;
      }

      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }

      handleControl(ws, message);
    });

    ws.on("close", () => {
      leave(ws, true);
    });

    ws.on("error", () => {
      leave(ws, true);
    });
  });
}
