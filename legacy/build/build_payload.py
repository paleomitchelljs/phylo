#!/usr/bin/env python3
"""Assemble the vertebrate scaffold and emit the browser payload.

    python3 build/build_payload.py

Reads build/scaffold/*.json plus the raw chronograms in trees/, and writes
docs/data/tree.bin and docs/data/meta.json.

The binary holds only what has to exist for every node -- parent, age, flags,
source, name length -- so it stays around 3 MB raw and about 1.2 MB over the
wire. Everything sparse (fossil ranges, grade membership, citations, the
alternatives) lives in meta.json.
"""

from __future__ import annotations

import csv
import json
import os
import re
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import phylolib as P
from phylolib import (FLAG_EXTINCT, FLAG_IMPUTED, FLAG_SCHEMATIC, FLAG_RANGE,
                      Node)

ROOT = Path(__file__).resolve().parent.parent
TREES = ROOT / "trees"
SCAFFOLD = Path(__file__).parent / "scaffold"
OUT = ROOT / "docs" / "data"

MAGIC = 0x31525456  # 'VTR1'
VERSION = 1
SPARE_NODES = 96    # slots reserved for joints created by topology toggles

warnings: list[str] = []


def warn(msg):
    warnings.append(msg)
    print(f"  ! {msg}", file=sys.stderr)


def load(name):
    with open(SCAFFOLD / name) as fh:
        return json.load(fh)


# --------------------------------------------------------------------------
# 1. Backbone
# --------------------------------------------------------------------------

def build_backbone(spec):
    """Turn the nested backbone spec into Nodes. Graft points stay as tips."""
    index = {}

    def walk(d):
        nd = Node(name=d.get("label", d["id"]))
        nd.age = float(d["age"])
        nd.meta = {
            "id": d["id"],
            "label": d.get("label", d["id"]),
            "vernacular": d.get("vernacular"),
            "note": d.get("note"),
            "refs": d.get("refs", []),
            "backbone": True,
        }
        index[d["id"]] = nd
        for child in d.get("children", []):
            nd.add(walk(child))
        return nd

    root = walk(spec)
    return root, index


# --------------------------------------------------------------------------
# 2. Taxonomy tables, for labelling collapsed clades
# --------------------------------------------------------------------------

_PAREN = re.compile(r"\s*\(.*?\)\s*$")

# Column mapping per file. Sniffing these was a mistake: the amphibian table
# has a column literally called "Taxon" that holds the order, which any
# heuristic happily mistakes for the species name.
TAXONOMY_FILES = [
    {"path": "actinopterygii/PFC_taxonomy.csv",
     "species": "genus.species", "family": "family", "order": "order"},
    {"path": "amphibia/amph_shl_new_Classification.csv",
     "species": "Scientific Name", "family": "Family", "order": "Taxon"},
    {"path": "squamata/title2024_science/squamatesCoreTaxonomy_treeTaxa.csv",
     "species": "treename", "family": "family", "order": None},
    {"path": "mammalia/upham2019_vertlife/taxonomy_mamPhy_5911species.csv",
     "species": "Species_Name", "family": "fam", "order": "ord"},
    {"path": "aves/mctavish2025_opentree_aves1.6/taxonAddition_2025taxonomy_v2_9.csv",
     "species": "sci_name", "family": "family", "order": None,
     "common": "primary_com_name"},
    {"path": "aves/jetz2012_birdtree/BLIOCPhyloMasterTax.csv",
     "species": "TipLabel", "family": "BLFamilyLatin", "order": "IOCOrder",
     "common": "English"},
]


def _clean_taxon(value):
    """`Struthionidae (Ostriches)` -> `Struthionidae`."""
    v = _PAREN.sub("", (value or "").strip().strip("'\""))
    if not v or v.lower() in ("na", "n/a", "none", "incertae sedis"):
        return ""
    return v.title() if v.isupper() or v.islower() else v


