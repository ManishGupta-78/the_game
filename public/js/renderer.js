'use strict';

/**
 * Renderer – draws the 10×10 board and animated player tokens on a <canvas>.
 *
 * Board numbering (standard snake / snakes-and-ladders):
 *   Row 0 (bottom): 1 → 10   (left to right)
 *   Row 1:         20 ← 11   (right to left)
 *   Row 2:         21 → 30   (left to right)
 *   …
 *   Row 9 (top):  100 ← 91   (right to left)
 *  → position 100 is at top-left; position 1 is at bottom-left.
 */
class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');

    // Visual state per player id
    this.tokens = {};   // { id: { x, y, targetX, targetY, color, name, finished } }
    this.board  = {};   // mirror of server board
    this.players = [];  // array of player objects
    this.currentPlayerId = null;

    // Move-animation queue  [ { playerId, steps:[pos,…] } ]
    this.animQueue = [];
    this.animating = false;

    // Portal-flash overlay  { x, y, r, alpha, color }
    this.portalFlashes = [];

    // Glow phase for portal cells
    this.glowPhase = 0;

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this._loop();
  }

  // ── layout helpers ──────────────────────────────────────────────────────

  resize() {
    const W = this.canvas.parentElement.clientWidth  || window.innerWidth  - 440;
    const H = this.canvas.parentElement.clientHeight || window.innerHeight - 24;
    const size = Math.min(W, H, 700);
    this.canvas.width  = size;
    this.canvas.height = size;
    this.PAD  = Math.round(size * 0.03);
    this.CELL = (size - this.PAD * 2) / 10;
    this._syncTokenTargets();
  }

  /** Convert board position (1-100) to grid {row, col}. */
  _posToGrid(pos) {
    if (pos < 1 || pos > 100) return null;
    const idx  = pos - 1;
    const row  = Math.floor(idx / 10);
    const posInRow = idx % 10;
    const col  = (row % 2 === 0) ? posInRow : (9 - posInRow);
    return { row, col };
  }

  /** Convert grid {row, col} to canvas center pixel {x, y}. */
  _gridToPixel(row, col) {
    const x = this.PAD + col * this.CELL + this.CELL / 2;
    const y = this.PAD + (9 - row) * this.CELL + this.CELL / 2;
    return { x, y };
  }

  /** Convert position (0-100) to canvas pixel. 0 = off-board start zone. */
  _posToPixel(pos) {
    if (pos === 0) {
      // Show waiting tokens in a strip above the board's bottom row
      return { x: this.PAD + this.CELL * 0.5, y: this.canvas.height - this.PAD * 0.5 };
    }
    const g = this._posToGrid(pos);
    if (!g) return { x: this.PAD, y: this.PAD };
    return this._gridToPixel(g.row, g.col);
  }

  // ── public API ────────────────────────────────────────────────────────────

  updateState(gameState) {
    this.board   = gameState.board || {};
    this.players = gameState.players || [];
    const cur = this.players[gameState.currentPlayerIndex];
    this.currentPlayerId = cur ? cur.id : null;

    // Ensure every player has a token record
    for (const p of this.players) {
      if (!this.tokens[p.id]) {
        const pix = this._posToPixel(p.position);
        this.tokens[p.id] = { x: pix.x, y: pix.y, targetX: pix.x, targetY: pix.y };
      }
      this.tokens[p.id].color    = p.color;
      this.tokens[p.id].name     = p.name;
      this.tokens[p.id].finished = p.finished;
    }
  }

  /**
   * Queue a multi-step move animation for a player.
   * @param {string} playerId
   * @param {number[]} steps – array of positions to pass through
   */
  queueMove(playerId, steps) {
    this.animQueue.push({ playerId, steps: [...steps] });
    if (!this.animating) this._runNextAnim();
  }

  /** Flash a portal effect at a board position. */
  flashPortal(position, type) {
    const pix = this._posToPixel(position);
    const color = type === 'portal-forward' ? '#27AE60' : '#E74C3C';
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI * 2 / 6) * i;
      const r = this.CELL * 0.35;
      this.portalFlashes.push({
        x: pix.x + Math.cos(angle) * r * .5,
        y: pix.y + Math.sin(angle) * r * .5,
        vx: Math.cos(angle) * 1.2,
        vy: Math.sin(angle) * 1.2 - 0.5,
        r: this.CELL * 0.12,
        alpha: 1,
        color,
      });
    }
  }

  // ── animation queue ───────────────────────────────────────────────────────

  _runNextAnim() {
    if (this.animQueue.length === 0) { this.animating = false; return; }
    this.animating = true;
    const job = this.animQueue.shift();
    this._animateSteps(job.playerId, job.steps, () => this._runNextAnim());
  }

  _animateSteps(playerId, steps, onDone) {
    if (steps.length === 0) { onDone(); return; }
    const pos = steps.shift();
    const pix = this._posToPixel(pos);
    const tok = this.tokens[playerId];
    if (!tok) { onDone(); return; }

    tok.targetX = pix.x;
    tok.targetY = pix.y;

    // Wait until token is near target, then proceed
    const check = () => {
      const dx = tok.targetX - tok.x;
      const dy = tok.targetY - tok.y;
      if (Math.abs(dx) < 1.5 && Math.abs(dy) < 1.5) {
        tok.x = tok.targetX;
        tok.y = tok.targetY;
        setTimeout(() => this._animateSteps(playerId, steps, onDone), 80);
      } else {
        requestAnimationFrame(check);
      }
    };
    requestAnimationFrame(check);
  }

  _syncTokenTargets() {
    for (const p of this.players) {
      const tok = this.tokens[p.id];
      if (!tok) continue;
      const pix = this._posToPixel(p.position);
      tok.targetX = pix.x;
      tok.targetY = pix.y;
    }
  }

  // ── render loop ───────────────────────────────────────────────────────────

  _loop() {
    this.glowPhase += 0.045;
    this._render();
    requestAnimationFrame(() => this._loop());
  }

  _render() {
    const ctx  = this.ctx;
    const size = this.canvas.width;
    ctx.clearRect(0, 0, size, size);

    // Background gradient
    const bg = ctx.createLinearGradient(0, 0, size, size);
    bg.addColorStop(0, '#0d1b2a');
    bg.addColorStop(1, '#15253b');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);

    this._drawGrid();
    this._drawTokens();
    this._drawParticles();
  }

  // ── board drawing ─────────────────────────────────────────────────────────

  _drawGrid() {
    const ctx  = this.ctx;
    const CELL = this.CELL;
    const PAD  = this.PAD;

    for (let pos = 1; pos <= 100; pos++) {
      const g   = this._posToGrid(pos);
      const px  = PAD + g.col * CELL;
      const py  = PAD + (9 - g.row) * CELL;
      const cx  = px + CELL / 2;
      const cy  = py + CELL / 2;
      const cs  = this.board[pos];

      // ── cell background ──
      let fillColor;
      if (!cs || cs.type === 'unknown') {
        // checkerboard for unvisited
        fillColor = (g.row + g.col) % 2 === 0 ? '#1c3252' : '#162840';
      } else if (cs.type === 'portal-forward') {
        const glow = 0.55 + 0.45 * Math.sin(this.glowPhase);
        fillColor = `rgba(39,174,96,${glow})`;
      } else if (cs.type === 'portal-backward') {
        const glow = 0.55 + 0.45 * Math.sin(this.glowPhase + Math.PI);
        fillColor = `rgba(231,76,60,${glow})`;
      } else {
        // solid – warm tan tones
        fillColor = (g.row + g.col) % 2 === 0 ? '#9b8a72' : '#7d6e5a';
      }

      ctx.fillStyle = fillColor;
      this._roundRect(ctx, px + 1, py + 1, CELL - 2, CELL - 2, 4);
      ctx.fill();

      // ── border ──
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.lineWidth   = 1;
      this._roundRect(ctx, px + 1, py + 1, CELL - 2, CELL - 2, 4);
      ctx.stroke();

      // ── cell number ──
      const fontSize = Math.max(9, CELL * 0.19);
      ctx.font      = `600 ${fontSize}px Segoe UI, sans-serif`;
      ctx.fillStyle = (pos === 1 || pos === 100) ? '#f39c12' : 'rgba(255,255,255,0.55)';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(pos, cx, py + 3);

      // ── special labels ──
      if (pos === 1) {
        ctx.font      = `bold ${Math.max(7, CELL * 0.16)}px Segoe UI, sans-serif`;
        ctx.fillStyle = '#f39c12';
        ctx.textBaseline = 'bottom';
        ctx.fillText('START', cx, py + CELL - 3);
      }
      if (pos === 100) {
        ctx.font      = `bold ${Math.max(7, CELL * 0.16)}px Segoe UI, sans-serif`;
        ctx.fillStyle = '#f39c12';
        ctx.textBaseline = 'bottom';
        ctx.fillText('FINISH', cx, py + CELL - 3);
      }

      // ── portal symbol ──
      if (cs && cs.destination) {
        const symbol  = cs.type === 'portal-forward' ? '↑' : '↓';
        const symSize = Math.max(11, CELL * 0.30);
        ctx.font      = `${symSize}px Segoe UI, sans-serif`;
        ctx.fillStyle = '#fff';
        ctx.textBaseline = 'middle';
        ctx.fillText(symbol, cx, cy + CELL * 0.1);

        // draw a line toward destination if cells are visible
        this._drawPortalArrow(ctx, pos, cs.destination, cs.type);
      }

      // ── unknown question mark ──
      if (!cs || cs.type === 'unknown') {
        ctx.font      = `${Math.max(10, CELL * 0.28)}px Segoe UI, sans-serif`;
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', cx, cy + CELL * 0.08);
      }
    }
  }

  _drawPortalArrow(ctx, fromPos, toPos, type) {
    if (!toPos) return;
    const from = this._posToPixel(fromPos);
    const to   = this._posToPixel(toPos);
    const color = type === 'portal-forward' ? 'rgba(39,174,96,0.35)' : 'rgba(231,76,60,0.35)';
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // ── player tokens ─────────────────────────────────────────────────────────

  _drawTokens() {
    const ctx  = this.ctx;
    const CELL = this.CELL;

    // Group by position for offset when multiple tokens share a cell
    const posMap = {};
    for (const p of this.players) {
      const tok = this.tokens[p.id];
      if (!tok) continue;
      // Use token's actual render position (rounded) as key
      const key = `${Math.round(tok.x)},${Math.round(tok.y)}`;
      if (!posMap[key]) posMap[key] = [];
      posMap[key].push({ p, tok });
    }

    for (const group of Object.values(posMap)) {
      for (let i = 0; i < group.length; i++) {
        const { p, tok } = group[i];

        // Smooth interpolation toward target
        const speed = 0.16;
        tok.x += (tok.targetX - tok.x) * speed;
        tok.y += (tok.targetY - tok.y) * speed;

        // Offset within shared cell
        const offX = (i % 2 - 0.5) * CELL * 0.35;
        const offY = (Math.floor(i / 2) - 0.25) * CELL * 0.35;
        const rx   = tok.x + offX;
        const ry   = tok.y + offY;
        const r    = CELL * 0.21;

        // Glow for active player
        if (p.id === this.currentPlayerId) {
          ctx.save();
          ctx.shadowBlur  = 18;
          ctx.shadowColor = p.color;
          ctx.restore();
        }

        // Shadow
        ctx.save();
        ctx.shadowOffsetY = 3;
        ctx.shadowBlur    = 8;
        ctx.shadowColor   = 'rgba(0,0,0,0.5)';

        // Circle
        ctx.beginPath();
        ctx.arc(rx, ry, r, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();

        // Active player pulse ring
        if (p.id === this.currentPlayerId) {
          const pulse = 0.6 + 0.4 * Math.sin(this.glowPhase * 2);
          ctx.strokeStyle = `rgba(255,255,255,${pulse})`;
          ctx.lineWidth   = 2.5;
          ctx.stroke();
        } else {
          ctx.strokeStyle = 'rgba(255,255,255,0.4)';
          ctx.lineWidth   = 1.5;
          ctx.stroke();
        }
        ctx.restore();

        // Initial letter
        ctx.font         = `bold ${Math.max(9, r * 1.1)}px Segoe UI, sans-serif`;
        ctx.fillStyle    = '#fff';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.name[0].toUpperCase(), rx, ry);

        // Finished crown
        if (p.finished) {
          ctx.font         = `${r}px Segoe UI, sans-serif`;
          ctx.textBaseline = 'bottom';
          ctx.fillText('👑', rx, ry - r + 2);
        }
      }
    }
  }

  // ── particle effects ──────────────────────────────────────────────────────

  _drawParticles() {
    const ctx = this.ctx;
    this.portalFlashes = this.portalFlashes.filter(p => p.alpha > 0.02);
    for (const p of this.portalFlashes) {
      p.x     += p.vx;
      p.y     += p.vy;
      p.vy    += 0.05;
      p.alpha -= 0.025;
      p.r     *= 0.98;

      ctx.globalAlpha = p.alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ── utilities ─────────────────────────────────────────────────────────────

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}
