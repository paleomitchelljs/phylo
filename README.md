# Vertebrate Tree Explorer

An interactive time-calibrated tree of the vertebrates, built to be served as a
static site from GitHub Pages. 68,241 living species from eight published
chronograms, 94 extinct lineages placed on stems, 19 paraphyletic grades, and 11
contested nodes you can switch and watch the tree rearrange.

Two pages: the explorer, and a classroom exercise that deals random species and
scores the tree a student builds from them.

```
docs/          the site. GitHub Pages serves this directory.
  index.html         the explorer
  build.html         the "build a tree" exercise
  css/               app.css (shared palette), build.css
  js/          data loader, SPR engine, layout, canvas renderer, UI
  data/        tree.bin (2.9 MB) + meta.json (0.7 MB), both generated
build/
  phylolib.py        Newick/NEXUS I/O and tree surgery, no dependencies
  build_payload.py   assembles the scaffold and writes docs/data/
  test_topology.mjs  validates the SPR engine against the real payload
  test_treebuild.mjs validates the exercise's answer key
  scaffold/          the hand-authored content -- edit these, not the code
    backbone.json      deep vertebrate topology, ages, graft points
    fossils.json       extinct taxa with stratigraphic ranges
    grades.json        paraphyletic groups
    alternatives.json  the contested-node toggles
    common_names.json  vernaculars for non-bird species
trees/         the raw chronograms, ~990 MB, gitignored. See trees/README.md.
```

## Running it

```sh
cd docs && python3 -m http.server 8777    # then open http://localhost:8777/
```

A server is required. The page loads `tree.bin` with `fetch()`, which cannot
read `file://` URLs.

## Rebuilding the payload

```sh
python3 build/build_payload.py    # ~5 s, needs trees/ populated
node build/test_topology.mjs      # validates every topology alternative
node build/test_treebuild.mjs     # validates the exercise's answer key
```

`build_payload.py` reads `build/scaffold/*.json` and the chronograms in
`trees/`, and writes `docs/data/tree.bin` and `docs/data/meta.json`. It prints a
warning for every taxon it could not resolve, and those warnings are also
carried into `meta.json` so they are visible after the fact.

## Deploying to GitHub Pages

Push, then in the repository settings set Pages to deploy from the `main` branch
and the `/docs` folder. No Actions workflow and no build step: the payload is
committed. Nothing in `docs/` starts with an underscore, but `.nojekyll` is
present so Jekyll stays out of the way regardless.

## How the data is put together

None of the downloaded chronograms date the deep splits, and none of them
connect to each other. `backbone.json` supplies about twenty backbone nodes with
ages taken from the literature, each carrying its source; the published clade
trees are grafted at the named points and rescaled so their crown ages match.
Two of the grafts are hand-built Newick strings, because crocodilians have no
downloadable species-level dated tree and the cyclostome subtree from Open Tree
has no branch lengths at all. Branches of the second kind are drawn dashed and
the app says why.

| Clade | Tips | Source |
|---|---|---|
| Actinopterygii | 31,516 | Rabosky et al. 2018 |
| Aves | 11,167 | McTavish et al. 2025, Aves 1.6 |
| Squamata | 10,757 | Title et al. 2024 |
| Amphibia | 7,238 | Jetz & Pyron 2018 |
| Mammalia | 5,911 | Upham et al. 2019 |
| Chondrichthyes | 1,192 | Stein et al. 2018 |
| Testudines | 288 | Thomson et al. 2021 |
| Cyclostomata | 136 | Open Tree synthesis, topology only |
| Crocodylia | 27 | hand-built from Oaks 2011, Hekkala et al. 2021 |

30,885 of the 68,241 living tips carry no sequence data in their source tree and
were placed by taxonomy. The app marks them, because a tree that silently
presents 45% of its tips as resolved is lying about what it knows.

## Adding fossils and grades

A fossil is a tip that stops short of the present, so it takes three ages rather
than one: when its lineage diverged, when it first appears in the rock record,
and when it last does. The gap between the first two is the ghost lineage and
the app draws it thin, so the inferred part of a branch is visually distinct
from the part with fossils in it.

```json
{ "id": "Tiktaalik", "label": "Tiktaalik",
  "attachStemOf": "Tetrapoda", "splitAge": 385,
  "firstAppearance": 375, "lastAppearance": 375,
  "grades": ["stem-tetrapods"],
  "note": "...", "refs": ["Daeschler et al. 2006 Nature 440:757"] }
```