def load_taxonomy(spec):
    """Return ({species: (family, order)}, {species: common name})."""
    path = TREES / spec["path"]
    ranks, common = {}, {}
    if not path.exists():
        warn(f"taxonomy file missing: {spec['path']}")
        return ranks, common
    try:
        with open(path, newline="", errors="ignore") as fh:
            rdr = csv.DictReader(fh)
            if not rdr.fieldnames:
                return ranks, common
            fields = {f.strip(): f for f in rdr.fieldnames if f}
            need = spec["species"]
            if need not in fields:
                warn(f"{spec['path']}: no column '{need}'")
                return ranks, common
            for row in rdr:
                sp = P.normalise_label(row.get(fields[need], "") or "")
                if not sp:
                    continue
                fam = _clean_taxon(row.get(fields.get(spec["family"], ""), "")) \
                    if spec.get("family") in fields else ""
                ordr = _clean_taxon(row.get(fields.get(spec["order"], ""), "")) \
                    if spec.get("order") in fields else ""
                if fam or ordr:
                    ranks[sp] = (fam, ordr)
                ckey = spec.get("common")
                if ckey and ckey in fields:
                    cn = (row.get(fields[ckey]) or "").strip()
                    if cn:
                        common[sp] = cn
    except Exception as exc:  # a malformed table must not kill the build
        warn(f"taxonomy {spec['path']}: {exc}")
    return ranks, common


# --------------------------------------------------------------------------
# 3. Grafting the published clade trees
# --------------------------------------------------------------------------

def strip_vouchers(sub):
    """Cut museum voucher codes off tip labels: Cuora_trifasciata_KFBG030278065.

    Keeps the genus plus any following all-lowercase tokens, so binomials,
    trinomials and `Genus_sp` survive and everything from the first
    capitalised or digit-bearing token onwards is dropped. A name that would
    collide with another tip keeps its voucher, because two samples of one
    species are the one case where the code is the only thing separating them.
    """
    def binomial(name):
        parts = name.split("_")
        out = [parts[0]]
        for x in parts[1:]:
            if not (x.isalpha() and x.islower()):
                break
            out.append(x)
        return "_".join(out)

    tips = [nd for nd in P.iter_nodes(sub) if nd.is_tip and nd.name]
    proposed = {id(nd): binomial(nd.name) for nd in tips}
    counts = {}
    for v in proposed.values():
        counts[v] = counts.get(v, 0) + 1
    n = 0
    for nd in tips:
        want = proposed[id(nd)]
        if want != nd.name and counts[want] == 1 and "_" in want:
            nd.name = want
            n += 1
    return n


