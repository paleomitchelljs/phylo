// Payload loading and the mutable tree overlay.
//
// The base tree is immutable typed arrays straight out of tree.bin. Topology
// toggles never rewrite those. They write into a small copy-on-write overlay,
// because every alternative in the scaffold moves a handful of nodes near the
// backbone and leaves the other 133,000 alone. Clearing the overlay is one
// Map.clear() rather than a rebuild.

export const FLAG_EXTINCT = 1;
export const FLAG_IMPUTED = 2;
export const FLAG_SCHEMATIC = 4;
export const FLAG_RANGE = 8;

export class Tree {
  constructor(buf, meta) {
    const dv = new DataView(buf);
    const magic = dv.getUint32(0, true);
    if (magic !== 0x31525456) throw new Error('tree.bin: bad magic');
    this.version = dv.getUint32(4, true);
    const n = (this.n = dv.getUint32(8, true));
    this.nTips = dv.getUint32(12, true);
    const spare = (this.spare = dv.getUint32(16, true));
    const nameBytes = dv.getUint32(20, true);

    let o = 24;
    this.baseParent = new Int32Array(buf, o, n); o += 4 * n;
    this.baseAge = new Float32Array(buf, o, n); o += 4 * n;
    this.flags = new Uint8Array(buf, o, n); o += pad4(n);
    this.source = new Uint8Array(buf, o, n); o += pad4(n);
    const namelen = new Uint16Array(buf.slice(o, o + 2 * n)); o += pad4(2 * n);
    this.nameBlob = new Uint8Array(buf, o, nameBytes);

    this.nameOff = new Uint32Array(n + 1);
    for (let i = 0; i < n; i++) this.nameOff[i + 1] = this.nameOff[i] + namelen[i];

    this.meta = meta;
    this.cap = n + spare;
    this.decoder = new TextDecoder();
    this._nameCache = new Map();

    this.buildBaseChildren();
    this.resetOverlay();
  }

  // ---- names -------------------------------------------------------------

  name(i) {
    if (i >= this.n) return this.jointLabel.get(i) || '';
    let s = this._nameCache.get(i);
    if (s === undefined) {
      const a = this.nameOff[i], b = this.nameOff[i + 1];
      s = a === b ? '' : this.decoder.decode(this.nameBlob.subarray(a, b));
      this._nameCache.set(i, s);
    }
    return s;
  }

  /** Display form: `Gambusia marshi`, not `Gambusia_marshi`. */
  label(i) {
    const s = this.name(i);
    return s.indexOf('_') === -1 ? s : s.replace(/_/g, ' ');
  }

  // ---- base children as CSR ---------------------------------------------

  buildBaseChildren() {
    const n = this.n, p = this.baseParent;
    const start = new Int32Array(n + 1);
    for (let i = 1; i < n; i++) start[p[i] + 1]++;
    for (let i = 0; i < n; i++) start[i + 1] += start[i];
    const cursor = start.slice(0, n);
    const list = new Int32Array(n > 0 ? n - 1 : 0);
    // Preorder guarantees parent < child, so filling in index order keeps
    // sibling order identical to the order the builder ladderised into.
    for (let i = 1; i < n; i++) list[cursor[p[i]]++] = i;
    this.childStart = start;
    this.childList = list;
  }

  // ---- overlay -----------------------------------------------------------

  resetOverlay() {
    this.kidsOver = new Map();     // node -> child array
    this.parentOver = new Map();   // node -> parent
    this.ageOver = new Map();      // node -> age
    this.jointLabel = new Map();   // spare node -> display label
    this.nextSpare = this.n;
    this.root = 0;
    this.dirty = true;
  }

  allocJoint(age, label) {
    if (this.nextSpare >= this.cap) throw new Error('out of spare nodes');
    const j = this.nextSpare++;
    this.ageOver.set(j, age);
    if (label) this.jointLabel.set(j, label);
    return j;
  }

  children(i) {
    const ov = this.kidsOver.get(i);
    if (ov) return ov;
    if (i >= this.n) return EMPTY;
    const a = this.childStart[i], b = this.childStart[i + 1];
    if (a === b) return EMPTY;
    return this.childList.subarray(a, b);
  }

  setChildren(i, arr) { this.kidsOver.set(i, arr); this.dirty = true; }

  parent(i) {
    const ov = this.parentOver.get(i);
    if (ov !== undefined) return ov;
    return i < this.n ? this.baseParent[i] : -1;
  }

  setParent(i, p) { this.parentOver.set(i, p); this.dirty = true; }

  age(i) {
    const ov = this.ageOver.get(i);
    return ov !== undefined ? ov : (i < this.n ? this.baseAge[i] : 0);
  }

  flag(i, bit) { return i < this.n && (this.flags[i] & bit) !== 0; }

  isTip(i) { return this.children(i).length === 0; }

  // ---- derived -----------------------------------------------------------

