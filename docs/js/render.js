// Canvas renderer: rectangular chronogram, time running left to right.
//
// SVG is not an option here. Fully expanded this is 68,000 tips and roughly
// 133,000 branches, which is two orders of magnitude past where the DOM stops
// being usable. Everything is drawn to one canvas and clipped to the viewport.

import { FLAG_EXTINCT, FLAG_IMPUTED, FLAG_SCHEMATIC, FLAG_RANGE } from './data.js';

const AXIS_H = 46;
const GRADE_GUTTER = 14;
const PAD_L = 12;
const LABEL_GAP = 7;
const MIN_LABEL_ROW = 7.5;

export class Renderer {
  constructor(canvas, tree) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.tree = tree;
    this.view = { tMax: tree.meta.rootAge, tMin: 0, scrollY: 0, rowH: 22 };
    this.colours = readColours(canvas);
    this.hover = -1;
    this.selected = -1;
    this.highlightGrades = new Set();
    this.showImputed = true;
    this.gradeById = new Map(tree.meta.grades.map((g, i) => [g.id, { ...g, bit: i }]));
    this.gradeByBit = tree.meta.grades.map((g, i) => ({ ...g, bit: i }));
    this.fossilByNode = new Map(tree.meta.fossils.map((f) => [f.node, f]));
    this.cladeByNode = new Map(tree.meta.clades.map((c) => [c.node, c]));
    this.taxonByNode = new Map(tree.meta.taxonNodes.map((t) => [t.node, t]));
    this.resize();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(320, r.width);
    this.h = Math.max(240, r.height);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.colours = readColours(this.canvas);
  }

  get plotL() { return PAD_L; }
  get plotW() { return Math.max(80, this.w * this.labelSplit() - PAD_L); }

  labelSplit() {
    // Reserve more of the width for names when rows are tall enough to show
    // them, and hand it back to the tree when they are not.
    return this.view.rowH >= MIN_LABEL_ROW ? 0.62 : 0.97;
  }

  x(age) {
    const { tMax, tMin } = this.view;
    const span = Math.max(1e-6, tMax - tMin);
    return this.plotL + ((tMax - age) / span) * this.plotW;
  }

  ageAt(px) {
    const { tMax, tMin } = this.view;
    return tMax - ((px - this.plotL) / this.plotW) * (tMax - tMin);
  }

  y(row) { return AXIS_H + (row + 0.5) * this.view.rowH - this.view.scrollY; }

  rowAt(py) {
    return Math.floor((py + this.view.scrollY - AXIS_H) / this.view.rowH);
  }

  maxScroll(nRows) {
    return Math.max(0, nRows * this.view.rowH - (this.h - AXIS_H) + 8);
  }

  // ------------------------------------------------------------------------

  draw(lay, collapsed) {
    this._lay = lay;
    this._collapsed = collapsed || new Set();
    const { ctx, w, h } = this;
    const c = this.colours;
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, w, h);

    this.drawPeriods(lay);
    this.drawBranches(lay);
    this.drawGradeGutter(lay);
    this.drawAxis();
  }

  drawPeriods(lay) {
    const { ctx, h } = this;
    const c = this.colours;
    const top = AXIS_H;
    for (const p of this.tree.meta.periods) {
      const x0 = this.x(p.start), x1 = this.x(p.end);
      if (x1 < this.plotL || x0 > this.plotL + this.plotW) continue;
      const a = Math.max(x0, this.plotL), b = Math.min(x1, this.plotL + this.plotW);
      const i = this.tree.meta.periods.indexOf(p);
      ctx.fillStyle = i % 2 ? c.bandA : c.bandB;
      ctx.fillRect(a, top, b - a, h - top);
    }
  }

  drawAxis() {
    const { ctx, w } = this;
    const c = this.colours;
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, w, AXIS_H);
    ctx.strokeStyle = c.rule;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, AXIS_H - 0.5); ctx.lineTo(w, AXIS_H - 0.5);
    ctx.stroke();

    const right = this.plotL + this.plotW;
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';

    for (const p of this.tree.meta.periods) {
      let x0 = this.x(p.start), x1 = this.x(p.end);
      if (x1 < this.plotL || x0 > right) continue;
      x0 = Math.max(x0, this.plotL); x1 = Math.min(x1, right);
      const i = this.tree.meta.periods.indexOf(p);
      ctx.fillStyle = i % 2 ? c.bandA : c.bandB;
      ctx.fillRect(x0, AXIS_H - 17, x1 - x0, 16);
      ctx.strokeStyle = c.rule;
      ctx.beginPath();
      ctx.moveTo(x1 - 0.5, AXIS_H - 17); ctx.lineTo(x1 - 0.5, AXIS_H - 1);
      ctx.stroke();
      const wide = x1 - x0;
      if (wide > 34) {
        ctx.fillStyle = c.axisText;
        ctx.textAlign = 'center';
        const name = wide > 78 ? p.name : p.name.slice(0, 1);
        ctx.fillText(name, (x0 + x1) / 2, AXIS_H - 9);
      }
    }

    // Tick labels in Ma, on a round step that fits the current window.
    const span = this.view.tMax - this.view.tMin;
    const step = niceStep(span / 8);
    ctx.textAlign = 'center';
    ctx.fillStyle = c.axisText;
    const first = Math.ceil(this.view.tMin / step) * step;
    for (let a = first; a <= this.view.tMax + 1e-9; a += step) {
      const px = this.x(a);
      if (px < this.plotL - 1 || px > right + 1) continue;
      ctx.strokeStyle = c.rule;
      ctx.beginPath();
      ctx.moveTo(px, AXIS_H - 22); ctx.lineTo(px, AXIS_H - 18);
      ctx.stroke();
      ctx.fillText(fmtMa(a, step), px, AXIS_H - 29);
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = c.axisDim;
    ctx.fillText('Ma', right + 6, AXIS_H - 29);
  }

  drawBranches(lay) {
    const { ctx } = this;
    const c = this.colours;
    const t = this.tree;
    const { yOf, lo, hi, visible } = lay;
    const rowH = this.view.rowH;
    const top = AXIS_H - rowH, bottom = this.h + rowH;
    const right = this.plotL + this.plotW;
    const showLabels = rowH >= MIN_LABEL_ROW;

    ctx.lineWidth = Math.min(1.6, Math.max(0.8, rowH / 16));
    ctx.font = `${Math.min(13, Math.max(9, rowH * 0.62))}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textBaseline = 'middle';

    const selPath = this.selected >= 0 ? new Set(t.pathToRoot(this.selected)) : null;

    for (let vi = 0; vi < visible.length; vi++) {
      const i = visible[vi];
      // Cull first, on numbers only. Everything below this line runs for the
      // few hundred nodes actually on screen.
      if (this.y(hi[i]) < top || this.y(lo[i]) > bottom) continue;

      const yi = this.y(yOf[i]);
      // A collapsed node's children were never visited by the layout, so they
      // all have yOf === -1. Decide collapsed-ness from the real children
      // first, and only filter for the nodes we actually descend into.
      const collapsed = this._collapsed.has(i) && !t.isTip(i);
      const kids = collapsed ? EMPTY_KIDS : visibleKids(t, i, yOf);

      const p = t.parent(i);
      const xi = this.x(t.age(i));
      const xp = p === -1 ? this.plotL : this.x(t.age(p));
      const onPath = selPath && selPath.has(i);

      const isExtinct = t.flag(i, FLAG_EXTINCT);
      const isImputed = t.flag(i, FLAG_IMPUTED);
      const schematic = t.flag(i, FLAG_SCHEMATIC) || i >= t.n;

      let stroke = c.branch;
      if (isExtinct) stroke = c.extinct;
      else if (isImputed && this.showImputed) stroke = c.imputed;
      if (onPath) stroke = c.pathHi;
      if (i === this.hover) stroke = c.hover;

      ctx.strokeStyle = stroke;
      ctx.lineWidth = onPath ? 2.2 : Math.min(1.6, Math.max(0.8, rowH / 16));

      // Horizontal branch.
      if (schematic) ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(Math.max(xp, -20), yi);
      ctx.lineTo(Math.min(xi, right + 40), yi);
      ctx.stroke();
      if (schematic) ctx.setLineDash([]);

      if (collapsed) {
        this.drawTriangle(i, xi, yi, c, onPath);
      } else if (kids.length === 0) {
        this.drawTipMark(i, xi, yi, c, isExtinct);
      } else {
        // Vertical connector spanning the children.
        const ys = this.y(yOf[kids[0]]);
        const ye = this.y(yOf[kids[kids.length - 1]]);
        ctx.beginPath();
        ctx.moveTo(xi, Math.max(ys, top - 40));
        ctx.lineTo(xi, Math.min(ye, bottom + 40));
        ctx.stroke();
      }

      if (!showLabels) continue;
      if (kids.length === 0 || collapsed) {
        this.drawRowLabel(i, yi, collapsed, c, onPath);
      } else {
        this.drawInternalLabel(i, xi, yi, c);
      }
    }
  }

  drawTriangle(i, xi, yi, c, onPath) {
    const { ctx } = this;
    const t = this.tree;
    const rowH = this.view.rowH;
    const tips = t.tipCount[i];
    const youngest = t.minAge[i];
    const xEnd = this.x(Math.max(youngest, this.view.tMin));
    const half = Math.max(2.5, Math.min(rowH * 0.42, 9));
    const allExtinct = t.extinctCount[i] === tips;
    ctx.beginPath();
    ctx.moveTo(xi, yi);
    ctx.lineTo(xEnd, yi - half);
    ctx.lineTo(xEnd, yi + half);
    ctx.closePath();
    ctx.fillStyle = allExtinct ? c.extinctFill
      : (onPath ? c.pathFill : c.triFill);
    ctx.fill();
    ctx.strokeStyle = allExtinct ? c.extinct : (onPath ? c.pathHi : c.branch);
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  drawTipMark(i, xi, yi, c, isExtinct) {
    if (!isExtinct) return;
    const { ctx } = this;
    const t = this.tree;
    const f = this.fossilByNode.get(i);
    if (!f) return;
    // Stratigraphic range as a bar, ghost lineage as the thin line before it.
    const xFa = this.x(f.fa), xLa = this.x(f.la);
    const hh = Math.max(1.5, Math.min(this.view.rowH * 0.3, 5));
    ctx.fillStyle = c.extinct;
    ctx.fillRect(Math.min(xFa, xLa), yi - hh / 2, Math.max(1.5, Math.abs(xLa - xFa)), hh);
  }

  drawRowLabel(i, yi, collapsed, c, onPath) {
    const { ctx } = this;
    const t = this.tree;
    const x0 = this.plotL + this.plotW + LABEL_GAP + GRADE_GUTTER;
    if (x0 > this.w - 8) return;
    const isExtinct = t.flag(i, FLAG_EXTINCT);
    const isImputed = t.flag(i, FLAG_IMPUTED);

    let text = t.label(i);
    if (collapsed) {
      const n = t.tipCount[i];
      const named = this.cladeByNode.get(i) || this.taxonByNode.get(i);
      text = (named ? named.label : text) || 'unnamed clade';
      if (named && named.nonMono) text += '\u2009*';
      text += `  ${n.toLocaleString()}`;
    }
    if (!text) return;

    ctx.fillStyle = onPath ? c.pathHi
      : isExtinct ? c.extinctText
      : (isImputed && this.showImputed) ? c.imputedText
      : c.text;
    if (i === this.selected) ctx.fillStyle = c.selText;
    const max = this.w - x0 - 6;
    ctx.fillText(clip(ctx, text, max), x0, yi);

    if (isImputed && this.showImputed && !collapsed) {
      ctx.fillStyle = c.imputedText;
      ctx.fillRect(x0 - 5, yi - 1.5, 3, 3);
    }
  }

  drawInternalLabel(i, xi, yi, c) {
    const named = this.cladeByNode.get(i) || this.taxonByNode.get(i);
    if (!named) return;
    const { ctx } = this;
    const rowH = this.view.rowH;
    // Only label an internal node when its clade is tall enough to read.
    if (Math.abs(this.yOfSpan(i)) < 26) return;
    ctx.save();
    ctx.fillStyle = c.cladeText;
    ctx.font = `600 ${Math.min(12, Math.max(9, rowH * 0.55))}px ui-sans-serif, system-ui, sans-serif`;
    const text = clip(ctx, named.label + (named.nonMono ? '\u2009*' : ''), 170);
    const tw = ctx.measureText(text).width;
    // Deep nodes sit hard against the left edge, where a right-aligned label
    // runs off the canvas. Flip it to the inside of the clade instead.
    if (xi - 5 - tw >= this.plotL) {
      ctx.textAlign = 'right';
      ctx.fillText(text, xi - 5, yi);
    } else {
      ctx.textAlign = 'left';
      const room = this.plotL + this.plotW - (xi + 5);
      if (room > 26) ctx.fillText(clip(ctx, named.label, room), xi + 5, yi - rowH * 0.55);
    }
    ctx.restore();
    ctx.textAlign = 'left';
  }

  yOfSpan(i) {
    const lay = this._lay;
    if (!lay) return 0;
    const kids = visibleKids(this.tree, i, lay.yOf);
    if (!kids.length) return 0;
    return (lay.yOf[kids[kids.length - 1]] - lay.yOf[kids[0]]) * this.view.rowH;
  }

  drawGradeGutter(lay) {
    if (!this.highlightGrades.size) return;
    const { ctx } = this;
    const t = this.tree;
    const x0 = this.plotL + this.plotW + 3;
    const rowH = this.view.rowH;
    const runs = new Map();

    const firstRow = Math.max(0, this.rowAt(AXIS_H) - 1);
    const lastRow = Math.min(lay.rows.length - 1, this.rowAt(this.h) + 1);
    for (let r = firstRow; r <= lastRow; r++) {
      const node = lay.rows[r];
      const f = this.fossilByNode.get(node);
      let mask = f ? f.grades : 0;
      if (!mask && t.children(node).length) {
        // A collapsed clade inherits the grades of the fossils inside it.
        for (const kid of descendantFossils(t, node, this.fossilByNode, 200)) {
          mask |= kid.grades;
        }
      }
      if (!mask) continue;
      for (const g of this.gradeByBit) {
        if (!this.highlightGrades.has(g.id)) continue;
        if (!(mask & (1 << g.bit))) continue;
        let arr = runs.get(g.id);
        if (!arr) { arr = []; runs.set(g.id, arr); }
        const last = arr[arr.length - 1];
        if (last && last[1] === r - 1) last[1] = r;
        else arr.push([r, r]);
      }
    }

    let slot = 0;
    for (const [gid, ranges] of runs) {
      const g = this.gradeById.get(gid);
      const gx = x0 + slot * 5;
      ctx.fillStyle = g.colour || '#888';
      for (const [a, b] of ranges) {
        const ya = this.y(a) - rowH / 2, yb = this.y(b) + rowH / 2;
        if (yb < AXIS_H || ya > this.h) continue;
        ctx.fillRect(gx, Math.max(ya, AXIS_H), 3, Math.min(yb, this.h) - Math.max(ya, AXIS_H));
      }
      slot++;
      if (slot > 2) break;
    }
  }

  /** Node under the cursor: the row's node, or an ancestor whose join it touches. */
  pick(lay, px, py) {
    const r = this.rowAt(py);
    if (r < 0 || r >= lay.rows.length) return -1;
    const t = this.tree;
    const leaf = lay.rows[r];
    if (px > this.plotL + this.plotW) return leaf;

    let best = -1, bestD = 9;
    let cur = leaf;
    while (cur !== -1) {
      const xc = this.x(t.age(cur));
      const yc = this.y(lay.yOf[cur]);
      const d = Math.abs(px - xc);
      if (d < bestD && Math.abs(py - yc) < Math.max(this.view.rowH, 10) * 1.6) {
        best = cur; bestD = d;
      }
      cur = t.parent(cur);
    }
    if (best !== -1) return best;
    return leaf;
  }
}

const EMPTY_KIDS = new Int32Array(0);

function visibleKids(tree, i, yOf) {
  const all = tree.children(i);
  for (let k = 0; k < all.length; k++) {
    if (yOf[all[k]] < 0) {
      const out = [];
      for (let j = 0; j < all.length; j++) if (yOf[all[j]] >= 0) out.push(all[j]);
      return out;
    }
  }
  return all;
}

function descendantFossils(tree, node, map, cap) {
  const out = [];
  const stack = [node];
  let seen = 0;
  while (stack.length && seen < cap) {
    const i = stack.pop(); seen++;
    const f = map.get(i);
    if (f) out.push(f);
    const kids = tree.children(i);
    for (let k = 0; k < kids.length; k++) stack.push(kids[k]);
  }
  return out;
}

function clip(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + '…').width <= max) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + '…';
}

function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-6))));
  const n = raw / p;
  return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * p;
}

function fmtMa(a, step) {
  if (step >= 1) return String(Math.round(a));
  return a.toFixed(Math.min(3, Math.max(0, -Math.floor(Math.log10(step)))));
}

function readColours(el) {
  const s = getComputedStyle(el);
  const get = (k, fb) => (s.getPropertyValue(k) || '').trim() || fb;
  return {
    bg: get('--canvas-bg', '#ffffff'),
    bandA: get('--band-a', '#f6f5f2'),
    bandB: get('--band-b', '#efeee9'),
    rule: get('--rule', '#c9c7c0'),
    branch: get('--branch', '#3d4450'),
    extinct: get('--extinct', '#b0402f'),
    extinctFill: get('--extinct-fill', '#e8c4bb'),
    extinctText: get('--extinct-text', '#8f3325'),
    imputed: get('--imputed', '#a8a49a'),
    imputedText: get('--imputed-text', '#8d8880'),
    triFill: get('--tri-fill', '#c8cdd6'),
    pathFill: get('--path-fill', '#bcd4ea'),
    pathHi: get('--path-hi', '#1f6feb'),
    hover: get('--hover', '#d9822b'),
    text: get('--text', '#22262e'),
    selText: get('--sel-text', '#1f6feb'),
    cladeText: get('--clade-text', '#5c6470'),
    axisText: get('--axis-text', '#4a5058'),
    axisDim: get('--axis-dim', '#8d8880'),
  };
}