def graft_sources(index, sources, hand_built, taxonomy):
    """Replace backbone graft points with real clade trees."""
    source_meta = []
    source_of = {}

    def attach(target, subtree, src_id):
        """Move subtree's children onto the backbone node, keeping its label."""
        for child in list(subtree.children):
            target.add(child)
        for nd in P.iter_nodes(target):
            if nd is not target:
                source_of[id(nd)] = src_id

    for spec in hand_built:
        node = index.get(spec["graftAt"])
        if node is None:
            warn(f"hand-built graft point {spec['graftAt']} not in backbone")
            continue
        sub = P.parse_newick(spec["newick"])
        src_id = len(source_meta)
        source_meta.append({
            "label": spec["graftAt"], "citation": spec.get("citation", ""),
            "note": spec.get("note"), "handBuilt": True, "file": None,
        })
        if sub.is_tip:                     # single-species clade, e.g. tuatara
            sub.name = P.normalise_label(sub.name)
            sub.age = 0.0
            node.add(sub)
            source_of[id(sub)] = src_id
        else:
            P.ages_from_lengths(sub)
            P.rescale_to_root_age(sub, node.age)
            attach(node, sub, src_id)
        print(f"  graft {spec['graftAt']:<18} {P.count_tips(node):>6} tips  (hand-built)")

    for spec in sources:
        node = index.get(spec["graftAt"])
        if node is None:
            warn(f"graft point {spec['graftAt']} not in backbone")
            continue
        path = TREES / spec["file"]
        if not path.exists():
            warn(f"missing {spec['file']} -- {spec['graftAt']} will be empty")
            continue
        sub = P.read_first_tree(path, spec.get("index", 0))
        for nd in P.iter_nodes(sub):
            if nd.is_tip:
                nd.name = P.normalise_label(nd.name)
            else:
                nd.name = P.clean_internal_label(nd.name)
                if nd.name:
                    nd.meta = {"label": nd.name, "rank": "clade",
                               "taxon": True, "fromSource": True}

        drop = set(spec.get("drop", []))
        drop = {P.normalise_label(d) for d in drop}
        pattern = spec.get("dropPattern")
        if pattern:
            rx = re.compile(pattern)
            drop |= {nd.name for nd in P.iter_nodes(sub)
                     if nd.is_tip and rx.match(nd.name)}
        if drop:
            present = {nd.name for nd in P.iter_nodes(sub) if nd.is_tip}
            sub = P.drop_tips(sub, drop & present)

        # Order matters: dropPattern sees the labels as the published file
        # spells them, and `rename` sees them as the reader will.
        if spec.get("tipNames") == "binomial":
            n_cut = strip_vouchers(sub)
            if n_cut:
                print(f"    trimmed voucher codes off {n_cut} tip label(s)")
        renames = {P.normalise_label(k): P.normalise_label(v)
                   for k, v in spec.get("rename", {}).items()}
        if renames:
            hit = {nd.name for nd in P.iter_nodes(sub) if nd.is_tip} & set(renames)
            for missing in sorted(set(renames) - hit):
                warn(f"{spec['graftAt']}: rename target '{missing}' is not a tip")
            for nd in P.iter_nodes(sub):
                if nd.is_tip and nd.name in renames:
                    nd.name = renames[nd.name]

        sub, n_sup = P.suppress_single_child(sub)
        if n_sup:
            print(f"    spliced out {n_sup} single-child node(s)")
        P.ages_from_lengths(sub)
        if sub.age <= 0:
            # No branch lengths in the source; space by depth instead.
            P.ages_from_topology(sub, node.age)
            spec["schematic"] = True

        imputed = set()
        if spec.get("dataOnly"):
            dpath = TREES / spec["dataOnly"]
            if dpath.exists():
                have = {P.normalise_label(n) for n in P.read_tip_labels(dpath)}
                imputed = {nd.name for nd in P.iter_nodes(sub)
                           if nd.is_tip and nd.name not in have}
            else:
                warn(f"dataOnly file missing for {spec['graftAt']}")

        src_id = len(source_meta)
        source_meta.append({
            "label": spec["graftAt"],
            "citation": spec.get("citation", ""),
            "doi": spec.get("doi"),
            "url": spec.get("url"),
            "note": spec.get("note"),
            "file": spec["file"],
            "schematic": bool(spec.get("schematic")),
        })

        n_tips = 0
        for nd in P.iter_nodes(sub):
            if nd.is_tip:
                n_tips += 1
                if nd.name in imputed:
                    nd.flags |= FLAG_IMPUTED
                if spec.get("schematic"):
                    nd.flags |= FLAG_SCHEMATIC

        node.meta = dict(node.meta or {})
        node.meta["source"] = src_id
        if sub.age > 0:
            P.rescale_to_root_age(sub, node.age)
        attach(node, sub, src_id)
        print(f"  graft {spec['graftAt']:<18} {n_tips:>6} tips"
              f"  ({len(imputed):>5} taxonomy-placed)  {Path(spec['file']).name}")

    return source_meta, source_of


# --------------------------------------------------------------------------
# 4. Fossils
# --------------------------------------------------------------------------

