// Pure logic for the "build a tree" exercise: sampling taxa, pruning the
// reference tree down to them, and comparing two topologies.
//
// Kept free of the DOM so build/test_treebuild.mjs can exercise it directly.
// This is the answer key; a bug here marks correct student answers wrong.

import { FLAG_EXTINCT } from './data.js';

export function shuffle(a, rnd = Math.random) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function tipsUnder(tree, node, includeFossils) {
  const out = [];
  const stack = [node];
  while (stack.length) {
    const i = stack.pop();
    const kids = tree.children(i);
    if (kids.length === 0) {
      if (!includeFossils && tree.flag(i, FLAG_EXTINCT)) continue;
      out.push(i);
    } else for (let k = 0; k < kids.length; k++) stack.push(kids[k]);
  }
  return out;
}

/**
 * Break `node` open until there are at least `n` subclades, then take one tip
 * from each. Gives a set spread across the group, which is the easy case.
 */
export function sampleSpread(tree, node, n, opts = {}, rnd = Math.random) {
  // Count only tips that can actually be dealt. Splitting from the root of the
  // vertebrate tree hands you Conodonta, Myllokunmingia and the whole
  // ostracoderm ladder first; with fossils switched off those buckets are
  // empty, and counting raw tips stops the split far too early.
  const usable = (i) => (opts.fossils
    ? tree.tipCount[i]
    : tree.tipCount[i] - tree.extinctCount[i]);

  const buckets = [node];
  let live = usable(node) > 0 ? 1 : 0;
  let guard = 0;
  while (live < n && guard++ < 4096) {
    let bi = -1, best = 0;
    for (let i = 0; i < buckets.length; i++) {
      if (tree.children(buckets[i]).length > 1 && usable(buckets[i]) > best) {
        best = usable(buckets[i]);
        bi = i;
      }
    }
    if (bi === -1) break;
    const kids = Array.from(tree.children(buckets[bi]));
    live -= usable(buckets[bi]) > 0 ? 1 : 0;
    for (const k of kids) live += usable(k) > 0 ? 1 : 0;
    buckets.splice(bi, 1, ...kids);
  }

  const pool = buckets.filter((b) => usable(b) > 0);
  shuffle(pool, rnd);
  const picked = [];
  for (const b of pool) {
    if (picked.length >= n) break;
    const tips = tipsUnder(tree, b, opts.fossils);
    if (!tips.length) continue;
    picked.push(preferNamed(tips, opts.named, rnd));
  }
  return picked;
}

/** Draw everything from inside one smallish clade, so the answer is hard. */
export function sampleClose(tree, node, n, opts = {}, rnd = Math.random) {
  const usable = (i) => (opts.fossils
    ? tree.tipCount[i]
    : tree.tipCount[i] - tree.extinctCount[i]);
  const wanted = Math.max(n, 4);
  const candidates = [];
  const stack = [node];
  while (stack.length) {
    const i = stack.pop();
    const c = usable(i);
    if (c >= wanted && c <= wanted * 8) candidates.push(i);
    if (c > wanted) {
      const kids = tree.children(i);
      for (let k = 0; k < kids.length; k++) stack.push(kids[k]);
    }
  }
  const from = candidates.length ? candidates[(rnd() * candidates.length) | 0] : node;
  const tips = tipsUnder(tree, from, opts.fossils);
  shuffle(tips, rnd);
  if (opts.named) {
    tips.sort((a, b) => (opts.named.has(b) ? 1 : 0) - (opts.named.has(a) ? 1 : 0));
  }
  return tips.slice(0, n);
}

function preferNamed(tips, named, rnd) {
  const pool = named ? tips.filter((x) => named.has(x)) : [];
  const from = pool.length ? pool : tips;
  return from[(rnd() * from.length) | 0];
}

/**
 * Rooted topology induced on `tipIds` by the reference tree.
 *
 * Marks every ancestor of every chosen tip, then walks down from their MRCA
 * keeping only nodes where two or more marked branches diverge. Everything
 * else is a single-child chain and contracts away.
 */
