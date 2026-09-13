// "Build a tree" exercise.
//
// Deal a handful of species, let the student group them into a phylogeny, then
// score the result against the published tree pruned to the same taxa.
//
// The interaction is deliberately bottom-up: you join two things into a clade,
// and the clade becomes a thing you can join. That is what a tree is -- nested
// sets -- and dragging labels into a pretty shape without that constraint lets
// a student produce a picture they cannot defend.

import { loadTree, FLAG_EXTINCT } from './data.js';
import { shuffle, tipsUnder, sampleSpread, sampleClose, inducedTopology,
         cladeKeys, score } from './treebuild.js';

const $ = (id) => document.getElementById(id);

const state = {
  tree: null,
  common: new Map(),
  taxa: [],        // [{node, sci, common, extinct}]
  units: [],       // bench contents
  reference: null, // induced topology of the dealt taxa
  selected: null,
  nextUid: 1,
  checked: false,
};

boot();

async function boot() {
  try {
    const tree = await loadTree('data/');
    state.tree = tree;
    tree.recompute();
    const cn = tree.meta.commonNames || [];
    for (let i = 0; i < cn.length; i += 2) state.common.set(cn[i], cn[i + 1]);
    buildScopes();
    wire();
    $('loading').hidden = true;
    deal();
  } catch (err) {
    const el = $('loading');
    el.className = 'loading error';
    el.textContent = `Could not load the tree: ${err.message}. Serve this folder `
      + 'over HTTP (python3 -m http.server) -- fetch() cannot read file:// URLs.';
    console.error(err);
  }
}

// --------------------------------------------------------------------------
// Dealing
// --------------------------------------------------------------------------

const SCOPES = ['Vertebrata', 'Mammalia', 'Aves', 'Squamata', 'Amphibia',
  'Actinopterygii', 'Chondrichthyes', 'Testudines', 'Tetrapoda', 'Amniota'];

function buildScopes() {
  const sel = $('scope');
  const byId = new Map(state.tree.meta.clades.map((c) => [c.id, c]));
  for (const id of SCOPES) {
    const c = byId.get(id);
    if (!c) continue;
    const o = document.createElement('option');
    o.value = String(c.node);
    o.textContent = c.vernacular ? `${c.label} (${c.vernacular})` : c.label;
    sel.appendChild(o);
  }
}

/** key -> a readable name for that clade, taken from the reference tree. */
function refCladeNames() {
  const t = state.tree;
  const byNode = new Map();
  for (const c of t.meta.clades) byNode.set(c.node, c);
  for (const x of t.meta.taxonNodes) if (!byNode.has(x.node)) byNode.set(x.node, x);
  const out = new Map();
  const walk = (u) => {
    if (!u.children) return;
    const key = u.tips.slice().sort((a, b) => a - b).join(',');
    const named = byNode.get(u.node);
    if (named) {
      out.set(key, named.vernacular
        ? `${named.label} (${named.vernacular})`
        : named.label);
    }
    u.children.forEach(walk);
  };
  walk(state.reference);
  return out;
}

function deal() {
  const t = state.tree;
  const n = +$('count').value;
  const scope = +$('scope').value;
  const close = $('difficulty').value === 'close';
  const opts = { fossils: $('fossils').checked };

  const opt = { fossils: opts.fossils, named: state.common };
  let nodes = close ? sampleClose(t, scope, n, opt) : sampleSpread(t, scope, n, opt);
  nodes = [...new Set(nodes)].slice(0, n);
  if (nodes.length < n) {
    const extra = tipsUnder(t, scope, opts.fossils);
    shuffle(extra);
    for (const e of extra) {
      if (nodes.length >= n) break;
      if (!nodes.includes(e)) nodes.push(e);
    }
  }

  state.taxa = nodes.map((node) => ({
    node,
    sci: t.label(node),
    common: state.common.get(node) || null,
    extinct: t.flag(node, FLAG_EXTINCT),
  }));
  state.reference = inducedTopology(t, nodes);
  state.nextUid = 1;
  state.checked = false;
  state.selected = null;
  state.units = shuffle(state.taxa.map((x) => leafUnit(x)));
  $('results').hidden = true;
  render();
}

