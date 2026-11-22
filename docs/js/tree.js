/* Reference tree, student forest, scoring. No DOM here. */
(function (P) {
  'use strict';

  const slug = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/†/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  P.slug = slug;

  /* ── reference ─────────────────────────────────────────────────── */

  function parse(src) {
    let auto = 0;
    const root = { k: [] }, stack = [{ depth: -1, node: root }];
    for (const raw of src.split('\n')) {
      if (!raw.trim()) continue;
      const depth = raw.search(/\S/) / 2, line = raw.trim();
      while (stack[stack.length - 1].depth >= depth) stack.pop();
      const parent = stack[stack.length - 1].node;
      if (line.startsWith('- ')) {
        for (const o of line.slice(2).split(',')) {
          const name = o.trim();
          parent.k.push({ key: slug(name), name, org: true, k: [] });
        }
        continue;
      }
      let [name, sub, al] = line.split('|').map(s => (s || '').trim());
      const soft = name.startsWith('~');
      if (soft) name = name.slice(1).trim();
      const fossil = name.endsWith('†');
      if (fossil) name = name.slice(0, -1).trim();
      const aliases = al ? al.split(',').map(s => s.trim()).filter(Boolean) : [];
      let node;
      if (name === '.') {
        node = aliases.length
          ? { key: slug(aliases[0]), name: aliases[0], aliases: aliases.slice(1), hidden: true }
          : { key: '_' + (auto++), name: null, aliases: [] };
      } else node = { key: slug(name), name, sub: sub || '', aliases };
      Object.assign(node, { soft, fossil, k: [] });
      parent.k.push(node);
      stack.push({ depth, node });
    }
    return root.k[0];
  }

  function index(root) {
    const byKey = new Map();
    (function walk(n, p, d) {
      n.p = p; n.depth = d;
      if (byKey.has(n.key)) throw new Error('duplicate key ' + n.key);
      byKey.set(n.key, n);
      for (const c of n.k) walk(c, n, d + 1);
      if (!n.org && n.k.length && n.k.every(c => c.org)) n.unit = true;
    })(root, null, 0);
    return byKey;
  }

  function clone(n, p) {
    const c = Object.assign({}, n, { p, k: [] });
    c.k = n.k.map(x => clone(x, c));
    return c;
  }

  /* Prune `move` and regraft it as sister of `sisterTo`. */
  function applyAlt(root, alt) {
    root = clone(root, null);
    const by = new Map();
    (function w(n) { by.set(n.key, n); n.k.forEach(w); })(root);
    const m = by.get(alt.move), s = by.get(alt.sisterTo);
    const mp = m.p;
    mp.k.splice(mp.k.indexOf(m), 1);
    if (mp.k.length === 1) {                // splice out the now-unary parent
      const only = mp.k[0], gp = mp.p;
      gp.k[gp.k.indexOf(mp)] = only; only.p = gp;
    }
    const sp = s.p, j = { key: '_alt_' + alt.move, name: null, aliases: [], k: [s, m], p: sp };
    sp.k[sp.k.indexOf(s)] = j; s.p = j; m.p = j;
    (function d(n, x) { n.depth = x; n.k.forEach(c => d(c, x + 1)); })(root, 0);
    return root;
  }

  P.ref = parse(P.TREE_SRC);
  P.refByKey = index(P.ref);
  P.variants = [P.ref];
  for (const a of P.ALTERNATIVES) for (const v of P.variants.slice()) P.variants.push(applyAlt(v, a));

  P.TRAITS.forEach((t, i) => { t.id = slug(t.name); t.i = i; });
  P.traitById = new Map(P.TRAITS.map(t => [t.id, t]));

  P.nameIndex = new Map();                 // lowercase name or alias -> [keys]
  for (const n of P.refByKey.values()) {
    for (const nm of [n.name, ...(n.aliases || [])]) {
      if (!nm) continue;
      const k = nm.toLowerCase();
      if (!P.nameIndex.has(k)) P.nameIndex.set(k, []);
      P.nameIndex.get(k).push(n.key);
    }
  }
  P.cladeNames = [...new Set([...P.refByKey.values()].filter(n => !n.org && n.k.length)
    .flatMap(n => [n.name, ...(n.aliases || [])]).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  P.isAncestor = (a, b) => { for (let n = P.refByKey.get(b); n; n = n.p) if (n.key === a) return true; return false; };
  P.nested = (a, b) => a === b || P.isAncestor(a, b) || P.isAncestor(b, a);

  /* Restrict a reference variant to a set of tip keys.
     clusters: sig -> { tips, nodes (deepest first) }; nodeSig: refKey -> sig of tips below it. */
  function restrict(root, keys) {
    const want = new Set(keys), clusters = new Map(), nodeSig = new Map(), byKey = new Map();
    (function walk(n) {
      byKey.set(n.key, n);
      let tips;
      if (want.has(n.key)) { tips = [n.key]; n.k.forEach(c => walk(c)); }
      else tips = n.k.flatMap(walk);
      if (tips.length) {
        tips = tips.slice().sort();
        const sig = tips.join(' ');
        nodeSig.set(n.key, sig);
        if (!clusters.has(sig)) clusters.set(sig, { tips, nodes: [] });
        clusters.get(sig).nodes.push(n);
      }
      return want.has(n.key) ? [n.key] : tips;
    })(root);
    return { clusters, nodeSig, byKey };
  }
  P.restrict = restrict;

  const subset = (a, B) => a.every(x => B.has(x));
  function compatible(tips, R) {
    const A = new Set(tips);
    for (const { tips: t } of R.clusters.values()) {
      if (t.length < 2) continue;
      const shared = t.filter(x => A.has(x)).length;
      if (shared && shared < t.length && shared < A.size) return false;
    }
    return true;
  }

  function mrca(R, where) {
    if (typeof where === 'string') return R.byKey.get(where);
    const paths = where.map(k => { const p = []; for (let n = R.byKey.get(k); n; n = n.p) p.unshift(n); return p; });
    let i = 0;
    while (paths.every(p => p[i] && p[i] === paths[0][i])) i++;
    return paths[0][i - 1];
  }

  /* Reduce events placed on clusters to the ones that change state. evs: [{sig, gain, depth}] */
  function netEvents(evs) {
    evs = evs.filter(e => e.sig).sort((a, b) => a.depth - b.depth);
    const last = new Map();
    for (const e of evs) last.set(e.sig, e.gain);
    const sigs = [...last.keys()].sort((a, b) => b.split(' ').length - a.split(' ').length);
    const out = [];
    for (const s of sigs) {
      const S = s.split(' ');
      let parent = null;
      for (const q of sigs) {
        if (q === s) continue;
        const Q = new Set(q.split(' '));
        if (Q.size > S.length && subset(S, Q) && (!parent || Q.size < parent.size)) parent = Q, parent.sig = q;
      }
      const inherited = parent ? last.get(parent.sig) : false;
      if (last.get(s) !== inherited) out.push(s + (last.get(s) ? '+' : '-'));
    }
    return new Set(out);
  }

  P.refTraitEvents = function (trait, R) {
    if (!trait.ev) return new Set();
    return netEvents(trait.ev.map(([kind, where]) => {
      const n = mrca(R, where);
      return { sig: n && R.nodeSig.get(n.key), gain: kind === 'gain', depth: n ? n.depth : 0 };
    }));
  };

  P.applicableTraits = function (keys) {
    const R = restrict(P.ref, keys);
    return P.TRAITS.filter(t => P.refTraitEvents(t, R).size);
  };

  /* ── student forest ────────────────────────────────────────────── */

  P.emptyState = deck => ({ deck: deck.slice(), nodes: {}, roots: [], marks: {}, custom: [], next: 1 });

  const F = P.F = {};
  F.taxa = (S, id) => { const n = S.nodes[id]; return n.t ? [n.t] : n.k.flatMap(c => F.taxa(S, c)); };
  F.sub = (S, id) => [id, ...S.nodes[id].k.flatMap(c => F.sub(S, c))];
  F.rootOf = (S, id) => { while (S.nodes[id].p != null) id = S.nodes[id].p; return id; };
  F.placed = S => Object.values(S.nodes).filter(n => n.t).map(n => n.t);
  F.depth = (S, id) => { let d = 0; while (S.nodes[id].p != null) id = S.nodes[id].p, d++; return d; };

  function mk(S, o) { const id = 'n' + (S.next++); S.nodes[id] = Object.assign({ id, p: null, k: [], t: null, ph: false, lab: '' }, o); return id; }
  function rootEntry(S, id) { return S.roots.find(r => r.id === id); }
  function addRoot(S, id, x, y) { S.nodes[id].p = null; S.roots.push({ id, x, y }); }
  function dropRoot(S, id) { S.roots = S.roots.filter(r => r.id !== id); }
  function replaceIn(S, oldId, newId) {           // put newId where oldId sits
    const o = S.nodes[oldId], n = S.nodes[newId];
    if (o.p == null) { const r = rootEntry(S, oldId); r.id = newId; n.p = null; }
    else { const par = S.nodes[o.p]; par.k[par.k.indexOf(oldId)] = newId; n.p = o.p; }
  }
  function purge(S, id) {
    for (const x of F.sub(S, id)) {
      delete S.nodes[x];
      for (const t in S.marks) S.marks[t] = S.marks[t].filter(m => m.n !== x);
    }
  }

  F.addTip = (S, key, x, y) => { const id = mk(S, { t: key }); addRoot(S, id, x, y); return id; };
  F.newRoot = (S, x, y) => {
    const id = mk(S, {});
    S.nodes[id].k = [mk(S, { ph: true, p: id }), mk(S, { ph: true, p: id })];
    addRoot(S, id, x, y);
    return id;
  };

  /* Take a subtree out of its tree; the parent is spliced out if left with one child. */
  let spliced = null;
  const survivor = id => (spliced && spliced.gone === id ? spliced.by : id);
  F.detach = (S, id, x, y) => {
    spliced = null;
    const n = S.nodes[id];
    if (n.p == null) { const r = rootEntry(S, id); if (x != null) r.x = x, r.y = y; return id; }
    const par = S.nodes[n.p];
    par.k.splice(par.k.indexOf(id), 1);
    if (par.k.length === 1) {
      const only = par.k[0];
      replaceIn(S, par.id, only);
      for (const t in S.marks) S.marks[t] = S.marks[t].filter(m => m.n !== par.id);
      delete S.nodes[par.id];
      spliced = { gone: par.id, by: only };
    }
    addRoot(S, id, x || 0, y || 0);
    return id;
  };

  F.join = (S, a, b, before) => {                // a becomes sister of b
    F.detach(S, a);
    dropRoot(S, a);
    b = survivor(b);
    const m = mk(S, {});
    replaceIn(S, b, m);
    S.nodes[m].k = before ? [a, b] : [b, a];
    S.nodes[a].p = S.nodes[b].p = m;
    return m;
  };

  F.fill = (S, ph, a) => {
    F.detach(S, a);
    dropRoot(S, a);
    const P0 = S.nodes[ph];
    if (P0.lab && !S.nodes[a].lab) S.nodes[a].lab = P0.lab;
    replaceIn(S, ph, a);
    purge(S, ph);
    return a;
  };

  F.addChild = (S, n, a) => {
    if (S.nodes[a].p === n) return n;
    F.detach(S, a);
    dropRoot(S, a);
    S.nodes[n].k.push(a);
    S.nodes[a].p = n;
    return n;
  };

  F.remove = (S, id) => { F.detach(S, id); dropRoot(S, id); purge(S, id); };

  F.collapse = (S, id) => {
    const n = S.nodes[id];
    if (!n.k.length) return;
    if (n.p == null) {
      const r = rootEntry(S, id);
      dropRoot(S, id);
      n.k.forEach((c, i) => addRoot(S, c, r.x + (i - (n.k.length - 1) / 2) * 120, r.y));
    } else {
      const par = S.nodes[n.p], at = par.k.indexOf(id);
      par.k.splice(at, 1, ...n.k);
      n.k.forEach(c => { S.nodes[c].p = par.id; });
    }
    n.k = [];
    purge(S, id);
  };

  F.split = (S, id) => {
    const n = S.nodes[id];
    if (n.ph) { n.ph = false; n.k = [mk(S, { ph: true, p: id }), mk(S, { ph: true, p: id })]; return id; }
    if (n.k.length) { n.k.push(mk(S, { ph: true, p: id })); return id; }
    const m = mk(S, {});
    replaceIn(S, id, m);
    const slot = mk(S, { ph: true, p: m });
    S.nodes[m].k = [id, slot];
    n.p = m;
    return m;
  };

  F.rotate = (S, id) => { S.nodes[id].k.reverse(); };
  F.label = (S, id, txt) => { S.nodes[id].lab = txt.trim(); };
  F.mark = (S, trait, id, loss) => {
    const list = S.marks[trait] || (S.marks[trait] = []);
    const i = list.findIndex(m => m.n === id);
    if (i >= 0 && !!list[i].loss === !!loss) list.splice(i, 1);
    else if (i >= 0) list[i].loss = !!loss;
    else list.push({ n: id, loss: !!loss });
  };

  /* ── scoring ───────────────────────────────────────────────────── */

  const sigOf = tips => tips.slice().sort().join(' ');

  P.score = function (S) {
    const placed = F.placed(S);
    const ids = Object.keys(S.nodes);
    const nodeTips = {};
    for (const id of ids) nodeTips[id] = F.taxa(S, id);

    let best = null;
    for (const V of P.variants) {
      const R = restrict(V, placed), Rfull = restrict(V, S.deck);
      const node = {}, got = new Set();
      for (const id of ids) {
        const tips = nodeTips[id];
        if (tips.length < 2) continue;
        const sig = sigOf(tips);
        if (R.clusters.has(sig)) { node[id] = 'ok'; got.add(sig); }
        else node[id] = compatible(tips, R) ? 'meh' : 'bad';
      }
      const need = [...Rfull.clusters.values()].filter(c => c.tips.length > 1).length;
      if (!best || got.size > best.nodesOk) best = { V, R, Rfull, node, nodesOk: got.size, nodesNeed: need };
    }
    const { R } = best;

    // labels
    best.label = {};
    let lok = 0, lall = 0;
    for (const id of ids) {
      const n = S.nodes[id];
      if (!n.lab || !nodeTips[id].length) continue;
      lall++;
      const keys = P.nameIndex.get(n.lab.toLowerCase());
      if (!keys) { best.label[id] = 'meh'; continue; }
      const sig = sigOf(nodeTips[id]);
      const ok = keys.some(k => R.nodeSig.get(k) === sig);
      best.label[id] = ok ? 'ok' : 'bad';
      if (ok) lok++;
    }
    best.labelsOk = lok; best.labelsAll = lall;

    // traits
    best.mark = {};
    let tok = 0, tneed = 0;
    for (const tid in S.marks) {
      const trait = P.traitById.get(tid);
      const marks = S.marks[tid];
      if (!trait || !marks.length) continue;
      const ref = P.refTraitEvents(trait, R);
      const evs = marks.map(m => ({ sig: nodeTips[m.n] && nodeTips[m.n].length ? sigOf(nodeTips[m.n]) : null, gain: !m.loss, depth: F.depth(S, m.n), m }));
      const net = netEvents(evs.map(e => Object.assign({}, e)));
      const status = {};
      for (const e of evs) {
        const code = e.sig + (e.gain ? '+' : '-');
        status[e.m.n] = !e.sig ? 'meh' : ref.has(code) ? 'ok' : net.has(code) ? 'bad' : 'meh';
      }
      best.mark[tid] = status;
      tok += [...net].filter(c => ref.has(c)).length;
      tneed += ref.size;
    }
    best.traitsOk = tok; best.traitsNeed = tneed;
    best.placed = placed.length;
    return best;
  };

  /* The reference restricted to keys, as a nested tree for drawing. */
  P.answerTree = function (keys, V) {
    const R = restrict(V || P.ref, keys);
    const cl = [...R.clusters.entries()].map(([sig, c]) => ({ sig, tips: c.tips, nodes: c.nodes, k: [] }))
      .sort((a, b) => b.tips.length - a.tips.length);
    for (let i = 1; i < cl.length; i++) {
      const T = new Set(cl[i].tips);
      let par = null;
      for (let j = 0; j < i; j++) if (cl[j].tips.length > T.size && cl[i].tips.every(t => cl[j].tips.includes(t))) par = cl[j];
      if (par) par.k.push(cl[i]);
    }
    for (const c of cl) {
      if (c.tips.length === 1) c.t = c.tips[0];
      const named = c.nodes.find(n => n.name && !n.hidden && !(c.t && n.key === c.t));
      c.lab = c.tips.length > 1 && named ? named.name : '';
      // keep tip order the same as the reference
      c.k.sort((a, b) => order(a) - order(b));
    }
    return { root: cl[0], R };
  };
  let ord = null;
  function order(c) {
    if (!ord) { ord = new Map(); let i = 0; (function w(n) { ord.set(n.key, i++); n.k.forEach(w); })(P.ref); }
    return Math.min(...c.tips.map(t => ord.get(t)));
  }

  /* ── dealing ───────────────────────────────────────────────────── */

  /* Terminal choices below a group: organisms and leaf groups. */
  P.terminals = key => {
    const out = [];
    (function w(n) { if (!n.k.length) { if (n.name) out.push(n.key); } else n.k.forEach(w); })(P.refByKey.get(key));
    return out;
  };

  /* Would this set leave a polytomy in the answer that the course doesn't sanction?
     strict: also refuse a third branch of the polytomies the course leaves open (random deals). */
  function fair(keys, strict) {
    const R = restrict(P.ref, keys);
    for (const n of R.byKey.values()) {
      if ((n.soft && !strict) || n.k.length < 3) continue;
      const hit = n.k.filter(c => R.nodeSig.has(c.key)).length;
      if (hit > 2 && !keys.includes(n.key)) return false;
    }
    return true;
  }
  P.fair = fair;

  P.deal = function (scopeKey, count, rnd, fossils) {
    rnd = rnd || Math.random;
    const live = n => fossils || !n.fossil;
    const pool = P.terminals(scopeKey).filter(k => live(P.refByKey.get(k)));
    const size = new Map();
    (function w(n) { size.set(n.key, !live(n) ? 0 : n.k.length ? n.k.reduce((a, c) => a + w(c), 0) : 1); return size.get(n.key); })(P.refByKey.get(scopeKey));
    const pick = () => {                        // walk down, weighting branches by the square root of their size,
      let n = P.refByKey.get(scopeKey);         // so big groups don't swamp small ones and small ones don't swamp big ones
      while (n.k.length) {
        const w = n.k.map(c => Math.sqrt(size.get(c.key)));
        let r = rnd() * w.reduce((a, b) => a + b, 0), i = 0;
        while (r > w[i] && i < w.length - 1) r -= w[i++];
        n = n.k[i];
      }
      return n.key;
    };
    const keys = [];
    for (let tries = 0; keys.length < Math.min(count, pool.length) && tries < 4000; tries++) {
      const k = tries < 2000 ? pick() : pool[Math.floor(rnd() * pool.length)];
      if (!P.refByKey.get(k).name || keys.includes(k) || !size.get(k)) continue;
      if (fair(keys.concat(k), true)) keys.push(k);
    }
    return keys;
  };

  P.display = key => {
    const n = P.refByKey.get(key);
    return n ? n.name : key;
  };
})(typeof window !== 'undefined' ? (window.P = window.P || {}) : globalThis.P);
