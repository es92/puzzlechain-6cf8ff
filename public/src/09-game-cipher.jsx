/* ============================================================
   Game 3 — Crypto Wordle (daily variable-length finance/crypto word)
   ============================================================ */
// The daily word now varies in length (3–8 letters). The board sizes its
// columns to the word and allows wordLen + 1 guesses (see cwMaxGuesses).
const CW_MIN_LEN = 3;
const CW_MAX_LEN = 8;

// Curated finance / crypto terms of VARYING length (3–8 letters), each with a
// short themed clue the player reads while solving. The daily answer is chosen
// deterministically from this list, so everyone gets the same word + length +
// clue on the same UTC day (shareable, comparable). No dictionary validates the
// guesses — any letters of the right length are accepted — but the answer is
// always from here. Every `word` must be UPPERCASE A–Z and 3–8 letters.
// Each entry: `clue` is the always-visible main clue; `hints` is an ordered
// list of EXTRA clues (default 2) that unlock progressively — one per wrong
// guess, or early via the paid Hint button. Keep hints incremental and
// spoiler-light (never spell the word).
const CW_WORDS = [
  { word: 'FEE',      clue: 'What you pay to get a transaction processed',        hints: ['Charged every time you move funds on-chain', 'Spikes when the network is congested'] },
  { word: 'BID',      clue: 'The price a buyer offers in an order book',          hints: ["The opposite of an 'ask'", 'Sits on the buy side of the book'] },
  { word: 'APY',      clue: 'Yearly compounded return on a staking deposit',      hints: ['A percentage yield farmers watch', "Three-letter acronym ending in 'yield'"] },
  { word: 'BULL',     clue: 'An investor betting prices will rise',               hints: ['This market only goes up, they say', 'The opposite of a bear'] },
  { word: 'BEAR',     clue: 'An investor betting prices will fall',               hints: ['Prices keep sliding in this market', 'The opposite of a bull'] },
  { word: 'COIN',     clue: "A blockchain's own native digital currency",         hints: ['Bitcoin is the original one', 'Not a token — it has its own chain'] },
  { word: 'FIAT',     clue: 'Government-issued money like dollars or euros',      hints: ['Backed by a state, not a blockchain', 'The dollar and euro are examples'] },
  { word: 'HODL',     clue: 'Crypto slang for holding through the swings',        hints: ["Born from a typo of 'hold'", 'A meme for diamond hands'] },
  { word: 'MINT',     clue: 'To create a brand-new token or NFT',                 hints: ['Happens when an NFT is first created', 'Adds fresh supply to existence'] },
  { word: 'PUMP',     clue: 'A sharp, sudden rise in a coin’s price',             hints: ['Often followed by a dump', 'A rapid green candle'] },
  { word: 'TOKEN',    clue: 'A tradable unit of value issued on a chain',         hints: ['Issued on top of an existing chain', 'ERC-20 is a standard for these'] },
  { word: 'BLOCK',    clue: 'A bundle of transactions added to the chain',        hints: ['Miners race to add the next one', 'Links to the one before it'] },
  { word: 'CHAIN',    clue: 'The shared ledger of linked blocks',                 hints: ['A linked sequence of blocks', "The 'chain' in blockchain"] },
  { word: 'STAKE',    clue: 'Lock up coins to secure a network and earn rewards', hints: ['You give this up temporarily to earn passive rewards', 'Proof-of-_____ networks rely on it'] },
  { word: 'VAULT',    clue: 'A smart contract that safeguards deposited assets',  hints: ['Where a DeFi protocol stores deposits', 'A digital strongbox'] },
  { word: 'WHALE',    clue: 'A holder big enough to move the market',             hints: ['A sea creature that moves markets', 'Holds enough to cause a splash'] },
  { word: 'YIELD',    clue: 'The income your crypto earns over time',             hints: ['What farmers chase in DeFi', 'Your return, expressed as a rate'] },
  { word: 'AUDIT',    clue: 'A security review of a smart contract',             hints: ['Done before a protocol launches', 'Hunts for code vulnerabilities'] },
  { word: 'ASSET',    clue: 'Anything of value you can hold or trade',            hints: ['On the plus side of a balance sheet', 'Crypto, stocks, and gold all count'] },
  { word: 'NONCE',    clue: 'The number a miner tweaks to find a valid hash',     hints: ['A miner increments it endlessly', 'Used once, then discarded'] },
  { word: 'WALLET',   clue: 'App that holds your keys and coins',                 hints: ['Holds your private keys', 'Can be hot software or a cold device'] },
  { word: 'LEDGER',   clue: 'The record of every transaction ever made',         hints: ['An immutable transaction record', 'Also a famous hardware brand'] },
  { word: 'MINING',   clue: 'Spending compute to add blocks and earn rewards',    hints: ['How proof-of-work secures a chain', 'Rewards whoever solves the puzzle'] },
  { word: 'ORACLE',   clue: 'A feed that brings off-chain data on-chain',         hints: ['Feeds real-world prices on-chain', 'Chainlink is the best-known one'] },
  { word: 'BRIDGE',   clue: 'Moves assets between two different blockchains',     hints: ['Connects two separate chains', 'A frequent hacking target'] },
  { word: 'TETHER',   clue: 'Nickname for the best-known dollar stablecoin',      hints: ['Its ticker is USDT', 'A coin pegged to the dollar'] },
  { word: 'CRYPTO',   clue: 'Short name for digital currencies as a whole',       hints: ["Short for a kind of currency", "The whole industry's nickname"] },
  { word: 'BROKER',   clue: 'A middleman who places trades for you',              hints: ['Places trades on your behalf', 'Earns a commission per trade'] },
  { word: 'WALLETS',  clue: 'Where holders keep their keys and coins (plural)',   hints: ['Plural of where you keep keys', 'You might own several of these'] },
  { word: 'NETWORK',  clue: 'The connected nodes that run a blockchain',          hints: ['Nodes connected together', 'Ethereum is one of these'] },
  { word: 'TRADING',  clue: 'Buying and selling to profit from price moves',      hints: ['Buying low and selling high', 'What day-_____ describes'] },
  { word: 'STAKING',  clue: 'Earning rewards by locking up your coins',           hints: ['Locking coins to earn rewards', 'Powers proof-of-stake'] },
  { word: 'DEPOSIT',  clue: 'Funds you put into an account or protocol',          hints: ['Money you put in', 'The opposite of a withdrawal'] },
  { word: 'AIRDROP',  clue: 'Free tokens dropped to a community of wallets',      hints: ['Free tokens sent to wallets', 'Often rewards early users'] },
  { word: 'LENDING',  clue: 'Supplying assets so others can borrow for interest', hints: ['Earn interest by supplying assets', 'Aave and Compound enable it'] },
  { word: 'EXCHANGE', clue: 'A marketplace for swapping one coin for another',    hints: ['Where you swap one coin for another', 'Can be centralized or decentralized'] },
  { word: 'SOLVENCY', clue: 'Having enough assets to cover what you owe',         hints: ['Enough assets to cover liabilities', 'The opposite of bankruptcy'] },
  { word: 'TREASURY', clue: 'The shared pool of funds a protocol controls',       hints: ["A DAO's shared war chest", "Holds a protocol's reserves"] },
  { word: 'VALIDATE', clue: 'To confirm transactions are legitimate',             hints: ['Confirm a transaction is legit', 'Validators do this'] },
  { word: 'DIVIDEND', clue: 'A share of profits paid out to holders',             hints: ['A payout to shareholders', 'Profit shared with holders'] },
  { word: 'CURRENCY', clue: 'Money in a particular form, digital or fiat',        hints: ['A medium of exchange', 'Dollars and bitcoin both qualify'] },
  { word: 'CONTRACT', clue: 'Self-running code that enforces an agreement',       hints: ['Self-executing code on a chain', 'Smart ones run on Ethereum'] },
  { word: 'CUSTODY',  clue: 'Who actually holds the keys to your assets',          hints: ['Self- or third-party', 'Not your keys, not your coins'] },
  { word: 'LIQUID',   clue: 'Easy to buy or sell without moving the price',        hints: ['A deep order book is this', 'The opposite of thinly traded'] },
  { word: 'ROLLUP',   clue: 'A layer that batches transactions off the main chain', hints: ['Optimistic or zero-knowledge', 'Cuts fees by bundling'] },
];

/* ============================================================
   #138 — "Daily cipher is the same every day".
   The seeding was fine (consecutive-day PRNG streams are well separated); the
   pool was the problem: 42 words, ONE theme, 4–7 drawn per day, no cross-day
   memory. Two words recurring inside a week is what made it feel identical.

   Fix: three more themed pools (≥180 entries total) plus a deterministic
   ROTATION that partitions a seeded shuffle into day-sized blocks, so a word
   cannot recur inside a full cycle. Verified by the cipher-rotation self-test.
   ============================================================ */
