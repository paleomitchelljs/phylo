"""Minimal dependency-free phylogeny I/O and tree surgery.

Everything here is iterative. Several of the source trees are strongly ladderised
(the Rabosky fish tree is ~31,500 tips and nests thousands of parentheses deep),
so a recursive descent parser blows the stack on real input.

Node ages are the primary quantity, not branch lengths. That is what makes fossil
tips representable: an extinct tip terminates at its last occurrence rather than
at the present, so it has a nonzero age and a stratigraphic range.
"""

from __future__ import annotations

import re
import sys

# Node flag bits. Mirrored in docs/js/data.js -- keep in sync.
FLAG_EXTINCT = 1 << 0   # tip does not reach the present
FLAG_IMPUTED = 1 << 1   # placed by taxonomy, not by sequence data
FLAG_SCHEMATIC = 1 << 2  # branch length is illustrative, not estimated
FLAG_RANGE = 1 << 3     # ageMin/ageMax are a real stratigraphic range
FLAG_GRADE = 1 << 4     # node carries a paraphyletic grade label


class Node:
    __slots__ = ("name", "length", "children", "parent", "age", "age_min",
                 "age_max", "flags", "meta")

    def __init__(self, name="", length=None):
        self.name = name
        self.length = length
        self.children = []
        self.parent = None
        self.age = 0.0
        self.age_min = None
        self.age_max = None
        self.flags = 0
        self.meta = None

    @property
    def is_tip(self):
        return not self.children

    def add(self, child):
        child.parent = self
        self.children.append(child)
        return child

    def __repr__(self):
        kind = "tip" if self.is_tip else f"node[{len(self.children)}]"
        return f"<{kind} {self.name!r} age={self.age:.1f}>"


# --------------------------------------------------------------------------
# Parsing
# --------------------------------------------------------------------------

_COMMENT = re.compile(r"\[[^\]]*\]")


def parse_newick(text):
    """Iterative Newick parser. Returns the root Node.

    Tolerates BEAST/MrBayes square-bracket annotations, single-quoted labels,
    and whitespace anywhere outside a quoted label.
    """
    text = _COMMENT.sub("", text)
    root = Node()
    cur = root
    stack = []
    i = 0
    n = len(text)
    pending_label = []
    reading_length = False
    length_chars = []

    def flush():
        """Commit whatever label/length text has accumulated onto `cur`."""
        nonlocal pending_label, length_chars, reading_length
        if pending_label:
            cur.name = "".join(pending_label).strip()
            pending_label = []
        if length_chars:
            raw = "".join(length_chars).strip()
            if raw:
                try:
                    cur.length = float(raw)
                except ValueError:
                    cur.length = None
            length_chars = []
        reading_length = False

    while i < n:
        c = text[i]
        if c == "(":
            stack.append(cur)
            child = Node()
            cur.add(child)
            cur = child
        elif c == ",":
            flush()
            parent = stack[-1]
            child = Node()
            parent.add(child)
            cur = child
        elif c == ")":
            flush()
            cur = stack.pop()
        elif c == ":":
            flush_label_only = "".join(pending_label).strip()
            if flush_label_only:
                cur.name = flush_label_only
            pending_label = []
            reading_length = True
        elif c == ";":
            flush()
            break
        elif c == "'":
            j = text.index("'", i + 1)
            pending_label.append(text[i + 1:j])
            i = j
        elif c.isspace():
            pass
        else:
            (length_chars if reading_length else pending_label).append(c)
        i += 1
    flush()

    # A Newick string is always wrapped in one outer pair, so `root` holds
    # exactly one real child unless the input was a bare tip.
    if len(root.children) == 1 and root.children[0].children:
        real = root.children[0]
        real.parent = None
        return real
    return root


_NEX_TREE = re.compile(r"^\s*tree\s+[^=]*=\s*(?:\[[^\]]*\]\s*)?(.*)$",
                       re.IGNORECASE)


