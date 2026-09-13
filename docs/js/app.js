// UI wiring: events, panels, URL state.

import { loadTree, buildSearchIndex, FLAG_EXTINCT, FLAG_IMPUTED } from './data.js';
import { applyAlternatives, isModified } from './topology.js';
import { layout, expand, collapseNode, revealPath, visibleAncestor } from './layout.js';
import { Renderer } from './render.js';

const $ = (id) => document.getElementById(id);

const state = {
  tree: null,
  search: null,
  renderer: null,
  collapsed: new Set(),
  defaultCollapsed: new Set(),
  selection: {},          // alternative id -> option id
  common: new Map(),
  lay: null,
  needsLayout: true,
  needsDraw: true,
  hideExtinct: false,
};

// Clades collapsed on first load. Anything with its own published source tree
// starts shut, so the opening view is the backbone plus the fossil record.
const START_CLOSED = ['Cyclostomata', 'Chondrichthyes', 'Actinopterygii', 'Actinistia',
  'Dipnoi', 'Amphibia', 'Mammalia', 'Squamata', 'Testudines', 'Crocodylia', 'Aves'];

boot();

async function boot() {
  try {
    const tree = await loadTree('data/');
    state.tree = tree;
    tree.recompute();
    state.search = buildSearchIndex(tree);
    const cn = tree.meta.commonNames || [];
    state.common = new Map();
    for (let i = 0; i < cn.length; i += 2) state.common.set(cn[i], cn[i + 1]);

    const byId = new Map(tree.meta.clades.map((c) => [c.id, c.node]));
    for (const id of START_CLOSED) {
      const n = byId.get(id);
      if (n !== undefined && !tree.isTip(n)) state.defaultCollapsed.add(n);
    }
    state.collapsed = new Set(state.defaultCollapsed);

    state.renderer = new Renderer($('canvas'), tree);
    buildAlternatives();
    buildGrades();
    buildLegend();
    buildSources();
    readUrl();

    // Handy from the console, and the only way to profile the hot paths.
    window.__vt = { state, layout, Renderer, applyAlternatives };

    $('loading').hidden = true;
    wireEvents();
    updateStats();
    invalidate(true);
    // A hidden tab pauses rAF, so repaint when it comes back.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) invalidate(false);
    });
  } catch (err) {
    const el = $('loading');
    el.className = 'loading error';
    el.textContent = `Could not load the tree: ${err.message}. `
      + 'If you opened this file directly, serve the folder over HTTP instead '
      + '(python3 -m http.server) -- fetch() cannot read file:// URLs.';
    console.error(err);
  }
}

// --------------------------------------------------------------------------
// Frame loop
// --------------------------------------------------------------------------

let frameQueued = false;

function invalidate(structural) {
  if (structural) state.needsLayout = true;
  state.needsDraw = true;
  // Render on demand rather than spinning a frame loop forever. Nothing here
  // animates, so a permanently scheduled rAF would only burn battery.
  if (!frameQueued) { frameQueued = true; requestAnimationFrame(frame); }
}

function frame() {
  frameQueued = false;
  const r = state.renderer;
  if (state.needsLayout) {
    state.lay = layout(state.tree, state.collapsed, state);
    state.needsLayout = false;
    r.view.scrollY = Math.min(r.view.scrollY, r.maxScroll(state.lay.nRows));
  }
  if (state.needsDraw) {
    r.draw(state.lay, state.collapsed);
    state.needsDraw = false;
  }
}

// --------------------------------------------------------------------------
// Events
// --------------------------------------------------------------------------