const CW_SCIENCE = [
  { word: 'ATOM',     clue: 'The smallest unit of an element',                    hints: ['Has a nucleus and electrons', 'Building block of matter'] },
  { word: 'CELL',     clue: 'The basic unit of every living thing',               hints: ['Has a membrane and a nucleus', 'You are made of trillions'] },
  { word: 'GENE',     clue: 'A stretch of DNA coding one trait',                  hints: ['Inherited from your parents', 'Lives on a chromosome'] },
  { word: 'MASS',     clue: 'How much matter something contains',                 hints: ['Measured in kilograms', 'Not the same as weight'] },
  { word: 'HEAT',     clue: 'Energy flowing from hot to cold',                     hints: ['Measured in joules', 'Flows down a temperature gradient'] },
  { word: 'IONS',     clue: 'Atoms carrying an electric charge',                  hints: ['Formed by losing or gaining electrons', 'Carry current through a solution'] },
  { word: 'ACID',     clue: 'A substance with a pH below seven',                  hints: ['Turns litmus paper red', 'Donates protons'] },
  { word: 'ORBIT',    clue: 'The curved path one body takes around another',      hints: ['The Moon does this to Earth', 'Kepler described its shape'] },
  { word: 'LASER',    clue: 'A beam of light amplified in one direction',          hints: ['An acronym for stimulated emission', 'Coherent, single-wavelength light'] },
  { word: 'PRISM',    clue: 'Glass that splits white light into colours',          hints: ['Newton used one on sunlight', 'Makes a rainbow indoors'] },
  { word: 'ALLOY',    clue: 'A metal blended from two or more elements',           hints: ['Brass and steel are examples', 'Stronger than its parts'] },
  { word: 'FORCE',    clue: 'A push or pull that changes motion',                 hints: ['Mass times acceleration', 'Measured in newtons'] },
  { word: 'PLANT',    clue: 'An organism that makes food from sunlight',          hints: ['Uses chlorophyll', 'Roots, stem, leaves'] },
  { word: 'NERVE',    clue: 'A fibre carrying signals through the body',          hints: ['Sends electrical impulses', 'Bundled into the spinal cord'] },
  { word: 'SOLAR',    clue: 'Relating to the Sun',                                hints: ['As in panels, or a system', 'From the Latin for sun'] },
  { word: 'FOSSIL',   clue: 'Preserved remains of ancient life',                  hints: ['Found in sedimentary rock', 'How we know about dinosaurs'] },
  { word: 'ENZYME',   clue: 'A protein that speeds up a reaction',                hints: ['A biological catalyst', 'Names usually end in -ase'] },
  { word: 'PHOTON',   clue: 'A single particle of light',                         hints: ['Has no mass', 'Both a particle and a wave'] },
  { word: 'GRAVITY',  clue: 'The force pulling masses toward each other',         hints: ['Keeps you on the ground', 'Newton and Einstein both explained it'] },
  { word: 'NEURON',   clue: 'A single brain cell that fires signals',             hints: ['Has dendrites and an axon', 'Billions of them in your head'] },
  { word: 'PLASMA',   clue: 'Ionised gas, the fourth state of matter',            hints: ['What stars are made of', 'Also the liquid part of blood'] },
  { word: 'MAGNET',   clue: 'Something with a north and south pole',              hints: ['Attracts iron', 'Has a field around it'] },
  { word: 'CARBON',   clue: 'Element number six, the basis of life',              hints: ['Diamonds and graphite are both this', 'Symbol C'] },
  { word: 'OXYGEN',   clue: 'The element every breath depends on',                hints: ['About a fifth of the air', 'Symbol O'] },
  { word: 'PROTON',   clue: 'The positively charged nucleus particle',            hints: ['Its count is the atomic number', 'Opposite of an electron'] },
  { word: 'ORGANIC',  clue: 'Chemistry built around carbon compounds',            hints: ['Also a food label', 'The chemistry of living things'] },
  { word: 'MINERAL',  clue: 'A naturally occurring solid with fixed structure',    hints: ['Quartz and calcite qualify', 'Rocks are made of them'] },
  { word: 'GLACIER',  clue: 'A slow river of ice',                                hints: ['Carves valleys as it moves', 'Retreating in a warming world'] },
  { word: 'ECOLOGY',  clue: 'The study of how organisms relate to their habitat',  hints: ['Food webs and niches', 'From the Greek for household'] },
  { word: 'ISOTOPE',  clue: 'A variant of an element with extra neutrons',        hints: ['Carbon-14 is one', 'Same element, different mass'] },
  { word: 'VACCINE',  clue: 'A preparation that trains immunity',                 hints: ['Teaches your body to recognise a pathogen', 'Jenner made the first'] },
  { word: 'NEUTRON',  clue: 'The uncharged particle in a nucleus',                hints: ['Has mass but no charge', 'Discovered by Chadwick'] },
  { word: 'ECLIPSE',  clue: 'When one body blocks the light of another',           hints: ['Solar or lunar', 'Needs three bodies in a line'] },
  { word: 'BIOLOGY',  clue: 'The science of living things',                       hints: ['Cells, genes, ecosystems', 'From the Greek for life'] },
  { word: 'CLIMATE',  clue: "A region's long-term weather pattern",               hints: ['Weather averaged over decades', 'Not the same as weather'] },
  { word: 'MOLECULE', clue: 'Two or more atoms bonded together',                  hints: ['Water is a famous one', 'Smaller than a cell, bigger than an atom'] },
  { word: 'ELECTRON', clue: 'The negatively charged particle orbiting a nucleus',  hints: ['Carries electric current', 'Tiny compared to a proton'] },
  { word: 'GRAVITON', clue: 'The hypothetical carrier of gravity',                hints: ['Never observed', 'Would be the force particle for mass'] },
  { word: 'PROTEIN',  clue: 'A chain of amino acids doing a cellular job',        hints: ['Folded into a shape that matters', 'Built from a gene recipe'] },
  { word: 'SPECTRUM', clue: 'The full range of wavelengths in radiation',          hints: ['Visible light is one slice', 'A prism reveals it'] },
  { word: 'PARTICLE', clue: 'A very small constituent of matter',                 hints: ['Physics has a whole zoo of them', 'Colliders smash them together'] },
  { word: 'PRESSURE', clue: 'Force spread over an area',                          hints: ['Measured in pascals', 'Rises as you dive deeper'] },
  { word: 'MOMENTUM', clue: 'Mass times velocity — the tendency to keep going',    hints: ['Conserved in a collision', 'Hard to stop a heavy fast thing'] },
  { word: 'HABITAT',  clue: 'The natural home of a species',                       hints: ['Where an animal lives', 'Loss of it drives extinction'] },
  { word: 'MICROBE',  clue: 'An organism too small to see unaided',                hints: ['Needs a microscope', 'Bacteria are examples'] },
  { word: 'MAGNETIC', clue: 'Having the properties of a magnet',                   hints: ['As in a field, or the north pole', 'Iron responds to it'] },
];

const CW_GEOGRAPHY = [
  { word: 'BAY',      clue: 'A wide inlet where the sea bends into land',         hints: ['Smaller than a gulf', 'Ships shelter in one'] },
  { word: 'CAPE',     clue: 'A headland jutting into the sea',                    hints: ['Horn and Good Hope are two', 'A pointed piece of coast'] },
  { word: 'DUNE',     clue: 'A hill of wind-blown sand',                          hints: ['Shifts with the wind', 'Deserts and beaches have them'] },
  { word: 'FJORD',    clue: 'A deep sea inlet carved by a glacier',               hints: ['Norway is famous for them', 'Steep cliffs on both sides'] },
  { word: 'DELTA',    clue: 'The fan of land where a river meets the sea',        hints: ['The Nile has a famous one', 'Named after a Greek letter'] },
  { word: 'ATOLL',    clue: 'A ring-shaped coral island',                         hints: ['Encircles a lagoon', 'Common in the Pacific'] },
  { word: 'STEPPE',   clue: 'A vast dry grassland plain',                          hints: ['Stretches across Central Asia', 'Too dry for forest'] },
  { word: 'TUNDRA',   clue: 'Treeless ground frozen most of the year',            hints: ['Permafrost underneath', 'Found in the far north'] },
  { word: 'CANYON',   clue: 'A deep gorge cut by a river',                        hints: ['Arizona has a Grand one', 'Steep walls, river below'] },
  { word: 'ISLAND',   clue: 'Land completely surrounded by water',                hints: ['Smaller than a continent', 'You need a boat'] },
  { word: 'STRAIT',   clue: 'A narrow channel joining two seas',                  hints: ['Gibraltar and Bering are two', 'Ships queue to pass'] },
  { word: 'LAGOON',   clue: 'Shallow water cut off by a reef or sandbar',         hints: ['Often inside an atoll', 'Calm and shallow'] },
  { word: 'SAVANNA',  clue: 'Tropical grassland with scattered trees',            hints: ['Where lions hunt', 'Wet and dry seasons'] },
  { word: 'PLATEAU',  clue: 'A raised area of flat land',                         hints: ['Tibet has the largest', 'High but level'] },
  { word: 'ESTUARY',  clue: 'Where a river tide mixes with the sea',              hints: ['Brackish water', 'Rich in birdlife'] },
  { word: 'ISTHMUS',  clue: 'A narrow strip of land joining two larger areas',     hints: ['Panama has a famous one', 'A land bridge'] },
  { word: 'SUMMIT',   clue: 'The highest point of a mountain',                     hints: ['Climbers aim for it', 'Also a meeting of leaders'] },
  { word: 'VOLCANO',  clue: 'A vent where magma reaches the surface',              hints: ['Erupts lava and ash', 'Vesuvius is one'] },
  { word: 'GLACIAL',  clue: 'Relating to ice sheets, or extremely slow',           hints: ['As in a pace, or a valley', 'Carved by ice'] },
  { word: 'MONSOON',  clue: 'A seasonal wind bringing heavy rain',                hints: ['Defines South Asian summers', 'Reverses direction each year'] },
  { word: 'PRAIRIE',  clue: 'The tall-grass plains of North America',              hints: ['Bison country', 'Flat and grassy'] },
  { word: 'CRATER',   clue: 'A bowl-shaped hollow from an impact or eruption',      hints: ['The Moon is covered in them', 'Left by a meteorite or a volcano'] },
  { word: 'RAVINE',   clue: 'A narrow steep-sided valley',                        hints: ['Smaller than a canyon', 'Carved by runoff'] },
  { word: 'MARSH',    clue: 'Low wet ground thick with grasses',                   hints: ['Wetland without trees', 'Squelchy underfoot'] },
  { word: 'OASIS',    clue: 'A fertile spot in a desert',                          hints: ['Fed by groundwater', 'Palm trees and a pool'] },
  { word: 'TROPIC',   clue: 'One of two latitude lines flanking the equator',       hints: ['Cancer and Capricorn', 'Marks the sun overhead'] },
  { word: 'MERIDIAN', clue: 'A line of longitude running pole to pole',            hints: ['Greenwich has the prime one', 'Vertical on a map'] },
  { word: 'EQUATOR',  clue: 'The zero-degree line around the middle of Earth',     hints: ['Splits the hemispheres', 'Longest line of latitude'] },
  { word: 'HEADLAND', clue: 'A cliff of land reaching into the sea',               hints: ['A high point on the coast', 'Lighthouses stand on them'] },
  { word: 'MOORLAND', clue: 'Open upland covered in heather',                      hints: ['Windswept and treeless', 'Heather and peat'] },
  { word: 'WATERWAY', clue: 'A river or canal that boats can travel',              hints: ['Navigable by barge', 'Carries freight inland'] },
  { word: 'FOOTHILL', clue: 'A low hill at the base of a mountain',                hints: ['Where the climb begins', 'Below the real peaks'] },
  { word: 'BASIN',    clue: 'A large depression that collects drainage',            hints: ['The Amazon has a huge one', 'All water flows to its middle'] },
  { word: 'GORGE',    clue: 'A deep narrow passage between cliffs',                hints: ['A river usually runs through it', 'Also means to eat greedily'] },
  { word: 'LEVEE',    clue: 'An embankment holding back a river',                  hints: ['Protects a floodplain', 'The Mississippi has many'] },
  { word: 'CURRENT',  clue: 'A steady flow of water through the sea',              hints: ['The Gulf Stream is one', 'Carries heat around the globe'] },
  { word: 'LATITUDE', clue: 'How far north or south a place sits',                 hints: ['Measured in degrees from the equator', 'Horizontal on a map'] },
  { word: 'ALTITUDE', clue: 'Height above sea level',                             hints: ['Thins the air as it rises', 'Pilots watch it closely'] },
  { word: 'LOWLAND',  clue: 'Ground lying near sea level',                         hints: ['The opposite of highland', 'Flat and often fertile'] },
  { word: 'WETLAND',  clue: 'Ground saturated with water year-round',              hints: ['Marshes and bogs', 'A haven for birds'] },
  { word: 'CASCADE',  clue: 'A small steep waterfall in a series',                 hints: ['Water tumbling down steps', 'Also a mountain range'] },
  { word: 'SEDIMENT', clue: 'Particles that settle out of water',                  hints: ['Builds up in a delta', 'Becomes rock over time'] },
  { word: 'HARBOUR',  clue: 'A sheltered place where ships moor',                   hints: ['Sydney has a famous one', 'Protected from open sea'] },
  { word: 'TERRAIN',  clue: 'The shape and features of the ground',                hints: ['Rough or smooth', 'What a map contour shows'] },
  { word: 'PLAINS',   clue: 'Broad stretches of flat low ground',                  hints: ['Great ones cross America', 'Few hills in sight'] },
];

