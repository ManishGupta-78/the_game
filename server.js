'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const BOARD_SIZE = 100;

// Rate-limit all HTTP requests (static assets + the index route)
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200,            // generous for a game app serving many assets
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─── Game state ─────────────────────────────────────────────────────────────

const rooms = new Map();

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function createBoard() {
  const board = {};
  for (let i = 1; i <= BOARD_SIZE; i++) {
    board[i] = { type: 'unknown', destination: null };
  }
  return board;
}

/**
 * Every time a player lands on a cell we regenerate its state dynamically.
 * - ~34 %  solid
 * - ~33 %  portal-forward  (up to +25 squares)
 * - ~33 %  portal-backward (up to -25 squares)
 */
function generateCellState(position) {
  const roll = Math.random();
  if (roll < 0.34) {
    return { type: 'solid', destination: null };
  }
  if (roll < 0.67) {
    const min = position + 1;
    const max = Math.min(BOARD_SIZE - 1, position + 25);
    if (min > max) return { type: 'solid', destination: null };
    return {
      type: 'portal-forward',
      destination: Math.floor(Math.random() * (max - min + 1)) + min,
    };
  }
  const max = position - 1;
  const min = Math.max(1, position - 25);
  if (max < min) return { type: 'solid', destination: null };
  return {
    type: 'portal-backward',
    destination: Math.floor(Math.random() * (max - min + 1)) + min,
  };
}

function createRoom(roomId, mode, maxPlayers) {
  return {
    id: roomId,
    mode,           // 'online' | 'vs-ai'
    maxPlayers: maxPlayers || 4,
    players: [],
    board: createBoard(),
    currentPlayerIndex: 0,
    gameStarted: false,
    gameOver: false,
    finishOrder: [],
    winner: null,
    aiTimer: null,
  };
}

const PLAYER_COLORS = ['#E74C3C', '#3498DB', '#2ECC71', '#F39C12'];

function addPlayerToRoom(room, socketId, playerName, isAI) {
  const player = {
    id: socketId,
    name: playerName,
    isAI: isAI || false,
    position: 0,
    color: PLAYER_COLORS[room.players.length % PLAYER_COLORS.length],
    finished: false,
    order: room.players.length,
  };
  room.players.push(player);
  return player;
}

function getCurrentPlayer(room) {
  return room.players[room.currentPlayerIndex] || null;
}

function advanceTurn(room) {
  const total = room.players.length;
  let attempts = 0;
  do {
    room.currentPlayerIndex = (room.currentPlayerIndex + 1) % total;
    attempts++;
  } while (room.players[room.currentPlayerIndex].finished && attempts <= total);
}

function rollDice() {
  return Math.floor(Math.random() * 6) + 1;
}

function checkAndHandleCollisions(room, movingPlayer, events) {
  const others = room.players.filter(
    p => p.id !== movingPlayer.id &&
         !p.finished &&
         p.position > 0 &&
         p.position === movingPlayer.position
  );
  for (const other of others) {
    const prev = other.position;
    other.position = 0;
    events.push({ type: 'collision', victim: other.id, from: prev, to: 0 });
  }
}

function checkGameOver(room, events) {
  const unfinished = room.players.filter(p => !p.finished);
  if (unfinished.length <= 1) {
    room.gameOver = true;
    const winner = room.players.find(p => p.id === room.finishOrder[0]) || unfinished[0];
    room.winner = winner;
    events.push({ type: 'game-over', winner: winner ? winner.id : null });
    return true;
  }
  return false;
}

function handlePlayerFinish(room, player, events) {
  player.position = BOARD_SIZE;
  player.finished = true;
  room.finishOrder.push(player.id);
  events.push({ type: 'finish', player: player.id, rank: room.finishOrder.length });
}

function processMove(room, playerId, diceValue) {
  const player = room.players.find(p => p.id === playerId);
  if (!player || player.finished) return null;

  const current = getCurrentPlayer(room);
  if (!current || current.id !== playerId) return null;

  const events = [];
  const originalPos = player.position;

  // ── Step 1: basic movement ──────────────────────────────────────────────
  let newPos = player.position + diceValue;
  if (newPos > BOARD_SIZE) {
    // bounce back
    newPos = BOARD_SIZE - (newPos - BOARD_SIZE);
    if (newPos < 1) newPos = 1;
  }
  player.position = newPos;
  events.push({ type: 'move', player: player.id, from: originalPos, to: newPos });

  // ── Step 2: landed exactly on 100? ─────────────────────────────────────
  if (newPos === BOARD_SIZE) {
    handlePlayerFinish(room, player, events);
    if (!checkGameOver(room, events)) advanceTurn(room);
    return events;
  }

  // ── Step 3: collision check ─────────────────────────────────────────────
  checkAndHandleCollisions(room, player, events);

  // ── Step 4: reveal cell state (dynamic) ────────────────────────────────
  const cellState = generateCellState(newPos);
  room.board[newPos] = cellState;
  events.push({ type: 'cell-revealed', position: newPos, cellState });

  // ── Step 5: portal teleport ─────────────────────────────────────────────
  if (cellState.type !== 'solid') {
    const portalFrom = player.position;
    let dest = cellState.destination;
    if (dest > BOARD_SIZE) dest = BOARD_SIZE;
    player.position = dest;
    events.push({
      type: 'portal',
      player: player.id,
      from: portalFrom,
      to: dest,
      portalType: cellState.type,
    });

    if (dest >= BOARD_SIZE) {
      handlePlayerFinish(room, player, events);
      if (!checkGameOver(room, events)) advanceTurn(room);
      return events;
    }

    // collision at portal destination
    checkAndHandleCollisions(room, player, events);
  }

  advanceTurn(room);
  return events;
}