Several fossils on the same stem nest automatically: the builder sorts by
`splitAge` descending, so the oldest divergence ends up outermost and the result
reads as a ladder. `attachStemOfMRCA` takes a list of living species instead of
a backbone id, which is how an extinct lineage gets placed inside a grafted
clade tree -- mosasaurs among the anguimorphs, moa beside the tinamous.

If a `splitAge` is older than the crown of its target, the builder walks
rootward to the branch that age actually falls on rather than clamping the
number. Elephant birds are sister to kiwi at 55 Ma, and the kiwi crown is 38 Ma;
the attachment belongs above the crown, and the caller should not have to know
that to say so.

Grades are declared separately and referenced by id. They are drawn as a
coloured gutter beside the tree, never as a collapsible triangle, because a
triangle is a claim of monophyly. Grades may nest: *Dimetrodon* is a pelycosaur
and a non-mammalian synapsid, and neither of those is a clade.

## Adding a contested node

Each entry in `alternatives.json` is a question with two or more answers, and an
answer is a short list of tree operations rather than a whole tree. The payload
therefore carries one topology plus a few hundred bytes of rearrangement
instructions.

```json
{ "op": "spr", "clade": "node:Testudines", "sibling": "node:Crocodylia", "age": 245 }
```

`spr` moves a clade to sit beside another node; when the target is an ancestor
of the moved clade the result reads as "this branches off before everything
else in the group", which is how the Iguania-first and anapsid-turtle
arrangements are expressed. `cluster` gathers scattered lineages into one clade,
which is what turns a grade back into a monophyletic group -- switch
`placoderm-monophyly` and eight separate stem lineages collapse into a single
triangle, which is the clearest statement of what that claim actually claims.

Node references are `node:<backbone id>`, `fossil:<fossil id>`, or
`mrca:<species,species,...>`. The builder resolves them to node indices and
refuses to emit an alternative whose references do not resolve, so a typo fails
the build instead of silently producing a wrong tree.

Rearranged branches are drawn dashed: the topology is real, the node ages have
not been re-estimated under it, and the app says so rather than implying a
dating analysis that was never run.

## What the numbers are worth

Backbone ages are hand-entered from the literature and rounded. Fossil ages are
stage-level approximations chosen for teaching, not calibrations -- do not use
this tree to date anything. Within-clade ages are whatever the source
chronograms say, linearly rescaled so each clade's crown matches its backbone
age.

773 families are labelled, of which 223 are not monophyletic in this tree; those
are marked with an asterisk and the detail panel says how many foreign tips the
node contains. A further 606 named taxa are too scattered to label at all. That
is not a defect in the labelling, it is what the source trees say, and
Colubridae failing to be a clade is the same lesson as "placoderms" failing to
be one.

## Performance

Measured in Chrome on the full payload, 133,208 nodes:

| | |
|---|---|
| Payload over the wire | 2.9 MB binary + 0.7 MB JSON, ~1.4 MB gzipped |
| Opening view, 98 rows | 3 ms layout, 19 ms draw |
| Every tip open, 68,335 rows | 38 ms expand, 65 ms layout, 21-28 ms draw |

The renderer culls against row spans precomputed by the layout, so the cost of a
frame tracks what is on screen rather than what is open. Rendering is on demand;
there is no animation loop.

## The exercise

`build.html` deals 3 to 20 random species and asks the student to group them
into a tree. Three is the floor because one or two taxa have only one possible
rooted tree, so there is nothing to get wrong.

You join two cards to make a clade, and the clade is itself a card, so you keep
joining until one tree is left. That constraint is the point: a tree is nested
sets, and letting someone drag labels into a pleasing shape without it produces
pictures they cannot defend. Click one card then another, or drag one onto the
other; *ungroup* undoes a join.

Taxa are drawn from any clade in the scope list, either spread across the group
(one per major subclade, which is the easy case) or all from inside one small
clade (which is not). Species with common names are preferred where they exist,
and extinct lineages can be dealt in. Scoring prunes the reference tree to the
dealt taxa and compares clade sets: how many published clades were recovered,
the Robinson-Foulds distance, which named groups were missed, and which groups
the student invented that the tree does not support.

The pruning is the answer key, so `build/test_treebuild.mjs` checks it the hard
way: for every three dealt taxa it compares the rooted triple from the pruned
tree against the same triple computed on the full 133,000-node tree. 17,124
triples across 60 deals currently agree. It also asserts that a deal returns the
number of taxa asked for -- an earlier version silently dealt two species when
asked for eight, because splitting from the root of the vertebrate tree hands
you the fossil ladder first and those buckets were empty with fossils switched
off.

## Licence and citation

The code is yours. The trees are not: each clade carries its citation in the
Sources panel and in `meta.json`, and anything built on this should cite the
underlying papers rather than this repository.