function wireEvents() {
  const canvas = $('canvas');
  const r = state.renderer;

  new ResizeObserver(() => { r.resize(); invalidate(false); }).observe($('canvas').parentElement);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.shiftKey) {
      zoomTime(e.offsetX, e.deltaY > 0 ? 1.12 : 1 / 1.12);
    } else if (e.ctrlKey || e.metaKey) {
      setRowHeight(r.view.rowH * (e.deltaY > 0 ? 0.9 : 1.1));
    } else {
      r.view.scrollY = clamp(r.view.scrollY + e.deltaY, 0, r.maxScroll(state.lay.nRows));
      invalidate(false);
    }
  }, { passive: false });

  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    drag = { x: e.offsetX, y: e.offsetY, sy: r.view.scrollY,
             tMax: r.view.tMax, tMin: r.view.tMin, moved: false };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (drag) {
      const dy = e.offsetY - drag.y, dx = e.offsetX - drag.x;
      if (Math.abs(dx) + Math.abs(dy) > 3) { drag.moved = true; canvas.classList.add('grabbing'); }
      r.view.scrollY = clamp(drag.sy - dy, 0, r.maxScroll(state.lay.nRows));
      const perPx = (drag.tMax - drag.tMin) / r.plotW;
      let tMax = drag.tMax + dx * perPx, tMin = drag.tMin + dx * perPx;
      if (tMin < 0) { tMax -= tMin; tMin = 0; }
      if (tMax > state.tree.meta.rootAge * 1.02) {
        const over = tMax - state.tree.meta.rootAge * 1.02;
        tMax -= over; tMin = Math.max(0, tMin - over);
      }
      r.view.tMax = tMax; r.view.tMin = tMin;
      invalidate(false);
      return;
    }
    const node = r.pick(state.lay, e.offsetX, e.offsetY);
    if (node !== r.hover) { r.hover = node; invalidate(false); }
    showTooltip(node, e.offsetX, e.offsetY);
  });
  canvas.addEventListener('pointerup', (e) => {
    canvas.classList.remove('grabbing');
    const wasDrag = drag && drag.moved;
    drag = null;
    if (wasDrag) return;
    const node = r.pick(state.lay, e.offsetX, e.offsetY);
    if (node < 0) return;
    if (state.collapsed.has(node)) {
      expand(state.tree, state.collapsed, node, e.altKey);
      invalidate(true);
    } else if (!state.tree.isTip(node) && e.offsetX < r.plotL + r.plotW) {
      collapseNode(state.tree, state.collapsed, node);
      invalidate(true);
    }
    select(node);
  });
  canvas.addEventListener('pointerleave', () => {
    $('tooltip').hidden = true;
    if (r.hover !== -1) { r.hover = -1; invalidate(false); }
  });

  canvas.addEventListener('keydown', (e) => {
    const page = (r.h - 60);
    if (e.key === 'ArrowDown') r.view.scrollY = clamp(r.view.scrollY + r.view.rowH, 0, r.maxScroll(state.lay.nRows));
    else if (e.key === 'ArrowUp') r.view.scrollY = clamp(r.view.scrollY - r.view.rowH, 0, r.maxScroll(state.lay.nRows));
    else if (e.key === 'PageDown') r.view.scrollY = clamp(r.view.scrollY + page, 0, r.maxScroll(state.lay.nRows));
    else if (e.key === 'PageUp') r.view.scrollY = clamp(r.view.scrollY - page, 0, r.maxScroll(state.lay.nRows));
    else if (e.key === '+' || e.key === '=') setRowHeight(r.view.rowH * 1.15);
    else if (e.key === '-') setRowHeight(r.view.rowH / 1.15);
    else if (e.key === 'Escape') { r.selected = -1; $('detail').hidden = true; }
    else return;
    e.preventDefault();
    invalidate(false);
  });

  $('btnZoomIn').onclick = () => setRowHeight(r.view.rowH * 1.25);
  $('btnZoomOut').onclick = () => setRowHeight(r.view.rowH / 1.25);
  $('btnFitTime').onclick = () => {
    r.view.tMax = state.tree.meta.rootAge; r.view.tMin = 0; invalidate(false);
  };
  $('btnReset').onclick = () => {
    state.collapsed = new Set(state.defaultCollapsed);
    r.view = { tMax: state.tree.meta.rootAge, tMin: 0, scrollY: 0, rowH: 22 };
    r.selected = -1;
    $('detail').hidden = true;
    invalidate(true);
    writeUrl();
  };
  $('menuBtn').onclick = () => {
    const open = $('sidebar').classList.toggle('open');
    $('menuBtn').setAttribute('aria-expanded', String(open));
  };

  $('optImputed').onchange = (e) => { r.showImputed = e.target.checked; invalidate(false); };
  $('optExtinct').onchange = (e) => { state.hideExtinct = !e.target.checked; invalidate(true); };

  const search = $('search');
  search.addEventListener('input', () => runSearch(search.value));
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = $('results').querySelector('button');
      if (first) first.click();
    }
  });

  window.addEventListener('hashchange', readUrl);
}