function roomPublicState(room) {
  return {
    id: room.id,
    mode: room.mode,
    maxPlayers: room.maxPlayers,
    players: room.players,
    board: room.board,
    currentPlayerIndex: room.currentPlayerIndex,
    gameStarted: room.gameStarted,
    gameOver: room.gameOver,
    winner: room.winner,
    finishOrder: room.finishOrder,
  };
}

// ─── AI ─────────────────────────────────────────────────────────────────────

function scheduleAI(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.gameOver || !room.gameStarted) return;
  const cur = getCurrentPlayer(room);
  if (!cur || !cur.isAI) return;

  // clear previous timer if any
  if (room.aiTimer) clearTimeout(room.aiTimer);
  room.aiTimer = setTimeout(() => {
    const r = rooms.get(roomId);
    if (!r || r.gameOver) return;
    const c = getCurrentPlayer(r);
    if (!c || !c.isAI) return;

    const diceValue = rollDice();
    io.to(roomId).emit('dice-rolled', { player: c.id, value: diceValue });

    setTimeout(() => {
      const r2 = rooms.get(roomId);
      if (!r2 || r2.gameOver) return;
      const events = processMove(r2, c.id, diceValue);
      if (!events) return;
      io.to(roomId).emit('move-processed', { events, room: roomPublicState(r2) });
      if (!r2.gameOver) scheduleAI(roomId);
    }, 900);
  }, 1400);
}

// ─── Socket.io ───────────────────────────────────────────────────────────────

io.on('connection', socket => {
  // Create room
  socket.on('create-room', ({ playerName, mode, maxPlayers }) => {
    if (!playerName || typeof playerName !== 'string') return;
    const name = playerName.slice(0, 20).trim() || 'Player';
    const roomId = generateRoomId();
    const room = createRoom(roomId, mode || 'online', maxPlayers || 4);
    rooms.set(roomId, room);

    const player = addPlayerToRoom(room, socket.id, name, false);
    socket.join(roomId);
    socket.data.roomId = roomId;

    if (mode === 'vs-ai') {
      addPlayerToRoom(room, 'ai-1', 'Computer', true);
    }

    socket.emit('room-created', { roomId, player, room: roomPublicState(room) });

    if (mode === 'vs-ai') {
      // Auto-start vs-AI games
      room.gameStarted = true;
      io.to(roomId).emit('game-started', { room: roomPublicState(room) });
      scheduleAI(roomId);
    }
  });

  // Join room
  socket.on('join-room', ({ roomId, playerName }) => {
    if (!playerName || typeof playerName !== 'string') return;
    const name = playerName.slice(0, 20).trim() || 'Player';
    const room = rooms.get(typeof roomId === 'string' ? roomId.toUpperCase() : '');
    if (!room) { socket.emit('join-error', { message: 'Room not found' }); return; }
    if (room.gameStarted) { socket.emit('join-error', { message: 'Game already started' }); return; }
    if (room.players.filter(p => !p.isAI).length >= room.maxPlayers) {
      socket.emit('join-error', { message: 'Room is full' }); return;
    }

    const player = addPlayerToRoom(room, socket.id, name, false);
    socket.join(roomId.toUpperCase());
    socket.data.roomId = roomId.toUpperCase();

    io.to(roomId.toUpperCase()).emit('player-joined', { player, room: roomPublicState(room) });
    socket.emit('room-joined', { player, room: roomPublicState(room) });
  });

  // Start game (host only)
  socket.on('start-game', () => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.gameStarted || room.players.length < 2) return;
    if (room.players[0].id !== socket.id) return;

    room.gameStarted = true;
    io.to(room.id).emit('game-started', { room: roomPublicState(room) });
    scheduleAI(room.id);
  });

  // Roll dice (human)
  socket.on('roll-dice', () => {
    const room = rooms.get(socket.data.roomId);
    if (!room || !room.gameStarted || room.gameOver) return;
    const cur = getCurrentPlayer(room);
    if (!cur || cur.id !== socket.id) return;

    const diceValue = rollDice();
    io.to(room.id).emit('dice-rolled', { player: socket.id, value: diceValue });

    setTimeout(() => {
      const r = rooms.get(socket.data.roomId);
      if (!r || r.gameOver) return;
      const events = processMove(r, socket.id, diceValue);
      if (!events) return;
      io.to(r.id).emit('move-processed', { events, room: roomPublicState(r) });
      if (!r.gameOver) scheduleAI(r.id);
    }, 900);
  });

  // Disconnect
  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomId);
    if (!room) return;

    const leavingIdx = room.players.findIndex(p => p.id === socket.id);
    room.players = room.players.filter(p => p.id !== socket.id);

    if (room.players.filter(p => !p.isAI).length === 0) {
      if (room.aiTimer) clearTimeout(room.aiTimer);
      rooms.delete(room.id);
      return;
    }

    // Adjust currentPlayerIndex so it remains valid after the player array shrinks.
    // After filtering, players at indices > leavingIdx each shift down by one, so the
    // old currentPlayerIndex naturally points to the "next" player when the current
    // player left; a modulo keeps it in-bounds when it was the last element.
    if (leavingIdx !== -1 && room.gameStarted && !room.gameOver) {
      if (leavingIdx < room.currentPlayerIndex) {
        room.currentPlayerIndex -= 1;
      } else if (leavingIdx === room.currentPlayerIndex) {
        room.currentPlayerIndex = room.currentPlayerIndex % room.players.length;
        scheduleAI(room.id);
      }
    }

    io.to(room.id).emit('player-left', { playerId: socket.id, room: roomPublicState(room) });
  });
});

server.listen(PORT, () => {
  console.log(`Portal Quest server running on http://localhost:${PORT}`);
});