const CW_EVERYDAY = [
  { word: 'KEYS',     clue: 'What you pat your pocket for on the way out',        hints: ['They jingle', 'One opens your front door'] },
  { word: 'LAMP',     clue: 'A light you switch on beside a chair',               hints: ['Has a shade', 'Sits on a side table'] },
  { word: 'SOAP',     clue: 'What you lather at the sink',                        hints: ['Twenty seconds, they say', 'Comes as a bar or a pump'] },
  { word: 'FORK',     clue: 'The tined one in the cutlery drawer',                hints: ['Sits left of the plate', 'Also a split in the road'] },
  { word: 'CLOCK',    clue: 'What you glance at when you are late',               hints: ['Two hands, twelve numbers', 'Ticks'] },
  { word: 'KETTLE',   clue: 'What you fill and switch on for tea',                hints: ['Whistles or clicks off', 'Boils water'] },
  { word: 'MIRROR',   clue: 'The thing you check before leaving',                 hints: ['Reflects you', 'On the wall, or in the car'] },
  { word: 'PURSE',    clue: 'The small bag coins go in',                          hints: ['Snaps shut', 'Also means to pucker your lips'] },
  { word: 'LADDER',   clue: 'What you climb to reach the gutter',                 hints: ['Has rungs', 'Lean it against a wall'] },
  { word: 'BUCKET',   clue: 'What you fill to wash the car',                      hints: ['Has a handle', 'Also a to-do list'] },
  { word: 'PILLOW',   clue: 'What your head lands on',                            hints: ['Comes with a case', 'Sits at the head of the bed'] },
  { word: 'BLANKET',  clue: 'What you pull up when it gets cold',                 hints: ['Woollen, usually', 'Also means covering everything'] },
  { word: 'CURTAIN',  clue: 'What you draw at dusk',                              hints: ['Hangs on a rail', 'Also falls at the end of a play'] },
  { word: 'CUSHION',  clue: 'The soft square on the sofa',                        hints: ['You plump it', 'Also means to soften a blow'] },
  { word: 'TOASTER',  clue: 'The appliance that browns your bread',               hints: ['Pops up when done', 'Crumbs collect in the tray'] },
  { word: 'UMBRELLA', clue: 'What you open when the sky turns',                   hints: ['Has ribs and a canopy', 'Always left on the train'] },
  { word: 'SCISSORS', clue: 'The two-bladed thing in the drawer',                 hints: ['Always plural', 'Cuts paper and ribbon'] },
  { word: 'HANGER',   clue: 'What a shirt hangs on in the wardrobe',              hints: ['Wire, wood or plastic', 'Hooks over a rail'] },
  { word: 'BOTTLE',   clue: 'What you refill and carry around',                    hints: ['Has a neck and a cap', 'Glass or plastic'] },
  { word: 'CANDLE',   clue: 'What you light when the power goes',                  hints: ['Has a wick', 'Drips wax'] },
  { word: 'BASKET',   clue: 'What you carry the shopping in',                      hints: ['Woven, often', 'Also on a bicycle'] },
  { word: 'SPOON',    clue: 'The rounded one you stir with',                       hints: ['Tea or table size', 'Sits right of the plate'] },
  { word: 'TOWEL',    clue: 'What you reach for stepping out of the shower',       hints: ['Hangs on a rail', 'Fluffy when new'] },
  { word: 'BRUSH',    clue: 'What you drag through your hair',                     hints: ['Has bristles', 'Also for paint'] },
  { word: 'DRAWER',   clue: 'The sliding compartment in a chest',                  hints: ['You pull it out', 'Where odd things accumulate'] },
  { word: 'CARPET',   clue: 'The soft floor covering underfoot',                   hints: ['Fitted wall to wall', 'Vacuumed weekly'] },
  { word: 'WINDOW',   clue: 'What you open to let the air in',                     hints: ['Has a pane and a latch', 'Also on a computer'] },
  { word: 'LAUNDRY',  clue: 'The pile that never quite ends',                     hints: ['Sorted by colour', 'Washed, dried, folded'] },
  { word: 'KITCHEN',  clue: 'The room with the kettle in it',                      hints: ['Where meals get made', 'Sink, hob, fridge'] },
  { word: 'CUPBOARD', clue: 'The closed shelf unit where plates live',            hints: ['Has doors', 'Skeletons optionally included'] },
  { word: 'MATTRESS', clue: 'The padded slab you sleep on',                        hints: ['Springs or foam', 'Sits on a bed frame'] },
  { word: 'DOORBELL', clue: 'What a visitor presses',                              hints: ['Chimes or buzzes', 'By the front door'] },
  { word: 'ENVELOPE', clue: 'What a letter goes into',                              hints: ['You lick the flap', 'Needs a stamp'] },
  { word: 'NOTEBOOK', clue: 'Where you jot things you then forget',                 hints: ['Lined pages, spiral bound', 'Also a small laptop'] },
  { word: 'BLENDER',  clue: 'The appliance that purées a soup',                    hints: ['Whirring blades', 'Makes smoothies'] },
  { word: 'DOORMAT',  clue: 'What you wipe your feet on',                          hints: ['Says WELCOME, sometimes', 'Lies at the threshold'] },
  { word: 'SLIPPERS', clue: 'What you swap your shoes for indoors',                hints: ['Soft-soled', 'Kept by the door'] },
  { word: 'ARMCHAIR', clue: 'The comfortable seat with sides',                     hints: ['You sink into it', 'Has arms, unlike a stool'] },
  { word: 'SANDWICH', clue: 'Lunch between two slices',                            hints: ['Named after an earl', 'Cut on the diagonal'] },
  { word: 'BACKPACK', clue: 'What you sling over both shoulders',                   hints: ['Two straps', 'For school or a hike'] },
  { word: 'CHARGER',  clue: 'The cable you can never find',                        hints: ['Plugs into the wall', 'Your phone needs it'] },
  { word: 'STAPLER',  clue: 'The desk tool that binds pages',                      hints: ['Jams at the worst moment', 'Loads with a strip'] },
  { word: 'TROLLEY',  clue: 'What you push around a supermarket',                   hints: ['One wheel always squeaks', 'Needs a coin sometimes'] },
  { word: 'RADIATOR', clue: 'The metal panel that warms a room',                    hints: ['Bled when it gurgles', 'Under the window'] },
  { word: 'CALENDAR', clue: 'What tells you which day it is',                       hints: ['Twelve pages', 'Hangs in the kitchen'] },
];

/* Themes are DISJOINT word sets, so the rotation only has to avoid repeats
   within a theme to avoid them globally. Order is fixed — theme choice is
   `dayNum % CW_THEMES.length`, which also spreads themes evenly. */

/* #176 — four more themes. The bank was 181 words across four themes, which
   the block partition turned into a 36-day no-repeat cycle. Eight themes take
   that to 72 days without touching the rotation logic: CW_BLOCKS is derived
   from the SMALLEST theme, so every theme here carries at least 45 words to
   keep the guarantee intact. */
const CW_NATURE = [
  { word: 'FERN',     clue: 'Shade-loving plant that spreads by spores',          hints: ['No flowers, no seeds', 'Fronds unfurl from a coil'] },
  { word: 'MOSS',     clue: 'Soft green carpet on damp stone',                    hints: ['Grows where it is wet and shady', 'Four letters, doubles the S'] },
  { word: 'HIVE',     clue: 'Where a bee colony lives',                           hints: ['Wax cells in hexagons', 'One queen, many workers'] },
  { word: 'REEF',     clue: 'Underwater ridge built by living creatures',         hints: ['Made of coral skeletons', 'Bleaches when the water warms'] },
  { word: 'TIDE',     clue: 'The sea rising and falling twice a day',             hints: ['Pulled mostly by the moon', 'Comes in and goes out'] },
  { word: 'SILT',     clue: 'Fine sediment a river drops as it slows',            hints: ['Finer than sand, coarser than clay', 'Builds deltas'] },
  { word: 'PEAT',     clue: 'Partly decayed bog vegetation, once burned as fuel',  hints: ['Cut in blocks and dried', 'Bogs store carbon in it'] },
  { word: 'LOAM',     clue: 'The gardener\'s ideal soil blend',                    hints: ['Sand, silt and clay in balance', 'Drains but still holds water'] },
  { word: 'FROST',    clue: 'Ice crystals that form on a cold clear night',       hints: ['Bites tender plants', 'Melts by mid-morning'] },
  { word: 'ROOST',    clue: 'Where birds settle for the night',                   hints: ['Starlings gather in thousands', 'Also a verb'] },
  { word: 'BLOOM',    clue: 'To come into flower',                               hints: ['What a plant does in spring', 'Algae do it too, and less prettily'] },
  { word: 'SWARM',    clue: 'A dense moving mass of insects',                     hints: ['Bees do it when a hive splits', 'Also a verb'] },
  { word: 'SHOAL',    clue: 'A shallow sandbank — or a group of fish',            hints: ['Boats run aground on it', 'Also a word for a fish gathering'] },
  { word: 'CRAG',     clue: 'A steep rugged rock face',                           hints: ['Climbers love them', 'Four letters, starts with C'] },
  { word: 'TALON',    clue: 'The hooked claw of a bird of prey',                  hints: ['An eagle grips with them', 'Not found on a songbird'] },
  { word: 'GEYSER',   clue: 'A spring that erupts boiling water',                 hints: ['Heated by volcanic rock', 'Old Faithful is one'] },
  { word: 'SPAWN',    clue: 'Eggs a fish or frog releases into water',            hints: ['Salmon swim upstream to do it', 'Also a verb'] },
  { word: 'CANOPY',   clue: 'The leafy roof of a forest',                         hints: ['Where most rainforest life lives', 'Blocks light from the floor'] },
  { word: 'HATCH',    clue: 'To break out of an egg',                             hints: ['Chicks use an egg tooth', 'Also a small opening'] },
  { word: 'THICKET',  clue: 'A dense tangle of shrubs',                           hints: ['Hard to push through', 'Good cover for small animals'] },
  { word: 'FORAGE',   clue: 'To search widely for food',                          hints: ['Bees do it for nectar', 'Also what humans call wild picking'] },
  { word: 'BRAMBLE',  clue: 'A thorny shrub that fruits in late summer',          hints: ['Blackberries grow on it', 'Snags your sleeves'] },
  { word: 'TENDRIL',  clue: 'The curling shoot a climbing plant grips with',      hints: ['Peas and vines send them out', 'Coils around whatever it touches'] },
  { word: 'PLANKTON', clue: 'Drifting microscopic life the sea feeds on',         hints: ['Whales strain it from the water', 'Base of the marine food chain'] },
  { word: 'BOULDER',  clue: 'A rock too big to lift',                             hints: ['Often left behind by ice', 'Climbers "problem" them'] },
  { word: 'CAVERN',   clue: 'A large natural chamber underground',                hints: ['Bigger than a cave', 'Stalactites hang in it'] },
  { word: 'RAPIDS',   clue: 'Fast turbulent water over a rocky bed',              hints: ['Graded I to VI', 'Kayakers seek them'] },
  { word: 'MEADOW',   clue: 'Open grassland left to flower',                      hints: ['Cut for hay in late summer', 'Full of bees when it is not'] },
  { word: 'BASALT',   clue: 'Dark volcanic rock that cools into columns',         hints: ['The Giant\'s Causeway is made of it', 'Most of the ocean floor'] },
  { word: 'PUMICE',   clue: 'Volcanic rock so full of bubbles it floats',         hints: ['Used to scrub skin', 'Froth from an eruption'] },
  { word: 'CALDERA',  clue: 'The bowl left when a volcano collapses',             hints: ['Bigger than a crater', 'Often fills with a lake'] },
  { word: 'AURORA',   clue: 'Coloured light show near the poles',                 hints: ['Solar wind hitting the atmosphere', 'Borealis or australis'] },
  { word: 'EROSION',  clue: 'The slow wearing away of land',                      hints: ['Wind, water and ice do it', 'The opposite of deposition'] },
  { word: 'WOODLAND', clue: 'Land covered with trees, lighter than a forest',     hints: ['Sunlight still reaches the floor', 'Bluebells grow in it'] },
  { word: 'PREDATOR', clue: 'An animal that hunts others for food',               hints: ['Sits above prey in the chain', 'Wolves and hawks qualify'] },
  { word: 'NECTAR',   clue: 'Sugary liquid flowers offer pollinators',            hints: ['Bees turn it into honey', 'The bribe in the deal'] },
  { word: 'POLLEN',   clue: 'Fine powder plants use to fertilise',                hints: ['Carried by wind or insects', 'Triggers hay fever'] },
  { word: 'BURROW',   clue: 'A tunnel an animal digs to live in',                 hints: ['Rabbits and badgers make them', 'Also a verb'] },
  { word: 'PLUMAGE',  clue: 'A bird\'s covering of feathers',                      hints: ['Often brighter in males', 'Moulted and regrown'] },
  { word: 'ANTLER',   clue: 'Bone headgear a deer grows and sheds',               hints: ['Not a horn — it drops each year', 'Branches as the animal ages'] },
  { word: 'COCOON',   clue: 'Silk case a larva spins to transform inside',        hints: ['Moths make them', 'Metamorphosis happens within'] },
  { word: 'MIGRATE',  clue: 'To travel seasonally between ranges',                hints: ['Swallows and wildebeest do it', 'Following food and warmth'] },
  { word: 'SAPLING',  clue: 'A young slender tree',                               hints: ['Older than a seedling', 'Bends in the wind'] },
  { word: 'LICHEN',   clue: 'Fungus and alga living as one crust',                hints: ['Grows on bare rock', 'An indicator of clean air'] },
  { word: 'HOLLOW',   clue: 'A cavity in a tree where animals nest',              hints: ['Owls and squirrels use them', 'Also means empty'] },
];