function setRowHeight(h) {
  const r = state.renderer;
  r.view.rowH = clamp(h, 1.2, 40);
  r.view.scrollY = clamp(r.view.scrollY, 0, r.maxScroll(state.lay.nRows));
  invalidate(false);
}

function zoomTime(px, factor) {
  const r = state.renderer;
  const anchor = r.ageAt(px);
  let tMax = anchor + (r.view.tMax - anchor) * factor;
  let tMin = anchor - (anchor - r.view.tMin) * factor;
  const limit = state.tree.meta.rootAge * 1.02;
  tMin = Math.max(0, tMin);
  tMax = Math.min(limit, tMax);
  if (tMax - tMin < 0.05) return;
  r.view.tMax = tMax; r.view.tMin = tMin;
  invalidate(false);
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// --------------------------------------------------------------------------
// Selection and detail
// --------------------------------------------------------------------------

function select(node) {
  state.renderer.selected = node;
  renderDetail(node);
  invalidate(false);
  writeUrl();
}

function nodeInfo(node) {
  const t = state.tree;
  const r = state.renderer;
  const clade = r.cladeByNode.get(node);
  const fossil = r.fossilByNode.get(node);
  const taxon = r.taxonByNode.get(node);
  const raw = t.label(node);
  return {
    node,
    label: (clade && clade.label) || (fossil && fossil.label) || (taxon && taxon.label) || raw
      || (t.isTip(node) ? 'unnamed tip' : 'unnamed node'),
    vernacular: (clade && clade.vernacular) || (fossil && fossil.vernacular)
      || (taxon && taxon.vernacular) || state.common.get(node) || null,
    clade, fossil, taxon,
    isTip: t.isTip(node),
    extinct: t.flag(node, FLAG_EXTINCT),
    imputed: t.flag(node, FLAG_IMPUTED),
    age: t.age(node),
    tips: t.tipCount[node],
    extinctTips: t.extinctCount[node],
    imputedTips: t.imputedCount[node],
    source: t.source[node] < 255 ? t.meta.sources[t.source[node]] : null,
  };
}

function renderDetail(node) {
  const el = $('detail');
  if (node < 0) { el.hidden = true; return; }
  const t = state.tree;
  const info = nodeInfo(node);
  const parts = [];

  parts.push(`<h2>${esc(info.label)}</h2>`);
  if (info.vernacular) parts.push(`<p class="vern">${esc(info.vernacular)}</p>`);

  const badges = [];
  if (info.extinct) badges.push('<span class="badge badge-extinct">extinct</span>');
  if (info.imputed) badges.push('<span class="badge badge-imputed">placed by taxonomy</span>');
  if (info.fossil) {
    for (const g of state.renderer.gradeByBit) {
      if (info.fossil.grades & (1 << g.bit)) {
        badges.push(`<span class="badge badge-grade" style="background:${esc(g.colour || '#777')}">${esc(g.label)}</span>`);
      }
    }
  }
  if (badges.length) parts.push(`<p>${badges.join('')}</p>`);

  const dl = [];
  if (info.fossil) {
    dl.push(['Known from', `${fmtAge(info.fossil.fa)} to ${fmtAge(info.fossil.la)} Ma`]);
    dl.push(['Diverged', `${fmtAge(t.age(t.parent(node)))} Ma`]);
  } else if (!info.isTip) {
    dl.push(['Crown age', `${fmtAge(info.age)} Ma`]);
  } else if (info.age > 0) {
    dl.push(['Terminates', `${fmtAge(info.age)} Ma`]);
  }
  if (!info.isTip) {
    dl.push(['Tips', info.tips.toLocaleString()]);
    if (info.extinctTips) dl.push(['Extinct lineages', String(info.extinctTips)]);
    if (info.imputedTips) {
      dl.push(['Placed by taxonomy',
        `${info.imputedTips.toLocaleString()} of ${info.tips.toLocaleString()}`]);
    }
  }
  if (info.taxon && info.taxon.rank) dl.push(['Rank', info.taxon.rank]);
  if (info.taxon && info.taxon.nonMono) {
    dl.push(['Monophyly', `not a clade here \u2014 this node holds `
      + `${info.taxon.holds.toLocaleString()} tips, of which `
      + `${info.taxon.members.toLocaleString()} carry the name`]);
  }
  if (info.source) dl.push(['Source', esc(info.source.citation || info.source.label)]);
  if (dl.length) {
    parts.push('<dl>' + dl.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('') + '</dl>');
  }

  const note = (info.fossil && info.fossil.note) || (info.clade && info.clade.note);
  if (note) parts.push(`<p class="note">${esc(note)}</p>`);
  if (info.source && info.source.note) parts.push(`<p class="note">${esc(info.source.note)}</p>`);

  const refs = ((info.fossil && info.fossil.refs) || (info.clade && info.clade.refs) || []);
  if (refs.length) {
    parts.push('<ul class="refs">' + refs.map((x) => `<li>${esc(x)}</li>`).join('') + '</ul>');
  }

  parts.push('<div class="actions">');
  if (!info.isTip) {
    parts.push(state.collapsed.has(node)
      ? '<button class="tool" data-act="expand">Open</button>'
      : '<button class="tool" data-act="collapse">Close</button>');
    parts.push(`<button class="tool" data-act="expandAll">Open fully`
      + `<span class="muted"> ${info.tips.toLocaleString()} rows</span></button>`);
  }
  parts.push('<button class="tool" data-act="zoom">Zoom to this</button>');
  parts.push('<button class="tool" data-act="path">Show path to root</button>');
  parts.push('</div>');

  el.innerHTML = parts.join('');
  el.hidden = false;
  el.querySelectorAll('button[data-act]').forEach((b) => {
    b.onclick = () => detailAction(b.dataset.act, node);
  });
}

function detailAction(act, node) {
  const t = state.tree, r = state.renderer;
  if (act === 'expand') { expand(t, state.collapsed, node, false); invalidate(true); }
  else if (act === 'expandAll') {
    // No confirmation dialog. Opening the 31,516-tip fish clade measures at
    // about 60 ms end to end, so there is nothing to warn about, and a modal
    // here would block the render loop as well as the reader.
    expand(t, state.collapsed, node, true); invalidate(true);
  } else if (act === 'collapse') { collapseNode(t, state.collapsed, node); invalidate(true); }
  else if (act === 'zoom') {
    const lo = t.minAge[node], hi = t.age(node);
    const pad = Math.max((hi - lo) * 0.08, 2);
    r.view.tMax = hi + pad; r.view.tMin = Math.max(0, lo - pad);
    scrollTo(node);
  } else if (act === 'path') {
    revealPath(t, state.collapsed, node);
    invalidate(true);
    requestAnimationFrame(() => scrollTo(node));
  }
  renderDetail(node);
  writeUrl();
}

function scrollTo(node) {
  const r = state.renderer;
  state.lay = layout(state.tree, state.collapsed, state);
  state.needsLayout = false;
  const target = visibleAncestor(state.tree, state.collapsed, node);
  const row = state.lay.yOf[target];
  if (row >= 0) {
    r.view.scrollY = clamp(row * r.view.rowH - (r.h - 46) / 2, 0, r.maxScroll(state.lay.nRows));
  }
  invalidate(false);
}

// --------------------------------------------------------------------------
// Tooltip
// --------------------------------------------------------------------------

function showTooltip(node, px, py) {
  const tip = $('tooltip');
  if (node < 0) { tip.hidden = true; return; }
  const info = nodeInfo(node);
  const bits = [`<strong>${esc(info.label)}</strong>`];
  if (info.vernacular) bits.push(`<span class="t-sub">${esc(info.vernacular)}</span><br>`);
  if (info.fossil) {
    bits.push(`<span class="t-sub">${fmtAge(info.fossil.fa)}&ndash;${fmtAge(info.fossil.la)} Ma &middot; extinct</span>`);
  } else if (!info.isTip) {
    bits.push(`<span class="t-sub">${info.tips.toLocaleString()} tips &middot; crown ${fmtAge(info.age)} Ma</span>`);
  } else if (info.imputed) {
    bits.push('<span class="t-sub">placed by taxonomy, not by data</span>');
  }
  tip.innerHTML = bits.join('');
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  const stage = $('canvas').getBoundingClientRect();
  tip.style.left = Math.min(px + 14, stage.width - r.width - 8) + 'px';
  tip.style.top = Math.min(py + 14, stage.height - r.height - 8) + 'px';
}

// --------------------------------------------------------------------------
// Panels
// --------------------------------------------------------------------------

function buildAlternatives() {
  const host = $('alternatives');
  host.innerHTML = '';
  for (const alt of state.tree.meta.alternatives) {
    state.selection[alt.id] = alt.default;
    const d = document.createElement('details');
    d.className = 'alt';
    d.id = 'alt-' + alt.id;
    const opts = alt.options.map((o) => `
      <label class="opt">
        <input type="radio" name="alt-${esc(alt.id)}" value="${esc(o.id)}"
               ${o.id === alt.default ? 'checked' : ''}>
        <span>${esc(o.label)}</span>
        ${o.sublabel ? `<span class="sub">${esc(o.sublabel)}</span>` : ''}
        ${o.note ? `<span class="why">${esc(o.note)}</span>` : ''}
      </label>`).join('');
    d.innerHTML = `<summary>${esc(alt.label)}</summary>
      ${alt.blurb ? `<p class="blurb">${esc(alt.blurb)}</p>` : ''}${opts}`;
    host.appendChild(d);
    d.querySelectorAll('input[type=radio]').forEach((input) => {
      input.onchange = () => {
        state.selection[alt.id] = input.value;
        d.classList.toggle('changed', input.value !== alt.default);
        reapply();
      };
    });
  }
}

function reapply() {
  const t = state.tree;
  const keptLabels = [...state.collapsed].map((n) => n);
  applyAlternatives(t, state.selection);
  // Node indices survive rearrangement, so the collapse set stays valid; drop
  // anything that became a tip.
  state.collapsed = new Set(keptLabels.filter((n) => !t.isTip(n)));
  invalidate(true);
  updateStats();
  writeUrl();
}

function buildGrades() {
  const host = $('grades');
  host.innerHTML = '';
  for (const g of state.tree.meta.grades) {
    const lab = document.createElement('label');
    lab.className = 'gcheck';
    lab.innerHTML = `<input type="checkbox" value="${esc(g.id)}">
      <span class="swatch" style="background:${esc(g.colour || '#777')}"></span>
      <span class="gname">${esc(g.label)}
        ${g.excludes ? `<span class="gnote">all of ${esc(g.excludes)}&rsquo;s stem except ${esc(g.excludes)}</span>` : ''}
      </span>`;
    host.appendChild(lab);
    lab.querySelector('input').onchange = (e) => {
      if (e.target.checked) state.renderer.highlightGrades.add(g.id);
      else state.renderer.highlightGrades.delete(g.id);
      invalidate(false);
    };
  }
}

function buildLegend() {
  $('legend').innerHTML = [
    ['--branch', 'living lineage'],
    ['--extinct', 'extinct lineage, bar = fossil range'],
    ['--imputed', 'species placed by taxonomy, not sequence data'],
  ].map(([v, t]) => `<span class="row"><span class="key" style="border-top-color:var(${v})"></span>${esc(t)}</span>`)
    .join('')
    + `<span class="row">A name followed by * is not a clade in this tree: the node
       named for it also contains species from other groups. ${state.tree.meta.stats.nonMonophyletic}
       labels are marked this way, and ${state.tree.meta.stats.unlabelledTaxa} named taxa are
       too scattered to label at all.</span>`
    + '<span class="row">Dashed branches are schematic: either a topology alternative that has not been re-dated, or a tree with no branch-length estimates.</span>';
}

function buildSources() {
  const host = $('sources');
  const seen = new Set();
  host.innerHTML = state.tree.meta.sources.map((s) => {
    if (!s.citation || seen.has(s.citation)) return '';
    seen.add(s.citation);
    const link = s.doi ? `https://doi.org/${s.doi}` : s.url;
    return `<li><b>${esc(s.label)}</b> &mdash; ${link
      ? `<a href="${esc(link)}" target="_blank" rel="noopener">${esc(s.citation)}</a>`
      : esc(s.citation)}</li>`;
  }).join('');
  const m = state.tree.meta;
  $('buildinfo').textContent =
    `Built ${m.generated.slice(0, 10)}. Deep backbone ages are hand-entered from the `
    + 'literature; fossil ages are stage-level approximations for teaching, not calibrations.';
}

function updateStats() {
  const m = state.tree.meta.stats;
  $('stats').textContent =
    `${m.livingTips.toLocaleString()} living species · ${m.extinctTips} extinct lineages · `
    + `${m.taxonomyPlaced.toLocaleString()} placed by taxonomy`
    + (isModified(state.tree, state.selection) ? ' · topology altered' : '');
}

// --------------------------------------------------------------------------
// Search
// --------------------------------------------------------------------------

function runSearch(q) {
  const host = $('results');
  const hits = state.search.query(q);
  if (!hits.length) { host.hidden = true; host.innerHTML = ''; return; }
  host.innerHTML = hits.map((h, i) => `
    <li><button data-i="${i}">
      <span class="kind">${esc(h.kind)}</span>${esc(h.text)}
      ${h.extra ? `<span class="sub">${esc(h.extra)}</span>` : ''}
    </button></li>`).join('');
  host.hidden = false;
  host.querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      const hit = hits[+b.dataset.i];
      revealPath(state.tree, state.collapsed, hit.node);
      if (!state.tree.isTip(hit.node)) collapseNode(state.tree, state.collapsed, hit.node);
      invalidate(true);
      state.lay = layout(state.tree, state.collapsed, state);
      state.needsLayout = false;
      select(hit.node);
      scrollTo(hit.node);
      host.hidden = true;
      if (window.innerWidth <= 820) $('sidebar').classList.remove('open');
    };
  });
}