def read_first_tree(path, index=0):
    """Read tree `index` from a Newick or NEXUS file without loading it all.

    The shark and mammal files run to hundreds of megabytes because they hold
    thousands of trees. Only the translate table and the requested tree are
    ever held in memory.
    """
    translate = {}
    in_translate = False
    seen = 0
    with open(path, "r", errors="ignore") as fh:
        head = fh.read(64)
        fh.seek(0)
        is_nexus = head.lstrip().upper().startswith("#NEXUS")

        if not is_nexus:
            for line in fh:
                line = line.strip()
                if not line or line.lower() == "trees":
                    continue
                if seen == index:
                    return parse_newick(line)
                seen += 1
            raise IndexError(f"{path}: no tree at index {index}")

        for line in fh:
            s = line.strip()
            low = s.lower()
            if low.startswith("translate"):
                in_translate = True
                continue
            if in_translate:
                if s.startswith(";") or low.startswith("tree "):
                    in_translate = False
                else:
                    body = s.rstrip(",;")
                    if body:
                        parts = body.split(None, 1)
                        if len(parts) == 2:
                            translate[parts[0]] = parts[1].strip().strip("'\"")
                    if s.endswith(";"):
                        in_translate = False
                    if not low.startswith("tree "):
                        continue
            m = _NEX_TREE.match(s)
            if m:
                if seen == index:
                    tree = parse_newick(m.group(1))
                    if translate:
                        for nd in iter_nodes(tree):
                            if nd.is_tip and nd.name in translate:
                                nd.name = translate[nd.name]
                    return tree
                seen += 1
    raise IndexError(f"{path}: no tree at index {index}")


def read_tip_labels(path):
    """Pull just the tip label set from a tree file. Cheaper than parsing."""
    return {nd.name for nd in iter_nodes(read_first_tree(path)) if nd.is_tip}


# --------------------------------------------------------------------------
# Traversal
# --------------------------------------------------------------------------

def iter_nodes(root):
    """Preorder, iterative."""
    stack = [root]
    while stack:
        nd = stack.pop()
        yield nd
        stack.extend(reversed(nd.children))


def postorder(root):
    """Postorder, iterative."""
    out = []
    stack = [(root, False)]
    while stack:
        nd, done = stack.pop()
        if done:
            out.append(nd)
        else:
            stack.append((nd, True))
            stack.extend((c, False) for c in reversed(nd.children))
    return out


def tips(root):
    return [nd for nd in iter_nodes(root) if nd.is_tip]


def count_tips(root):
    return sum(1 for nd in iter_nodes(root) if nd.is_tip)


# --------------------------------------------------------------------------
# Ages
# --------------------------------------------------------------------------

def ages_from_lengths(root, tip_age=0.0):
    """Convert branch lengths to node ages, in Ma before present.

    Uses the maximum root-to-tip path so that a tree with slight numerical
    non-ultrametricity still puts every tip at or above `tip_age`.
    """
    for nd in postorder(root):
        if nd.is_tip:
            nd.age = tip_age
        else:
            nd.age = max((c.age + (c.length or 0.0)) for c in nd.children)
    return root.age


def ages_from_topology(root, crown_age, tip_age=0.0):
    """Space nodes evenly by depth when the source tree has no branch lengths.

    The Open Tree cyclostome subtree is topology only. Running it through
    ages_from_lengths puts every node at the present, which draws the whole
    clade as a vertical line. Spacing by relative depth at least produces a
    readable shape, and the branches are flagged schematic so nobody reads
    ages off them.
    """
    below = {}
    for nd in postorder(root):
        below[id(nd)] = 0 if nd.is_tip else 1 + max(below[id(c)] for c in nd.children)
    span = below[id(root)] or 1
    for nd in iter_nodes(root):
        nd.age = tip_age + (crown_age - tip_age) * (below[id(nd)] / span)
    return root.age


