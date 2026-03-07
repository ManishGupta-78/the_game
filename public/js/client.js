'use strict';

/* ── Socket connection ─────────────────────────────────────────────────────── */
const socket = io();

/* ── App state ────────────────────────────────────────────────────────────── */
let gameState    = null;
let myPlayerId   = null;
let renderer     = null;

/* ── Screen management ───────────────────────────────────────────────────── */
const SCREENS = ['lobby', 'waiting', 'game', 'gameover'];

function showScreen(name) {
  for (const s of SCREENS) {
    const el = document.getElementById(`screen-${s}`);
    if (el) el.classList.toggle('hidden', s !== name);
  }
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function $id(id) { return document.getElementById(id); }

function showError(elId, msg) {
  const el = $id(elId);
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

/* ── Build the path between two positions ───────────────────────────────── */
function pathBetween(from, to) {
  if (from === to) return [to];
  const steps = [];
  const step  = from < to ? 1 : -1;
  for (let p = from + step; step > 0 ? p <= to : p >= to; p += step) {
    steps.push(p);
  }
  return steps;
}

/* ── Dice faces ──────────────────────────────────────────────────────────── */
const DICE_FACE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

function animateDice(value) {
  const el = $id('dice-face');
  el.classList.remove('rolling');
  // Force reflow so animation restarts
  void el.offsetWidth;
  el.classList.add('rolling');
  setTimeout(() => {
    el.textContent = DICE_FACE[value] || '🎲';
    el.classList.remove('rolling');
  }, 650);
}

/* ── Logging ─────────────────────────────────────────────────────────────── */
function log(msg, cls) {
  const log = $id('game-log');
  if (!log) return;
  const entry = document.createElement('div');
  entry.className = `log-entry${cls ? ' ' + cls : ''}`;
  entry.textContent = msg;
  log.prepend(entry);
  while (log.children.length > 30) log.removeChild(log.lastChild);
}

function playerName(id) {
  if (!gameState) return id;
  const p = gameState.players.find(p => p.id === id);
  return p ? p.name : id;
}

/* ── UI refresh ──────────────────────────────────────────────────────────── */
function refreshGameUI() {
  if (!gameState) return;
  const cur = gameState.players[gameState.currentPlayerIndex];
  const isMyTurn = cur && cur.id === myPlayerId && !gameState.gameOver;

  // Turn label
  const tn = $id('turn-name');
  if (tn) tn.textContent = cur ? (cur.isAI ? `${cur.name} 🤖` : cur.name) : '—';

  // Roll button
  const rollBtn = $id('btn-roll');
  if (rollBtn) {
    rollBtn.disabled = !isMyTurn;
    rollBtn.textContent = isMyTurn ? 'Roll Dice 🎲' : 'Waiting…';
  }

  // Player status cards
  const list = $id('player-status-list');
  if (list) {
    list.innerHTML = gameState.players.map(p => {
      const posLabel = p.position === 0   ? 'At Start'
                     : p.finished         ? '🏆 Finished'
                     : `Square ${p.position}`;
      const active = cur && p.id === cur.id ? ' active-turn' : '';
      return `
        <div class="p-card${active}" style="border-left-color:${p.color}">
          <span class="p-card-name">${p.name}${p.isAI ? ' 🤖' : ''}</span>
          <span class="p-card-pos">${posLabel}</span>
        </div>`;
    }).join('');
  }

  // Update renderer
  if (renderer) renderer.updateState(gameState);
}

/* ── Waiting room player list ────────────────────────────────────────────── */
function refreshWaitingList(players) {
  const ul = $id('waiting-list');
  if (!ul) return;
  ul.innerHTML = players
    .map(p => `<li style="border-left:3px solid ${p.color};padding-left:10px">
      ${p.name}${p.isAI ? ' 🤖' : ''}${p.order === 0 ? ' (host)' : ''}</li>`)
    .join('');
}

/* ── Process events from server ─────────────────────────────────────────── */
function processEvents(events) {
  for (const ev of events) {
    switch (ev.type) {
      case 'move': {
        const steps = pathBetween(ev.from, ev.to);
        if (renderer) renderer.queueMove(ev.player, steps);
        break;
      }
      case 'portal': {
        log(`🌀 ${playerName(ev.player)} hit a ${ev.portalType === 'portal-forward' ? 'FORWARD' : 'BACKWARD'} portal → square ${ev.to}!`, 'log-portal');
        if (renderer) {
          renderer.flashPortal(ev.from, ev.portalType);
          renderer.queueMove(ev.player, [ev.to]);
        }
        break;
      }
      case 'collision': {
        log(`💥 ${playerName(ev.victim)} bumped back to start!`, 'log-collision');
        if (renderer) renderer.queueMove(ev.victim, [ev.to]);
        break;
      }
      case 'finish': {
        log(`🏆 ${playerName(ev.player)} finished in ${ordinal(ev.rank)} place!`, 'log-finish');
        break;
      }
      case 'game-over': {
        setTimeout(() => showGameOver(ev.winner, gameState), 1200);
        break;
      }
    }
  }
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/* ── Game over screen ────────────────────────────────────────────────────── */
function showGameOver(winnerId, state) {
  const winner = state ? state.players.find(p => p.id === winnerId) : null;
  const wl = $id('winner-label');
  if (wl) wl.textContent = winner ? `${winner.name} wins! 🎉` : 'Game Over!';

  // Finish order
  const foEl = $id('finish-order-list');
  if (foEl && state) {
    const ranks = ['🥇', '🥈', '🥉', '4️⃣'];
    foEl.innerHTML = (state.finishOrder || []).map((id, i) => {
      const p = state.players.find(pl => pl.id === id);
      return `<div class="fl-item" style="border-left:3px solid ${p ? p.color : '#fff'}">
        <span class="fl-rank">${ranks[i] || (i + 1)}</span>
        <span>${p ? p.name : id}</span>
      </div>`;
    }).join('');
  }

  showScreen('gameover');
}

/* ── Roll dice ───────────────────────────────────────────────────────────── */
function rollDice() {
  if (!gameState || gameState.gameOver) return;
  const cur = gameState.players[gameState.currentPlayerIndex];
  if (!cur || cur.id !== myPlayerId) return;
  const rollBtn = $id('btn-roll');
  if (rollBtn && rollBtn.disabled) return;
  socket.emit('roll-dice');
}

/* ── Socket events ───────────────────────────────────────────────────────── */
socket.on('room-created', ({ roomId, player, room }) => {
  myPlayerId = player.id;
  gameState  = room;
  const rcd = $id('room-code-display');
  if (rcd) rcd.textContent = roomId;
  refreshWaitingList(room.players);

  if (room.mode === 'vs-ai') {
    // vs-AI auto-starts; wait for game-started event
    showScreen('waiting');
  } else {
    showScreen('waiting');
  }
});

socket.on('room-joined', ({ player, room }) => {
  myPlayerId = player.id;
  gameState  = room;
  const rcd = $id('room-code-display');
  if (rcd) rcd.textContent = room.id;
  refreshWaitingList(room.players);
  showScreen('waiting');
});

socket.on('player-joined', ({ room }) => {
  gameState = room;
  refreshWaitingList(room.players);
});

socket.on('game-started', ({ room }) => {
  gameState = room;
  showScreen('game');
  if (renderer) renderer.updateState(room);
  refreshGameUI();
  log('🎮 Game started! Good luck!');
});

socket.on('dice-rolled', ({ player, value }) => {
  animateDice(value);
  const name = playerName(player);
  log(`${name} rolled a ${value}`);
});

socket.on('move-processed', ({ events, room }) => {
  gameState = room;
  processEvents(events);
  // Refresh UI after a short delay to let animations begin
  setTimeout(() => refreshGameUI(), 100);
});

socket.on('player-left', ({ room }) => {
  gameState = room;
  refreshGameUI();
  log('A player left the game.');
});

socket.on('join-error', ({ message }) => {
  showError('lobby-error', message);
  showError('waiting-error', message);
});

/* ── Keyboard support ────────────────────────────────────────────────────── */
document.addEventListener('keydown', e => {
  if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat) {
    const gameEl = $id('screen-game');
    if (gameEl && !gameEl.classList.contains('hidden')) {
      e.preventDefault();
      rollDice();
    }
  }
});

/* ── Copy room code ──────────────────────────────────────────────────────── */
function copyRoomCode() {
  const code = ($id('room-code-display') || {}).textContent || '';
  if (navigator.clipboard) {
    navigator.clipboard.writeText(code).catch(() => {});
  }
}

/* ── Init ─────────────────────────────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  // Init renderer
  const canvas = $id('game-canvas');
  if (canvas) renderer = new Renderer(canvas);

  showScreen('lobby');

  // Lobby buttons
  $id('btn-vs-ai').addEventListener('click', () => {
    const name = ($id('player-name').value || '').trim();
    if (!name) { showError('lobby-error', 'Please enter your name'); return; }
    socket.emit('create-room', { playerName: name, mode: 'vs-ai', maxPlayers: 2 });
  });

  $id('btn-create-online').addEventListener('click', () => {
    const name = ($id('player-name').value || '').trim();
    if (!name) { showError('lobby-error', 'Please enter your name'); return; }
    socket.emit('create-room', { playerName: name, mode: 'online', maxPlayers: 4 });
  });

  $id('btn-join').addEventListener('click', () => {
    const name   = ($id('player-name').value || '').trim();
    const roomId = ($id('room-code-input').value || '').trim().toUpperCase();
    if (!name)   { showError('lobby-error', 'Please enter your name'); return; }
    if (!roomId) { showError('lobby-error', 'Please enter a room code'); return; }
    socket.emit('join-room', { roomId, playerName: name });
  });

  // Waiting room
  $id('btn-start').addEventListener('click', () => {
    socket.emit('start-game');
  });

  $id('btn-copy-code').addEventListener('click', copyRoomCode);

  // Roll dice button
  $id('btn-roll').addEventListener('click', rollDice);

  // Allow pressing Enter in name input to start vs-AI quickly
  $id('player-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') $id('btn-vs-ai').click();
  });
});
