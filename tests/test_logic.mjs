// node tests/test_logic.mjs — checks the course data and the scoring engine.
import fs from 'fs';
import vm from 'vm';
const ctx = { console }; ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['course.js', 'tree.js']) vm.runInContext(fs.readFileSync(new URL('../docs/js/' + f, import.meta.url), 'utf8'), ctx, { filename: f });
const P = ctx.P, F = P.F;
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } };

// every key used in decks and traits exists
for (const d of P.DECKS) for (const k of d.tips) ok(P.refByKey.has(k), `deck ${d.id}: ${k}`);
for (const d of P.DECKS) for (const a of d.tips) for (const b of d.tips) if (a !== b) ok(!P.nested(a, b), `deck ${d.id} nests ${a} ${b}`);
for (const d of P.DECKS) ok(P.fair(d.tips), `deck ${d.id} unfair`);
for (const t of P.TRAITS) for (const [, w] of t.ev) for (const k of [].concat(w)) ok(P.refByKey.has(k), `trait ${t.name}: ${k}`);
for (const a of P.ALTERNATIVES) ok(P.refByKey.has(a.move) && P.refByKey.has(a.sisterTo), 'alt');
console.log('variants', P.variants.length, 'nodes', P.refByKey.size, 'traits', P.TRAITS.length);

// build the correct answer for a deck through the forest ops and expect a perfect score
function buildAnswer(keys) {
  const S = P.emptyState(keys);
  const { root } = P.answerTree(keys);
  function rec(c) {
    if (c.t) return F.addTip(S, c.t, 0, 0);
    const ids = c.k.map(rec);
    let cur = ids[0];
    for (const x of ids.slice(1)) {
      if (cur === ids[0] && S.nodes[cur].p == null) cur = F.join(S, x, cur);
      else F.addChild(S, cur, x);
    }
    if (c.lab) F.label(S, cur, c.lab);
    return cur;
  }
  rec(root);
  return S;
}
for (const d of P.DECKS) {
  const S = buildAnswer(d.tips);
  const r = P.score(S);
  ok(r.nodesOk === r.nodesNeed, `${d.id} nodes ${r.nodesOk}/${r.nodesNeed}`);
  ok(r.labelsOk === r.labelsAll, `${d.id} labels ${r.labelsOk}/${r.labelsAll}`);
  ok(S.roots.length === 1, `${d.id} roots`);
  ok(Object.values(r.node).every(s => s !== 'bad'), `${d.id} no bad nodes`);
}

// backbone: wrong grouping is flagged
{
  const S = P.emptyState(['myxini', 'petromyzontida', 'selachii', 'actinopterygii']);
  const a = F.addTip(S, 'myxini', 0, 0), b = F.addTip(S, 'petromyzontida', 0, 0), c = F.addTip(S, 'selachii', 0, 0), d = F.addTip(S, 'actinopterygii', 0, 0);
  const m1 = F.join(S, c, b);        // (lamprey, shark) wrong
  const m2 = F.join(S, d, m1);
  const m3 = F.join(S, a, m2);
  const r = P.score(S);
  ok(r.node[m1] === 'bad', 'lamprey+shark should be bad, got ' + r.node[m1]);
  ok(r.node[m3] === 'ok', 'root ok');
  ok(r.nodesOk === 1 && r.nodesNeed === 3, `score ${r.nodesOk}/${r.nodesNeed}`);
  F.label(S, m3, 'Vertebrata'); F.label(S, m2, 'Gnathostomata');
  const r2 = P.score(S);
  ok(r2.label[m3] === 'ok' && r2.label[m2] === 'bad', 'labels ' + JSON.stringify(r2.label));
}

// root-up: placeholders, split, fill, label transfer
{
  const S = P.emptyState(['myxini', 'petromyzontida', 'selachii']);
  const r = F.newRoot(S, 0, 0);
  const [p1, p2] = S.nodes[r].k;
  F.label(S, p2, 'Cyclostomata');
  F.split(S, p2);
  const [q1, q2] = S.nodes[p2].k;
  F.fill(S, q1, F.addTip(S, 'myxini', 0, 0));
  F.fill(S, q2, F.addTip(S, 'petromyzontida', 0, 0));
  F.fill(S, p1, F.addTip(S, 'selachii', 0, 0));
  const sc = P.score(S);
  ok(sc.nodesOk === 2 && sc.labelsOk === 1, `root-up ${sc.nodesOk} ${sc.labelsOk}`);
  ok(S.roots.length === 1 && Object.values(S.nodes).every(n => !n.ph), 'no placeholders left');
  // detach the shark: root splices out
  const shark = Object.values(S.nodes).find(n => n.t === 'selachii').id;
  F.detach(S, shark, 10, 10);
  ok(S.roots.length === 2 && S.roots.some(x => x.id === p2), 'detach splices root');
  F.collapse(S, p2);
  ok(S.roots.length === 3, 'collapse root');
}