def insert_fossils(root, index, fossils, grade_ids):
    """Insert extinct lineages on stems, oldest divergence outermost."""
    fossil_nodes = {}
    by_target = {}

    for f in fossils:
        if "attachStemOf" in f:
            key = ("node", f["attachStemOf"])
        elif "attachStemOfMRCA" in f:
            key = ("mrca", tuple(f["attachStemOfMRCA"]))
        else:
            warn(f"fossil {f['id']} has no attachment")
            continue
        by_target.setdefault(key, []).append(f)

    tip_index = {}
    for nd in P.iter_nodes(root):
        if nd.is_tip and nd.name:
            tip_index.setdefault(nd.name, nd)

    for key, group in by_target.items():
        kind, ref = key
        if kind == "node":
            target = index.get(ref)
            if target is None:
                warn(f"fossil target node {ref} not found")
                continue
        else:
            present = [t for t in ref if t in tip_index]
            missing = [t for t in ref if t not in tip_index]
            if not present:
                warn(f"fossil target MRCA {ref}: none of these tips exist; "
                     f"skipping {[f['id'] for f in group]}")
                continue
            if missing:
                warn(f"fossil target MRCA: not found {missing} "
                     f"(using {present})")
            target = P.mrca(root, present)
            if target is None:
                continue

        for f in sorted(group, key=lambda g: -float(g["splitAge"])):
            split = float(f["splitAge"])
            la = float(f.get("lastAppearance", 0.0))
            fa = float(f.get("firstAppearance", la))
            tip = Node(name=f["label"])
            tip.age = la
            tip.flags = FLAG_EXTINCT | (FLAG_RANGE if fa > la else 0)
            mask = 0
            for g in f.get("grades", []):
                if g in grade_ids:
                    mask |= 1 << grade_ids[g]
                else:
                    warn(f"{f['id']}: unknown grade '{g}'")
            tip.meta = {
                "id": f["id"], "fossil": True, "label": f["label"],
                "vernacular": f.get("vernacular"),
                "exemplarOf": f.get("exemplarOf"),
                "firstAppearance": fa, "lastAppearance": la,
                "gradeMask": mask, "note": f.get("note"),
                "featured": bool(f.get("featured")),
                "refs": f.get("refs", []),
            }
            joint, attached_to = P.attach_on_lineage(target, tip, split)
            if attached_to is root:
                root = joint          # fossil on the stem below the old root
            if attached_to is not target:
                warn(f"{f['id']}: splitAge {split} is older than the crown of "
                     f"its target, so it attached on the lineage above "
                     f"{attached_to.name or 'an unnamed node'} instead")
            fossil_nodes[f["id"]] = tip

    return root, fossil_nodes


# --------------------------------------------------------------------------
# 5. Clade labels from taxonomy
# --------------------------------------------------------------------------

def label_taxon_nodes(root, taxonomy):
    """Name the MRCA of each order, family and genus so collapsed clades read well.

    Genus is derived from the tip label rather than a table, which is the only
    reason turtles, sharks and cyclostomes get any labels at all -- none of them
    ship a usable taxonomy CSV.
    """
    members = {}
    for nd in P.iter_nodes(root):
        if not nd.is_tip or not nd.name or (nd.flags & FLAG_EXTINCT):
            continue
        fam, ordr = taxonomy.get(nd.name, ("", ""))
        if ordr:
            members.setdefault((2, "order", ordr), []).append(nd)
        if fam:
            members.setdefault((1, "family", fam), []).append(nd)
        genus = nd.name.split("_")[0]
        if genus and genus[0].isupper():
            members.setdefault((0, "genus", genus), []).append(nd)

    counts = {}
    for nd in P.postorder(root):
        counts[id(nd)] = 1 if nd.is_tip else sum(counts[id(c)] for c in nd.children)

    labelled = {"order": 0, "family": 0, "genus": 0}
    nonmono = {"order": 0, "family": 0, "genus": 0}
    dropped = []
    # Broadest rank first so that when a family and its only genus share a node,
    # the family name wins.
    for (_, rank, name), nodes in sorted(members.items(), key=lambda kv: -kv[0][0]):
        if len(nodes) < 2:
            continue
        target = len(nodes)
        seen = {}
        for nd in nodes:
            cur = nd
            while cur is not None:
                seen[id(cur)] = seen.get(id(cur), 0) + 1
                cur = cur.parent
        anc = nodes[0]
        while anc.parent is not None and seen.get(id(anc), 0) < target:
            anc = anc.parent
        if anc.is_tip or (anc.meta is not None):
            continue
        ratio = counts[id(anc)] / target
        # Beyond about 3x the label stops carrying any information: the MRCA of
        # five Leptoscopidae is most of Percomorpha. Below that, label it but
        # say so -- "Colubridae is not a clade here" is the lesson, not a gap.
        if ratio > 3.0:
            dropped.append((name, target, counts[id(anc)]))
            continue
        anc.name = name
        anc.meta = {"label": name, "rank": rank, "taxon": True}
        if ratio > 1.6:
            anc.meta["nonMono"] = True
            anc.meta["members"] = target
            anc.meta["holds"] = counts[id(anc)]
            nonmono[rank] += 1
        labelled[rank] += 1
    return labelled, nonmono, dropped