// --------------------------------------------------------------------------
// The published answer, pruned to the dealt taxa
// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
// Units on the bench
// --------------------------------------------------------------------------

function leafUnit(taxon) {
  return { uid: state.nextUid++, taxon, tips: [taxon.node], children: null };
}

function join(a, b) {
  return {
    uid: state.nextUid++,
    taxon: null,
    tips: a.tips.concat(b.tips),
    children: [a, b],
  };
}

function unitLabel(u) {
  if (u.taxon) return u.taxon.common || u.taxon.sci;
  return `${u.tips.length} taxa`;
}

/** Card header. For a leaf the tip label already shows the common name, so the
 *  header carries the binomial instead of repeating it. */
function unitHeader(u) {
  if (!u.taxon) return `${u.tips.length} taxa`;
  return u.taxon.common ? u.taxon.sci : '';
}

// --------------------------------------------------------------------------
// Drawing a unit as a cladogram
// --------------------------------------------------------------------------

const ROW = 22;
const LABEL_W = 172;
const STEP = 20;

function heightOf(u) {
  return u.children ? 1 + Math.max(...u.children.map(heightOf)) : 0;
}

function svgFor(u, marks) {
  const tips = [];
  (function collect(x) {
    if (!x.children) tips.push(x);
    else x.children.forEach(collect);
  })(u);

  const h = heightOf(u);
  const treeW = Math.max(STEP, h * STEP);
  const W = treeW + LABEL_W;
  const H = Math.max(ROW, tips.length * ROW);
  const yOf = new Map();
  tips.forEach((tp, i) => yOf.set(tp, i * ROW + ROW / 2));

  const parts = [];
  const xOf = (node) => treeW - heightOf(node) * STEP;

  (function draw(x) {
    if (!x.children) {
      const y = yOf.get(x);
      const t = x.taxon;
      const name = t.common || t.sci;
      const cls = t.extinct ? 'tip-extinct' : 'tip';
      const tip = t.common ? `<title>${esc(t.sci)}</title>` : '';
      parts.push(`<text class="${cls}" x="${treeW + 6}" y="${y}" `
        + `dominant-baseline="middle">${esc(name)}${tip}</text>`);
      return;
    }
    x.children.forEach(draw);
    const ys = x.children.map((c) => (c.children ? midY(c) : yOf.get(c)));
    const my = (Math.min(...ys) + Math.max(...ys)) / 2;
    yOf.set(x, my);
    const px = xOf(x);
    const key = x.tips.slice().sort((a, b) => a - b).join(',');
    const mark = marks ? (marks.has(key) ? 'ok' : 'bad') : '';
    parts.push(`<line class="v ${mark}" x1="${px}" y1="${Math.min(...ys)}" x2="${px}" y2="${Math.max(...ys)}"/>`);
    x.children.forEach((c, i) => {
      const cy = ys[i];
      const cx = c.children ? xOf(c) : treeW;
      parts.push(`<line class="h ${mark}" x1="${px}" y1="${cy}" x2="${cx}" y2="${cy}"/>`);
    });
  })(u);

  function midY(x) {
    if (yOf.has(x)) return yOf.get(x);
    const ys = x.children.map((c) => (c.children ? midY(c) : yOf.get(c)));
    const m = (Math.min(...ys) + Math.max(...ys)) / 2;
    yOf.set(x, m);
    return m;
  }

  // Shift the viewBox left a couple of pixels so the root's vertical stroke is
  // not half-clipped by the edge of the card.
  return `<svg class="clado" width="${W + 3}" height="${H}" viewBox="-3 0 ${W + 3} ${H}"
    role="img" aria-label="${esc(unitLabel(u))}">${parts.join('')}</svg>`;
}

// --------------------------------------------------------------------------
// Rendering the bench
// --------------------------------------------------------------------------

