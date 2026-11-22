// node build/test_topology.mjs
//
// Exercises the overlay and the SPR engine against the real payload. The tree
// surgery is the one piece where a silent bug produces a plausible-looking
// picture that is wrong, so it gets checked rather than eyeballed.

import { readFileSync } from 'node:fs';
import { Tree, FLAG_EXTINCT } from '../docs/js/data.js';
import { applyAlternatives } from '../docs/js/topology.js';
import { layout, namedFrontier } from '../docs/js/layout.js';

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

// Fully expanded, every tip gets a row except where a run of adjacent tips
// prints the same label and folds into one. No tip may go missing either way.
const merged = (l) => {
  let n = 0;
  for (const count of l.dup.values()) n += count - 1;
  return n;
};
const lay = layout(tree, new Set());
check(lay.nRows + merged(lay) === base.tips,
  `layout rows ${lay.nRows} + ${merged(lay)} merged != tips ${base.tips}`);
console.log(`layout (fully expanded): ${lay.nRows} rows, ${lay.visible.length} visible nodes, `
  + `${merged(lay)} tips folded into a row above them`);

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
    check(l.nRows + merged(l) === v.tips,
      `${label}: layout rows ${l.nRows} + ${merged(l)} merged != tips ${v.tips}`);
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

// Every clade the scaffold asks for by MRCA has to have landed somewhere. This
// fails silently in the build: a tip list that names nothing in the tree drops
// the label entirely, which is how Cryptodira and Pleurodira went missing while
// the turtle tips still carried their voucher codes.
console.log('\nclades named by MRCA:');
const scaffold = JSON.parse(readFileSync(
  new URL('./scaffold/backbone.json', import.meta.url)));
const labelled = new Map();
for (const x of meta.taxonNodes) if (!labelled.has(x.label)) labelled.set(x.label, x.node);
for (const c of meta.clades) labelled.set(c.label, c.node);
let placed = 0;
for (const spec of scaffold.namedClades || []) {
  if (check(labelled.has(spec.label),
      `${spec.label}: not in the payload -- none of its mrca tips resolved`)) placed++;
}
console.log(`  ${placed} of ${(scaffold.namedClades || []).length} located`);

// Where a one-level open fans out widest. Not a failure -- the cichlids really
// are a thousand-odd genera under an unlabelled cascade -- but a missing
// intermediate label shows up here first, and a small number here is the
// difference between a readable click and a wall of rows.
const named = new Set();
for (const c of meta.clades) named.add(c.node);
for (const x of meta.taxonNodes) named.add(x.node);
for (const f of meta.fossils) named.add(f.node);
const widest = [];
for (const [label, node] of labelled) {
  if (tree.isTip(node)) continue;
  widest.push([namedFrontier(tree, node, (n) => named.has(n)).length, label]);
}
widest.sort((a, b) => b[0] - a[0]);
console.log('  widest one-level opens: '
  + widest.slice(0, 5).map(([n, l]) => `${l} ${n}`).join(', '));

// Tip labels. The placeholder rule has to fire on a taxonomy-placed tip and
// keep its hands off a real name, including the one form where a placeholder
// token is part of a real name: `cf.` followed by an epithet.
console.log('\ntip labels:');
const nameToNode = new Map();
for (let i = 0; i < meta.nNodes; i++) if (tree.isTip(i)) nameToNode.set(tree.name(i), i);
const labelCases = [
  ['Anolis_xzx90', 'Anolis sp.'],
  ['Pseudocrenilabrus_sp', 'Pseudocrenilabrus sp.'],
  ['Glyphis_sp.1', 'Glyphis sp.'],
  ['Cyclemys_sp_CAS208423', 'Cyclemys sp. CAS208423'],
  ['Eptatretus_cf._fernholmi_NRMt7933', 'Eptatretus cf. fernholmi NRMt7933'],
  ['Kinosternon_scorpioides_cruentatum', 'Kinosternon scorpioides cruentatum'],
  ['Homo_sapiens', 'Homo sapiens'],
  ['Apalone_spinifera', 'Apalone spinifera'],
];
for (const [raw, want] of labelCases) {
  const node = nameToNode.get(raw);
  if (!check(node !== undefined, `tip ${raw} is not in the payload`)) continue;
  check(tree.label(node) === want,
    `label(${raw}) is "${tree.label(node)}", expected "${want}"`);
}
let rewritten = 0;
for (let i = 0; i < meta.nNodes; i++) {
  if (tree.isTip(i) && tree.name(i).replace(/_/g, ' ') !== tree.label(i)) rewritten++;
}
console.log(`  ${labelCases.length} cases checked, ${rewritten} tips render as sp.`);

// Merged rows: nothing identical may remain side by side, the counts have to
// add up to the tips that were folded away, and an extinct tip keeps its own
// row even when a living tip carries the same name -- the Upham tree has a
// Hydrodamalis gigas and so does the fossil scaffold.
console.log('\nmerged rows:');
{
  const full = layout(tree, new Set());
  const keys = tree.rowKeys();
  let adjacent = 0;
  for (let r = 1; r < full.rows.length; r++) {
    const a = keys[full.rows[r - 1]], b = keys[full.rows[r]];
    if (a !== -1 && a === b) adjacent++;
  }
  check(adjacent === 0, `${adjacent} pairs of identical rows are still adjacent`);

  let counted = 0;
  for (const [node, n] of full.dup) {
    counted += n - 1;
    check(tree.isTip(node), `row ${node} was merged but is not a tip`);
    check(!tree.flag(node, FLAG_EXTINCT), `extinct tip ${tree.label(node)} was merged`);
  }
  check(counted === merged(full), 'dup counts disagree with the merged total');

  const byLabel = new Map();
  for (const node of full.rows) {
    const l = tree.label(node);
    byLabel.set(l, (byLabel.get(l) || 0) + 1);
  }
  const sea = byLabel.get('Hydrodamalis gigas') || 0;
  check(sea === 2, `Hydrodamalis gigas occupies ${sea} rows, expected 2 (living + fossil)`);
  const biggest = [...full.dup].sort((a, b) => b[1] - a[1])[0];
  console.log(`  ${full.dup.size} rows stand for more than one tip; `
    + `largest is ${tree.label(biggest[0])} at ${biggest[1]}`);
}

// The turtle graft is the one that needed cleaning up on the way in.
const turtleTips = [];
{
  const st = [meta.clades.find((c) => c.id === 'Testudines').node];
  while (st.length) {
    const i = st.pop();
    const k = tree.children(i);
    if (!k.length) turtleTips.push(tree.name(i)); else st.push(...k);
  }
}
check(!turtleTips.some((n) => /^(AA|ZZ)_|^Alligator_|^Gallus_/.test(n)),
  'an outgroup from the turtle file is still inside Testudines');
check(!turtleTips.some((n) => /^Hompous_|^Eretmocelys_/.test(n)),
  'a misspelt turtle name survived the rename');

// Warnings the build chose not to treat as fatal still deserve a look.
if (meta.warnings.length) {
  console.log(`\n${meta.warnings.length} build warning(s):`);
  for (const w of meta.warnings) console.log(`  ${w}`);
}

console.log(failures === 0 ? '\nOK' : `\n${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