# --------------------------------------------------------------------------
# 6. Flattening and output
# --------------------------------------------------------------------------

def flatten(root):
    order = list(P.iter_nodes(root))
    idx = {id(nd): i for i, nd in enumerate(order)}
    return order, idx


def resolve_ref(ref, index, fossil_nodes, root, idx):
    """Turn 'node:X' / 'fossil:X' / 'mrca:a,b' into a node index."""
    kind, _, body = ref.partition(":")
    if kind == "node":
        nd = index.get(body)
    elif kind == "fossil":
        nd = fossil_nodes.get(body)
    elif kind == "mrca":
        names = [n.strip() for n in body.split(",") if n.strip()]
        have = {nm.name for nm in P.iter_nodes(root) if nm.is_tip}
        present = [n for n in names if n in have]
        missing = [n for n in names if n not in have]
        if missing:
            warn(f"alternative ref '{ref}': missing tips {missing}")
        if not present:
            return None
        nd = P.mrca(root, present)
    else:
        warn(f"alternative ref '{ref}': unknown kind")
        return None
    if nd is None:
        warn(f"alternative ref '{ref}' did not resolve")
        return None
    return idx[id(nd)]


PERIODS = [
    ("Ediacaran", 635, 538.8), ("Cambrian", 538.8, 485.4),
    ("Ordovician", 485.4, 443.8), ("Silurian", 443.8, 419.2),
    ("Devonian", 419.2, 358.9), ("Carboniferous", 358.9, 298.9),
    ("Permian", 298.9, 251.9), ("Triassic", 251.9, 201.4),
    ("Jurassic", 201.4, 145.0), ("Cretaceous", 145.0, 66.0),
    ("Paleogene", 66.0, 23.03), ("Neogene", 23.03, 2.58),
    ("Quaternary", 2.58, 0.0),
]

ERAS = [("Paleozoic", 538.8, 251.9), ("Mesozoic", 251.9, 66.0),
        ("Cenozoic", 66.0, 0.0)]