export function inducedTopology(tree, tipIds) {
  const want = new Set(tipIds);
  const marked = new Set();
  for (const tip of tipIds) {
    for (let cur = tip; cur !== -1; cur = tree.parent(cur)) {
      if (marked.has(cur)) break;
      marked.add(cur);
    }
  }

  const markedKids = (node) => {
    const out = [];
    const kids = tree.children(node);
    for (let k = 0; k < kids.length; k++) if (marked.has(kids[k])) out.push(kids[k]);
    return out;
  };

  // Descend past single-child chains to the MRCA of everything chosen.
  let root = tipIds.length ? tipIds[0] : -1;
  while (tree.parent(root) !== -1) {
    const p = tree.parent(root);
    if (!marked.has(p)) break;
    root = p;
  }
  while (!want.has(root)) {
    const mk = markedKids(root);
    if (mk.length !== 1) break;
    root = mk[0];
  }

  const build = (node) => {
    if (want.has(node)) return { tips: [node], children: null, node };
    // Collect the next branching points below this one.
    const kids = [];
    const stack = markedKids(node).reverse();
    while (stack.length) {
      const c = stack.pop();
      if (want.has(c)) { kids.push(build(c)); continue; }
      const mk = markedKids(c);
      if (mk.length > 1) kids.push(build(c));
      else stack.push(...mk.reverse());
    }
    if (kids.length === 1) return kids[0];
    const tips = [];
    for (const k of kids) tips.push(...k.tips);
    tips.sort((a, b) => a - b);
    return { tips, children: kids, node };
  };

  return build(root);
}

/** Non-trivial clades of a rooted topology, as sorted comma-joined keys. */
export function cladeKeys(topo) {
  const out = new Set();
  const total = topo.tips.length;
  const walk = (u) => {
    if (!u.children) return;
    if (u.tips.length > 1 && u.tips.length < total) {
      out.add(u.tips.slice().sort((a, b) => a - b).join(','));
    }
    u.children.forEach(walk);
  };
  walk(topo);
  return out;
}

/** Compare a student topology to the reference. */
export function score(studentTopo, referenceTopo) {
  const ref = cladeKeys(referenceTopo);
  const got = cladeKeys(studentTopo);
  const correct = [...got].filter((k) => ref.has(k));
  const missed = [...ref].filter((k) => !got.has(k));
  const spurious = [...got].filter((k) => !ref.has(k));
  return {
    ref, got, correct, missed, spurious,
    total: ref.size,
    rf: missed.length + spurious.length,
    pct: ref.size ? Math.round((correct.length / ref.size) * 100) : 100,
  };
}

/**
 * Which of a, b, c pair up, using only the induced topology.
 * Returns the odd one out, or null if the topology leaves it unresolved.
 */
export function rootedTriple(topo, a, b, c) {
  const depth = new Map();
  const walk = (u, d) => {
    depth.set(u, d);
    if (u.children) u.children.forEach((k) => walk(k, d + 1));
  };
  walk(topo, 0);

  const holders = (x) => {
    const out = [];
    const rec = (u) => {
      if (u.tips.includes(x)) { out.push(u); if (u.children) u.children.forEach(rec); }
    };
    rec(topo);
    return out;
  };
  const mrca = (x, y) => {
    const hx = new Set(holders(x));
    let best = null;
    for (const u of holders(y)) {
      if (hx.has(u) && (!best || depth.get(u) > depth.get(best))) best = u;
    }
    return best;
  };
  const dAB = depth.get(mrca(a, b));
  const dAC = depth.get(mrca(a, c));
  const dBC = depth.get(mrca(b, c));
  if (dAB > dAC && dAB > dBC) return c;
  if (dAC > dAB && dAC > dBC) return b;
  if (dBC > dAB && dBC > dAC) return a;
  return null;
}

/** The same question asked of the full reference tree. */
export function rootedTripleFull(tree, a, b, c) {
  const depthOf = (x) => {
    let d = 0;
    for (let cur = x; tree.parent(cur) !== -1; cur = tree.parent(cur)) d++;
    return d;
  };
  const anc = (x) => {
    const s = new Set();
    for (let cur = x; cur !== -1; cur = tree.parent(cur)) s.add(cur);
    return s;
  };
  const mrcaDepth = (x, y) => {
    const ax = anc(x);
    for (let cur = y; cur !== -1; cur = tree.parent(cur)) {
      if (ax.has(cur)) return depthOf(cur);
    }
    return -1;
  };
  const dAB = mrcaDepth(a, b);
  const dAC = mrcaDepth(a, c);
  const dBC = mrcaDepth(b, c);
  if (dAB > dAC && dAB > dBC) return c;
  if (dAC > dAB && dAC > dBC) return b;
  if (dBC > dAB && dBC > dAC) return a;
  return null;
}