function render() {
  const bench = $('bench');
  bench.innerHTML = '';
  for (const u of state.units) {
    const card = document.createElement('div');
    card.className = 'unit' + (state.selected === u.uid ? ' selected' : '');
    card.dataset.uid = String(u.uid);
    card.innerHTML =
      `<div class="unit-head">
         <span class="unit-name${u.taxon ? ' sci' : ''}">${esc(unitHeader(u))}</span>
         ${u.children ? '<button class="unit-split" title="Break this group apart">ungroup</button>' : ''}
       </div>${svgFor(u)}`;
    bench.appendChild(card);
  }
  const done = state.units.length === 1 && state.units[0].tips.length === state.taxa.length;
  $('check').disabled = !done || state.taxa.length < 3;
  $('progress').textContent = state.units.length === 1
    ? (state.taxa.length < 3 ? 'Too few taxa to have a wrong answer.' : 'One tree. Ready to check.')
    : `${state.units.length} groups left to join`;
  $('hintbar').hidden = state.units.length === 1;
}

// --------------------------------------------------------------------------
// Interaction: click to select then click to join, and drag to join
// --------------------------------------------------------------------------

function unitAt(el) {
  const card = el && el.closest ? el.closest('.unit') : null;
  if (!card) return null;
  return state.units.find((u) => u.uid === +card.dataset.uid) || null;
}

function mergeUnits(a, b) {
  if (!a || !b || a === b) return;
  const ia = state.units.indexOf(a);
  const ib = state.units.indexOf(b);
  const merged = join(a, b);
  state.units.splice(Math.max(ia, ib), 1);
  state.units.splice(Math.min(ia, ib), 1, merged);
  state.selected = null;
  state.checked = false;
  $('results').hidden = true;
  render();
}

function splitUnit(u) {
  if (!u.children) return;
  const i = state.units.indexOf(u);
  state.units.splice(i, 1, ...u.children);
  state.selected = null;
  state.checked = false;
  $('results').hidden = true;
  render();
}

function wire() {
  const bench = $('bench');

  bench.addEventListener('click', (e) => {
    if (e.target.closest('.unit-split')) {
      const u = unitAt(e.target);
      if (u) splitUnit(u);
      return;
    }
    const u = unitAt(e.target);
    if (!u) { state.selected = null; render(); return; }
    if (state.selected === null) { state.selected = u.uid; render(); return; }
    if (state.selected === u.uid) { state.selected = null; render(); return; }
    const a = state.units.find((x) => x.uid === state.selected);
    mergeUnits(a, u);
  });

  // Dragging. Pointer events rather than HTML5 drag-and-drop so this works
  // with a trackpad, a touchscreen and a classroom projector alike.
  let drag = null;
  bench.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.unit-split')) return;
    const card = e.target.closest('.unit');
    if (!card) return;
    const u = unitAt(e.target);
    if (!u) return;
    drag = { uid: u.uid, card, x: e.clientX, y: e.clientY, ghost: null, over: null };
    card.setPointerCapture(e.pointerId);
  });

  bench.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.ghost && Math.abs(dx) + Math.abs(dy) < 6) return;
    if (!drag.ghost) {
      drag.ghost = drag.card.cloneNode(true);
      drag.ghost.classList.add('ghost');
      const r = drag.card.getBoundingClientRect();
      drag.ghost.style.width = r.width + 'px';
      drag.offX = drag.x - r.left;
      drag.offY = drag.y - r.top;
      document.body.appendChild(drag.ghost);
      drag.card.classList.add('dragging');
    }
    drag.ghost.style.left = (e.clientX - drag.offX) + 'px';
    drag.ghost.style.top = (e.clientY - drag.offY) + 'px';

    drag.ghost.style.pointerEvents = 'none';
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const target = under && under.closest ? under.closest('.unit') : null;
    if (drag.over && drag.over !== target) drag.over.classList.remove('drop');
    if (target && target !== drag.card) { target.classList.add('drop'); drag.over = target; }
    else drag.over = null;
  });

  const endDrag = (e) => {
    if (!drag) return;
    const moved = !!drag.ghost;
    if (drag.ghost) drag.ghost.remove();
    drag.card.classList.remove('dragging');
    if (drag.over) drag.over.classList.remove('drop');
    const target = drag.over;
    const a = state.units.find((x) => x.uid === drag.uid);
    drag = null;
    if (moved && target) {
      const b = state.units.find((x) => x.uid === +target.dataset.uid);
      mergeUnits(a, b);
    }
  };
  bench.addEventListener('pointerup', endDrag);
  bench.addEventListener('pointercancel', endDrag);

  $('deal').onclick = deal;
  $('check').onclick = check;
  $('reveal').onclick = reveal;
  $('reset').onclick = () => {
    state.units = shuffle(state.taxa.map((x) => leafUnit(x)));
    state.selected = null;
    state.checked = false;
    $('results').hidden = true;
    render();
  };
  $('count').oninput = () => { $('countOut').textContent = $('count').value; };
  $('countOut').textContent = $('count').value;

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { state.selected = null; render(); }
  });
}