def main():
    print("Loading scaffold...")
    bb = load("backbone.json")
    fossils_spec = load("fossils.json")
    grades_spec = load("grades.json")
    alts_spec = load("alternatives.json")

    grade_ids = {g["id"]: i for i, g in enumerate(grades_spec["grades"])}
    if len(grade_ids) > 32:
        raise SystemExit("grade bitmask is 32 bits wide; trim grades.json")

    print("Building backbone...")
    root, index = build_backbone(bb["backbone"])

    print("Loading taxonomy tables...")
    taxonomy, common_names = {}, {}
    for spec in TAXONOMY_FILES:
        ranks, common = load_taxonomy(spec)
        if ranks or common:
            print(f"  {len(ranks):>6} ranked  {len(common):>6} common  "
                  f"{spec['path']}")
        for k, v in ranks.items():
            taxonomy.setdefault(k, v)
        for k, v in common.items():
            common_names.setdefault(k, v)
    try:
        curated = load("common_names.json")["names"]
        for k, v in curated.items():
            common_names[P.normalise_label(k)] = v
        print(f"  {len(curated):>6} curated common names")
    except FileNotFoundError:
        warn("common_names.json missing; only the bird tables supply vernaculars")

    print("Grafting published trees...")
    source_meta, source_of = graft_sources(index, bb["sources"],
                                           bb.get("handBuilt", []), taxonomy)

    print("Inserting fossils...")
    root, fossil_nodes = insert_fossils(root, index, fossils_spec["fossils"],
                                        grade_ids)
    print(f"  {len(fossil_nodes)} extinct lineages placed")

    print("Labelling named clades...")
    tip_lookup = {}
    for nd in P.iter_nodes(root):
        if nd.is_tip and nd.name:
            tip_lookup.setdefault(nd.name, nd)
    n_named = 0
    for spec in bb.get("namedClades", []):
        present = [t for t in spec["mrca"] if t in tip_lookup]
        missing = [t for t in spec["mrca"] if t not in tip_lookup]
        if len(present) < 2:
            warn(f"named clade {spec['label']}: only {present} found, skipped")
            continue
        if missing:
            warn(f"named clade {spec['label']}: missing {missing}")
        nd = P.mrca(root, present)
        if nd is None or nd.is_tip:
            continue
        nd.meta = {"label": spec["label"], "rank": "clade", "taxon": True,
                   "vernacular": spec.get("vernacular")}
        nd.name = spec["label"]
        n_named += 1
    print(f"  {n_named} named clades located")

    print("Labelling taxon nodes...")
    n_lab, n_non, n_drop = label_taxon_nodes(root, taxonomy)
    print(f"  {n_lab['order']} orders, {n_lab['family']} families, "
          f"{n_lab['genus']} genera labelled")
    print(f"  {sum(n_non.values())} of those are not monophyletic here "
          f"(flagged); {len(n_drop)} too scattered to label at all")

    P.ladderize(root, ascending=True)

    order, idx = flatten(root)
    n = len(order)
    n_tips = sum(1 for nd in order if nd.is_tip)
    print(f"Flattened: {n} nodes, {n_tips} tips")

    # --- binary arrays -----------------------------------------------------
    parent = bytearray(4 * n)
    ages = bytearray(4 * n)
    flags = bytearray(n)
    source = bytearray(n)
    namelen = bytearray(2 * n)
    blob = bytearray()

    for i, nd in enumerate(order):
        p = -1 if nd.parent is None else idx[id(nd.parent)]
        struct.pack_into("<i", parent, 4 * i, p)
        struct.pack_into("<f", ages, 4 * i, nd.age)
        flags[i] = nd.flags & 0xFF
        source[i] = (source_of.get(id(nd), 255)) & 0xFF
        label = nd.name or ""
        if label and not nd.is_tip and nd.meta is None:
            label = ""
        enc = label.encode("utf-8")
        if len(enc) > 65535:
            enc = enc[:65535]
        struct.pack_into("<H", namelen, 2 * i, len(enc))
        blob += enc

    def pad4(b):
        return b + bytes((-len(b)) % 4)

    header = struct.pack("<6I", MAGIC, VERSION, n, n_tips, SPARE_NODES,
                         len(blob))
    OUT.mkdir(parents=True, exist_ok=True)
    with open(OUT / "tree.bin", "wb") as fh:
        fh.write(header)
        fh.write(parent)
        fh.write(ages)
        fh.write(pad4(flags))
        fh.write(pad4(source))
        fh.write(pad4(namelen))
        fh.write(bytes(blob))

    # --- meta --------------------------------------------------------------
    clades = []
    for cid, nd in index.items():
        m = nd.meta or {}
        clades.append({
            "id": cid, "node": idx[id(nd)], "label": m.get("label", cid),
            "vernacular": m.get("vernacular"), "note": m.get("note"),
            "refs": m.get("refs", []), "source": m.get("source"),
        })

    fossil_meta = []
    for fid, nd in fossil_nodes.items():
        m = nd.meta
        fossil_meta.append({
            "id": fid, "node": idx[id(nd)], "label": m["label"],
            "vernacular": m.get("vernacular"), "exemplarOf": m.get("exemplarOf"),
            "fa": m["firstAppearance"], "la": m["lastAppearance"],
            "grades": m["gradeMask"], "note": m.get("note"),
            "featured": m.get("featured", False),
            "refs": m.get("refs", []),
        })

    taxon_nodes = [
        {"node": i, "label": nd.name, "rank": (nd.meta or {}).get("rank"),
         **({"vernacular": nd.meta["vernacular"]}
            if (nd.meta or {}).get("vernacular") else {}),
         **({"nonMono": True, "members": nd.meta["members"],
             "holds": nd.meta["holds"]} if (nd.meta or {}).get("nonMono") else {})}
        for i, nd in enumerate(order)
        if nd.meta and nd.meta.get("taxon")
    ]

    # Flat [index, name, index, name, ...] so the browser can build a search
    # map without parsing 11,000 objects.
    common_flat = []
    for i, nd in enumerate(order):
        if nd.is_tip and nd.name in common_names:
            common_flat.append(i)
            common_flat.append(common_names[nd.name])

    alternatives = []
    for alt in alts_spec["alternatives"]:
        opts = []
        ok = True
        for opt in alt["options"]:
            ops = []
            for op in opt.get("ops", []):
                if op["op"] == "spr":
                    c = resolve_ref(op["clade"], index, fossil_nodes, root, idx)
                    s = resolve_ref(op["sibling"], index, fossil_nodes, root, idx)
                    if c is None or s is None:
                        ok = False
                        break
                    ops.append({"op": "spr", "clade": c, "sibling": s,
                                "age": op.get("age")})
                elif op["op"] == "cluster":
                    members = [resolve_ref(m, index, fossil_nodes, root, idx)
                               for m in op["members"]]
                    s = resolve_ref(op["sibling"], index, fossil_nodes, root, idx)
                    if any(m is None for m in members) or s is None:
                        ok = False
                        break
                    ops.append({"op": "cluster", "members": members,
                                "sibling": s, "age": op.get("age"),
                                "label": op.get("label", "")})
            if not ok:
                break
            opts.append({**{k: v for k, v in opt.items() if k != "ops"},
                         "ops": ops})
        if not ok:
            warn(f"alternative '{alt['id']}' dropped: unresolved references")
            continue
        scope = index.get(alt.get("scope", ""))
        alternatives.append({
            **{k: v for k, v in alt.items() if k != "options"},
            "scopeNode": idx[id(scope)] if scope is not None else None,
            "options": opts,
        })

    n_extinct = sum(1 for nd in order if nd.flags & FLAG_EXTINCT)
    n_imputed = sum(1 for nd in order if nd.flags & FLAG_IMPUTED)

    meta = {
        "generated": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
        "nNodes": n, "nTips": n_tips, "spare": SPARE_NODES,
        "rootAge": root.age,
        "stats": {
            "livingTips": n_tips - n_extinct,
            "extinctTips": n_extinct,
            "featuredExtinct": sum(1 for f in fossil_meta if f["featured"]),
            "taxonomyPlaced": n_imputed,
            "gradesDefined": len(grades_spec["grades"]),
            "nonMonophyletic": sum(n_non.values()),
            "unlabelledTaxa": len(n_drop),
            "alternatives": len(alternatives),
        },
        "clades": sorted(clades, key=lambda c: c["node"]),
        "fossils": sorted(fossil_meta, key=lambda f: f["node"]),
        "taxonNodes": taxon_nodes,
        "commonNames": common_flat,
        "grades": grades_spec["grades"],
        "alternatives": alternatives,
        "sources": source_meta,
        "periods": [{"name": a, "start": b, "end": c} for a, b, c in PERIODS],
        "eras": [{"name": a, "start": b, "end": c} for a, b, c in ERAS],
        "warnings": warnings,
    }
    with open(OUT / "meta.json", "w") as fh:
        json.dump(meta, fh, separators=(",", ":"))

    bin_kb = (OUT / "tree.bin").stat().st_size / 1024
    meta_kb = (OUT / "meta.json").stat().st_size / 1024
    print(f"\nWrote docs/data/tree.bin   {bin_kb:8.1f} KB")
    print(f"Wrote docs/data/meta.json  {meta_kb:8.1f} KB")
    print(f"\n{n_tips - n_extinct} living tips, {n_extinct} extinct, "
          f"{n_imputed} placed by taxonomy")
    print(f"{len(alternatives)} topology alternatives, "
          f"{len(grades_spec['grades'])} grades")
    if warnings:
        print(f"\n{len(warnings)} warning(s) -- see meta.json 'warnings'")


if __name__ == "__main__":
    main()