const CW_KITCHEN = [
  { word: 'ZEST',     clue: 'Grated citrus peel used for flavour',                hints: ['Only the coloured layer', 'Avoid the bitter white pith'] },
  { word: 'WHISK',    clue: 'Wire tool for beating air into a mixture',           hints: ['Balloon-shaped, usually', 'Turns cream into peaks'] },
  { word: 'KNEAD',    clue: 'To work dough with your hands',                      hints: ['Develops gluten', 'Ten minutes by hand'] },
  { word: 'PROOF',    clue: 'To let dough rise before baking',                    hints: ['Yeast doing its work', 'Somewhere warm and covered'] },
  { word: 'SEAR',     clue: 'To brown a surface fast in high heat',               hints: ['Builds crust and flavour', 'Does not "seal in juices"'] },
  { word: 'BASTE',    clue: 'To spoon cooking juices back over a roast',          hints: ['Keeps the surface moist', 'Every twenty minutes or so'] },
  { word: 'BRINE',    clue: 'Salt water used to season and tenderise',            hints: ['Turkeys are soaked in it', 'Also preserves pickles'] },
  { word: 'BLANCH',   clue: 'To boil briefly then plunge into ice water',         hints: ['Sets the colour of greens', 'Stops the cooking dead'] },
  { word: 'DEGLAZE',  clue: 'To lift browned bits from a pan with liquid',        hints: ['Wine or stock, usually', 'The start of a pan sauce'] },
  { word: 'REDUCE',   clue: 'To simmer a liquid down and concentrate it',         hints: ['Evaporating water', 'Thickens without flour'] },
  { word: 'FOLD',     clue: 'To combine gently without knocking out air',         hints: ['A spatula and a light hand', 'How you treat whipped egg white'] },
  { word: 'SIMMER',   clue: 'To cook just below boiling',                         hints: ['Small bubbles, not a rolling boil', 'Gentler than boiling'] },
  { word: 'BRAISE',   clue: 'To brown then cook slowly in a little liquid',       hints: ['Lid on, low oven', 'Turns tough cuts tender'] },
  { word: 'POACH',    clue: 'To cook gently submerged in barely-moving liquid',   hints: ['Eggs and fish suit it', 'No bubbles at all, ideally'] },
  { word: 'GRATE',    clue: 'To shred food against a rough surface',              hints: ['Cheese and carrots', 'Box-shaped tool'] },
  { word: 'MINCE',    clue: 'To chop very finely',                                hints: ['Garlic gets this treatment', 'Smaller than a dice'] },
  { word: 'JULIENNE', clue: 'To cut into thin matchsticks',                       hints: ['A French knife cut', 'Carrots for a stir-fry'] },
  { word: 'MARINADE', clue: 'A seasoned liquid food soaks in before cooking',     hints: ['Acid, oil and aromatics', 'Hours, not minutes'] },
  { word: 'EMULSION', clue: 'Two liquids that will not normally mix, made to',    hints: ['Mayonnaise is one', 'Oil suspended in water'] },
  { word: 'ROUX',     clue: 'Cooked flour and fat used to thicken',               hints: ['White, blond or brown', 'The base of a béchamel'] },
  { word: 'STOCK',    clue: 'Savoury liquid simmered from bones and vegetables',  hints: ['The backbone of soup', 'Skim the scum off'] },
  { word: 'GLAZE',    clue: 'A shiny coating brushed onto food',                  hints: ['Egg wash on pastry', 'Sugar syrup on a ham'] },
  { word: 'CURDLE',   clue: 'To separate into solids and liquid, unwanted',       hints: ['Too much heat on eggs', 'Or acid in milk'] },
  { word: 'TEMPER',   clue: 'To raise a mixture\'s heat slowly to stop it seizing', hints: ['Eggs into hot cream', 'Also done to chocolate'] },
  { word: 'SKILLET',  clue: 'A heavy frying pan, often cast iron',                hints: ['Goes from hob to oven', 'Seasoned, not scrubbed'] },
  { word: 'COLANDER', clue: 'A perforated bowl for draining',                     hints: ['Pasta goes into it', 'Holes all over'] },
  { word: 'RAMEKIN',  clue: 'A small round dish for individual portions',         hints: ['Soufflés bake in them', 'Ceramic and ridged'] },
  { word: 'DECANT',   clue: 'To pour off a liquid, leaving sediment behind',      hints: ['Wine into a carafe', 'Slowly and steadily'] },
  { word: 'SIEVE',    clue: 'A mesh tool for separating or aerating',             hints: ['Flour goes through it', 'Also called a strainer'] },
  { word: 'PESTLE',   clue: 'The club you grind with in a mortar',                hints: ['Spices and garlic', 'Its partner is the bowl'] },
  { word: 'CLEAVER',  clue: 'A heavy square-bladed knife',                        hints: ['For bones and hard squash', 'Chops with weight, not edge'] },
  { word: 'SKEWER',   clue: 'A thin spike food is threaded onto',                 hints: ['Soak the wooden ones', 'Kebabs need them'] },
  { word: 'LADLE',    clue: 'A deep-bowled long-handled spoon',                   hints: ['For soup and stew', 'Hangs on the pot'] },
  { word: 'TONGS',    clue: 'Hinged arms for gripping hot food',                  hints: ['Better than a fork for steak', 'Comes as a pair'] },
  { word: 'SPATULA',  clue: 'A flat tool for lifting or scraping',                hints: ['Turns pancakes', 'Silicone or metal'] },
  { word: 'GRIDDLE',  clue: 'A flat cooking surface with no sides',               hints: ['Pancakes and flatbreads', 'Sometimes ridged'] },
  { word: 'CARAMEL',  clue: 'What sugar becomes when heated until brown',         hints: ['One degree from burnt', 'Amber and bitter-sweet'] },
  { word: 'MERINGUE', clue: 'Whipped egg white and sugar, baked crisp',           hints: ['Peaks that hold their shape', 'Pavlova is built on it'] },
  { word: 'BATTER',   clue: 'A thin pourable flour mixture',                      hints: ['Pancakes and tempura', 'Thinner than dough'] },
  { word: 'PASTRY',   clue: 'Dough of flour and fat, baked',                      hints: ['Short, flaky or choux', 'Keep the butter cold'] },
  { word: 'YEAST',    clue: 'The living organism that makes bread rise',          hints: ['Eats sugar, gives off gas', 'Fresh, dried or wild'] },
  { word: 'CRUMB',    clue: 'The soft inside of a loaf',                          hints: ['Judged by its holes', 'The opposite of the crust'] },
  { word: 'SCALD',    clue: 'To heat milk to just below boiling',                 hints: ['Kills enzymes for baking', 'A skin forms on top'] },
  { word: 'INFUSE',   clue: 'To steep a flavouring in warm liquid',               hints: ['Vanilla in cream', 'Time does the work'] },
  { word: 'SEASON',   clue: 'To add salt, pepper and aromatics — or to cure a pan', hints: ['The most common cooking fix', 'Two meanings in one kitchen'] },
];

const CW_THEMES = [
  { name: 'Crypto & finance', words: CW_WORDS },
  { name: 'Science',          words: CW_SCIENCE },
  { name: 'Geography',        words: CW_GEOGRAPHY },
  { name: 'Everyday objects', words: CW_EVERYDAY },
  { name: 'Nature',           words: CW_NATURE },
  { name: 'The kitchen',      words: CW_KITCHEN },
];
// Fixed rounds per day: a varying count made the cycle maths unverifiable, and
// 5 is the middle of the old 4–7 range.
const CW_ROUNDS_PER_DAY = 5;
// Blocks available in the smallest theme — the binding constraint on the cycle.
const CW_BLOCKS = Math.min(...CW_THEMES.map(t => Math.floor(t.words.length / CW_ROUNDS_PER_DAY)));
// Days before ANY word can recur — a SLIDING guarantee, not just an aligned one
// (see cwRoundsForDay). 4 themes x 9 blocks = 36 days.
const CW_CYCLE_LEN = CW_BLOCKS * CW_THEMES.length;

// Fisher-Yates over the shared mulberry32 family — same PRNG as every other
// daily, so this is reproducible on any device without server state.
function cwSeededShuffle(arr, seed) {
  const out = arr.slice();
  const rng = mulberry32(seed >>> 0);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = out[i]; out[i] = out[j]; out[j] = t;
  }
  return out;
}

/* The day's words, purely from the UTC day number.

   PARTITION, not sampling. Each theme is shuffled ONCE (fixed seed) and cut
   into CW_ROUNDS_PER_DAY-sized blocks; day N takes block (N/nThemes) mod
   blocks. Because the slot index just walks the blocks cyclically, ANY window
   of CW_CYCLE_LEN consecutive days touches each theme's blocks at most once —
   a *sliding* no-repeat guarantee, which is what a player actually experiences.

   An earlier version reshuffled per cycle to also vary which words appear
   together. That broke the sliding property at every cycle boundary (a window
   straddling two shuffles could repeat a word days apart), so it was dropped:
   the fixed partition is the property worth having, and the visible fix for
   #138 is the 180-word four-theme pool. */
function cwRoundsForDay(dayNum) {
  const n = CW_THEMES.length;
  const themeIdx = ((dayNum % n) + n) % n;
  const theme = CW_THEMES[themeIdx];
  const dayInTheme = Math.floor(dayNum / n);
  const blocks = Math.max(1, Math.floor(theme.words.length / CW_ROUNDS_PER_DAY));
  const slot = ((dayInTheme % blocks) + blocks) % blocks;
  const shuffled = cwSeededShuffle(theme.words, hashStr('cw-rotation:' + themeIdx));
  return shuffled.slice(slot * CW_ROUNDS_PER_DAY, slot * CW_ROUNDS_PER_DAY + CW_ROUNDS_PER_DAY);
}

