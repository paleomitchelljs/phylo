# Tree practice (BIO 365)

A static, self-contained site for practicing the course tree. Students get a set of tips, build the
tree with tips up, name the nodes, paint traits on the branches, and check their work against the
tree in `refs/2026f_365_phylogeny.tex`.

```
docs/              the site (GitHub Pages serves this folder; no build step)
  index.html
  css/app.css
  js/course.js     ← the course content: tree, traits, tip sets. Edit this.
  js/tree.js       reference tree, the student's forest and its edits, scoring
  js/app.js        canvas, dragging, panels
tests/test_logic.mjs   node tests/test_logic.mjs
refs/              the course handout the tree was transcribed from (kept local)
legacy/            the previous chronogram explorer, kept for reference
```

## Run locally

Open `docs/index.html` directly, or `cd docs && python3 -m http.server 8777`.
Plain scripts, no modules, no fetches, so it also works from `file://`.

## Deploy

Push to GitHub. In Settings → Pages, deploy from `main`, folder `/docs`.

## Building, for students

- **Tip down:** drag tips onto the canvas and drop one on another to make sisters. Drop on a
  node to join at that node. Shift-drop puts it into a polytomy.
- **Root up:** double-click the canvas for a node with two `?` slots. Name it, split slots (S),
  then drop tips or whole subtrees into the slots. With a slot selected, clicking a tip fills it.
- Both directions work at once. Subtrees float freely until they're joined, and the grip under each
  root moves the whole tree.
- Drag anything out of a tree to detach it, or onto the tip list to remove it.
  R swaps, C collapses, Del removes, ⌘Z undoes.
- **Traits:** pick one on the right, click a branch to put a gain on it, shift-click for a loss.
  Every branch carrying the trait gets painted.
- **Check** colors each node: green is in the course tree, red conflicts with it, amber is a
  resolution the course leaves untested. Names and trait marks are scored the same way.
  **Answer** shows the course tree for the current tips.

Work is saved in the browser's localStorage.

## Editing the content (`docs/js/course.js`)

`TREE_SRC` is the tree, one node per line, two spaces per level:

```
Name | subtitle | alias, alias      a named group (aliases are accepted as node names)
.                                   an unnamed node
~Name  or  ~.                       a polytomy the course leaves open on purpose
Name †                              extinct
- a, b, c                           example organisms inside a group (an unresolved set;
                                    random deals never take more than two from one group)
```

- `ALTERNATIVES` lists other placements that count as correct (turtles with lepidosaurs; Ascaphus +
  Leiopelma). Scoring takes the best match.
- `TRAITS`: each trait is a list of `['gain' | 'loss', groupKey]` events. A list of keys means their
  common ancestor. Keys are names lowercased with non-letters replaced by `_`
  (e.g. `great_white_shark`).
- `DECKS` are the ready-made tip sets in the menu: fixed sets of 6, 11 and 16 tips across the
  whole tree, the backbone, and one set per major group.

Random deals (6, 11, 16 or 21 tips, from any clade, fossils optional) take at most two tips from a
group whose insides weren't taught, and at most two branches of any polytomy the course leaves open.

Run `node tests/test_logic.mjs` after editing. It checks that every key resolves, that each deck's
own answer scores 100%, and that random deals stay fair.