// --------------------------------------------------------------------------
// URL state
// --------------------------------------------------------------------------

let writing = false;

function writeUrl() {
  const parts = [];
  const r = state.renderer;
  if (r.selected >= 0) parts.push('n=' + r.selected);
  const alts = state.tree.meta.alternatives
    .filter((a) => state.selection[a.id] !== a.default)
    .map((a) => `${a.id}:${state.selection[a.id]}`);
  if (alts.length) parts.push('a=' + alts.join(','));
  const extra = [...state.collapsed].filter((n) => !state.defaultCollapsed.has(n));
  const missing = [...state.defaultCollapsed].filter((n) => !state.collapsed.has(n));
  if (extra.length && extra.length < 150) parts.push('c=' + extra.join('.'));
  if (missing.length) parts.push('o=' + missing.join('.'));
  writing = true;
  history.replaceState(null, '', parts.length ? '#' + parts.join('&') : location.pathname);
  writing = false;
}

function readUrl() {
  if (writing) return;
  const h = location.hash.replace(/^#/, '');
  if (!h) return;
  const q = Object.fromEntries(h.split('&').map((kv) => {
    const i = kv.indexOf('=');
    return i === -1 ? [kv, ''] : [kv.slice(0, i), kv.slice(i + 1)];
  }));

  if (q.a) {
    for (const pair of q.a.split(',')) {
      const [id, opt] = pair.split(':');
      const alt = state.tree.meta.alternatives.find((a) => a.id === id);
      if (alt && alt.options.some((o) => o.id === opt)) {
        state.selection[id] = opt;
        const input = document.querySelector(`input[name="alt-${CSS.escape(id)}"][value="${CSS.escape(opt)}"]`);
        if (input) { input.checked = true; input.closest('.alt').classList.add('changed'); }
      }
    }
    applyAlternatives(state.tree, state.selection);
  }
  state.collapsed = new Set(state.defaultCollapsed);
  if (q.o) for (const n of q.o.split('.')) state.collapsed.delete(+n);
  if (q.c) for (const n of q.c.split('.')) if (!state.tree.isTip(+n)) state.collapsed.add(+n);
  invalidate(true);
  updateStats();

  if (q.n) {
    const n = +q.n;
    state.lay = layout(state.tree, state.collapsed, state);
    state.needsLayout = false;
    state.renderer.selected = n;
    renderDetail(n);
    scrollTo(n);
  }
}

// --------------------------------------------------------------------------

function fmtAge(a) {
  if (a === undefined || a === null || !isFinite(a)) return '?';
  if (a === 0) return '0';
  if (a < 0.01) return a.toExponential(1);
  if (a < 1) return a.toFixed(2);
  if (a < 10) return a.toFixed(1);
  return String(Math.round(a));
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