  /** Tips below every node, and the youngest age reached, for collapsed clades. */
  recompute() {
    if (!this.dirty) return;
    const cap = this.cap;
    if (!this.tipCount || this.tipCount.length !== cap) {
      this.tipCount = new Int32Array(cap);
      this.minAge = new Float32Array(cap);
      this.extinctCount = new Int32Array(cap);
      this.imputedCount = new Int32Array(cap);
      this._order = new Int32Array(cap);
    }
    const tc = this.tipCount, ma = this.minAge;
    const ec = this.extinctCount, ic = this.imputedCount;
    tc.fill(0); ec.fill(0); ic.fill(0); ma.fill(Infinity);

    // Iterative postorder without recursion; the fish clade alone is 70 deep
    // and a rearranged tree can be much worse.
    const stack = [this.root], out = this._order;
    let top = 0, len = 0;
    while (top >= 0) {
      const i = stack[top--];
      out[len++] = i;
      const kids = this.children(i);
      for (let k = 0; k < kids.length; k++) stack[++top] = kids[k];
    }
    for (let x = len - 1; x >= 0; x--) {
      const i = out[x], kids = this.children(i);
      if (kids.length === 0) {
        tc[i] = 1;
        ma[i] = this.age(i);
        ec[i] = this.flag(i, FLAG_EXTINCT) ? 1 : 0;
        ic[i] = this.flag(i, FLAG_IMPUTED) ? 1 : 0;
      } else {
        let t = 0, m = Infinity, e = 0, p = 0;
        for (let k = 0; k < kids.length; k++) {
          const c = kids[k];
          t += tc[c]; e += ec[c]; p += ic[c];
          if (ma[c] < m) m = ma[c];
        }
        tc[i] = t; ma[i] = m; ec[i] = e; ic[i] = p;
      }
    }
    this.visitOrder = out.subarray(0, len);
    this.dirty = false;
  }

  /** Path from a node up to the root, root first. */
  pathToRoot(i) {
    const out = [];
    let cur = i;
    while (cur !== -1 && cur !== undefined) { out.push(cur); cur = this.parent(cur); }
    return out.reverse();
  }
}

const EMPTY = new Int32Array(0);
function pad4(x) { return x + ((-x) % 4 + 4) % 4; }

export async function loadTree(base = 'data/') {
  const [binRes, metaRes] = await Promise.all([
    fetch(base + 'tree.bin'),
    fetch(base + 'meta.json'),
  ]);
  if (!binRes.ok) throw new Error(`tree.bin: HTTP ${binRes.status}`);
  if (!metaRes.ok) throw new Error(`meta.json: HTTP ${metaRes.status}`);
  const [buf, meta] = await Promise.all([binRes.arrayBuffer(), metaRes.json()]);
  return new Tree(buf, meta);
}

// --------------------------------------------------------------------------
// Search
// --------------------------------------------------------------------------

export function buildSearchIndex(tree) {
  const entries = [];
  const seen = new Set();

  const push = (node, text, kind, extra) => {
    if (!text) return;
    entries.push({ node, text, lower: text.toLowerCase(), kind, extra });
  };

  for (const c of tree.meta.clades) {
    push(c.node, c.label, 'clade', c.vernacular);
    if (c.vernacular) push(c.node, c.vernacular, 'clade', c.label);
    seen.add(c.node);
  }
  for (const t of tree.meta.taxonNodes) {
    if (seen.has(t.node)) continue;
    push(t.node, t.label, t.rank || 'clade');
    seen.add(t.node);
  }
  for (const f of tree.meta.fossils) {
    push(f.node, f.label, 'fossil', f.vernacular);
    if (f.vernacular) push(f.node, f.vernacular, 'fossil', f.label);
    seen.add(f.node);
  }
  const common = tree.meta.commonNames || [];
  const commonByNode = new Map();
  for (let i = 0; i < common.length; i += 2) commonByNode.set(common[i], common[i + 1]);
  for (const [node, cn] of commonByNode) push(node, cn, 'common', tree.label(node));

  // Species tips are the long tail; index them by scientific name.
  for (let i = 0; i < tree.n; i++) {
    if (tree.childStart[i] !== tree.childStart[i + 1]) continue;
    if (seen.has(i)) continue;
    const nm = tree.name(i);
    if (nm) push(i, nm.replace(/_/g, ' '), 'species', commonByNode.get(i));
  }

  return {
    entries,
    query(q, limit = 40) {
      const s = q.trim().toLowerCase();
      if (s.length < 2) return [];
      const starts = [], contains = [];
      for (const e of entries) {
        const idx = e.lower.indexOf(s);
        if (idx === 0) { if (starts.length < limit) starts.push(e); }
        else if (idx > 0 && contains.length < limit) contains.push(e);
        if (starts.length >= limit) break;
      }
      const rank = { clade: 0, order: 1, family: 2, genus: 3, fossil: 1, common: 4, species: 5 };
      return starts.concat(contains)
        .sort((a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9) || a.text.length - b.text.length)
        .slice(0, limit);
    },
  };
}
