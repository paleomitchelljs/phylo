/* UI: canvas, dragging, panels. */
(function (P) {
  'use strict';
  const F = P.F;
  const $ = s => document.querySelector(s);
  const NS = 'http://www.w3.org/2000/svg';
  const GAP = 34, LEV = 34, STEM = 26, HIT = 24;
  const COLORS = ['#d1495b', '#00798c', '#e09f1f', '#6a4c93', '#30638e', '#e07a5f', '#3d9970', '#b56576', '#8d6a1f', '#1b998b', '#c2185b', '#5d7f2a'];
  const KEY = 'tree365.v1';

  const A = {
    S: null, undo: [], redo: [],
    view: { x: 0, y: 0, k: 1 },
    sel: null, brush: null, check: false, answer: false, variant: 0,
    style: 'square', drag: null, deckName: '',
  };

  /* ── state & history ───────────────────────────────────────────── */

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ S: A.S, view: A.view, style: A.style, check: A.check })); } catch (e) { /* storage off */ }
  }
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY));
      if (d && d.S && d.S.deck.every(k => P.refByKey.has(k))) {
        A.S = d.S; A.view = d.view || A.view; A.style = d.style || A.style; A.check = !!d.check;
        return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }
  function commit(fn) {
    const before = JSON.stringify(A.S);
    const r = fn(A.S);
    if (JSON.stringify(A.S) === before) return r;
    A.undo.push(before); if (A.undo.length > 200) A.undo.shift();
    A.redo = [];
    if (A.sel && !A.S.nodes[A.sel]) A.sel = null;
    save(); render();
    return r;
  }
  function undo() { if (!A.undo.length) return; A.redo.push(JSON.stringify(A.S)); A.S = JSON.parse(A.undo.pop()); afterHistory(); }
  function redo() { if (!A.redo.length) return; A.undo.push(JSON.stringify(A.S)); A.S = JSON.parse(A.redo.pop()); afterHistory(); }
  function afterHistory() { if (A.sel && !A.S.nodes[A.sel]) A.sel = null; save(); renderAll(); }

  /* ── layout ────────────────────────────────────────────────────── */

  function height(N, id) { const n = N[id]; return n.k.length ? 1 + Math.max(...n.k.map(c => height(N, c))) : 0; }

  /* positions for the subtree at id with its root at (rx, ry); tips up */
  function layout(N, id, rx, ry, pos) {
    pos = pos || {};
    const H = height(N, id);
    let leaf = 0;
    const local = {};
    (function walk(x, d) {
      const n = N[x];
      if (!n.k.length) local[x] = { x: leaf++ * GAP };
      else { n.k.forEach(c => walk(c, d + 1)); local[x] = { x: (local[n.k[0]].x + local[n.k[n.k.length - 1]].x) / 2 }; }
      local[x].h = height(N, x);
    })(id, 0);
    const dx = rx - local[id].x;
    (function place(x, par) {
      const n = N[x];
      pos[x] = { x: local[x].x + dx, y: ry - (H - local[x].h) * LEV, p: par };
      n.k.forEach(c => place(c, x));
    })(id, null);
    pos[id].root = true;
    pos[id].w = (leaf - 1) * GAP;
    return pos;
  }
  function layoutAll(M) {
    const pos = {};
    for (const r of M.roots) layout(M.nodes, r.id, r.x, r.y, pos);
    return pos;
  }

  /* ── drawing ───────────────────────────────────────────────────── */

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const traitColor = id => { const t = P.traitById.get(id); if (t) return COLORS[t.i % COLORS.length]; const i = A.S.custom.findIndex(c => c.id === id); return COLORS[(P.TRAITS.length + i * 5) % COLORS.length]; };

  function branchPath(a, b, style) {   // a = node, b = parent (or null for root stem)
    if (!b) return `M${a.x} ${a.y}V${a.y + STEM}`;
    return style === 'slant' ? `M${a.x} ${a.y}L${b.x} ${b.y}` : `M${a.x} ${a.y}V${b.y}H${b.x}`;
  }
  function branchPoint(a, b, t, style) {
    if (!b) return { x: a.x, y: a.y + 6 + t * (STEM - 10) };
    if (style === 'slant') return { x: a.x + (b.x - a.x) * (0.2 + t * 0.6), y: a.y + (b.y - a.y) * (0.2 + t * 0.6) };
    const top = a.y + 16, bot = b.y - 5;
    return { x: a.x, y: top + (Math.max(bot, top) - top) * t };
  }

  function tipName(key) {
    const n = P.refByKey.get(key);
    return n ? n.name + (n.fossil ? ' †' : '') : key;
  }

  /* Draw a forest model. o: { pos, check, paint, marks, sel, dim:Set, interactive } */
  function drawForest(M, o) {
    const pos = o.pos, N = M.nodes, out = { e: [], h: [], m: [], n: [], l: [] };
    for (const id in pos) {
      const a = pos[id], b = a.p ? pos[a.p] : null, n = N[id];
      const dim = o.dim && o.dim.has(id) ? ' dim' : '';
      const painted = o.paint && o.paint[id];
      const col = painted ? ` style="stroke:${o.paintColor};stroke-width:3.2"` : '';
      out.e.push(`<path class="e${dim}" d="${branchPath(a, b, o.style)}"${col}/>`);
      if (o.interactive) out.h.push(`<path class="hit" data-b="${id}" d="${branchPath(a, b, o.style)}"/>`);
      // trait marks on this branch
      const here = [];
      for (const t in o.marks) for (const m of o.marks[t]) if (m.n === id) here.push([t, m]);
      here.forEach(([t, m], i) => {
        const p = branchPoint(a, b, here.length === 1 ? 0.5 : i / (here.length - 1), o.style);
        const st = o.check && o.check.mark[t] ? o.check.mark[t][id] || '' : '';
        const c = traitColor(t);
        const name = (P.traitById.get(t) || A.S.custom.find(x => x.id === t) || { name: t }).name;
        const on = o.brush === t ? ' style="stroke-width:2.5"' : '';
        out.m.push(`<rect class="mk${m.loss ? ' loss' : ''} ${st}" data-b="${id}" x="${p.x - 8}" y="${p.y - 2.5}" width="16" height="5" rx="1.5" fill="${c}" stroke="${c}"${on}><title>${esc(name)}${m.loss ? ' (lost)' : ''}</title></rect>`);
      });
      // node
      const st = o.check ? (o.check.node[id] || '') : '';
      const cls = n.t ? 'tip' : n.ph ? 'ph' : '';
      const ring = o.sel === id ? `<circle class="ring" r="${n.ph ? 13 : 9}"/>` : '';
      if (n.ph) out.n.push(`<g class="nd ph${dim}" data-n="${id}" transform="translate(${a.x},${a.y})">${ring}<circle class="c" r="9"/><text>?</text></g>`);
      else out.n.push(`<g class="nd ${cls} ${n.t ? '' : st}${dim}" data-n="${id}" transform="translate(${a.x},${a.y})">${ring}<circle class="c" r="${n.t ? 4 : 5}"/><circle r="${HIT / 2}" fill="transparent"/></g>`);
      if (a.root && o.interactive) out.n.push(`<g class="nd grip${dim}" data-n="${id}" transform="translate(${a.x},${a.y + STEM + 4})"><rect class="c" x="-9" y="-4" width="18" height="8" rx="4"/><title>move</title></g>`);
      if (n.t) {
        const ref = P.refByKey.get(n.t);
        out.l.push(`<text class="tl${ref && ref.fossil ? ' fos' : ''}${dim}" data-n="${id}" transform="translate(${a.x + 3},${a.y - 9}) rotate(-60)">${esc(tipName(n.t))}${ref && ref.sub && !ref.org ? `<title>${esc(ref.sub)}</title>` : ''}</text>`);
      }
      if (n.lab) {
        const ls = o.check ? (o.check.label[id] || '') : '';
        const ly = n.t ? a.y + 22 : a.y + 15;
        out.l.push(`<text class="nl ${ls}${dim}" data-l="${id}" x="${a.x + 7}" y="${ly}">${esc(n.lab)}</text>`);
      }
    }
    return out.e.join('') + out.h.join('') + out.m.join('') + out.n.join('') + out.l.join('');
  }

  function paintMap(M, marks) {
    const map = {};
    if (!marks) return map;
    (function w(ids, st) { for (const id of ids) { const m = marks.find(x => x.n === id); const s = m ? !m.loss : st; map[id] = s; w(M.nodes[id].k, s); } })(M.roots.map(r => r.id), false);
    return map;
  }

  let POS = {}, SCORE = null;
  const world = $('#world'), cv = $('#cv');

  function render() {
    const S = A.S;
    POS = layoutAll(S);
    SCORE = A.check ? P.score(S) : null;
    const d = A.drag;
    const dim = d && d.kind === 'node' && d.moved ? new Set(F.sub(S, d.id)) : null;
    let html = drawForest(S, {
      pos: POS, check: SCORE, marks: S.marks, sel: A.sel, dim, interactive: true, style: A.style, brush: A.brush,
      paint: A.brush ? paintMap(S, S.marks[A.brush] || []) : null, paintColor: A.brush && traitColor(A.brush),
    });
    if (d && d.moved && d.over) {
      if (d.target) {
        const t = POS[d.target.id];
        html += `<circle class="target ${d.target.mode}" cx="${t.x}" cy="${t.y}" r="${d.target.mode === 'fill' ? 13 : 11}"/>`;
      }
      const g = ghostModel(d);
      if (g) html += `<g class="ghost">${drawForest(g, { pos: layoutAll(g), marks: {}, style: A.style })}</g>`;
    }
    world.innerHTML = html;
    world.setAttribute('transform', `translate(${A.view.x},${A.view.y}) scale(${A.view.k})`);
    $('#empty').hidden = S.roots.length > 0;
    renderTools(); renderScore();
    if (A.answer) renderAnswer();
  }
  function renderAll() { renderDeck(); renderChips(); renderTraits(); render(); }

  function ghostModel(d) {
    const S = A.S, w = d.world;
    if (d.kind === 'chip') return { nodes: { g: { id: 'g', k: [], t: d.key, lab: '' } }, roots: [{ id: 'g', x: w.x, y: w.y }] };
    const nodes = {};
    for (const id of F.sub(S, d.id)) nodes[id] = S.nodes[id];
    return { nodes, roots: [{ id: d.id, x: w.x + d.off.x, y: w.y + d.off.y }] };
  }

  /* ── side panels ───────────────────────────────────────────────── */

  const refOrder = new Map(); { let i = 0; (function w(n) { refOrder.set(n.key, i++); n.k.forEach(w); })(P.ref); }

  function renderDeck() {
    const sel = $('#deck');
    const known = P.DECKS.find(d => d.id === A.S.deckId);
    sel.innerHTML = P.DECKS.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('') +
      `<option value="_custom"${known ? '' : ' selected'}>${known ? 'Custom' : esc(A.S.deckName || 'Custom')}</option>`;
    if (known) sel.value = known.id;
  }

  function renderChips() {
    const placed = new Set(F.placed(A.S));
    const left = A.S.deck.filter(k => !placed.has(k)).sort((a, b) => refOrder.get(a) - refOrder.get(b));
    $('#chips').innerHTML = left.map(k => {
      const n = P.refByKey.get(k);
      return `<div class="chip${n.org ? '' : ' grp'}" data-k="${k}" title="${esc(n.sub || '')}">${esc(tipName(k))}<span class="x" data-x="${k}">×</span></div>`;
    }).join('');
  }

  function traitList() {
    const app = P.applicableTraits(A.S.deck);
    const used = Object.keys(A.S.marks).filter(t => A.S.marks[t].length);
    const all = app.slice();
    for (const t of used) if (P.traitById.has(t) && !all.includes(P.traitById.get(t))) all.push(P.traitById.get(t));
    return all.concat(A.S.custom);
  }

  function renderTraits() {
    const f = $('#tfilter').value.trim().toLowerCase();
    const rows = traitList().filter(t => !f || t.name.toLowerCase().includes(f));
    $('#tlist').innerHTML = rows.map(t => {
      const n = (A.S.marks[t.id] || []).length;
      const st = SCORE && SCORE.mark[t.id] ? Object.values(SCORE.mark[t.id]) : null;
      const dot = st ? `<span class="st" style="background:var(--${st.every(s => s === 'ok') ? 'ok' : st.includes('bad') ? 'bad' : 'meh'})"></span>` : '';
      return `<div class="trait${A.brush === t.id ? ' on' : ''}" data-t="${t.id}"><span class="sw" style="background:${traitColor(t.id)}"></span><span class="n">${esc(t.name)}</span>${dot}<span class="c">${n || ''}</span></div>`;
    }).join('');
    cv.classList.toggle('paint', !!A.brush);
  }

  function renderScore() {
    const el = $('#score');
    if (!SCORE) { el.innerHTML = ''; return; }
    const s = SCORE;
    const bits = [`<span class="s" title="nodes"><i>⑂</i><b>${s.nodesOk}</b>/${s.nodesNeed}</span>`];
    if (s.labelsAll) bits.push(`<span class="s" title="names"><i>Aa</i><b>${s.labelsOk}</b>/${s.labelsAll}</span>`);
    if (s.traitsNeed) bits.push(`<span class="s" title="traits"><i>▮</i><b>${s.traitsOk}</b>/${s.traitsNeed}</span>`);
    el.innerHTML = bits.join('');
    renderTraitDots();
  }
  function renderTraitDots() {
    for (const row of document.querySelectorAll('.trait')) {
      const t = row.dataset.t, old = row.querySelector('.st');
      if (old) old.remove();
      const st = SCORE && SCORE.mark[t] ? Object.values(SCORE.mark[t]) : null;
      if (!st) continue;
      const dot = document.createElement('span');
      dot.className = 'st';
      dot.style.background = `var(--${st.every(x => x === 'ok') ? 'ok' : st.includes('bad') ? 'bad' : 'meh'})`;
      row.insertBefore(dot, row.querySelector('.c'));
    }
  }

  /* ── answer panel ──────────────────────────────────────────────── */

  function renderAnswer() {
    const V = P.variants[A.variant] || P.ref;
    if (!A.S.deck.length) { $('#ans').innerHTML = ''; $('#alts').innerHTML = ''; return; }
    const { root, R } = P.answerTree(A.S.deck, V);
    const M = { nodes: {}, roots: [] }, sigId = {};
    let i = 0;
    (function conv(c, p) {
      const id = 'a' + (i++);
      sigId[c.sig] = id;
      M.nodes[id] = { id, p, t: c.t || null, k: [], lab: c.lab };
      M.nodes[id].k = c.k.map(x => conv(x, id));
      return id;
    })(root, null);
    M.roots.push({ id: 'a0', x: 0, y: 0 });
    let marks = {}, paint = null;
    if (A.brush && P.traitById.has(A.brush)) {
      const ev = [...P.refTraitEvents(P.traitById.get(A.brush), R)];
      marks[A.brush] = ev.map(code => ({ n: sigId[code.slice(0, -1)], loss: code.endsWith('-') })).filter(m => m.n);
      paint = paintMap(M, marks[A.brush]);
    }
    const pos = layoutAll(M);
    const svg = $('#ans');
    svg.innerHTML = `<g>${drawForest(M, { pos, marks, paint, paintColor: A.brush && traitColor(A.brush), style: A.style })}</g>`;
    const xs = Object.values(pos).map(p => p.x), ys = Object.values(pos).map(p => p.y);
    const longest = Math.max(...Object.values(M.nodes).filter(n => n.t).map(n => tipName(n.t).length)) * 6.6 * 0.87;
    const x0 = Math.min(...xs) - 30, x1 = Math.max(...xs) + longest * 0.5 + 30, y0 = Math.min(...ys) - longest - 20, y1 = Math.max(...ys) + STEM + 10;
    svg.setAttribute('viewBox', `${x0} ${y0} ${x1 - x0} ${y1 - y0}`);
    // which alternatives matter for this deck
    const sigs = P.variants.map(v => [...P.restrict(v, A.S.deck).clusters.keys()].sort().join('|'));
    const distinct = sigs.map((s, j) => sigs.indexOf(s) === j ? j : -1).filter(j => j >= 0);
    $('#alts').innerHTML = distinct.length > 1 ? distinct.map((j, n) => `<button data-v="${j}" class="${(sigs[A.variant] === sigs[j]) ? 'on' : ''}">${n + 1}</button>`).join('') : '';
  }

  /* ── selection tools & labeler ─────────────────────────────────── */

  const toScreen = p => ({ x: p.x * A.view.k + A.view.x, y: p.y * A.view.k + A.view.y });
  const toWorld = (cx, cy) => { const r = cv.getBoundingClientRect(); return { x: (cx - r.left - A.view.x) / A.view.k, y: (cy - r.top - A.view.y) / A.view.k }; };

  function renderTools() {
    const t = $('#tools');
    if (!A.sel || !POS[A.sel] || A.drag) { t.hidden = true; return; }
    const n = A.S.nodes[A.sel], s = toScreen(POS[A.sel]);
    t.hidden = false;
    t.style.left = s.x + 'px'; t.style.top = s.y + 'px';
    t.querySelector('[data-a=rotate]').disabled = n.k.length < 2;
    t.querySelector('[data-a=collapse]').disabled = !n.k.length;
  }

  function editLabel(id) {
    const inp = $('#labeler'), p = toScreen(POS[id]);
    inp.hidden = false;
    inp.style.left = p.x + 'px'; inp.style.top = (p.y + 30) + 'px';
    inp.value = A.S.nodes[id].lab || '';
    inp.dataset.id = id;
    $('#tools').hidden = true;
    inp.focus(); inp.select();
  }
  function closeLabel(ok) {
    const inp = $('#labeler');
    if (inp.hidden) return;
    inp.hidden = true;
    const id = inp.dataset.id;
    if (ok && A.S.nodes[id]) commit(S => F.label(S, id, inp.value));
    else render();
  }
  $('#labeler').addEventListener('keydown', e => {
    if (e.key === 'Enter') closeLabel(true);
    if (e.key === 'Escape') closeLabel(false);
    e.stopPropagation();
  });
  $('#labeler').addEventListener('blur', () => closeLabel(true));

  function act(a, id) {
    id = id || A.sel;
    if (!id || !A.S.nodes[id]) return;
    if (a === 'label') return editLabel(id);
    if (a === 'rotate') commit(S => F.rotate(S, id));
    if (a === 'split') commit(S => { const r = F.split(S, id); A.sel = r; });
    if (a === 'collapse') commit(S => F.collapse(S, id));
    if (a === 'remove') { A.sel = null; commit(S => F.remove(S, id)); renderChips(); renderTraits(); }
  }
  $('#tools').addEventListener('pointerdown', e => e.stopPropagation());
  $('#tools').addEventListener('click', e => { const b = e.target.closest('button'); if (b) act(b.dataset.a); });

  /* ── canvas pointer handling ───────────────────────────────────── */

  function findTarget(w, exclude, shift) {
    let best = null, bd = (HIT + 4) / Math.min(A.view.k, 1.4);
    for (const id in POS) {
      if (exclude && exclude.has(id)) continue;
      const p = POS[id], dd = Math.hypot(p.x - w.x, p.y - w.y);
      if (dd < bd) { bd = dd; best = id; }
    }
    if (!best) return null;
    const n = A.S.nodes[best];
    const mode = n.ph ? 'fill' : (shift && n.k.length) ? 'poly' : 'join';
    return { id: best, mode, before: w.x < POS[best].x };
  }

  function overPool(cx, cy) {
    const r = $('#pool').getBoundingClientRect();
    return r.width > 0 && cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
  }
  function overStage(cx, cy) { const r = cv.getBoundingClientRect(); return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom; }

  let lastTap = { t: 0, id: null };

  cv.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    closeLabel(true);
    const nEl = e.target.closest('[data-n]'), bEl = e.target.closest('[data-b]'), lEl = e.target.closest('[data-l]');
    const w = toWorld(e.clientX, e.clientY);
    if (lEl) { editLabel(lEl.dataset.l); e.preventDefault(); return; }
    if (A.brush && (bEl || nEl)) {
      const id = (bEl || nEl).dataset.b || (bEl || nEl).dataset.n;
      if (!A.S.nodes[id].ph) commit(S => F.mark(S, A.brush, id, e.shiftKey || e.altKey));
      renderTraits();
      return;
    }
    const id = nEl ? nEl.dataset.n : bEl ? bEl.dataset.b : null;
    if (id) {
      const p = POS[id];
      A.drag = { kind: 'node', id, sx: e.clientX, sy: e.clientY, off: { x: p.x - w.x, y: p.y - w.y }, world: w, moved: false };
    } else {
      A.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: A.view.x, vy: A.view.y, moved: false };
    }
    cv.setPointerCapture(e.pointerId);
  });

  cv.addEventListener('pointermove', e => { if (A.drag && A.drag.kind !== 'chip') dragMove(e); });
  cv.addEventListener('pointerup', e => { if (A.drag && A.drag.kind !== 'chip') dragEnd(e); });
  cv.addEventListener('pointercancel', () => { A.drag = null; cv.classList.remove('pan'); render(); });

  function dragMove(e) {
    const d = A.drag;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
    if (!d.moved && d.kind === 'chip') $('#pool').classList.remove('open');
    d.moved = true;
    if (d.kind === 'pan') {
      A.view.x = d.vx + e.clientX - d.sx; A.view.y = d.vy + e.clientY - d.sy;
      cv.classList.add('pan');
      world.setAttribute('transform', `translate(${A.view.x},${A.view.y}) scale(${A.view.k})`);
      renderTools();
      return;
    }
    d.world = toWorld(e.clientX, e.clientY);
    d.over = overStage(e.clientX, e.clientY);
    d.toPool = overPool(e.clientX, e.clientY);
    $('#pool').classList.toggle('drop', d.toPool && d.kind === 'node');
    const exclude = d.kind === 'node' ? new Set(F.sub(A.S, d.id)) : null;
    d.target = d.over && !d.toPool ? findTarget(d.kind === 'node' ? { x: d.world.x + d.off.x, y: d.world.y + d.off.y } : d.world, exclude, e.shiftKey) : null;
    if (d.kind === 'chip') {
      const dc = $('#dragchip');
      dc.hidden = d.over && !d.toPool;
      dc.style.left = e.clientX + 'px'; dc.style.top = e.clientY + 'px';
    }
    render();
  }

  function dragEnd(e) {
    const d = A.drag;
    A.drag = null;
    cv.classList.remove('pan');
    $('#pool').classList.remove('drop');
    $('#dragchip').hidden = true;
    if (d.kind === 'pan') {
      if (!d.moved) { A.sel = null; render(); }
      save();
      return;
    }
    if (!d.moved) {
      if (d.kind === 'node') return tap(d.id);
      if (d.kind === 'chip') return placeChip(d.key);
      return;
    }
    if (d.kind === 'chip' && !d.over) { render(); return; }
    if (d.kind === 'node' && d.toPool) { A.sel = null; commit(S => F.remove(S, d.id)); return renderAfterTips(); }
    commit(S => {
      const a = d.kind === 'chip' ? F.addTip(S, d.key, d.world.x, d.world.y) : d.id;
      const t = d.target;
      if (!t) {
        if (d.kind === 'node') F.detach(S, a, d.world.x + d.off.x, d.world.y + d.off.y);
        return;
      }
      if (t.mode === 'fill') F.fill(S, t.id, a);
      else if (t.mode === 'poly') F.addChild(S, t.id, a);
      else F.join(S, a, t.id, t.before);
    });
    render();
    renderAfterTips();
  }
  function renderAfterTips() { renderChips(); renderTraits(); }

  function tap(id) {
    const now = Date.now();
    if (lastTap.id === id && now - lastTap.t < 350) { lastTap = { t: 0 }; editLabel(id); return; }
    lastTap = { t: now, id };
    A.sel = A.sel === id ? null : id;
    render();
  }

  cv.addEventListener('dblclick', e => {
    if (e.target.closest('[data-n],[data-b],[data-l]')) return;
    const w = toWorld(e.clientX, e.clientY);
    commit(S => { A.sel = F.newRoot(S, w.x, w.y + LEV); });
  });

  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018));
    zoomAt(mx, my, f);
  }, { passive: false });
  function zoomAt(mx, my, f) {
    const k = Math.min(3, Math.max(0.25, A.view.k * f));
    A.view.x = mx - (mx - A.view.x) * k / A.view.k;
    A.view.y = my - (my - A.view.y) * k / A.view.k;
    A.view.k = k;
    world.setAttribute('transform', `translate(${A.view.x},${A.view.y}) scale(${A.view.k})`);
    renderTools(); save();
  }
  $('#z-in').onclick = () => { const r = cv.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1.25); };
  $('#z-out').onclick = () => { const r = cv.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 0.8); };

  /* chips: drag in from the tip list */
  $('#chips').addEventListener('pointerdown', e => {
    const x = e.target.closest('[data-x]');
    if (x) {
      const k = x.dataset.x;
      commit(S => { S.deck = S.deck.filter(d => d !== k); S.deckId = null; });
      renderAll();
      return;
    }
    const c = e.target.closest('.chip');
    if (!c) return;
    e.preventDefault();
    A.drag = { kind: 'chip', key: c.dataset.k, sx: e.clientX, sy: e.clientY, moved: false, world: toWorld(e.clientX, e.clientY) };
    $('#dragchip').textContent = c.textContent.replace(/×$/, '');
  });
  window.addEventListener('pointermove', e => { if (A.drag && A.drag.kind === 'chip') dragMove(e); });
  window.addEventListener('pointerup', e => { if (A.drag && A.drag.kind === 'chip') dragEnd(e); });

  /* click a chip: fill the selected slot, or place it beside the trees */
  function placeChip(key) {
    const sel = A.sel && A.S.nodes[A.sel];
    commit(S => {
      if (sel && sel.ph) {
        const nx = F.addTip(S, key, 0, 0);
        F.fill(S, sel.id, nx);
        const next = Object.values(S.nodes).find(n => n.ph && F.rootOf(S, n.id) === F.rootOf(S, nx));
        A.sel = next ? next.id : null;
        return;
      }
      const pos = layoutAll(S);
      const r = cv.getBoundingClientRect();
      const c = toWorld(r.left + r.width / 2, r.top + r.height * 0.6);
      let x = c.x, y = c.y;
      const xs = Object.values(pos).map(p => p.x);
      if (xs.length) { x = Math.max(...xs) + GAP * 1.5; y = Math.max(...S.roots.map(q => q.y)); }
      F.addTip(S, key, x, y);
    });
    ensureVisible();
    renderAfterTips();
  }

  function ensureVisible() {
    const r = cv.getBoundingClientRect();
    const xs = Object.values(POS).map(p => toScreen(p).x);
    if (!xs.length) return;
    const right = Math.max(...xs);
    if (right > r.width - 60) { A.view.x -= right - (r.width - 120); render(); save(); }
  }

  /* ── tidy & fit ────────────────────────────────────────────────── */

  function tidy() {
    commit(S => {
      const pos = layoutAll(S);
      const rs = S.roots.slice().sort((a, b) => a.x - b.x);
      let x = 0;
      for (const r of rs) {
        const w = pos[r.id].w || 0;
        const local = layout(S.nodes, r.id, 0, 0);
        const minx = Math.min(...F.sub(S, r.id).map(i => local[i].x));
        r.x = x - minx; r.y = 0;
        x += w + GAP * 2.5;
      }
    });
    fit();
  }
  function fit() {
    const ps = Object.values(POS);
    if (!ps.length) { A.view = { x: cv.clientWidth / 2, y: cv.clientHeight * 0.7, k: 1 }; render(); return; }
    const x0 = Math.min(...ps.map(p => p.x)) - 30, x1 = Math.max(...ps.map(p => p.x)) + 90;
    const y0 = Math.min(...ps.map(p => p.y)) - 110, y1 = Math.max(...ps.map(p => p.y)) + STEM + 30;
    const W = cv.clientWidth, H = cv.clientHeight;
    const k = Math.min(1.3, Math.max(0.25, Math.min(W / (x1 - x0), H / (y1 - y0))));
    A.view = { k, x: (W - (x1 + x0) * k) / 2, y: (H - (y1 + y0) * k) / 2 };
    render(); save();
  }

  /* ── decks ─────────────────────────────────────────────────────── */

  function newDeck(keys, id, name) {
    commit(S => {
      const fresh = P.emptyState(keys);
      for (const k in S) delete S[k];
      Object.assign(S, fresh, { deckId: id || null, deckName: name || '' });
    });
    A.sel = null; A.brush = null;
    renderAll();
    A.view = { x: 60, y: cv.clientHeight * 0.75, k: 1 };
    render();
  }

  $('#deck').addEventListener('change', e => {
    const d = P.DECKS.find(x => x.id === e.target.value);
    if (d) newDeck(d.tips, d.id);
    else newDeck([], null, 'Custom');
  });

  const SCOPES = ['chordata', 'vertebrata', 'gnathostomata', 'chondrichthyes', 'actinopterygii', 'teleostei', 'sarcopterygii', 'tetrapoda', 'lissamphibia', 'amniota', 'mammalia', 'eutheria', 'lepidosauria', 'squamata', 'testudines', 'archosauria', 'aves'];
  $('#scope').innerHTML = SCOPES.map(k => `<option value="${k}">${esc(P.refByKey.get(k).name)}</option>`).join('');
  $('#b-fos').onclick = () => $('#b-fos').classList.toggle('on');
  $('#b-deal').onclick = () => {
    const scope = $('#scope').value, n = +$('#count').value;
    newDeck(P.deal(scope, n, null, $('#b-fos').classList.contains('on')), null, '🎲 ' + P.refByKey.get(scope).name);
  };

  /* add any tip by name */
  const allTaxa = [...P.refByKey.values()].filter(n => n.name && !n.hidden);
  $('#taxa').innerHTML = allTaxa.map(n => `<option value="${esc(n.name)}">`).join('');
  $('#clades').innerHTML = P.cladeNames.map(n => `<option value="${esc(n)}">`).join('');
  $('#add').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const v = e.target.value.trim().toLowerCase();
    const n = allTaxa.find(x => x.name.toLowerCase() === v) || allTaxa.find(x => x.name.toLowerCase().startsWith(v));
    if (!n) return;
    if (A.S.deck.some(k => P.nested(k, n.key))) { e.target.select(); e.target.animate([{ borderColor: 'var(--bad)' }, {}], 600); return; }
    commit(S => { S.deck.push(n.key); S.deckId = null; S.deckName = S.deckName || 'Custom'; });
    e.target.value = '';
    renderAll();
  });

  /* ── traits panel ──────────────────────────────────────────────── */

  $('#tlist').addEventListener('click', e => {
    const r = e.target.closest('.trait');
    if (!r) return;
    A.brush = A.brush === r.dataset.t ? null : r.dataset.t;
    A.sel = null;
    renderTraits(); render();
  });
  $('#tfilter').addEventListener('input', renderTraits);
  $('#tnew').addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !e.target.value.trim()) return;
    const name = e.target.value.trim(), id = 'u_' + P.slug(name);
    const known = P.TRAITS.find(t => t.name.toLowerCase() === name.toLowerCase());
    if (known) A.brush = known.id;
    else {
      if (!A.S.custom.some(c => c.id === id)) commit(S => S.custom.push({ id, name }));
      A.brush = id;
    }
    e.target.value = '';
    renderTraits(); render();
  });

  /* ── top bar ───────────────────────────────────────────────────── */

  $('#b-undo').onclick = () => { undo(); };
  $('#b-redo').onclick = () => { redo(); };
  $('#b-tidy').onclick = tidy;
  $('#b-clear').onclick = () => { commit(S => { S.nodes = {}; S.roots = []; S.marks = {}; }); A.sel = null; renderAll(); };
  $('#b-style').onclick = () => { A.style = A.style === 'square' ? 'slant' : 'square'; save(); render(); };
  $('#b-check').onclick = () => { A.check = !A.check; $('#b-check').classList.toggle('on', A.check); save(); render(); renderTraits(); };
  $('#b-answer').onclick = () => { A.answer = !A.answer; $('#b-answer').classList.toggle('on', A.answer); $('#answer').hidden = !A.answer; render(); };
  $('#alts').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) { A.variant = +b.dataset.v; renderAnswer(); } });
  $('#b-help').onclick = () => { $('#help').hidden = false; };
  $('#help').onclick = () => { $('#help').hidden = true; };
  $('#b-pool').onclick = () => { $('#pool').classList.toggle('open'); $('#traits').classList.remove('open'); };
  $('#b-traits').onclick = () => {
    if (matchMedia('(max-width: 760px)').matches) { $('#traits').classList.toggle('open'); $('#pool').classList.remove('open'); }
    else $('#traits').hidden = !$('#traits').hidden;
  };

  window.addEventListener('keydown', e => {
    if (e.target.matches('input, select')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (mod) return;
    if (e.key === 'Escape') { A.sel = null; A.brush = null; $('#help').hidden = true; renderTraits(); render(); return; }
    if (e.key === '?') { $('#help').hidden = !$('#help').hidden; return; }
    if (!A.sel) return;
    const m = { Enter: 'label', l: 'label', r: 'rotate', s: 'split', c: 'collapse', Delete: 'remove', Backspace: 'remove' }[e.key];
    if (m) { e.preventDefault(); act(m); }
  });
  window.addEventListener('resize', () => render());

  /* ── start ─────────────────────────────────────────────────────── */

  if (!load()) {
    const d = P.DECKS[0];
    A.S = P.emptyState(d.tips); A.S.deckId = d.id;
  }
  $('#b-check').classList.toggle('on', A.check);
  renderAll();
  if (!A.S.roots.length) { A.view = { x: 60, y: cv.clientHeight * 0.75, k: 1 }; render(); }
  try { if (!localStorage.getItem(KEY + '.seen')) { $('#help').hidden = false; localStorage.setItem(KEY + '.seen', '1'); } } catch (e) { /* storage off */ }

  P.app = A;   // for debugging
})(window.P);