function cwThemeForDay(dayNum) {
  const n = CW_THEMES.length;
  return CW_THEMES[((dayNum % n) + n) % n].name;
}

/* One block of the partition, named by theme and slot. cwRoundsForDay picks
   its block from the day; the mode picker below picks one from a mode seed.
   Both go through here so a story or arcade set is drawn from the SAME curated
   partition the daily uses — five words that were shuffled together once, not
   five sampled at random from 271. */
function cwBlockAt(themeIdx, slot) {
  const n = CW_THEMES.length;
  const ti = ((themeIdx % n) + n) % n;
  const theme = CW_THEMES[ti];
  const blocks = Math.max(1, Math.floor(theme.words.length / CW_ROUNDS_PER_DAY));
  const si = ((slot % blocks) + blocks) % blocks;
  const shuffled = cwSeededShuffle(theme.words, hashStr('cw-rotation:' + ti));
  return {
    theme: theme.name,
    words: shuffled.slice(si * CW_ROUNDS_PER_DAY, si * CW_ROUNDS_PER_DAY + CW_ROUNDS_PER_DAY),
  };
}

/* #195 — the words a MODE serves.

   Daily Cipher never learned about play modes. #176 gave it story rungs and
   arcade bands and passed playMode/band down like every other game, but this
   component's signature never took them: every mode called cwDailyRounds, so
   the daily, all six story rungs and all three arcade bands served the SAME
   five words on the same day. That is the report's "the same 5 questions
   repeat across Daily mode, the 6 Story levels, and all Arcade modes" — not a
   thin corpus (there are 271 words on a 54-day sliding rotation), but every
   door opening onto the same room.

   The daily is untouched and must stay so: it is the shared board, and its
   leaderboard and share cards depend on everyone getting the same five words.

   Story and arcade go through modeSeed, which is the one place that decides
   stable-vs-fresh (see CLAUDE.md): a story rung draws the same block every
   visit, so it stays a rung you can retry, and an arcade run draws a new one
   each time. */
function cwRoundsForMode(playMode, band, offset) {
  if (playMode !== 'story' && playMode !== 'arcade') {
    // #331 — the daily's difficulty band: same theme, a different block of
    // the SAME partition, steered by average word length. The rotation, the
    // theme and the un-banded block are all untouched.
    const dailyBand = cwDailyBandFor(band);
    return {
      theme: cwThemeForDay(cwDayNum(offset)),
      words: dailyBand ? cwBandBlockFor(cwDayNum(offset), dailyBand) : cwDailyRounds(offset),
    };
  }
  const rung = playMode === 'story' ? (band || 0) : 0;
  const { rng } = modeSeed(playMode, 'cryptowordle', rung, offset);
  /* #331 (part 2) — the arcade band was decorative here: modeSeed draws a
     fresh block per run, so Easy and Hard served the same distribution of
     words and the band changed nothing a player could feel. The band now
     steers WHICH block a fresh draw lands on — Easy picks the shortest-worded
     of six candidates, Hard the longest. The guess dial below follows the
     same band. */
  if (playMode === 'arcade' && (band === 'easy' || band === 'hard')) {
    let best = null, bestAvg = -1;
    for (let k = 0; k < 6; k++) {
      const blk = cwBlockAt(Math.floor(rng() * CW_THEMES.length), Math.floor(rng() * 1e6));
      const avg = blk.words.reduce((a, w) => a + w.length, 0) / blk.words.length;
      if (bestAvg < 0 || (band === 'easy' ? avg < bestAvg : avg > bestAvg)) { best = blk; bestAvg = avg; }
    }
    return best;
  }
  return cwBlockAt(Math.floor(rng() * CW_THEMES.length), Math.floor(rng() * 1e6));
}

/* #331 — the daily's difficulty band, from the band prop (a string on the
   daily path; story/arcade pass numbers, which never equal 'easy'/'hard'). */
function cwDailyBandFor(band) {
  return (band === 'easy' || band === 'hard') ? band : null;
}

/* The band's block: the day's theme, the block of the fixed partition whose
   average word length is the SHORTEST (Easy) or LONGEST (Hard). Scanning the
   same shuffle the day's own block came from keeps every band's words inside
   the curated 5-word blocks and the sliding no-repeat guarantee intact. */
function cwBandBlockFor(dayNum, dailyBand) {
  const n = CW_THEMES.length;
  const themeIdx = ((dayNum % n) + n) % n;
  const theme = CW_THEMES[themeIdx];
  const blocks = Math.max(1, Math.floor(theme.words.length / CW_ROUNDS_PER_DAY));
  const shuffled = cwSeededShuffle(theme.words, hashStr('cw-rotation:' + themeIdx));
  let best = 0;
  let bestAvg = -1;
  for (let b = 0; b < blocks; b++) {
    const block = shuffled.slice(b * CW_ROUNDS_PER_DAY, b * CW_ROUNDS_PER_DAY + CW_ROUNDS_PER_DAY);
    const avg = block.reduce((a, w) => a + w.length, 0) / block.length;
    if (bestAvg < 0 || (dailyBand === 'easy' ? avg < bestAvg : avg > bestAvg)) {
      best = b; bestAvg = avg;
    }
  }
  return shuffled.slice(best * CW_ROUNDS_PER_DAY, best * CW_ROUNDS_PER_DAY + CW_ROUNDS_PER_DAY);
}

// Guesses allowed for a given word length: one more than the length, so a
// 3-letter word gives 4 tries and an 8-letter word gives 9. Single knob.
const cwMaxGuesses = (wordLen) => wordLen + 1;

// #331 — the band's guess dial: one EXTRA guess on Easy, one FEWER on Hard
// (floored at 2 — a word you get one shot at is not a puzzle). cwRoundPoints
// deliberately stays on the BASE cap above: the points table must not need to
// know a band exists, and an extra Easy guess already bottoms out at its
// 60-point floor.
const cwBandGuessDelta = (dailyBand) => dailyBand === 'easy' ? 1 : dailyBand === 'hard' ? -1 : 0;
const cwMaxGuessesFor = (wordLen, dailyBand) =>
  Math.max(2, cwMaxGuesses(wordLen) + cwBandGuessDelta(dailyBand));

const CW_EMOJI = { green: '🟩', yellow: '🟨', gray: '⬛' };
const CW_KEYS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

// UTC day number, anchored to server time (offset = serverNow − clientNow),
// so the daily word can't desync from the lock countdown on a skewed clock.
function cwDayNum(offset) {
  const d = new Date(Date.now() + (offset || 0));
  return Math.floor(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000
  );
}

// Standard two-pass Wordle coloring (handles duplicate letters): greens
// first, consuming a tally of the answer's letters; then yellows only while
// an unconsumed copy of the letter remains, else gray.
function cwScoreGuess(guess, answer) {
  const len = answer.length;
  const res = Array(len).fill('gray');
  const counts = {};
  for (let i = 0; i < len; i++) counts[answer[i]] = (counts[answer[i]] || 0) + 1;
  for (let i = 0; i < len; i++) {
    if (guess[i] === answer[i]) { res[i] = 'green'; counts[guess[i]]--; }
  }
  for (let i = 0; i < len; i++) {
    if (res[i] === 'green') continue;
    if (counts[guess[i]] > 0) { res[i] = 'yellow'; counts[guess[i]]--; }
  }
  return res;
}

/* #193 — the third and fourth clue, DERIVED rather than written.

   The "2-hint ceiling" the report hit is not a number anyone chose: every one
   of the 271 corpus entries ships exactly two hand-written hints, and the Hint
   button reads `activeHints.length`, so two is simply all a word has. Raising a
   cap would change nothing — there is no third clue to reveal.

   Hand-writing a third for 271 words would be 271 lines of invented copy that
   nobody can review against the puzzle. These are derived from the answer
   instead, so every word gains them for free and they cannot contradict it.
   They also escalate correctly: the two written clues are semantic ("what is
   this thing"), and when those have not been enough the next help a stuck
   player wants is structural.

   EVERY word of three letters or more carries BOTH derived clues, so the
   per-word clue count is uniform (four) however long today's words run. A
   short first word used to offer only three — the day's board read as a
   different game, with a smaller hint budget nobody had chosen.

   The second clue for a short word is therefore NOT the last letter. Giving
   first AND last of a 4-letter word leaves two, which is not a clue any
   more, and of a 3-letter word leaves one. Short words get the answer's
   repetition status instead: whether a letter appears more than once. That
   is real structural help — on a 3-letter word it is the difference between
   EEL and NET — and it never spells anything. */
function cwDerivedHints(word) {
  const w = String(word || '').toUpperCase();
  if (w.length < 3) return [];
  const out = [`It starts with "${w[0]}".`];
  if (w.length >= 5) {
    out.push(`It ends with "${w[w.length - 1]}".`);
  } else {
    const counts = {};
    for (const ch of w) counts[ch] = (counts[ch] || 0) + 1;
    const repeats = Object.keys(counts).some(ch => counts[ch] > 1);
    out.push(repeats ? 'A letter appears more than once.' : 'No letter appears more than once.');
  }
  return out;
}

// Multi-word daily puzzle: each UTC day is a deterministic stack of independent
// words, identical for every player. Count is now fixed (CW_ROUNDS_PER_DAY) and
// the words come from the themed rotation above — see the #138 note there.
const CW_MIN_ROWS = 4;
const CW_MAX_ROWS = 7;

// Points banked for solving one word in `attemptsUsed` tries. Fewer attempts and
// longer words score more. Missed words score 0. Single formula, easy to retune.
const cwRoundPoints = (wordLen, attemptsUsed) =>
  Math.max((cwMaxGuesses(wordLen) + 1 - attemptsUsed) * 60, 60) + wordLen * 10;

// The day's ordered list of word entries ({ word, clue, hints }). Deterministic
// from the server-anchored UTC day, so it's identical for everyone (fair board).
function cwDailyRounds(offset) {
  // Anchored to the server-issued UTC day, not the daily PRNG stream: the
  // rotation IS the fairness guarantee (everyone on day N gets block N), and
  // deriving it from the day number is what makes "no repeat within a cycle"
  // provable rather than probabilistic.
  return cwRoundsForDay(cwDayNum(offset));
}

/* CwBoardCanvas was absorbed into CryptoWordleGame's single frame canvas
   (controls wave) — pills, theme, tracker, clues, hint bar, guess grid and
   the keyboard all draw together; see the frame block in the component. */

/* Screenshot-state + regression deep link: `?cwtype=LEND-`.
   dapp.json checks can only NAVIGATE — they never tap — so the double-input
   bug ("one tap types two letters") was invisible to every check we had. This
   replays a REAL touch pointer sequence (pointerdown -> pointerup -> compat
   click, exactly what a phone dispatches) against the frame canvas at each
   drawn key's position, so the guess row ends up holding the typed string and
   a check can assert on it via `.cw-board[data-cw-typed="LEND"]`. A `-` means
   backspace. Writes nothing — typing never claims, saves or submits — so it
   is safe in every environment (the "before" screenshot comes from
   production). */
function cwTypeScript() {
  try {
    const raw = new URLSearchParams(window.location.search).get('cwtype') || '';
    return raw.toUpperCase().replace(/[^A-Z-]/g, '').slice(0, 20);
  } catch (e) { return ''; }
}

