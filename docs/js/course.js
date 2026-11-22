/* The BIO 365 tree, transcribed from refs/2026f_365_phylogeny.tex.
 *
 * One line per node, two spaces of indent per level.
 *   Name | subtitle | alias, alias     a named node
 *   .                                  an unnamed node
 *   ~ (prefix)                         a polytomy the course leaves unresolved on purpose
 *                                      (more than two of its branches may be dealt together)
 *   † (suffix)                         extinct
 *   - a, b, c                          example organisms, an unresolved set inside the group
 *                                      (never more than two dealt from one group)
 */
(function (P) {
  P.TREE_SRC = `
Chordata
  Cephalochordata | amphioxus
  .
    Urochordata | tunicates | Tunicata
    Vertebrata
      Cyclostomata | hagfish & lampreys
        Myxini | hagfish
        Petromyzontida | lampreys
          - sea lamprey, brook lamprey
      .
        galeaspids †
        Gnathostomata | jawed vertebrates
          antiarchs †
          .
            ptyctodontids †
            .
              arthrodires †
              .
                Chondrichthyes | cartilaginous fish
                  Holocephali | chimaeras
                    - ratfish, elephant shark
                  Elasmobranchii
                    Selachii | sharks
                      Squalomorphi | dogfish sharks
                        - spiny dogfish, cookie cutter shark, frilled shark, angel shark, saw shark
                      Galeomorphi | most sharks
                        - horn shark, whale shark, wobbegong, great white shark, basking shark, goblin shark, tiger shark, hammerhead
                    Batoidea | rays
                      - skate, torpedo, sawfish, guitarfish, stingray, manta
                Osteichthyes | bony fish
                  Actinopterygii | ray-finned fish
                    Polypteriformes | bichirs
                      - bichir, reedfish
                    ~.
                      Chondrostei | sturgeons & paddlefish
                        - sturgeon, paddlefish
                      gars | Lepisosteidae
                        - longnose gar, alligator gar
                      bowfin | Amia
                      Teleostei
                        Osteoglossomorpha | bony-tongues
                          - arawana, arapaima, African knifefish, mormyrid
                        .
                          Elopomorpha | eels & tarpon
                            - tarpon, moray, American eel, gulper eel
                          .
                            .
                              Clupeomorpha | herrings
                                - herring, shad
                              Ostariophysi | catfish, minnows
                                - catfish, minnow, zebrafish, tetra, piranha, cavefish, American knifefish, electric eel
                            .
                              Lepidogalaxias | salamanderfish
                              .
                                Protacanthopterygii | salmon, pike
                                  - salmon, trout, pike, smelt
                                Acanthomorpha | spiny-rayed fish
                                  - yellow perch, walleye, largemouth bass, sunfish, seahorse, opah, cichlid, flounder, tuna, flying fish, swamp eel, anglerfish, wrasse, pufferfish
                  Sarcopterygii | lobe-finned fish
                    Actinistia | coelacanths
                    .
                      Dipnoi | lungfish
                        - Australian lungfish, African lungfish, South American lungfish
                      .
                        Eusthenopteron †
                        .
                          Tiktaalik †
                          ~.
                            Acanthostega †
                            Ichthyostega †
                            .
                              Whatcheeria †
                              Tetrapoda
                                Lissamphibia | amphibians
                                  Gymnophiona | caecilians | Apoda
                                    Rhinatrematidae | tailed caecilians
                                    .
                                      Ichthyophiidae | Asian caecilians
                                      Teresomata
                                        Scolecomorphidae | buried-eye caecilians
                                        Caeciliidae | common caecilians
                                  Batrachia
                                    Caudata | salamanders | Urodela
                                      Cryptobranchoidea
                                        Cryptobranchidae | giant salamanders
                                          - hellbender, Chinese giant salamander
                                        Hynobiidae | Asian salamanders
                                      .
                                        Sirenidae | sirens
                                        Salamandroidea | most salamanders
                                          - mudpuppy, olm, axolotl, tiger salamander, amphiuma, red-backed salamander, eastern newt
                                    Anura | frogs | Salientia
                                      Ascaphus | tailed frog
                                      .
                                        Leiopelma | New Zealand frogs
                                        .
                                          discoglossids | fire-bellied & midwife toads | Discoglossanura, Alytidae, Bombinatoridae
                                            - fire-bellied toad, midwife toad
                                          .
                                            .
                                              Pipidae | Xenopus, Pipa
                                                - African clawed frog, Surinam toad
                                              Rhinophrynidae | burrowing toad | Rhinophrynus
                                            .
                                              Pelobatoidea | spadefoots
                                              Neobatrachia | most frogs
                                                - bullfrog, leopard frog, wood frog, American toad, gray tree frog, spring peeper, poison dart frog, horned frog, glass frog, flying frog
                                Amniota
                                  Synapsida
                                    pelycosaurs † | Dimetrodon
                                    Therapsida
                                      dicynodonts † | Lystrosaurus
                                      Cynodontia
                                        non-mammal cynodonts †
                                        Mammalia | mammals
                                          Monotremata | monotremes
                                            - platypus, echidna
                                          Theria
                                            Metatheria | marsupials | Marsupialia
                                              - opossum, kangaroo, koala, wombat, Tasmanian devil
                                            Eutheria | placentals | Placentalia
                                              . | | Atlantogenata
                                                Xenarthra | armadillos, sloths
                                                  - armadillo, sloth, anteater
                                                Afrotheria | elephants, aardvark
                                                  - elephant, manatee, hyrax, aardvark, golden mole
                                              Boreoeutheria
                                                Laurasiatheria
                                                  Eulipotyphla | shrews, moles
                                                    - shrew, mole, hedgehog
                                                  .
                                                    Chiroptera | bats
                                                      - fruit bat, vampire bat
                                                    .
                                                      Cetartiodactyla | even-toed & whales | Artiodactyla
                                                        camel
                                                        .
                                                          ruminants | Ruminantia
                                                            - cow, deer
                                                          . | | Whippomorpha
                                                            hippo
                                                            whale
                                                      .
                                                        Perissodactyla | odd-toed
                                                          - horse, rhino, tapir
                                                        . | | Ferae
                                                          Pholidota | pangolins
                                                          Carnivora | carnivorans
                                                            - dog, cat, bear, seal
                                                Euarchontoglires
                                                  Archonta | primates, tree shrews | Euarchonta
                                                    - human, monkey, tree shrew, colugo
                                                  Glires | rodents, rabbits
                                                    - mouse, squirrel, beaver, rabbit, pika
                                  Diapsida | reptiles | Sauria
                                    Lepidosauria
                                      Sphenodon | tuatara
                                      Squamata | lizards & snakes
                                        Dibamidae | blind lizards
                                        .
                                          Gekkota | geckos
                                            - leopard gecko, tokay gecko
                                          .
                                            Scincoidea | skinks
                                              - five-lined skink, blue-tongued skink
                                            .
                                              Lacertoidea | tegus, amphisbaenians
                                                - tegu, amphisbaenian, wall lizard
                                              Toxicofera
                                                Iguania | iguanas, chameleons
                                                  - green iguana, chameleon, anole, bearded dragon
                                                .
                                                  Anguimorpha | monitors
                                                    - Komodo dragon, Gila monster, glass lizard
                                                  Serpentes | snakes
                                                    Scolecophidia | blind snakes
                                                    .
                                                      boas & pythons | Booidea
                                                        - boa, python
                                                      .
                                                        Viperidae | vipers
                                                          - rattlesnake, copperhead
                                                        .
                                                          Elapidae | cobras
                                                            - cobra, coral snake
                                                          Colubridae | racers
                                                            - racer, garter snake, kingsnake
                                    . | | Archelosauria
                                      Testudines | turtles
                                        Pleurodira | side-necked turtles
                                          - matamata
                                        Cryptodira
                                          Trionychidae | soft-shells
                                          .
                                            Testudinoidea | tortoises, pond turtles
                                              - box turtle, painted turtle, desert tortoise
                                            feisty water turtles | snapping, musk, sea | Americhelydia
                                              - snapping turtle, musk turtle, sea turtle
                                      .
                                        phytosaurs †
                                        Archosauria
                                          ~Crurotarsi | crocodile line | Pseudosuchia
                                            aetosaurs †
                                            rauisuchians †
                                            Crocodylomorpha
                                              sphenosuchians †
                                              Crocodylia | crocodylians
                                                - alligator, caiman, crocodile, gharial
                                          Ornithodira | bird line | Avemetatarsalia
                                            pterosaurs †
                                            Dinosauria | dinosaurs
                                              Ornithischia † | bird-hipped
                                                - Triceratops, Stegosaurus, hadrosaur, ankylosaur
                                              Saurischia
                                                Sauropodomorpha † | long-necked giants
                                                  - Brachiosaurus, Diplodocus
                                                Theropoda
                                                  non-bird theropods † | T. rex, Velociraptor
                                                  Aves | birds
                                                    Palaeognathae | ratites, tinamous
                                                      - ostrich, emu, kiwi, tinamou
                                                    Neognathae
                                                      Galloanserae
                                                        Galliformes | landfowl
                                                          - chicken, peacock, turkey
                                                        Anseriformes | waterfowl
                                                          - duck, goose
                                                      ~Neoaves
                                                        loon
                                                        pelican
                                                        kingfishers
                                                          - kookaburra, belted kingfisher
                                                        .
                                                          parrot
                                                          Passeriformes | perching birds
                                                            - crow, tyrant flycatcher, robin
`;

  /* Places the course accepts more than one answer. Each moves a group (by key) to be sister of another. */
  P.ALTERNATIVES = [
    { move: 'testudines', sisterTo: 'lepidosauria' },   // turtles with lepidosaurs, also accepted
    { move: 'leiopelma', sisterTo: 'ascaphus' },         // Ascaphus + Leiopelma as a clade
  ];

  /* Traits. Each event is [gain|loss, where], where = a group key, or a list of keys (their common ancestor). */
  P.TRAITS = [
    { name: 'notochord', ev: [['gain', 'chordata']] },
    { name: 'dorsal hollow nerve cord', ev: [['gain', 'chordata']] },
    { name: 'pharyngeal slits', ev: [['gain', 'chordata']] },
    { name: 'endostyle', ev: [['gain', 'chordata']] },
    { name: 'post-anal tail', ev: [['gain', 'chordata'], ['loss', 'teresomata'], ['loss', 'anura']] },
    { name: 'neural crest', ev: [['gain', 'vertebrata']] },
    { name: 'vertebrae', ev: [['gain', 'vertebrata'], ['loss', 'myxini']] },
    { name: 'electroreception', ev: [['gain', 'vertebrata'], ['loss', 'anura'], ['loss', 'amniota'], ['gain', 'platypus']] },
    { name: 'slime glands', ev: [['gain', 'myxini']] },
    { name: 'suction-cup mouth', ev: [['gain', 'petromyzontida']] },
    { name: 'dermal bone', ev: [['gain', ['galeaspids', 'gnathostomata']], ['loss', 'chondrichthyes']] },
    { name: 'jaws', ev: [['gain', 'gnathostomata']] },
    { name: 'paired fins', ev: [['gain', 'gnathostomata']] },
    { name: 'three semicircular canals', ev: [['gain', 'gnathostomata']] },
    { name: 'placoid scales', ev: [['gain', 'chondrichthyes']] },
    { name: 'tessellated cartilage', ev: [['gain', 'chondrichthyes']] },
    { name: 'claspers', ev: [['gain', 'chondrichthyes']] },
    { name: 'squalene liver', ev: [['gain', 'chondrichthyes']] },
    { name: 'upper jaw fused to braincase', ev: [['gain', 'holocephali'], ['gain', 'tetrapoda']] },
    { name: 'tooth plates', ev: [['gain', 'holocephali'], ['gain', 'dipnoi']] },
    { name: 'pectoral-fin swimming', ev: [['gain', 'holocephali'], ['gain', 'batoidea']] },
    { name: 'rostrum', ev: [['gain', 'selachii']] },
    { name: 'ventral gills', ev: [['gain', 'batoidea']] },
    { name: 'rostral saw', ev: [['gain', 'saw_shark'], ['gain', 'sawfish']] },
    { name: 'electric organs', ev: [['gain', 'skate'], ['gain', 'torpedo'], ['gain', 'mormyrid'], ['gain', 'electric_eel']] },
    { name: 'warm body', ev: [['gain', 'great_white_shark'], ['gain', 'tuna'], ['gain', 'opah']] },
    { name: 'lungs', ev: [['gain', 'osteichthyes']] },
    { name: 'acellular bone', ev: [['gain', 'teleostei']] },
    { name: 'recessus lateralis', ev: [['gain', 'clupeomorpha']] },
    { name: 'fin spines', ev: [['gain', 'acanthomorpha']] },
    { name: 'pelvic fins forward', ev: [['gain', 'acanthomorpha']] },
    { name: 'three-lobed tail', ev: [['gain', 'actinistia']] },
    { name: 'giant notochord', ev: [['gain', 'actinistia']] },
    { name: 'dorsal fin', ev: [['gain', 'chordata'], ['loss', 'dipnoi']] },
    { name: 'estivation', ev: [['gain', 'dipnoi']] },
    { name: 'neck', ev: [['gain', ['tiktaalik', 'tetrapoda']]] },
    { name: 'wrist', ev: [['gain', ['tiktaalik', 'tetrapoda']]] },
    { name: 'pelvis fused to sacrum', ev: [['gain', ['acanthostega', 'tetrapoda']]] },
    { name: 'limbs with digits', ev: [['gain', 'tetrapoda'], ['loss', 'gymnophiona'], ['loss', 'serpentes']] },
    { name: 'stapes', ev: [['gain', 'tetrapoda'], ['loss', 'scolecomorphidae']] },
    { name: 'choana', ev: [['gain', 'tetrapoda']] },
    { name: 'zygapophyses', ev: [['gain', 'tetrapoda']] },
    { name: 'retractor bulbi', ev: [['gain', 'tetrapoda']] },
    { name: 'breathing skin', ev: [['gain', 'lissamphibia']] },
    { name: 'dermal scale rings', ev: [['gain', 'gymnophiona']] },
    { name: 'tentacle', ev: [['gain', 'gymnophiona']] },
    { name: 'interhyoideus jaw closer', ev: [['gain', 'gymnophiona']] },
    { name: 'urostyle', ev: [['gain', 'anura']] },
    { name: 'frontoparietal', ev: [['gain', 'anura']] },
    { name: 'no lower teeth', ev: [['gain', 'anura']] },
    { name: 'keratin spade', ev: [['gain', 'pelobatoidea']] },
    { name: 'hind limbs lost', ev: [['gain', 'sirenidae']] },
    { name: 'amniotic egg', ev: [['gain', 'amniota']] },
    { name: 'metanephric kidney', ev: [['gain', 'amniota']] },
    { name: 'one temporal opening', ev: [['gain', 'synapsida']] },
    { name: 'two temporal openings', ev: [['gain', 'diapsida'], ['loss', 'testudines']] },
    { name: 'hair', ev: [['gain', 'mammalia']] },
    { name: 'milk', ev: [['gain', 'mammalia']] },
    { name: 'three middle-ear bones', ev: [['gain', 'mammalia']] },
    { name: 'diaphragm', ev: [['gain', 'mammalia']] },
    { name: 'long-lived placenta', ev: [['gain', 'eutheria']] },
    { name: 'powered flight', ev: [['gain', 'chiroptera'], ['gain', 'pterosaurs'], ['gain', 'aves']] },
    { name: 'shell', ev: [['gain', 'testudines']] },
    { name: 'venom', ev: [['gain', 'toxicofera']] },
    { name: 'antorbital fenestra', ev: [['gain', 'archosauria']] },
    { name: 'socketed teeth', ev: [['gain', 'archosauria']] },
    { name: 'open hip socket', ev: [['gain', 'dinosauria']] },
    { name: 'predentary', ev: [['gain', 'ornithischia']] },
    { name: 'toothless beak', ev: [['gain', 'aves']] },
    { name: 'flow-through lungs', ev: [['gain', 'aves']] },
  ];

  /* Ready-made sets of tips. */
  P.DECKS = [
    { id: 'six', name: '6 tips', tips: ['sea_lamprey', 'spiny_dogfish', 'yellow_perch', 'leopard_frog', 'mouse', 'anole'] },
    { id: 'eleven', name: '11 tips', tips: ['sea_lamprey', 'ratfish', 'spiny_dogfish', 'bichir', 'catfish', 'walleye', 'african_lungfish', 'gray_tree_frog', 'platypus', 'mouse', 'chicken'] },
    { id: 'sixteen', name: '16 tips', tips: ['cephalochordata', 'myxini', 'sea_lamprey', 'ratfish', 'great_white_shark', 'skate', 'longnose_gar', 'herring', 'salmon', 'actinistia', 'african_lungfish', 'axolotl', 'bullfrog', 'kangaroo', 'human', 'alligator'] },
    { id: 'backbone', name: 'Backbone', tips: ['cephalochordata', 'urochordata', 'myxini', 'petromyzontida', 'holocephali', 'selachii', 'batoidea', 'actinopterygii', 'actinistia', 'dipnoi', 'lissamphibia', 'amniota'] },
    { id: 'chond', name: 'Chondrichthyes', tips: ['ratfish', 'spiny_dogfish', 'frilled_shark', 'great_white_shark', 'hammerhead', 'skate', 'manta'] },
    { id: 'actino', name: 'Actinopterygii', tips: ['bichir', 'sturgeon', 'longnose_gar', 'bowfin', 'mormyrid', 'moray', 'herring', 'catfish', 'piranha', 'lepidogalaxias', 'salmon', 'walleye', 'seahorse'] },
    { id: 'sarc', name: 'Sarcopterygii', tips: ['yellow_perch', 'actinistia', 'african_lungfish', 'eusthenopteron', 'tiktaalik', 'acanthostega', 'whatcheeria', 'leopard_frog', 'mouse'] },
    { id: 'gnath', name: 'Jaws', tips: ['sea_lamprey', 'galeaspids', 'antiarchs', 'ptyctodontids', 'arthrodires', 'spiny_dogfish', 'yellow_perch'] },
    { id: 'amph', name: 'Lissamphibia', tips: ['rhinatrematidae', 'ichthyophiidae', 'scolecomorphidae', 'caeciliidae', 'hellbender', 'sirenidae', 'axolotl', 'ascaphus', 'fire_bellied_toad', 'african_clawed_frog', 'rhinophrynidae', 'pelobatoidea', 'bullfrog'] },
    { id: 'amniota', name: 'Amniota', tips: ['pelycosaurs', 'dicynodonts', 'non_mammal_cynodonts', 'platypus', 'kangaroo', 'human', 'sphenodon', 'green_iguana', 'box_turtle', 'alligator', 'chicken'] },
    { id: 'mamm', name: 'Mammalia', tips: ['platypus', 'opossum', 'armadillo', 'elephant', 'shrew', 'fruit_bat', 'camel', 'cow', 'whale', 'horse', 'pholidota', 'dog', 'human', 'mouse'] },
    { id: 'squam', name: 'Squamata', tips: ['sphenodon', 'dibamidae', 'leopard_gecko', 'five_lined_skink', 'tegu', 'green_iguana', 'komodo_dragon', 'scolecophidia', 'python', 'rattlesnake', 'cobra', 'garter_snake'] },
    { id: 'arch', name: 'Archosauria', tips: ['box_turtle', 'phytosaurs', 'aetosaurs', 'sphenosuchians', 'alligator', 'pterosaurs', 'triceratops', 'brachiosaurus', 'non_bird_theropods', 'ostrich', 'chicken'] },
    { id: 'turtle', name: 'Testudines', tips: ['matamata', 'trionychidae', 'box_turtle', 'desert_tortoise', 'snapping_turtle', 'sea_turtle', 'alligator'] },
    { id: 'aves', name: 'Aves', tips: ['ostrich', 'chicken', 'loon', 'peacock', 'duck', 'parrot', 'goose', 'pelican', 'kookaburra', 'crow', 'tyrant_flycatcher'] },
    { id: 'course', name: 'Whole course', tips: ['cephalochordata', 'urochordata', 'myxini', 'petromyzontida', 'holocephali', 'squalomorphi', 'galeomorphi', 'batoidea', 'polypteriformes', 'chondrostei', 'gars', 'bowfin', 'teleostei', 'actinistia', 'dipnoi', 'gymnophiona', 'cryptobranchoidea', 'sirenidae', 'salamandroidea', 'anura', 'monotremata', 'metatheria', 'xenarthra', 'afrotheria', 'laurasiatheria', 'archonta', 'glires', 'sphenodon', 'squamata', 'testudines', 'crocodylia', 'aves'] },
  ];
})(window.P = window.P || {});
