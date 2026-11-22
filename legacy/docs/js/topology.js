// Topology alternatives: subtree prune-and-regraft over the overlay.
//
// Every alternative in alternatives.json compiles to a short list of these two
// operations. Applying a set of them means clearing the overlay and replaying
// from the reference tree, which keeps toggles independent and undoable.

/** Children of `i` as a plain mutable array. */
function kidsArray(tree, i) {
  const k = tree.children(i);
  return Array.prototype.slice.call(k);
}

function replaceChild(tree, parent, oldChild, newChild) {
  const kids = kidsArray(tree, parent);
  const at = kids.indexOf(oldChild);
  if (at === -1) return false;
  kids[at] = newChild;
  tree.setChildren(parent, kids);
  tree.setParent(newChild, parent);
  return true;
}

/** Detach `node`, suppressing its parent if that leaves the parent with one child. */
function detach(tree, node) {
  const p = tree.parent(node);
  if (p === -1) return;
  const kids = kidsArray(tree, p).filter((x) => x !== node);
  tree.setChildren(p, kids);
  if (kids.length === 1 && p !== tree.root) {
    const only = kids[0];
    const gp = tree.parent(p);
    if (gp !== -1) {
      replaceChild(tree, gp, p, only);
      tree.setChildren(p, []);
    }
  } else if (kids.length === 1 && p === tree.root) {
    tree.root = kids[0];
    tree.setParent(kids[0], -1);
  }
}

function isAncestorOf(tree, maybeAncestor, node) {
  let cur = node;
  let guard = 0;
  while (cur !== -1 && guard++ < 1e6) {
    if (cur === maybeAncestor) return true;
    cur = tree.parent(cur);
  }
  return false;
}

/**
 * Make `clade` sister to `sibling`.
 *
 * When `sibling` is an ancestor of `clade`, the prune happens first, so the
 * result reads as "clade branches off before everything else in that group".
 * That is how the Iguania-first and anapsid-turtle arrangements are expressed.
 */
export function spr(tree, clade, sibling, age) {
  if (clade === sibling) return;
  if (isAncestorOf(tree, clade, sibling)) {
    console.warn('spr: refusing to regraft a clade inside itself', clade, sibling);
    return;
  }
  const targetWasAncestor = isAncestorOf(tree, sibling, clade);
  detach(tree, clade);

  let target = sibling;
  let a = (age === null || age === undefined)
    ? Math.max(tree.age(clade), tree.age(target)) * 1.08 + 0.5
    : age;
  const floor0 = Math.max(tree.age(clade), tree.age(target));
  if (a <= floor0) a = floor0 + Math.max(floor0 * 0.03, 0.4);

  // Walk rootward to the branch the requested age actually falls on. "Turtles
  // sister to crocodilians at 245 Ma" means sister to the crocodilian total
  // group, above Deinosuchus and the rest of the stem, not wedged between
  // crown Crocodylia and a 98 Ma joint. Skipped when the target is already an
  // ancestor of the moved clade, where the caller means "branches off first".
  if (!targetWasAncestor) {
    for (;;) {
      const up = tree.parent(target);
      if (up === -1 || tree.age(up) >= a) break;
      target = up;
    }
  }

  const q = tree.parent(target);
  const lower = Math.max(tree.age(clade), tree.age(target));
  if (a <= lower) a = lower + Math.max(lower * 0.03, 0.4);
  if (q !== -1 && a >= tree.age(q)) a = (lower + tree.age(q)) / 2;

  const j = tree.allocJoint(a, null);
  tree.setChildren(j, targetWasAncestor ? [clade, target] : [target, clade]);
  tree.setParent(target, j);
  tree.setParent(clade, j);

  if (q === -1) {
    tree.root = j;
    tree.setParent(j, -1);
  } else {
    replaceChild(tree, q, target, j);
  }
  tree.dirty = true;
}

/**
 * Gather separate lineages into one clade and hang it off `sibling`.
 *
 * This is what converts a grade back into a monophyletic group, which is the
 * only honest way to show a student what the placoderm-monophyly claim is
 * actually claiming.
 */
export function cluster(tree, members, sibling, age, label) {
  const live = members.filter((m) => m !== undefined && m !== null);
  if (live.length < 2) return;

  const ages = live.map((m) => tree.age(m));
  const inner = tree.allocJoint(Math.max(...ages) * 1.04 + 0.5, label || null);
  for (const m of live) detach(tree, m);
  tree.setChildren(inner, live.slice());
  for (const m of live) tree.setParent(m, inner);

  spr(tree, inner, sibling, age);
}

/**
 * Replay a chosen set of options onto a clean overlay.
 * `selection` maps alternative id -> option id.
 */
export function applyAlternatives(tree, selection) {
  tree.resetOverlay();
  const applied = [];
  for (const alt of tree.meta.alternatives) {
    const chosen = selection[alt.id] || alt.default;
    const opt = alt.options.find((o) => o.id === chosen);
    if (!opt || !opt.ops || opt.ops.length === 0) continue;
    for (const op of opt.ops) {
      try {
        if (op.op === 'spr') spr(tree, op.clade, op.sibling, op.age);
        else if (op.op === 'cluster') cluster(tree, op.members, op.sibling, op.age, op.label);
      } catch (err) {
        console.error(`alternative ${alt.id}/${chosen}: ${err.message}`);
      }
    }
    applied.push({ alt, opt });
  }
  tree.dirty = true;
  tree.recompute();
  return applied;
}

/** True when any alternative is set to something other than its default. */
export function isModified(tree, selection) {
  return tree.meta.alternatives.some(
    (a) => (selection[a.id] || a.default) !== a.default);
}