/* #194's companion fixture: `?cwsubmit=N&practice=1` plays N deterministic
   WRONG guesses so a route can reach a board that has feedback on it at all.
   `?cwtype=` deliberately never submits, and it cannot be made to: the guess
   it types is a fixed string, so on a day whose first word is a different
   length it would not be submittable anyway.

   This submits a filler of the ACTIVE word's own length instead, so it works
   on every day's board rather than on the days a hard-coded word happens to
   fit. Without it the before/after screenshots of a feedback-colour change
   are two pictures of an empty grid.

   PRACTICE ONLY, and that is the whole safety argument: a real guess spends
   one of the day's attempts, and practiceMode is the app's existing inert
   path (App short-circuits handleWin/handleLose and suppresses saves before
   any endpoint). Off the practice route this returns 0 and nothing happens. */
function cwSubmitScript() {
  try {
    const p = new URLSearchParams(window.location.search);
    if (p.get('practice') !== '1') return 0;
    const n = parseInt(p.get('cwsubmit') || '0', 10);
    return Number.isFinite(n) ? Math.max(0, Math.min(3, n)) : 0;
  } catch (e) { return 0; }
}
// The filler letter. Q is the rarest letter in the corpus, so a filler row is
// almost always all-wrong — which is the state this fixture exists to show.
const CW_FILLER_CH = 'Q';

function cwSimulateTouchTapAt(el, clientX, clientY) {
  const opts = {
    bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 1,
    isPrimary: true, clientX, clientY,
  };
  const PE = window.PointerEvent;
  const fire = (type) => {
    let ev;
    try { ev = PE ? new PE(type, opts) : new MouseEvent(type, opts); }
    catch (e) { ev = new MouseEvent(type, opts); }
    if (!('pointerType' in ev)) { try { Object.defineProperty(ev, 'pointerType', { value: 'touch' }); } catch (e2) {} }
    el.dispatchEvent(ev);
  };
  fire('pointerdown');
  fire('pointerup');
  // The browser's compatibility click, which is the half that used to double
  // on the DOM keyboard. The canvas has no click handler, so it must no-op.
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX, clientY }));
}

