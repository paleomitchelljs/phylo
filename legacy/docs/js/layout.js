// Turn the tree plus a collapse state into rows.
//
// A "row" is a visible leaf: either a real tip or a collapsed clade standing in
// for everything below it. Internal nodes get the midpoint of their children,
// so the whole layout is one depth-first pass and costs nothing until the user
// actually expands something large.

export function layout(tree, collapsed, opts) {
  tree.recompute();
  // "Show extinct lineages" off means dropping any branch whose entire subtree
  // is extinct -- the whole stem, not just the tips, since a stem lineage with
  // no living descendants is exactly what should disappear.
  //
  // `minorExtinct` is the second level of that filter: the extinct lineages a
  // vertebrate course does not name, hidden unless the reader asks for all of
  // them. Same rule either way -- an entirely extinct branch, so nothing living
  // ever disappears with it.
  const hideExtinct = !!(opts && opts.hideExtinct);
  const minor = (opts && opts.minorExtinct) || null;
  const filtering = hideExtinct || minor !== null;
  const drop = (i) => (hideExtinct || (minor !== null && minor.has(i)))
    && tree.extinctCount[i] === tree.tipCount[i];
  const yOf = new Float32Array(tree.cap).fill(-1);
  // Row span of each visible node's subtree. The renderer culls against these
  // instead of reading children, which is the difference between touching
  // 63,000 typed-array views per frame and touching none.
  const lo = new Float32Array(tree.cap);
  const hi = new Float32Array(tree.cap);
  const rows = [];
  const visible = [];
  // Runs of adjacent tips that would print the same label collapse to one row.
  // The source trees carry a lot of them: 3,872 squamate tips are placeholders
  // that all render as `Genus sp.`, and twenty identical rows tell the reader
  // less than one row saying twenty. `dup` maps the row's node to how many tips
  // it stands for, and is only populated where that is more than one.
  const keys = tree.rowKeys();
  const dup = new Map();
  let lastKey = -1;

  const ENTER = 0, EXIT = 1;
  const stack = [[tree.root, ENTER]];

  while (stack.length) {
    const frame = stack.pop();
    const i = frame[0];
    if (frame[1] === ENTER) {
      visible.push(i);
      // Only pay for the copy when the filter is actually on; this runs for
      // every one of 133,000 nodes when the tree is fully expanded.
      const all = tree.children(i);
      const kids = filtering ? all.filter((c) => !drop(c)) : all;
      if (kids.length === 0 || collapsed.has(i)) {
        // Only a real tip merges. A node left childless by the extinct filter
        // is standing in for a clade and keeps its own row.
        const key = all.length === 0 ? keys[i] : -1;
        if (key !== -1 && key === lastKey) {
          const r = rows.length - 1;
          yOf[i] = lo[i] = hi[i] = r;
          const rep = rows[r];
          dup.set(rep, (dup.get(rep) || 1) + 1);
        } else {
          yOf[i] = lo[i] = hi[i] = rows.length;
          rows.push(i);
          lastKey = key;
        }
      } else {
        stack.push([i, EXIT, kids]);
        for (let k = kids.length - 1; k >= 0; k--) stack.push([kids[k], ENTER]);
      }
    } else {
      const kids = frame[2];
      let a = Infinity, b = -Infinity, sLo = Infinity, sHi = -Infinity;
      for (let k = 0; k < kids.length; k++) {
        const c = kids[k], y = yOf[c];
        if (y < a) a = y;
        if (y > b) b = y;
        if (lo[c] < sLo) sLo = lo[c];
        if (hi[c] > sHi) sHi = hi[c];
      }
      yOf[i] = (a + b) / 2;
      lo[i] = sLo; hi[i] = sHi;
    }
  }

  return { yOf, lo, hi, rows, visible, dup, nRows: rows.length };
}

/** Collapse everything strictly below the given nodes. */
export function collapseTo(tree, nodes) {
  const set = new Set();
  for (const n of nodes) if (!tree.isTip(n)) set.add(n);
  return set;
}

/** Expand every ancestor of `node` so it becomes visible, and return the set. */
export function revealPath(tree, collapsed, node) {
  for (const a of tree.pathToRoot(node)) collapsed.delete(a);
  return collapsed;
}

/**
 * Expand `node` by one level, or fully when `deep` is set.
 * Guards against blowing the row count open by accident: a deep expand of
 * Actinopterygii is 31,000 rows and the caller may want to warn first.
 *
 * One level means down to the nearest *named* descendants, not to the immediate
 * children. The published trees are full of unlabelled bifurcations, and
 * stopping on one leaves the reader a triangle captioned "unnamed clade",
 * which tells them nothing and costs a click to get past. `isNamed` is
 * supplied by the caller; without it the old child-by-child behaviour stands.
 */
export function expand(tree, collapsed, node, deep, isNamed) {
  collapsed.delete(node);
  if (!deep) {
    for (const c of namedFrontier(tree, node, isNamed)) {
      if (!tree.isTip(c)) collapsed.add(c);
    }
    return collapsed;
  }
  const stack = [node];
  while (stack.length) {
    const i = stack.pop();
    collapsed.delete(i);
    for (const c of tree.children(i)) stack.push(c);
  }
  return collapsed;
}

/**
 * The nearest named nodes below `node`: its children, except that an unnamed
 * child is replaced by its own children, and so on down to the tips.
 */
export function namedFrontier(tree, node, isNamed) {
  const out = [];
  const stack = Array.from(tree.children(node)).reverse();
  let guard = 0;
  while (stack.length && guard++ < 100000) {
    const c = stack.pop();
    if (tree.isTip(c) || !isNamed || isNamed(c)) { out.push(c); continue; }
    const kids = tree.children(c);
    for (let k = kids.length - 1; k >= 0; k--) stack.push(kids[k]);
  }
  return out;
}

export function collapseNode(tree, collapsed, node) {
  if (!tree.isTip(node)) collapsed.add(node);
  return collapsed;
}

/** Nearest visible ancestor, for scrolling to a node that is currently hidden. */
export function visibleAncestor(tree, collapsed, node) {
  const path = tree.pathToRoot(node);
  for (let i = 0; i < path.length; i++) {
    if (collapsed.has(path[i])) return path[i];
  }
  return node;
}
