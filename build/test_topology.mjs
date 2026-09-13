// node build/test_topology.mjs
//
// Exercises the overlay and the SPR engine against the real payload. The tree
// surgery is the one piece where a silent bug produces a plausible-looking
// picture that is wrong, so it gets checked rather than eyeballed.

import { readFileSync } from 'node:fs';
import { Tree } from '../docs/js/data.js';
import { applyAlternatives } from '../docs/js/topology.js';
import { layout } from '../docs/js/layout.js';

const bin = readFileSync(new URL('../docs/data/tree.bin', import.meta.url));
const meta = JSON.parse(readFileSync(new URL('../docs/data/meta.json', import.meta.url)));
const buf = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);

// Backbone clades with exactly one living species keep their label and so keep
// their node; everything else with one child is a bug.
const monotypic = new Set();

let failures = 0;
function check(cond, msg) {
  if (!cond) { console.log(`  FAIL ${msg}`); failures++; }
  return cond;
}

/** Walk the overlay and assert it is still a tree. */
function validate(tree, label) {
  const seen = new Set();
  const stack = [tree.root];
  let tips = 0, maxDepth = 0;
  const depth = new Map([[tree.root, 0]]);
  while (stack.length) {
    const i = stack.pop();
    if (seen.has(i)) { check(false, `${label}: node ${i} reached twice (cycle or DAG)`); return null; }
    seen.add(i);
    const d = depth.get(i);
    if (d > maxDepth) maxDepth = d;
    const kids = tree.children(i);
    if (kids.length === 0) tips++;
    else if (kids.length === 1 && !monotypic.has(i)) {
      check(false, `${label}: node ${i} (${tree.name(i)}) has a single child`);
    }
    for (let k = 0; k < kids.length; k++) {
      const c = kids[k];
      check(tree.parent(c) === i, `${label}: parent of ${c} is ${tree.parent(c)}, expected ${i}`);
      depth.set(c, d + 1);
      stack.push(c);
    }
  }
  check(tree.parent(tree.root) === -1, `${label}: root has a parent`);
  return { nodes: seen.size, tips, maxDepth };
}

function ageMonotonic(tree, label) {
  let bad = 0, worst = null;
  const stack = [tree.root];
  while (stack.length) {
    const i = stack.pop();
    const kids = tree.children(i);
    for (let k = 0; k < kids.length; k++) {
      const c = kids[k];
      if (tree.age(c) > tree.age(i) + 1e-3) {
        bad++;
        if (!worst) worst = `${tree.name(c) || c} ${tree.age(c).toFixed(1)} > parent ${tree.name(i) || i} ${tree.age(i).toFixed(1)}`;
      }
      stack.push(c);
    }
  }
  if (bad) console.log(`  note ${label}: ${bad} age inversion(s), e.g. ${worst}`);
  return bad;
}

const tree = new Tree(buf, meta);
for (const c of meta.clades) {
  if (tree.children(c.node).length === 1) monotypic.add(c.node);
}
console.log(`monotypic backbone clades: ${[...monotypic].map((i) => tree.name(i)).join(', ') || 'none'}`);
console.log(`payload: ${tree.n} nodes, ${tree.nTips} tips, root age ${meta.rootAge}`);

const base = validate(tree, 'reference');
console.log(`reference: ${base.nodes} nodes, ${base.tips} tips, depth ${base.maxDepth}`);
check(base.tips === tree.nTips, `reference tip count ${base.tips} != header ${tree.nTips}`);
check(ageMonotonic(tree, 'reference') === 0, 'reference has age inversions');

const lay = layout(tree, new Set());
check(lay.nRows === base.tips, `layout rows ${lay.nRows} != tips ${base.tips}`);
console.log(`layout (fully expanded): ${lay.nRows} rows, ${lay.visible.length} visible nodes`);

console.log('\nalternatives:');
for (const alt of meta.alternatives) {
  for (const opt of alt.options) {
    const sel = {};
    sel[alt.id] = opt.id;
    applyAlternatives(tree, sel);
    const label = `${alt.id}/${opt.id}`;
    const v = validate(tree, label);
    if (!v) continue;
    const tipDelta = v.tips - base.tips;
    check(tipDelta === 0, `${label}: tip count changed by ${tipDelta}`);
    ageMonotonic(tree, label);
    const l = layout(tree, new Set());
    check(l.nRows === v.tips, `${label}: layout rows ${l.nRows} != tips ${v.tips}`);
    const spare = tree.nextSpare - tree.n;
    console.log(`  ${label.padEnd(40)} ${v.tips} tips, depth ${v.maxDepth}, ${spare} joint(s)`);
  }
}

// All non-default options at once: the stress case for overlay interaction.
console.log('\nall alternatives switched together:');
const everything = {};
for (const alt of meta.alternatives) {
  const other = alt.options.find((o) => o.id !== alt.default);
  if (other) everything[alt.id] = other.id;
}
applyAlternatives(tree, everything);
const combo = validate(tree, 'combined');
if (combo) {
  check(combo.tips === base.tips, `combined: tip count ${combo.tips} != ${base.tips}`);
  console.log(`  ${combo.nodes} nodes, ${combo.tips} tips, depth ${combo.maxDepth}, `
    + `${tree.nextSpare - tree.n} joints used of ${tree.spare}`);
}

// Back to the reference: resetting must be exact.
applyAlternatives(tree, {});
const back = validate(tree, 'reset');
check(back && back.tips === base.tips && back.nodes === base.nodes, 'reset did not restore the reference tree');
check(tree.root === 0, `reset root is ${tree.root}, expected 0`);

console.log(failures === 0 ? '\nOK' : `\n${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
