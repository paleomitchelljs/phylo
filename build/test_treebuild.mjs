// node build/test_treebuild.mjs
//
// The exercise marks student answers, so the pruned reference tree has to be
// right. The strong test is rooted triples: for every three dealt taxa, the
// pruned tree must give the same answer as the full 133,000-node tree. If it
// does for every triple, the induced topology is correct.

import { readFileSync } from 'node:fs';
import { Tree } from '../docs/js/data.js';
import {
  sampleSpread, sampleClose, inducedTopology, cladeKeys, score,
  rootedTriple, rootedTripleFull,
} from '../docs/js/treebuild.js';

const bin = readFileSync(new URL('../docs/data/tree.bin', import.meta.url));
const meta = JSON.parse(readFileSync(new URL('../docs/data/meta.json', import.meta.url)));
const tree = new Tree(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength), meta);
tree.recompute();

let failures = 0;
const fail = (msg) => { console.log(`  FAIL ${msg}`); failures++; };

// Deterministic generator so a failure is reproducible.
let seed = 20260913;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

const named = new Set();
const cn = meta.commonNames || [];
for (let i = 0; i < cn.length; i += 2) named.add(cn[i]);

const scopes = ['Vertebrata', 'Mammalia', 'Aves', 'Squamata', 'Amphibia', 'Actinopterygii']
  .map((id) => meta.clades.find((c) => c.id === id))
  .filter(Boolean);

const label = (i) => tree.label(i);

function checkDeal(tag, tips) {
  const uniq = [...new Set(tips)];
  if (uniq.length !== tips.length) fail(`${tag}: dealt a duplicate taxon`);
  if (tips.some((x) => !tree.isTip(x))) fail(`${tag}: dealt a non-tip`);

  const topo = inducedTopology(tree, tips);

  const flat = [];
  (function collect(u) { if (!u.children) flat.push(u.tips[0]); else u.children.forEach(collect); })(topo);
  if (flat.length !== tips.length) {
    fail(`${tag}: induced tree has ${flat.length} tips, dealt ${tips.length}`);
    return null;
  }
  if ([...new Set(flat)].length !== flat.length) fail(`${tag}: induced tree repeats a tip`);
  for (const x of tips) if (!flat.includes(x)) fail(`${tag}: ${label(x)} missing from induced tree`);

  // No single-child nodes: those are the contraction failing.
  (function noChains(u) {
    if (!u.children) return;
    if (u.children.length < 2) fail(`${tag}: induced node with ${u.children.length} child(ren)`);
    u.children.forEach(noChains);
  })(topo);

  // Every rooted triple must match the full tree.
  let checked = 0, wrong = 0;
  for (let a = 0; a < tips.length; a++) {
    for (let b = a + 1; b < tips.length; b++) {
      for (let c = b + 1; c < tips.length; c++) {
        const full = rootedTripleFull(tree, tips[a], tips[b], tips[c]);
        const ind = rootedTriple(topo, tips[a], tips[b], tips[c]);
        checked++;
        if (full !== ind) {
          wrong++;
          if (wrong === 1) {
            fail(`${tag}: triple (${label(tips[a])}, ${label(tips[b])}, ${label(tips[c])}) `
              + `full tree says odd-one-out ${full === null ? 'polytomy' : label(full)}, `
              + `pruned tree says ${ind === null ? 'polytomy' : label(ind)}`);
          }
        }
      }
    }
  }
  return { topo, triples: checked, wrong };
}

console.log('rooted-triple agreement between the pruned and full trees:');
let totalTriples = 0;
for (const scope of scopes) {
  for (const mode of ['spread', 'close']) {
    for (const n of [3, 5, 8, 12, 20]) {
      const opts = { fossils: false, named };
      const tips = mode === 'spread'
        ? sampleSpread(tree, scope.node, n, opts, rnd)
        : sampleClose(tree, scope.node, n, opts, rnd);
      const got = [...new Set(tips)].slice(0, n);
      // The deal must actually produce what was asked for; silently short
      // deals are how a 'spread' sample turns into two taxa.
      if (got.length !== n) {
        fail(`${scope.id}/${mode}/n=${n}: dealt ${got.length} taxa, asked for ${n}`);
        continue;
      }
      const r = checkDeal(`${scope.id}/${mode}/n=${n}`, got);
      if (r) totalTriples += r.triples;
    }
  }
}
console.log(`  ${totalTriples} triples checked across ${scopes.length * 2 * 5} deals`);

// Fossils must be reachable when asked for, and absent when not.
const withFossils = sampleSpread(tree, 0, 20, { fossils: true, named }, rnd);
const withoutFossils = sampleSpread(tree, 0, 20, { fossils: false, named }, rnd);
const isExtinct = (i) => (tree.flags[i] & 1) !== 0;
if (withoutFossils.some(isExtinct)) fail('extinct taxa dealt when fossils were excluded');
console.log(`\nfossils excluded: ${withoutFossils.filter(isExtinct).length} extinct dealt`);
console.log(`fossils included: ${withFossils.filter(isExtinct).length} extinct dealt of 20`);

// Scoring: the reference scored against itself must be perfect, and a
// deliberately wrong tree must not be.
const tips = [...new Set(sampleSpread(tree, 0, 8, { fossils: false, named }, rnd))].slice(0, 8);
if (tips.length !== 8) fail(`scoring setup dealt ${tips.length} taxa, wanted 8`);
const ref = inducedTopology(tree, tips);
if (cladeKeys(ref).size === 0) fail('8-taxon reference has no clades to score against');
const self = score(ref, ref);
if (self.pct !== 100 || self.rf !== 0) fail(`reference scored against itself: ${self.pct}%, RF ${self.rf}`);

// A caterpillar in dealt order is almost certainly not the true tree.
let cat = { tips: [tips[0]], children: null, node: tips[0] };
for (let i = 1; i < tips.length; i++) {
  const leaf = { tips: [tips[i]], children: null, node: tips[i] };
  cat = { tips: cat.tips.concat([tips[i]]).sort((a, b) => a - b), children: [cat, leaf] };
}
const bad = score(cat, ref);
console.log(`\nreference vs itself: ${self.pct}% (RF ${self.rf})`);
console.log(`caterpillar vs reference: ${bad.pct}% (RF ${bad.rf}, `
  + `${bad.correct.length}/${bad.total} clades)`);
if (bad.total !== cladeKeys(ref).size) fail('clade count mismatch in scoring');
if (bad.pct === 100 && bad.total > 0) {
  fail('a caterpillar in dealt order scored 100% -- scoring is not discriminating');
}

console.log(failures === 0 ? '\nOK' : `\n${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