function CryptoWordleGame({ onWin, onLose, onStepChange, offset, savedProgress, onSaveProgress, playMode, band }) {
  const dayNum = useRef(cwDayNum(offset)).current;
  /* The stack of independent word rounds for THIS mode, stable for the render
     lifetime (#195). The daily is unchanged; story and arcade draw their own
     block so they are no longer the daily wearing a different hat. */
  const modeSet = useRef(cwRoundsForMode(playMode, band, offset)).current;
  const roundsDef = modeSet.words;
  // #331 — the difficulty band this run plays (null off daily/arcade, where
  // the band never lands). Steers the guess allowance and, on the daily, the
  // block itself (see cwRoundsForMode).
  const bandDial = playMode === 'daily' || playMode === 'arcade'
    ? cwDailyBandFor(band) : null;
  const maxGFor = (wordLen) => cwMaxGuessesFor(wordLen, bandDial);

  // Resume only today's saved progress (multi-round shape). Board is re-derived
  // from the seed; we persist only the mutable per-round guess words + hint use.
  const resumed = savedProgress && savedProgress.dayNum === dayNum && Array.isArray(savedProgress.rounds)
    ? savedProgress
    : null;
  const initRoundGuesses = () => roundsDef.map((rd, i) => {
    const words = resumed && Array.isArray(resumed.rounds[i]) ? resumed.rounds[i] : [];
    return words
      .filter(w => typeof w === 'string' && w.length === rd.word.length)
      .slice(0, maxGFor(rd.word.length))
      .map(w => ({ word: w, result: cwScoreGuess(w, rd.word) }));
  });
  const initHintsByRound = () => roundsDef.map((_, i) =>
    resumed && Array.isArray(resumed.hintsByRound) && Number.isFinite(resumed.hintsByRound[i])
      ? resumed.hintsByRound[i] : 0
  );

  // roundGuesses[i] = [{ word, result }]; hintsByRound[i] = paid hints applied to round i.
  const [roundGuesses, setRoundGuesses] = useState(initRoundGuesses);
  const [hintsByRound, setHintsByRound] = useState(initHintsByRound);
  const [cur, setCur] = useState('');
  const [shake, setShake] = useState(false);
  const [done, setDone] = useState(false);
  const initialSecs = savedProgress && Number.isFinite(savedProgress.elapsedSecs) ? savedProgress.elapsedSecs : 0;
  const { secs, fmt } = useTimer(!done, initialSecs);

  // Derive per-round status (solved / missed / active) from the submitted guesses.
  const resolveRounds = (guessArrays) => roundsDef.map((rd, i) => {
    const gs = guessArrays[i] || [];
    const maxG = maxGFor(rd.word.length);
    const solved = gs.length > 0 && gs[gs.length - 1].word === rd.word;
    const missed = !solved && gs.length >= maxG;
    return { def: rd, guesses: gs, maxG, solved, missed, resolved: solved || missed };
  });
  const roundState = resolveRounds(roundGuesses);
  const activeIdx = roundState.findIndex(r => !r.resolved);
  const allResolved = activeIdx === -1;
  const active = activeIdx >= 0 ? roundState[activeIdx] : null;

  const solvedCount = roundState.filter(r => r.solved).length;
  const totalScore = roundState.reduce(
    (a, r) => a + (r.solved ? cwRoundPoints(r.def.word.length, r.guesses.length) : 0), 0
  );
  const totalSteps = roundGuesses.reduce((a, g) => a + (g ? g.length : 0), 0);

  const buildProgress = (guessArrays, hbr) => ({
    dayNum,
    rounds: guessArrays.map(gs => (gs || []).map(g => g.word)),
    hintsByRound: hbr,
  });

  // Idle/leave autosave; per-guess + per-purchase saves happen inline.
  const stateRef = useRef({});
  stateRef.current = { roundGuesses, hintsByRound, secs };
  useAutosave(
    onSaveProgress,
    () => ({
      progress: buildProgress(stateRef.current.roundGuesses, stateRef.current.hintsByRound),
      steps: stateRef.current.roundGuesses.reduce((a, g) => a + (g ? g.length : 0), 0),
      secs: stateRef.current.secs,
    }),
    !done
  );

  // Hint state. Hints are FREE (the MATCH currency is retired) but
  // hintsPurchased stays a server-authoritative DAILY count so a reload can't
  // reset it and the server-side cap still applies.
  const [hintsPurchased, setHintsPurchased] = useState(0);
  const [buying, setBuying] = useState(false);
  const [hintMsg, setHintMsg] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      const { ok, body } = await api('/api/cryptowordle/hint');
      if (!alive || !ok || !body) return;
      if (Number.isFinite(body.hintsPurchased)) setHintsPurchased(body.hintsPurchased);
    })();
    return () => { alive = false; };
  }, []);

  // Per-round clue reveal: wrong guesses in THIS round + hints applied to it,
  // capped at the round's available clues. Cost ramp is global across rounds.
  /* Written clues first, derived ones after — the order IS the escalation, and
     revealedExtra walks it from the front. */
  const activeHints = active
    ? [...(active.def.hints || []), ...cwDerivedHints(active.def.word)]
    : [];
  const activeWrong = active ? active.guesses.filter(g => g.word !== active.def.word).length : 0;
  const activeHintsApplied = active ? (hintsByRound[activeIdx] || 0) : 0;
  const revealedExtra = active ? Math.min(activeWrong + activeHintsApplied, activeHints.length) : 0;
  const cluesLeft = activeHints.length - revealedExtra;
  // Daily cap sent to the server: total clues available across all rounds.
  const dailyClueTotal = roundsDef.reduce((a, rd) => a + (rd.hints ? rd.hints.length : 0), 0);

  const buyHint = async () => {
    if (buying || done || !active || cluesLeft <= 0) return;
    setBuying(true);
    setHintMsg('');
    const { ok, status, body } = await api('/api/cryptowordle/hint', {
      method: 'POST',
      body: JSON.stringify({ maxHints: dailyClueTotal }),
    });
    setBuying(false);
    if (ok && body) {
      if (Number.isFinite(body.hintsPurchased)) setHintsPurchased(body.hintsPurchased);
      // Apply the revealed clue to the active round and persist immediately so a
      // reload can't lose a reveal while the server counter already advanced.
      const nextHbr = hintsByRound.map((n, i) => (i === activeIdx ? (n || 0) + 1 : n));
      setHintsByRound(nextHbr);
      onSaveProgress && onSaveProgress(buildProgress(roundGuesses, nextHbr), totalSteps, secs);
      return;
    }
    if (status === 409 && body && body.code === 'no_more_hints') {
      setHintMsg('No more clues');
    } else {
      setHintMsg('Could not use hint');
    }
  };

  // Spoiler-free multi-word share: one line per word (✅/❌ + blank squares).
  const buildShare = (rs) => {
    const lines = [`Daily Cipher #${dayNum} — ${rs.filter(r => r.solved).length}/${rs.length} · ${totalScore} pts`];
    rs.forEach(r => {
      lines.push((r.solved ? '✅ ' : '❌ ') + (r.solved ? '🟩' : '⬛').repeat(r.def.word.length));
    });
    return lines.join('\n');
  };

  const finishIfDone = (nextRoundState) => {
    if (nextRoundState.some(r => !r.resolved)) return false;
    setDone(true);
    const share = buildShare(nextRoundState);
    const solved = nextRoundState.filter(r => r.solved).length;
    const total = nextRoundState.length;
    const pts = nextRoundState.reduce(
      (a, r) => a + (r.solved ? cwRoundPoints(r.def.word.length, r.guesses.length) : 0), 0
    );
    const meta = { share, hintsUsed: hintsPurchased, wordsSolved: solved, wordsTotal: total };
    if (pts > 0) onWin(pts, totalSteps + 1, secs, meta);
    else onLose(totalSteps + 1, secs, meta);
    return true;
  };

  // Best color per letter for the active round's keyboard tinting.
  const keyState = {};
  const rank = { gray: 0, yellow: 1, green: 2 };
  if (active) {
    for (const g of active.guesses) {
      for (let i = 0; i < active.def.word.length; i++) {
        const ch = g.word[i], c = g.result[i];
        if (!(ch in keyState) || rank[c] > rank[keyState[ch]]) keyState[ch] = c;
      }
    }
  }

  const submit = () => {
    if (done || !active) return;
    const answer = active.def.word;
    const wordLen = answer.length;
    if (cur.length !== wordLen) {
      setShake(true);
      setTimeout(() => setShake(false), 400);
      return;
    }
    const result = cwScoreGuess(cur, answer);
    const newRoundGuesses = roundGuesses.map((g, i) =>
      i === activeIdx ? [...(g || []), { word: cur, result }] : g
    );
    setRoundGuesses(newRoundGuesses);
    setCur('');
    const steps = newRoundGuesses.reduce((a, g) => a + (g ? g.length : 0), 0);
    onStepChange(steps);
    onSaveProgress && onSaveProgress(buildProgress(newRoundGuesses, hintsByRound), steps, secs);
    finishIfDone(resolveRounds(newRoundGuesses));
  };

  // Functional updates: the length cap is evaluated against the LIVE value, so
  // even if two calls ever land in one batch the word can never overflow its
  // boxes (the visible symptom of the double-input bug).
  const maxLen = active ? active.def.word.length : 0;
  const typeLetter = (ch) => {
    if (done || !active) return;
    setCur((prev) => (prev.length < maxLen ? prev + ch : prev));
  };
  const backspace = () => {
    if (done) return;
    setCur((prev) => prev.slice(0, -1));
  };

  // Physical keyboard, dispatched through a ref so each keypress runs the latest closure.
  const apiRef = useRef({});
  apiRef.current = { submit, typeLetter, backspace };
  useEffect(() => {
    const onKey = (e) => {
      // Held keys auto-repeat: one PRESS must be one letter, so ignore repeats
      // (and any modifier combo, which is a browser shortcut, not a guess).
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      // #192 — the device-keyboard input owns every key it receives. Letting
      // this run too would type each letter twice, which is exactly the shape
      // of #one-tap-two-letters in a different costume.
      if (hidRef.current && e.target === hidRef.current) return;
      // Enter/Space on a FOCUSED on-screen key already fires that button's own
      // click. Running the window handler too would submit AND type from one
      // press, so let the button own those two keys while it has focus.
      const inKbd = e.target && e.target.closest && e.target.closest('.cui-twin');
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        if (inKbd) return;
        if (e.key === 'Enter') { e.preventDefault(); apiRef.current.submit(); }
        return;
      }
      if (e.key === 'Backspace') { e.preventDefault(); apiRef.current.backspace(); return; }
      const ch = (e.key || '').toUpperCase();
      if (ch.length === 1 && ch >= 'A' && ch <= 'Z') apiRef.current.typeLetter(ch);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // `?cwtype=` — replay real touch taps once the drawn keyboard is on screen.
  // Keys are canvas controls now, so each tap is a coordinate-carrying pointer
  // sequence at the key's drawn rect, through the same usePointerCell ->
  // cuiWrapHandlers path a finger takes (twin buttons are the CLICK path and
  // would sidestep the hit-test this exists to regress).
  useEffect(() => {
    const script = cwTypeScript();
    if (!script) return;
    let tries = 0, timer = null, cancelled = false;
    const run = () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      const hasKeys = ctlRef.current.some((c) => c.id === 'bksp');
      if (!canvas || !hasKeys) {
        if (tries++ < 40) timer = setTimeout(run, 50);
        return;
      }
      for (const ch of script) {
        const id = ch === '-' ? 'bksp' : 'k' + ch;
        const c = ctlRef.current.find((k) => k.id === id);
        if (!c) continue;
        const rect = canvas.getBoundingClientRect();
        const scale = rect.width / (parseFloat(canvas.style.width) || rect.width);
        cwSimulateTouchTapAt(
          canvas,
          rect.left + (c.r[0] + c.r[2] / 2) * scale,
          rect.top + (c.r[1] + c.r[3] / 2) * scale
        );
      }
    };
    timer = setTimeout(run, 60);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);

  /* `?cwsubmit=N` (practice only) — see cwSubmitScript. It goes through the
     same `submit` the Enter key calls, via the ref, so the guess is scored,
     rendered and keyboard-tinted by exactly the code a player exercises. One
     pass per round-state change, guarded by a ref so a re-render cannot
     replay a guess that has already been spent. */
  const cwFillRef = useRef(0);
  useEffect(() => {
    const want = cwSubmitScript();
    if (!want || cwFillRef.current >= want) return;
    if (!active || done) return;
    cwFillRef.current += 1;
    const t = setTimeout(() => {
      const len = active.def.word.length;
      setCur(CW_FILLER_CH.repeat(len));
      setTimeout(() => apiRef.current.submit(), 40);
    }, 120);
    return () => clearTimeout(t);
  }, [activeIdx, roundGuesses]);

  const wordLen = active ? active.def.word.length : 5;
  const maxGuesses = active ? active.maxG : 6;
  const boardWidth = Math.min(wordLen * 52, 440);

  /* ---- The whole frame is ONE canvas (controls wave) --------------------
     Pills, theme line, round tracker, clue prose (wrapped on canvas), hint
     bar, the guess grid AND the keyboard draw together; the hardware
     keyboard listener above still types. CuiTwin carries every key. */
  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const { boxW, boxH } = useFitBox(boxRef, { cols: 1, rows: 1, maxCell: 100000 });
  const W = Math.floor(boxW);
  /* #191 — the chrome has to give way before the board clips.
     Every one of these was a fixed pixel height, so on a short viewport the
     chrome alone (a 146px keyboard, the pills, the theme line, the track and
     the clue) plus the board's own 20px-per-tile floor came to 524px whatever
     the space actually was. `.cw-board` is `overflow: hidden`, so the excess
     was simply cut off — 43px lost at 360x640, 115px at 360x568, and the
     bottom keyboard row with it. The board stopped shrinking and started
     disappearing instead.

     The keyboard is by far the biggest block, so it is the one that scales;
     the pill row follows it down a little. Below the reference height they
     shrink in proportion, floored at a still-tappable size, which buys the
     board enough room to fit rather than clip. `.fit-col` fits or it clips —
     there is no scrollbar to fall back on. */
  const FIT_REF_H = 700;
  const tightH = Math.max(0, Math.floor(boxH));
  const tightScale = tightH > 0 && tightH < FIT_REF_H ? tightH / FIT_REF_H : 1;
  const GAP = tightScale < 1 ? 6 : 8;
  const PILL_H = tightScale < 1 ? Math.max(38, Math.round(46 * tightScale)) : 46;
  const THEME_H = 20, TRACK_H = 24, CLUE_H = 34, HINTB_H = 36;
  /* #193 doubled how many extra clues can be on screen at once, and each one
     costs XCLUE_H of chrome the board does not get. So it scales like #191's
     other constants rather than staying fixed: four clues on a short phone
     would otherwise take 112px off the board, which is exactly the clipping
     #191 fixed, arriving by a different route. */
  const XCLUE_H = tightScale < 1 ? Math.max(18, Math.round(28 * tightScale)) : 28;
  const KEY_H = tightScale < 1 ? Math.max(30, Math.round(46 * tightScale)) : 46;
  const KGAP = 4;
  /* #192 — with the device's own keyboard doing the typing, the drawn one is
     replaced by a colour legend rendered in the DOM below the canvas. It costs
     the canvas nothing, so the board gets the three key rows back. */
  const devKbd = cgPrefs.devkbd;
  const kbdH = devKbd ? 0 : KEY_H * 3 + KGAP * 2;
  const activeXtra = active ? revealedExtra : 0;
  const hasHintBar = !!(active && activeHints.length > 0 && !done);
  const chrome = PILL_H + GAP + THEME_H + GAP + TRACK_H + GAP
    + (active ? CLUE_H + activeXtra * XCLUE_H + GAP + (hasHintBar ? HINTB_H + GAP : 0) + (kbdH ? kbdH + GAP : 0) : 0)
    + (allResolved ? 34 : 0);
  const gapPx = 5;
  /* No floor on the available height: flooring it at 90 meant a board that
     could not fit simply drew past the bottom of its own frame. The tile floor
     scales the same way, so a short screen gets a smaller board instead of a
     clipped one. */
  const minTile = tightScale < 1 ? 14 : 20;
  const availB = Math.max(0, Math.floor(boxH) - chrome);
  const tile = active ? Math.max(minTile, Math.min(56, Math.floor(Math.min(
    (Math.min(W, boardWidth) - gapPx * (wordLen - 1)) / wordLen,
    (availB - gapPx * (maxGuesses - 1)) / maxGuesses
  )))) : 0;
  const bw = active ? tile * wordLen + gapPx * (wordLen - 1) : 0;
  const bh = active ? tile * maxGuesses + gapPx * (maxGuesses - 1) : 0;
  const H = chrome + bh;
  let cwY = PILL_H + GAP;
  const themeY = cwY; cwY += THEME_H + GAP;
  const trackY = cwY; cwY += TRACK_H + GAP;
  const clueY = cwY; if (active) cwY += CLUE_H + activeXtra * XCLUE_H + GAP;
  const hintbY = cwY; if (hasHintBar) cwY += HINTB_H + GAP;
  const boardY = cwY; if (active) cwY += bh + GAP;
  const kbdY = cwY;
  const boardX = Math.floor((W - bw) / 2);

  // The shake: rAF-driven wiggle for 400ms when `shake` flips true.
  const shakeRef = useRef(null);
  const [shakeFrame, setShakeFrame] = useState(0);
  useEffect(() => {
    if (!shake) { shakeRef.current = null; return; }
    shakeRef.current = { t0: performance.now() };
    let raf = 0;
    const tick = () => {
      if (!shakeRef.current) return;
      if (performance.now() - shakeRef.current.t0 >= 400) shakeRef.current = null;
      setShakeFrame((f) => f + 1);
      if (shakeRef.current) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [shake]);

  const controls = [];
  if (W > 80) {
    const pr = cuiRow(0, 0, W, PILL_H, 4);
    controls.push({ id: 'p-time', kind: 'pill', r: pr[0], label: 'Time', value: fmt, gold: true });
    controls.push({ id: 'p-word', kind: 'pill', r: pr[1], label: 'Word', value: `${Math.min(activeIdx < 0 ? roundsDef.length : activeIdx + 1, roundsDef.length)}/${roundsDef.length}` });
    controls.push({ id: 'p-solved', kind: 'pill', r: pr[2], label: 'Solved', value: `${solvedCount}/${roundsDef.length}` });
    controls.push({ id: 'p-points', kind: 'pill', r: pr[3], label: 'Points', value: totalScore });
    /* The theme line names the set you are actually playing. "Today's theme"
       is only true of the daily now — a story rung or an arcade run draws its
       own block, and labelling that with the day's theme would be wrong (#195). */
    controls.push({
      id: 'theme', kind: 'label', r: [0, themeY, W, THEME_H], font: 12,
      label: (playMode === 'story' || playMode === 'arcade')
        ? `Theme: ${modeSet.theme}`
        : `Today's theme: ${modeSet.theme}`,
    });
    if (active) {
      // Clue prose is custom-drawn (wrapped); twin-only entries carry the text.
      controls.push({ id: 'clue', kind: 'label', noDraw: true, r: [0, clueY, W, CLUE_H], label: `Clue: ${active.def.clue} · ${wordLen} letters` });
      activeHints.slice(0, revealedExtra).forEach((h, i) => {
        controls.push({ id: 'xclue' + i, kind: 'label', noDraw: true, r: [0, clueY + CLUE_H + i * XCLUE_H, W, XCLUE_H], label: `Hint ${i + 1}: ${h}` });
      });
      if (hasHintBar) {
        const exhausted = cluesLeft <= 0;
        controls.push({
          id: 'hint', kind: 'button',
          r: [hintMsg ? 0 : Math.floor(W * 0.2), hintbY, hintMsg ? Math.floor(W * 0.48) : Math.floor(W * 0.6), HINTB_H],
          label: exhausted ? '💡 No more clues' : `💡 Hint${Number.isFinite(cluesLeft) ? ` · ${cluesLeft} left` : ''}`,
          disabled: buying || exhausted,
          action: buyHint,
        });
        if (hintMsg) controls.push({ id: 'hint-msg', kind: 'label', r: [Math.floor(W * 0.5), hintbY, Math.floor(W * 0.5), HINTB_H], label: hintMsg, font: 11 });
      }
      // Keyboard: 3 rows, wide Enter/⌫ flanking the bottom row. Skipped
      // entirely in device-keyboard mode (#192) — see the legend below.
      if (!devKbd) {
      const kbW = Math.min(W, 480);
      const kbX0 = Math.floor((W - kbW) / 2);
      // The key must say the same thing as the tile it came from, so a spent
      // letter is red here too — a red tile over a grey key is two answers.
      const keyBg = (ch) => keyState[ch] === 'green' ? PAL.emerald
        : keyState[ch] === 'yellow' ? PAL.gold
        : keyState[ch] === 'gray' ? PAL.rose : PAL.border;
      const keyInk = (ch) => keyState[ch] ? '#fff' : PAL.text;
      CW_KEYS.forEach((row, ri) => {
        const y = kbdY + ri * (KEY_H + KGAP);
        const units = row.length + (ri === 2 ? 3.2 : 0); // two 1.6-wide keys
        const uw = (kbW - KGAP * (row.length - 1 + (ri === 2 ? 2 : 0))) / units;
        let x = kbX0 + (ri === 1 ? uw / 2 : 0);
        if (ri === 2) {
          controls.push({ id: 'enter', kind: 'button', r: [x, y, uw * 1.6, KEY_H], label: 'Enter', font: 11, noBorder: true, bg: PAL.border, radius: 6, action: submit });
          x += uw * 1.6 + KGAP;
        }
        for (const ch of row.split('')) {
          controls.push({ id: 'k' + ch, kind: 'button', r: [x, y, uw, KEY_H], label: ch, font: 13, noBorder: true, radius: 6, bg: keyBg(ch), ink: keyInk(ch), action: () => typeLetter(ch) });
          x += uw + KGAP;
        }
        if (ri === 2) {
          controls.push({ id: 'bksp', kind: 'button', r: [x, y, uw * 1.6, KEY_H], label: '⌫', font: 14, noBorder: true, bg: PAL.border, radius: 6, action: backspace });
        }
      });
      }
    }
    if (allResolved) {
      controls.push({ id: 'alldone', kind: 'label', r: [0, trackY + TRACK_H + GAP, W, 30], label: `Puzzle complete — ${solvedCount}/${roundsDef.length} words · ${totalScore} pts`, font: 14, color: PAL.text, bold: true });
    }
  }
  const ctlRef = useRef([]);
  ctlRef.current = controls;
  const [pressedId, setPressedId] = useState(null);
  usePointerCell(canvasRef, cuiWrapHandlers(ctlRef, setPressedId, {}));

  useCanvasBoard(canvasRef, {
    width: W,
    height: H,
    deps: [roundGuesses, cur, done, tile, shakeFrame, W, fmt, solvedCount, totalScore, revealedExtra, cluesLeft, buying, hintMsg, pressedId, activeIdx],
    draw: (ctx) => {
      cuiDrawControls(ctx, ctlRef.current, pressedId);
      // Round tracker dots.
      {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '600 13px ' + CUI_MONO;
        const n = roundState.length;
        const stepX = 26;
        let x = Math.floor(W / 2 - ((n - 1) * stepX) / 2);
        roundState.forEach((r, i) => {
          /* #194's check mark. The track already carried the cross for a
             missed word; a solved one was a filled dot, which said "this one
             is over" but not "you got it". It costs no layout to say both. */
          ctx.fillStyle = r.solved ? PAL.emerald : r.missed ? PAL.rose : i === activeIdx ? PAL.accent : PAL.dim;
          ctx.fillText(r.solved ? '✓' : r.missed ? '✗' : i === activeIdx ? '▶' : '○', x, trackY + TRACK_H / 2);
          x += stepX;
        });
      }
      if (active) {
        // Clue prose, wrapped.
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.font = '600 12px ' + CUI_FONT;
        ctx.fillStyle = PAL.text;
        cuiWrapText(ctx, `Clue: ${active.def.clue} · ${wordLen} letters`, W / 2, clueY + 14, W - 16, 15, 2);
        ctx.fillStyle = PAL.gold;
        ctx.font = '500 11.5px ' + CUI_FONT;
        activeHints.slice(0, revealedExtra).forEach((h, i) => {
          cuiWrapText(ctx, `Hint ${i + 1}: ${h}`, W / 2, clueY + CLUE_H + i * XCLUE_H + 12, W - 16, 13, 2);
        });
        // Guess grid.
        ctx.save();
        ctx.translate(boardX, boardY);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const sh = shakeRef.current;
        const shakeP = sh ? (performance.now() - sh.t0) / 400 : 1;
        const wiggle = sh ? Math.sin(shakeP * Math.PI * 4) * 6 * (1 - shakeP) : 0;
        const guesses = active.guesses;
        for (let r = 0; r < maxGuesses; r++) {
          const g = guesses[r];
          const isCurrent = !g && r === guesses.length && !done;
          const letters = g ? g.word : (isCurrent ? cur : '');
          const dx = isCurrent ? wiggle : 0;
          for (let c = 0; c < wordLen; c++) {
            const ch = letters[c] || '';
            const x = c * (tile + gapPx) + dx, y = r * (tile + gapPx);
            const state = g ? g.result[c] : (ch ? 'filled' : '');
            let bg = PAL.card, border = PAL.dim, ink = PAL.text;
            if (state === 'filled') border = PAL.muted;
            else if (state === 'green') { bg = PAL.emerald; border = PAL.emerald; ink = '#fff'; }
            else if (state === 'yellow') { bg = PAL.gold; border = PAL.gold; ink = '#fff'; }
            /* #194 — an absent letter is RED, not grey. Grey read as "empty"
               rather than as "wrong": PAL.dim is also the unfilled tile's
               border, so a spent guess and a blank row were nearly the same
               object at a glance. A present-but-misplaced letter deliberately
               stays gold — the issue asks for red only for the wrong ones, and
               three states need three colours. */
            else if (state === 'gray') { bg = PAL.rose; border = PAL.rose; ink = '#fff'; }
            klRR(ctx, x + 1, y + 1, tile - 2, tile - 2, 8);
            ctx.fillStyle = bg;
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = border;
            ctx.stroke();
            if (ch) {
              ctx.font = `600 ${Math.round(tile * 0.5)}px 'JetBrains Mono', monospace`;
              ctx.fillStyle = ink;
              ctx.fillText(String(ch).toUpperCase(), x + tile / 2, y + tile / 2 + 1);
            }
          }
        }
        ctx.restore();
      }
    },
  });

  /* #192 — DEVICE KEYBOARD.

     A hidden, focusable input is what opens the system keyboard; there is no
     other way to ask for one. It stays visually empty and is never allowed to
     change: every edit is read from `beforeinput` and cancelled, so the field
     holds one non-breaking space forever. That matters for backspace — a
     browser will not report a delete on a field it believes is already empty,
     so an input that is genuinely empty can be typed into and never erased.

     `beforeinput` rather than `keydown`, because a phone keyboard often sends
     no usable `key` at all (predictive text reports 229 / 'Unidentified').
     What it always sends is the text it inserted, which is `e.data`.

     THE DOUBLE-INPUT TRAP, in a new place. A physical keypress while this
     input has focus fires BOTH its beforeinput and the window keydown handler
     the game has always had. That is the same shape as #one-tap-two-letters,
     where one touch typed two letters, so the window handler now ignores
     anything whose target is this input and the input owns those keys
     completely. `?cwtype=` still exercises the drawn keys, and a check asserts
     the typed string either way. */
  const hidRef = useRef(null);
  const CW_HID_FILL = '\u00a0';
  const focusDeviceKbd = () => {
    const el = hidRef.current;
    if (!el || !devKbd || done) return;
    // Mobile browsers only open a keyboard for a focus() that happens inside a
    // user gesture, which is why this hangs off the board's own pointerdown
    // rather than an effect: an effect runs after the gesture is over.
    try { el.focus({ preventScroll: true }); } catch (_) { try { el.focus(); } catch (_) {} }
  };
  /* Bound NATIVELY rather than through React's onBeforeInput prop. React 18's
     synthetic beforeinput is a polyfill layered on `textInput`, and it does not
     see every inputType a phone keyboard produces — deleteContentBackward in
     particular. The native event is the one that carries the contract this
     depends on. */
  const hidApiRef = useRef({});
  hidApiRef.current = { typeLetter, backspace, submit };
  useEffect(() => {
    const el = hidRef.current;
    if (!el) return;
    const onBI = (e) => onHiddenBeforeInputRef.current(e);
    const onKD = (e) => onHiddenKeyDownRef.current(e);
    el.addEventListener('beforeinput', onBI);
    el.addEventListener('keydown', onKD);
    return () => {
      el.removeEventListener('beforeinput', onBI);
      el.removeEventListener('keydown', onKD);
    };
  }, [devKbd, done]);

  const onHiddenBeforeInput = (e) => {
    const t = e.inputType || '';
    if (t === 'insertText' || t === 'insertCompositionText' || t === 'insertFromPaste') {
      const text = (e.data || '').toUpperCase();
      for (const ch of text) if (ch >= 'A' && ch <= 'Z') hidApiRef.current.typeLetter(ch);
      e.preventDefault();
      return;
    }
    if (t.indexOf('delete') === 0) { hidApiRef.current.backspace(); e.preventDefault(); return; }
    if (t === 'insertLineBreak' || t === 'insertParagraph') { hidApiRef.current.submit(); e.preventDefault(); }
  };
  const onHiddenKeyDown = (e) => {
    // Enter is the one key a phone keyboard reports reliably, and on a
    // single-line field it may produce no beforeinput at all.
    if (e.key === 'Enter') { e.preventDefault(); hidApiRef.current.submit(); return; }
    // A hardware keyboard attached to a phone still goes through here, and
    // Backspace on a field the browser thinks is full is reported as a delete
    // by beforeinput — so nothing else needs handling.
  };
  const onHiddenBeforeInputRef = useRef(onHiddenBeforeInput);
  onHiddenBeforeInputRef.current = onHiddenBeforeInput;
  const onHiddenKeyDownRef = useRef(onHiddenKeyDown);
  onHiddenKeyDownRef.current = onHiddenKeyDown;

  return (
    // PHASE 3 — .fit-col keeps the frame the one flexible child (fitShell).
    <div className="fit-col">
      <div
        className="cw-board cui-frame"
        ref={boxRef}
        onPointerDown={devKbd ? focusDeviceKbd : undefined}
        data-cw-kbd={devKbd ? 'device' : 'drawn'}
        /* The live entry, verbatim. A check asserts
           `.cw-board[data-cw-typed="LEN"]` after the ?cwtype= replay — with
           the double-input bug it would read "LLEENN" and the check fails. */
        data-cw-typed={cur}
        /* How many guesses the ACTIVE round has scored. The feedback colours
           live on the canvas, where no check can read a pixel, so this is the
           assertable half: a row exists to be coloured (#194). */
        data-cw-rows={active ? active.guesses.length : 0}
      >
        <canvas
          ref={canvasRef}
          className="cw-canvas board-canvas"
          role="img"
          aria-label={active
            ? `Daily Cipher — word ${activeIdx + 1} of ${roundsDef.length}, ${active.guesses.length} of ${maxGuesses} guesses used`
            : `Daily Cipher — puzzle complete, ${solvedCount} of ${roundsDef.length} words`}
        />
      </div>
      {devKbd && (
        <input
          ref={hidRef}
          className="cw-hidden-input"
          type="text"
          defaultValue={CW_HID_FILL}
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
          aria-label="Type your guess"
          onBlur={(e) => { e.target.value = CW_HID_FILL; }}
        />
      )}
      {devKbd && active && !done && (
        /* The read-out the device keyboard cannot give you: which letters are
           placed, which are in the word, which are spent. Not tappable — the
           typing is happening elsewhere now. */
        <div className="cw-legend" aria-hidden="true">
          {CW_KEYS.join('').split('').map((ch) => (
            <span key={ch} className={'cw-legend-key' + (keyState[ch] ? ' on-' + keyState[ch] : '')}>{ch}</span>
          ))}
        </div>
      )}
      <CuiTwin controls={controls} />
    </div>
  );
}
