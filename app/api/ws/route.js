import { experimental_upgradeWebSocket } from "@vercel/functions";

export const runtime = "nodejs";
export const maxDuration = 300;

const G = globalThis;
if (!G.__miniChatMaxRooms) G.__miniChatMaxRooms = new Map();
const rooms = G.__miniChatMaxRooms;

function isOpen(ws) { return ws && ws.readyState === 1; }
function sendJSON(ws, payload) { if (!isOpen(ws)) return; try { ws.send(JSON.stringify(payload)); } catch {} }
function codeOf(value) { return String(value || "").replace(/\D/g, "").slice(0, 6); }
function getRoom(code) { if (!rooms.has(code)) rooms.set(code, new Set()); return rooms.get(code); }
function cleanRoom(code) {
  const room = rooms.get(code); if (!room) return null;
  for (const client of [...room]) if (!isOpen(client)) room.delete(client);
  if (room.size === 0) { rooms.delete(code); return null; }
  return room;
}
function addRoom(ws, code) { if (!ws.__rooms) ws.__rooms = new Set(); ws.__rooms.add(code); getRoom(code).add(ws); }
function leaveRoom(ws, code, notify = true) {
  ws.__rooms?.delete(code); const room = rooms.get(code); if (!room) return;
  room.delete(ws); for (const c of [...room]) if (!isOpen(c)) room.delete(c);
  if (room.size === 0) { rooms.delete(code); return; }
  if (notify) for (const c of room) sendJSON(c, { type:"peer_left", room:code, at:Date.now() });
}
function leaveAll(ws) { for (const code of [...(ws.__rooms || [])]) leaveRoom(ws, code, true); }
function presence(code) { const room = cleanRoom(code); if (!room) return; for (const c of room) sendJSON(c,{type:"presence",room:code,count:room.size}); }
function relayJSON(roomCode, sender, payload) {
  const room = cleanRoom(roomCode); if (!room) return; const text = JSON.stringify(payload);
  for (const c of room) if (c !== sender && isOpen(c)) try { c.send(text); } catch {}
}
function relayBinary(roomCode, sender, data) {
  const room = cleanRoom(roomCode); if (!room) return;
  for (const c of room) if (c !== sender && isOpen(c)) try { c.send(data,{binary:true}); } catch {}
}
function handle(ws,msg) {
  const type = msg?.type; const roomCode = codeOf(msg?.room || msg?.code);
  if (type === "create") {
    if (roomCode.length !== 6) return sendJSON(ws,{type:"error",message:"bad_room"});
    const room = cleanRoom(roomCode);
    if (room && room.size > 0 && !room.has(ws) && !msg.resume) return sendJSON(ws,{type:"taken",room:roomCode});
    if (room && room.size >= 2 && !room.has(ws)) return sendJSON(ws,{type:"full",room:roomCode});
    addRoom(ws,roomCode); sendJSON(ws,{type:"room_ready",room:roomCode,role:"owner"}); presence(roomCode); return;
  }
  if (type === "join") {
    if (roomCode.length !== 6) return sendJSON(ws,{type:"not_found",room:roomCode});
    const room = cleanRoom(roomCode); if (!room) return sendJSON(ws,{type:"not_found",room:roomCode});
    if (room.size >= 2 && !room.has(ws)) return sendJSON(ws,{type:"full",room:roomCode});
    addRoom(ws,roomCode); sendJSON(ws,{type:"room_ready",room:roomCode,role:"guest"}); presence(roomCode); return;
  }
  if (type === "resume") {
    if (roomCode.length !== 6) return; const role = msg.role === "owner" ? "owner" : "guest"; const room = cleanRoom(roomCode);
    if (!room) {
      if (role === "owner") { addRoom(ws,roomCode); sendJSON(ws,{type:"room_ready",room:roomCode,role}); presence(roomCode); }
      else sendJSON(ws,{type:"room_offline",room:roomCode});
      return;
    }
    if (room.size >= 2 && !room.has(ws)) return sendJSON(ws,{type:"room_full",room:roomCode});
    addRoom(ws,roomCode); sendJSON(ws,{type:"room_ready",room:roomCode,role}); presence(roomCode); return;
  }
  if (type === "leave_room") { if (roomCode) leaveRoom(ws,roomCode,true); return; }
  if (type === "ping") { sendJSON(ws,{type:"pong",at:Date.now()}); return; }
  if (["crypto_hello","secure","typing","receipt"].includes(type) && roomCode && ws.__rooms?.has(roomCode)) relayJSON(roomCode,ws,msg);
}

export function GET() {
  return experimental_upgradeWebSocket((ws) => {
    ws.__rooms = new Set();
    ws.on("message", (data,isBinary) => {
      if (isBinary) {
        try { const roomCode = data.subarray(0,6).toString("utf8"); if (/^\d{6}$/.test(roomCode) && ws.__rooms?.has(roomCode)) relayBinary(roomCode,ws,data); } catch {}
        return;
      }
      let msg; try { msg = JSON.parse(data.toString()); } catch { return; } handle(ws,msg);
    });
    ws.on("close",()=>leaveAll(ws)); ws.on("error",()=>leaveAll(ws));
  });
}