// --------------------------------------------------------------------------
// Scoring
// --------------------------------------------------------------------------

function check() {
  const student = state.units[0];
  const s = score(student, state.reference);
  const { ref, correct, missed, spurious, rf, pct } = s;
  state.checked = true;

  const clean = (key) => key.split(',').map((id) => {
    const tx = state.taxa.find((x) => x.node === +id);
    return tx ? (tx.common || tx.sci) : id;
  });
  const cladeNames = refCladeNames();
  // Name the group where the published tree has a name for it; listing seven
  // species is not something a student can read at a glance.
  const describe = (key, useNames) => {
    const members = clean(key);
    const shown = members.length > 4
      ? `${members.slice(0, 3).map(esc).join(', ')} and ${members.length - 3} more`
      : members.map(esc).join(' + ');
    const nm = useNames ? cladeNames.get(key) : null;
    return nm ? `<strong>${esc(nm)}</strong> &mdash; ${shown}` : shown;
  };

  const rows = [];
  rows.push(`<p class="score"><strong>${correct.length} of ${s.total}</strong>
    clades in the published tree recovered (${pct}%).
    Robinson&ndash;Foulds distance ${rf}.</p>`);

  if (missed.length) {
    rows.push('<h3>Groups you did not recover</h3><ul class="cladelist">'
      + missed.map((k) => `<li>${describe(k, true)}</li>`).join('')
      + '</ul>');
  }
  if (spurious.length) {
    rows.push('<h3>Groups you made that the tree does not support</h3><ul class="cladelist">'
      + spurious.map((k) => `<li>${describe(k, false)}</li>`).join('')
      + '</ul>');
  }
  if (!missed.length && !spurious.length) {
    rows.push('<p class="perfect">Exactly the published topology.</p>');
  }

  rows.push(`<div class="compare">
      <figure><figcaption>Your tree</figcaption>${svgFor(student, ref)}</figure>
      <figure><figcaption>The published tree</figcaption>${svgFor(toUnit(state.reference))}</figure>
    </div>`);
  rows.push(`<p class="caveat">Scored against the reference topology in
    <a href="index.html">the explorer</a>, pruned to these taxa. Several of these
    nodes are genuinely contested; the explorer's toggles show which.</p>`);

  $('results').innerHTML = rows.join('');
  $('results').hidden = false;
  $('results').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function reveal() {
  $('results').innerHTML =
    `<h3>The published tree</h3>${svgFor(toUnit(state.reference))}
     <p class="caveat">Pruned from the reference topology in
     <a href="index.html">the explorer</a>.</p>`;
  $('results').hidden = false;
}

/** Convert an induced topology into the same shape the bench uses. */
function toUnit(topo) {
  if (!topo.children) {
    const tx = state.taxa.find((x) => x.node === topo.tips[0]);
    return { uid: -1, taxon: tx, tips: topo.tips, children: null };
  }
  return {
    uid: -1,
    taxon: null,
    tips: topo.tips,
    children: topo.children.map(toUnit),
  };
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