def suppress_single_child(root):
    """Splice out internal nodes that have exactly one child.

    Taxonomic nesting in Open Tree produces chains like
    Hyperoartia > Petromyzontiformes > Petromyzontidae, each with one child.
    They carry no branching information and draw as redundant joints.
    """
    removed = 0
    for nd in postorder(root):
        if len(nd.children) == 1 and nd.parent is not None:
            only = nd.children[0]
            if nd.name and not only.name:
                only.name = nd.name
            idx = nd.parent.children.index(nd)
            nd.parent.children[idx] = only
            only.parent = nd.parent
            removed += 1
    while len(root.children) == 1 and root.children[0].children:
        root = root.children[0]
        root.parent = None
        removed += 1
    return root, removed


def rescale_to_root_age(root, target_root_age, tip_age=0.0):
    """Linearly rescale every node age so the root sits at `target_root_age`.

    Used when grafting a published clade chronogram onto a backbone whose stem
    age comes from a different study. The within-clade relative ages are
    preserved; only the overall depth moves.
    """
    cur = root.age
    if cur <= 0:
        return
    span = target_root_age - tip_age
    for nd in iter_nodes(root):
        nd.age = tip_age + (nd.age - tip_age) * (span / cur)


# --------------------------------------------------------------------------
# Surgery
# --------------------------------------------------------------------------

def drop_tips(root, names):
    """Remove named tips and suppress the resulting degree-2 nodes.

    Returns the (possibly new) root. Branch lengths are not preserved; ages
    are, which is the quantity we actually carry downstream.
    """
    names = set(names)
    doomed = [nd for nd in iter_nodes(root) if nd.is_tip and nd.name in names]
    for nd in doomed:
        p = nd.parent
        while p is not None:
            p.children.remove(nd)
            if p.children:
                break
            nd, p = p, p.parent
    # Suppress unbranched internal nodes.
    for nd in postorder(root):
        if len(nd.children) == 1 and nd.parent is not None:
            only = nd.children[0]
            idx = nd.parent.children.index(nd)
            nd.parent.children[idx] = only
            only.parent = nd.parent
    while len(root.children) == 1:
        root = root.children[0]
        root.parent = None
    return root


def mrca(root, names):
    """Most recent common ancestor of a set of tip labels."""
    names = set(names)
    found = {}
    for nd in postorder(root):
        if nd.is_tip:
            found[id(nd)] = 1 if nd.name in names else 0
        else:
            found[id(nd)] = sum(found[id(c)] for c in nd.children)
    target = sum(1 for nd in iter_nodes(root) if nd.is_tip and nd.name in names)
    if target == 0:
        return None
    best = root
    nd = root
    while True:
        nxt = None
        for c in nd.children:
            if found[id(c)] == target:
                nxt = c
                break
        if nxt is None:
            best = nd
            break
        nd = nxt
    return best


def spr(root, clade, new_sibling, attach_age=None):
    """Subtree prune and regraft: move `clade` to be sister to `new_sibling`.

    This is how a curated topology alternative is applied -- moving Testudines
    to sit with Crocodylia, or rerooting Placentalia on Xenarthra. Returns the
    root, which can change if the prune emptied it.
    """
    if clade is new_sibling or clade.parent is None:
        return root
    anc = new_sibling
    while anc is not None:
        if anc is clade:
            raise ValueError("cannot regraft a clade inside itself")
        anc = anc.parent

    old_parent = clade.parent
    old_parent.children.remove(clade)
    if len(old_parent.children) == 1 and old_parent.parent is not None:
        only = old_parent.children[0]
        idx = old_parent.parent.children.index(old_parent)
        old_parent.parent.children[idx] = only
        only.parent = old_parent.parent

    target_parent = new_sibling.parent
    joint = Node()
    joint.age = attach_age if attach_age is not None else max(
        clade.age, new_sibling.age) * 1.05
    if target_parent is None:
        joint.add(new_sibling)
        joint.add(clade)
        return joint
    idx = target_parent.children.index(new_sibling)
    target_parent.children[idx] = joint
    joint.parent = target_parent
    joint.add(new_sibling)
    joint.add(clade)
    if joint.age >= target_parent.age:
        joint.age = (max(clade.age, new_sibling.age) + target_parent.age) / 2
    while len(root.children) == 1:
        root = root.children[0]
        root.parent = None
    return root


