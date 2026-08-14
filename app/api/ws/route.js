import { experimental_upgradeWebSocket } from "@vercel/functions";

export const runtime = "nodejs";
export const maxDuration = 300;

const G = globalThis;
if (!G.__miniChatV3Rooms) G.__miniChatV3Rooms = new Map();
const rooms = G.__miniChatV3Rooms;

function isOpen(ws) {
  return ws && ws.readyState === 1;
}

function sendJSON(ws, payload) {
  if (!isOpen(ws)) return;
  try { ws.send(JSON.stringify(payload)); } catch {}
}

function cleanCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 6);
}

function roomSet(code) {
  if (!rooms.has(code)) rooms.set(code, new Set());
  return rooms.get(code);
}

function cleanRoom(code) {
  const room = rooms.get(code);
  if (!room) return null;
  for (const member of [...room]) {
    if (!isOpen(member)) room.delete(member);
  }
  if (room.size === 0) {
    rooms.delete(code);
    return null;
  }
  return room;
}

function addToRoom(ws, code) {
  if (!ws.__rooms) ws.__rooms = new Set();
  ws.__rooms.add(code);
  roomSet(code).add(ws);
}

function removeFromRoom(ws, code, notify = true) {
  const room = rooms.get(code);
  ws.__rooms?.delete(code);
  if (!room) return;
  room.delete(ws);

  for (const member of [...room]) {
    if (!isOpen(member)) room.delete(member);
  }

  if (room.size === 0) {
    rooms.delete(code);
    return;
  }

  if (notify) {
    for (const member of room) {
      sendJSON(member, { type: "peer_left", room: code, at: Date.now() });
    }
  }
}

function leaveAll(ws) {
  for (const code of [...(ws.__rooms || [])]) {
    removeFromRoom(ws, code, true);
  }
}

function relay(roomCode, sender, data, isBinary = false) {
  const room = cleanRoom(roomCode);
  if (!room) return;

  for (const member of room) {
    if (member === sender || !isOpen(member)) continue;
    try { member.send(data, { binary: isBinary }); } catch {}
  }
}

function announcePresence(code) {
  const room = cleanRoom(code);
  if (!room) return;
  const size = room.size;
  for (const member of room) {
    sendJSON(member, { type: "room_presence", room: code, count: size });
  }
}

function handleControl(ws, msg) {
  const type = msg?.type;
  const code = cleanCode(msg?.room || msg?.code);

  if (type === "create") {
    if (code.length !== 6) return sendJSON(ws, { type: "error", message: "Неверный код" });

    const room = cleanRoom(code);
    if (room && room.size >= 2 && !room.has(ws)) {
      return sendJSON(ws, { type: "full", room: code });
    }
    if (room && room.size > 0 && !room.has(ws) && !msg.resume) {
      return sendJSON(ws, { type: "taken", room: code });
    }

    addToRoom(ws, code);
    sendJSON(ws, { type: "room_ready", room: code, role: "owner" });
    announcePresence(code);
    return;
  }

  if (type === "join") {
    if (code.length !== 6) return sendJSON(ws, { type: "not_found", room: code });

    const room = cleanRoom(code);
    if (!room) return sendJSON(ws, { type: "not_found", room: code });
    if (room.size >= 2 && !room.has(ws)) return sendJSON(ws, { type: "full", room: code });

    addToRoom(ws, code);
    sendJSON(ws, { type: "room_ready", room: code, role: "guest" });
    announcePresence(code);
    return;
  }

  if (type === "resume") {
    if (code.length !== 6) return;
    const role = msg.role === "owner" ? "owner" : "guest";
    const room = cleanRoom(code);

    if (!room) {
      if (role === "owner") {
        addToRoom(ws, code);
        sendJSON(ws, { type: "room_ready", room: code, role });
        announcePresence(code);
      } else {
        sendJSON(ws, { type: "room_offline", room: code });
      }
      return;
    }

    if (room.size >= 2 && !room.has(ws)) {
      sendJSON(ws, { type: "room_full", room: code });
      return;
    }

    addToRoom(ws, code);
    sendJSON(ws, { type: "room_ready", room: code, role });
    announcePresence(code);
    return;
  }

  if (type === "leave_room") {
    if (code) removeFromRoom(ws, code, true);
    return;
  }

  if (type === "ping") {
    sendJSON(ws, { type: "pong", at: Date.now() });
    return;
  }

  const relayTypes = new Set([
    "chat", "file_meta", "file_end", "typing", "receipt",
    "profile", "message_action", "reaction"
  ]);

  if (relayTypes.has(type) && code && ws.__rooms?.has(code)) {
    relay(code, ws, JSON.stringify(msg), false);
  }
}

export function GET() {
  return experimental_upgradeWebSocket((ws) => {
    ws.__rooms = new Set();

    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        // Binary frame begins with six ASCII bytes containing the room code.
        try {
          const roomCode = data.subarray(0, 6).toString("utf8");
          if (/^\d{6}$/.test(roomCode) && ws.__rooms?.has(roomCode)) {
            relay(roomCode, ws, data, true);
          }
        } catch {}
        return;
      }

      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      handleControl(ws, msg);
    });

    ws.on("close", () => leaveAll(ws));
    ws.on("error", () => leaveAll(ws));
  });
}
