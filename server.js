const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');
require('dotenv').config();

const PORT = Number(process.env.PORT || 8080);
const ROOT = __dirname;
const rooms = new Map();
const adminSessions = new Map();
const loginFailures = new Map();
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/admin-login' && req.method === 'POST') {
    if (!process.env.ADMIN_PASSWORD) { res.writeHead(503); res.end('Admin access is not configured.'); return; }
    const ip = req.socket.remoteAddress || 'unknown';
    const attempt = loginFailures.get(ip);
    if (attempt?.blockedUntil > Date.now()) { res.writeHead(429); res.end('Too many attempts. Try again later.'); return; }
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 4096) break; }
    let body = {};
    try { body = JSON.parse(raw); } catch {}
    const expected = Buffer.from(process.env.ADMIN_PASSWORD);
    const supplied = Buffer.from(String(body.password || ''));
    if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
      const failures = attempt?.blockedUntil > Date.now() ? attempt : { count: (attempt?.count || 0) + 1, blockedUntil: 0 };
      if (failures.count >= 5) { failures.count = 0; failures.blockedUntil = Date.now() + 15 * 60 * 1000; }
      loginFailures.set(ip, failures);
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Incorrect password.'); return;
    }
    loginFailures.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    adminSessions.set(token, Date.now() + 12 * 60 * 60 * 1000);
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    res.writeHead(204, { 'set-cookie': `sp_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}` });
    res.end(); return;
  }
  if (url.pathname === '/api/admin-check') {
    const token = /(?:^|;\s*)sp_admin=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1];
    const expiry = token && adminSessions.get(token);
    if (!expiry || expiry < Date.now()) { if (token) adminSessions.delete(token); res.writeHead(403); res.end(); return; }
    res.writeHead(204); res.end(); return;
  }
  if (url.pathname === '/' || url.pathname === '/strikepoint.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    fs.createReadStream(path.join(ROOT, 'strikepoint.html')).pipe(res);
    return;
  }
  if (url.pathname === '/favicon.svg') {
    res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'public, max-age=86400' });
    fs.createReadStream(path.join(ROOT, 'favicon.svg')).pipe(res);
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname !== '/ws') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});

function send(ws, message) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}
function otherMembers(room, ws) {
  return [...room.players].filter(p => p !== ws && p.readyState === WebSocket.OPEN);
}
function code() { return Math.random().toString(36).slice(2, 8).toUpperCase(); }

wss.on('connection', ws => {
  ws.room = null;
  ws.playerId = Math.random().toString(36).slice(2, 10);
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'join') {
      let roomCode = String(msg.room || code()).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      if (!roomCode) roomCode = code();
      let room = rooms.get(roomCode);
      if (!room) { room = { players: new Set() }; rooms.set(roomCode, room); }
      if (room.players.size >= 2) { send(ws, { type: 'error', message: 'That room already has two players.' }); ws.close(); return; }
      ws.room = roomCode;
      ws.isHost = room.players.size === 0;
      room.players.add(ws);
      send(ws, { type: 'welcome', room: roomCode, playerId: ws.playerId, host: ws.isHost, players: room.players.size });
      for (const peer of otherMembers(room, ws)) send(peer, { type: 'peer-joined', playerId: ws.playerId });
      return;
    }
    const room = rooms.get(ws.room);
    if (!room || !['config', 'state', 'shot', 'round'].includes(msg.type)) return;
    for (const peer of otherMembers(room, ws)) send(peer, { ...msg, playerId: ws.playerId });
  });
  ws.on('close', () => {
    if (!ws.room) return;
    const room = rooms.get(ws.room);
    if (!room) return;
    room.players.delete(ws);
    for (const peer of otherMembers(room, ws)) send(peer, { type: 'peer-left' });
    if (room.players.size === 0) rooms.delete(ws.room);
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`STRIKEPOINT server listening on port ${PORT}`));