def insert_on_stem(child_node, new_taxon, split_age):
    """Insert `new_taxon` as sister to `child_node` at `split_age`.

    The mechanism for stem fossils. "Placodermi" is not a clade hanging off a
    node; it is a series of lineages diverging one after another along the
    gnathostome stem, and each one is a separate call to this function at a
    progressively younger split age.

    Returns the new joint node, which is the new root when `child_node` was the
    root. Callers must use the return value.
    """
    parent = child_node.parent
    joint = Node()
    joint.age = split_age
    if parent is not None:
        idx = parent.children.index(child_node)
        parent.children[idx] = joint
        joint.parent = parent
    joint.add(child_node)
    joint.add(new_taxon)
    return joint


def attach_on_lineage(target, new_taxon, split_age):
    """Attach `new_taxon` at `split_age` on the lineage leading to `target`.

    Walks rootward until it finds the branch that `split_age` actually falls on,
    instead of forcing the attachment next to `target` and clamping the age.
    An extinct sister to kiwi at 55 Ma has to attach above the kiwi crown, not
    inside it, and the caller should not have to know the crown age to say so.

    Returns (joint, attached_below), where `attached_below` is the node the new
    taxon ended up sister to.
    """
    cur = target
    while cur.parent is not None and cur.parent.age < split_age:
        cur = cur.parent
    if cur.parent is not None and split_age >= cur.parent.age:
        split_age = (cur.age + cur.parent.age) / 2
    if split_age <= cur.age:
        split_age = cur.age + max(cur.age * 0.02, 0.1)
        if cur.parent is not None and split_age >= cur.parent.age:
            split_age = (cur.age + cur.parent.age) / 2
    return insert_on_stem(cur, new_taxon, split_age), cur


def ladderize(root, ascending=True):
    """Order children by subtree size. Makes the rendered tree readable."""
    size = {}
    for nd in postorder(root):
        size[id(nd)] = 1 if nd.is_tip else sum(size[id(c)] for c in nd.children)
    for nd in iter_nodes(root):
        nd.children.sort(key=lambda c: size[id(c)], reverse=not ascending)
    return root


# --------------------------------------------------------------------------
# Label normalisation
# --------------------------------------------------------------------------

_OTT = re.compile(r"_ott\d+$")
_MAMPHY = re.compile(r"_[A-Z]{3,}_[A-Z]{3,}$")


def normalise_label(raw):
    """Reduce a source tip label to `Genus_species`.

    Upham's mammal tips carry `_FAMILY_ORDER`; Open Tree tips carry `_ottNNNNN`.
    Everything else in the corpus is already clean.
    """
    s = raw.strip().strip("'\"")
    s = _OTT.sub("", s)
    s = _MAMPHY.sub("", s)
    s = s.replace(" ", "_")
    return s


_SYNTH_ID = re.compile(r"^(?:mrca)?ott\d+(?:ott\d+)*$", re.IGNORECASE)


def clean_internal_label(raw):
    """Keep meaningful internal labels, discard synthetic identifiers.

    Open Tree trees label internal nodes with things like `ott81461` and
    `mrcaott246ott92263`, which are ids rather than names, alongside genuinely
    useful ones like `Petromyzontiformes_ott1067466`.
    """
    s = (raw or "").strip().strip("'\"")
    if not s or _SYNTH_ID.match(s):
        return ""
    s = _OTT.sub("", s)
    if not s or _SYNTH_ID.match(s):
        return ""
    return s


def pretty(label):
    """`Gambusia_marshi` -> `Gambusia marshi`."""
    return label.replace("_", " ")


if __name__ == "__main__":
    for path in sys.argv[1:]:
        t = read_first_tree(path)
        ages_from_lengths(t)
        print(f"{count_tips(t):>7} tips  root {t.age:8.2f} Ma  {path}")