// soft polytomy: resolving sturgeon/gar/bowfin is "meh", not wrong
{
  const keys = ['bichir', 'sturgeon', 'longnose_gar', 'bowfin'];
  const S = P.emptyState(keys);
  const [a, b, c, d] = keys.map(k => F.addTip(S, k, 0, 0));
  const m = F.join(S, c, b), m2 = F.join(S, d, m), m3 = F.join(S, a, m2);
  const r = P.score(S);
  ok(r.node[m] === 'meh' && r.node[m2] === 'ok' && r.node[m3] === 'ok', 'soft ' + JSON.stringify(r.node));
}

// alternatives: turtles with lepidosaurs scores full
{
  const keys = ['sphenodon', 'green_iguana', 'box_turtle', 'alligator', 'chicken'];
  const S = P.emptyState(keys);
  const [sp, ig, tu, al, ch] = keys.map(k => F.addTip(S, k, 0, 0));
  const l = F.join(S, ig, sp), lt = F.join(S, tu, l), ar = F.join(S, ch, al), root = F.join(S, ar, lt);
  const r = P.score(S);
  ok(r.nodesOk === 4 && r.nodesNeed === 4, `alt ${r.nodesOk}/${r.nodesNeed}`);
}

// traits: vertebrae gained at Vertebrata, lost in hagfish; electroreception net events
{
  const keys = ['amphioxus_never'];
  const R = P.restrict(P.ref, ['cephalochordata', 'myxini', 'petromyzontida', 'selachii', 'platypus', 'mouse']);
  const v = P.refTraitEvents(P.traitById.get('vertebrae'), R);
  ok(v.size === 2, 'vertebrae events ' + [...v]);
  const e = P.refTraitEvents(P.traitById.get('electroreception'), R);
  ok(e.size === 3, 'electro events ' + [...e]);   // gain vertebrata, loss amniota(mammals), gain platypus
  const R2 = P.restrict(P.ref, ['myxini', 'platypus']);
  const e2 = P.refTraitEvents(P.traitById.get('electroreception'), R2);
  ok(e2.size === 1, 'electro cancels ' + [...e2]);
  // student marks
  const S = P.emptyState(['myxini', 'petromyzontida', 'selachii']);
  const [h, l, s] = S.deck.map(k => F.addTip(S, k, 0, 0));
  const cy = F.join(S, l, h), root = F.join(S, s, cy);
  F.mark(S, 'vertebrae', root, false); F.mark(S, 'vertebrae', h, true);
  F.mark(S, 'jaws', cy, false);
  const r = P.score(S);
  ok(r.mark.vertebrae[root] === 'ok' && r.mark.vertebrae[h] === 'ok', 'marks ' + JSON.stringify(r.mark));
  ok(r.mark.jaws[cy] === 'bad', 'jaws bad');
  ok(r.traitsOk === 2 && r.traitsNeed === 3, `traits ${r.traitsOk}/${r.traitsNeed}`);
}

// dealing: random decks of 6/11/16/21 reach their size, never take more than two
// from a group whose insides weren't taught (or from any open polytomy), and never nest
for (let i = 0; i < 400; i++) {
  const scope = ['chordata', 'vertebrata', 'gnathostomata', 'actinopterygii', 'amniota', 'lissamphibia', 'chondrichthyes'][i % 7];
  const n = [6, 11, 16, 21][i % 4];
  const d = P.deal(scope, n, null, i % 2 === 0);
  for (const node of P.refByKey.values()) {
    if (node.k.length < 3) continue;
    const hit = node.k.filter(c => d.some(k => k === c.key || P.isAncestor(c.key, k))).length;
    ok(hit <= 2 || d.includes(node.key), `deal takes ${hit} from ${node.key}: ${d}`);
  }
  for (const a of d) for (const b of d) if (a !== b) ok(!P.nested(a, b), 'deal nested');
  if (['chordata', 'vertebrata', 'gnathostomata'].includes(scope)) ok(d.length === n, `deal ${scope} size ${d.length} < ${n}`);
}

// dropping a subtree on its own parent keeps the tree intact
{
  const S = P.emptyState(['myxini', 'petromyzontida', 'selachii']);
  const [h, l, s] = S.deck.map(k => F.addTip(S, k, 0, 0));
  const cy = F.join(S, l, h), root = F.join(S, s, cy);
  F.join(S, h, cy);
  ok(S.roots.length === 1 && F.taxa(S, S.roots[0].id).length === 3, 'join onto own parent');
  ok(Object.keys(S.nodes).length === 5, 'nodes ' + Object.keys(S.nodes).length);
}
console.log(fails ? fails + ' failures' : 'all ok');
process.exit(fails ? 1 : 0);
