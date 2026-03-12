'use strict';

// ─── State ───────────────────────────────────────────────────────────────────
const socket = io();

let myPlayerId  = null;
let myMark      = null;   // 'X' or 'O'
let currentRoom = null;
let myName      = null;
let isVsAI      = false;

// ─── Screen helpers ──────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

function showLobbyError(msg) {
  const el = document.getElementById('lobby-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}
function clearLobbyError() {
  const el = document.getElementById('lobby-error');
  el.textContent = '';
  el.classList.add('hidden');
}

// ─── Lobby ───────────────────────────────────────────────────────────────────
document.getElementById('btn-vs-ai').addEventListener('click', () => {
  clearLobbyError();
  const name = document.getElementById('player-name').value.trim() || 'Player';
  myName = name;
  isVsAI = true;
  socket.emit('ttt-create-room', { playerName: name, mode: 'vs-ai' });
});

document.getElementById('btn-create-online').addEventListener('click', () => {
  clearLobbyError();
  const name = document.getElementById('player-name').value.trim() || 'Player';
  myName = name;
  isVsAI = false;
  socket.emit('ttt-create-room', { playerName: name, mode: 'online' });
});

document.getElementById('btn-join').addEventListener('click', joinRoom);
document.getElementById('room-code-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') joinRoom();
});

function joinRoom() {
  clearLobbyError();
  const name = document.getElementById('player-name').value.trim() || 'Player';
  const code = document.getElementById('room-code-input').value.trim().toUpperCase();
  if (!code) { showLobbyError('Please enter a room code.'); return; }
  myName = name;
  isVsAI = false;
  socket.emit('ttt-join-room', { playerName: name, roomId: code });
}

document.getElementById('btn-copy-code').addEventListener('click', () => {
  const code = document.getElementById('room-code-display').textContent;
  navigator.clipboard.writeText(code).catch(() => {});
});

// ─── Socket events ────────────────────────────────────────────────────────────

socket.on('ttt-room-created', ({ roomId, player, room }) => {
  myPlayerId = player.id;
  myMark     = player.mark;
  currentRoom = room;

  if (room.mode === 'vs-ai') {
    startGame(room);
  } else {
    document.getElementById('room-code-display').textContent = roomId;
    renderWaitingList(room);
    showScreen('screen-waiting');
  }
});

socket.on('ttt-room-joined', ({ player, room }) => {
  myPlayerId = player.id;
  myMark     = player.mark;
  currentRoom = room;
  renderWaitingList(room);
  showScreen('screen-waiting');
});

socket.on('ttt-player-joined', ({ room }) => {
  currentRoom = room;
  renderWaitingList(room);
});

socket.on('ttt-game-started', ({ room }) => {
  currentRoom = room;
  startGame(room);
});

socket.on('ttt-move-made', ({ room }) => {
  currentRoom = room;
  renderBoard(room);
  updateStatus(room);
});

socket.on('ttt-game-over', ({ room, result }) => {
  currentRoom = room;
  renderBoard(room);
  showGameOver(room, result);
});

socket.on('ttt-game-restarted', ({ room }) => {
  currentRoom = room;
  renderBoard(room);
  updateStatus(room);
  showScreen('screen-game');
});

socket.on('ttt-join-error', ({ message }) => {
  showLobbyError(message);
});

socket.on('ttt-player-left', () => {
  setStatus('Opponent disconnected.', '');
});

// ─── Waiting list ─────────────────────────────────────────────────────────────
function renderWaitingList(room) {
  const ul = document.getElementById('waiting-list');
  ul.innerHTML = '';
  room.players.forEach(p => {
    const li = document.createElement('li');
    li.textContent = `${p.name} (${p.mark})`;
    ul.appendChild(li);
  });
}

// ─── Game screen ─────────────────────────────────────────────────────────────
function startGame(room) {
  currentRoom = room;
  renderBoard(room);
  buildScoreRow(room);
  updateStatus(room);
  showScreen('screen-game');
}

function renderBoard(room) {
  const cells = document.querySelectorAll('.ttt-cell');
  cells.forEach((cell, i) => {
    const val = room.board[i];
    cell.textContent = val || '';
    cell.className = 'ttt-cell';
    if (val === 'X') cell.classList.add('mark-x');
    if (val === 'O') cell.classList.add('mark-o');

    // highlight winning cells
    if (room.winLine && room.winLine.includes(i)) {
      cell.classList.add('winning');
    }

    // disable if game over, cell taken, or not my turn
    const isMyTurn = room.currentMark === myMark && !room.gameOver;
    cell.disabled = room.gameOver || !!val || !isMyTurn;
  });
}

function buildScoreRow(room) {
  const row = document.getElementById('ttt-score-row');
  row.innerHTML = '';
  room.players.forEach(p => {
    const div = document.createElement('div');
    div.className = 'ttt-score-item';
    div.id = `score-${p.id}`;
    div.innerHTML = `<div class="score-label">${escHtml(p.name)} (${p.mark})</div><div class="score-value" id="score-val-${p.id}">0</div>`;
    row.appendChild(div);
  });
}

function updateScores(room) {
  room.players.forEach(p => {
    const el = document.getElementById(`score-val-${p.id}`);
    if (el) el.textContent = p.score ?? 0;
  });
}

function setStatus(text, cls) {
  const el = document.getElementById('ttt-status');
  el.textContent = text;
  el.className = 'ttt-status ' + (cls || '');
}

function updateStatus(room) {
  if (room.gameOver) return;
  if (room.currentMark === myMark) {
    setStatus("Your turn (" + myMark + ")", 'your-turn');
  } else {
    const opp = room.players.find(p => p.mark !== myMark);
    const oppName = opp ? opp.name : 'Opponent';
    setStatus(`${oppName}'s turn (${room.currentMark})`, 'opponent-turn');
  }
}

// ─── Cell click ──────────────────────────────────────────────────────────────
document.getElementById('ttt-board').addEventListener('click', e => {
  const cell = e.target.closest('.ttt-cell');
  if (!cell || cell.disabled) return;
  const idx = parseInt(cell.dataset.idx, 10);
  socket.emit('ttt-make-move', { index: idx });
});

// ─── Game over ────────────────────────────────────────────────────────────────
function showGameOver(room, result) {
  updateScores(room);

  let icon = '🤝';
  let label = "It's a draw!";

  if (result.winner) {
    const winner = room.players.find(p => p.id === result.winner);
    if (winner) {
      if (winner.id === myPlayerId) {
        icon  = '🏆';
        label = `You won! (${winner.mark})`;
      } else {
        icon  = '😞';
        label = `${escHtml(winner.name)} wins! (${winner.mark})`;
      }
    }
  }

  document.getElementById('gameover-icon').textContent = icon;
  document.getElementById('winner-label').textContent   = label;
  showScreen('screen-gameover');
}

document.getElementById('btn-play-again').addEventListener('click', () => {
  socket.emit('ttt-restart');
});

// ─── Utility ──────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
