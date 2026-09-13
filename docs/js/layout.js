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
  const hideExtinct = !!(opts && opts.hideExtinct);
  const drop = (i) => hideExtinct && tree.extinctCount[i] === tree.tipCount[i];
  const yOf = new Float32Array(tree.cap).fill(-1);
  // Row span of each visible node's subtree. The renderer culls against these
  // instead of reading children, which is the difference between touching
  // 63,000 typed-array views per frame and touching none.
  const lo = new Float32Array(tree.cap);
  const hi = new Float32Array(tree.cap);
  const rows = [];
  const visible = [];

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
      const kids = hideExtinct ? all.filter((c) => !drop(c)) : all;
      if (kids.length === 0 || collapsed.has(i)) {
        yOf[i] = lo[i] = hi[i] = rows.length;
        rows.push(i);
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

  return { yOf, lo, hi, rows, visible, nRows: rows.length };
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
 */
export function expand(tree, collapsed, node, deep) {
  collapsed.delete(node);
  if (!deep) {
    for (const c of tree.children(node)) if (!tree.isTip(c)) collapsed.add(c);
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
