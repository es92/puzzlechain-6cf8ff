/* ============================================================
   Word Sprint — daily Boggle-style timed word grid (change-list item 6).
   Trace adjacent letters (8 directions, no reuse) on today's seeded 4×4
   grid and bank as many valid words as you can in 90 seconds. Open
   vocabulary against the in-file WSPR word set; longer words score more.
   The countdown ending is the "win" (score may be 0 — an empty sprint
   still locks the day but never breaks a streak).
   ============================================================ */
const WSPR_SECS = 90;
const WSPR_SIZE = 4;
// Original letter dice (own distribution — not any published game's):
// heavy on E/A/I/O/N/R/S/T/L, light on the awkward tail.
const WSPR_DICE = [
  'AAEIOU', 'AEINOT', 'ADELRS', 'AEGNRT', 'EILNOS', 'EIORST',
  'ABCEMP', 'CDEIKT', 'DEHLNR', 'EFGHIY', 'AILMNU', 'BEIOSW',
  'ACDHOT', 'EGKLNU', 'FIMOPR', 'ESTUVY',
];
const WSPR_POINTS = { 3: 30, 4: 60, 5: 120, 6: 200, 7: 300, 8: 400 };
const wsprPoints = (len) => WSPR_POINTS[Math.min(8, len)] || 0;

// Common-English word set, 3–8 letters. Deliberately generous on short
// words (the bulk of real finds on a 4×4). Invalid entries can never
// match a traced path, so the list only ever errs safe.
const WSPR_WORDS_RAW = `
ace act add age ago aid ail aim air ale all and ant any ape apt arc are arm art ash ask ate awe axe
bad bag ban bar bat bay bed bee beg bet bid big bin bit bog bow box boy bud bug bun bus but buy
cab can cap car cat cob cod cog con cop cot cow cry cub cue cup cut dab dam day den dew did die dig
dim din dip doe dog don dot dry dub dud due dug duo dye ear eat ebb eel egg ego elf elk elm end era
eve ewe eye fad fan far fat fed fee few fib fig fin fir fit fix flu fly foe fog for fox fry fun fur
gag gap gas gel gem get gig gin got gum gun gut guy gym had hag ham has hat hay hem hen her hew hex
hey hid him hip his hit hoe hog hop hot how hub hue hug hum hut ice icy ill imp ink inn ion ire irk
its ivy jab jam jar jaw jet jig job jog jot joy jug jut keg key kid kin kit lab lad lag lap law lax
lay led leg let lid lie lip lit lob log lot low mad man map mar mat maw may men met mid mix mob mop
mud mug nab nag nap net new nib nil nip nod nor not now nun nut oak oar oat odd ode off oil old one
ore our out owe owl own pad pal pan par pat paw pay pea peg pen pet pew pie pig pin pit ply pod pop
pot pro pry pub pun pup put rag ram ran rap rat raw ray red rib rid rig rim rip rob rod roe rot row
rub rue rug rum run rut rye sad sag sap sat saw say sea set sew she shy sin sip sir sit six ski sky
sly sob sod son sow soy spa spy sty sub sue sum sun tab tag tan tap tar tax tea ten the tie tin tip
toe ton top tot tow toy try tub tug two urn use van vat vet vex via vie vow wad wag war was wax way
web wed wet who wig win wit woe wok won woo wow yak yam yap yes yet yew you zip zoo
able ache acid acre aged aide airy ally also alto amid area aria atom aunt auto away axle babe back
bail bait bake bald bale ball band bane bang bank bare bark barn base bash bask bath bead beak beam
bean bear beat beef been beer bell belt bend bent best bike bile bill bind bird bite blot blow blue
blur boar boat body boil bold bolt bond bone book boom boot bore born both bout bowl brag bran brew
brim brow bulk bull bump burn bury bush bust busy cage cake calf call calm came camp cane cape card
care cart case cash cast cave cell cent chat chef chew chin chip chop cite city clad clam clan clap
claw clay clip clog clot club clue coal coat code coil coin cold colt comb come cone cook cool cope
copy cord core cork corn cost cove cozy crab crag cram crew crib crop crow cube cure curl cute dame
damp dare dark darn dart dash data date dawn dead deaf deal dean dear debt deck deed deem deep deer
dent deny desk dial dice diet dime dine dirt dish dive dock does dome done doom door dose dote dour
dove down doze drag draw drew drip drop drum dual duck duel duet dull dumb dune dusk dust duty each
earl earn ease east easy echo edge edit envy epic even ever evil exam exit face fact fade fail fair
fake fall fame fang fare farm fast fate fawn fear feat feed feel fell felt fern feud file fill film
find fine fire firm fish fist five flag flap flat flaw flea fled flee flew flip flow foam foal foil
fold folk fond font food fool foot ford fore fork form fort foul four fowl free fret frog from fuel
full fume fund fuse fuss gain gait gale game gang gape gate gave gaze gear gene gift gill girl give
glad glee glen glow glue goad goal goat goes gold golf gone gong good gore gown grab gray grew grey
grid grim grin grip grit grow gulf gull gulp gush gust hail hair hale half hall halt hand hang hard
hare harm harp hate haul have hawk haze heal heap hear heat heed heel heir held helm help herb herd
here hero hide high hike hill hind hint hire hive hold hole home hone hood hoof hook hoop hope horn
hose host hour howl huge hull hunt hurl hurt hush hymn icon idea idle idol inch into iron isle item
jade jail jest join joke jolt jury just keen keep kelp kept kick kiln kind king kiss kite knee knew
knit knob knot know lace lack lady laid lain lair lake lamb lame lamp land lane lard lark last late
lava lawn lazy lead leaf leak lean leap left lend lens lent less lest levy liar lice lick lied lien
life lift like limb lime limp line link lint lion list live load loaf loan lobe lock loft logo lone
long look loom loop loot lord lore lose loss lost loud love luck lull lung lure lurk lush lute made
maid mail main make male mall malt mane many mare mark mash mask mast mate math maze meal mean meat
meek meet meld melt memo mend menu mere mesh mess mice mild mile milk mill mind mine mint mire miss
mist mite moan moat mock mode mold mole molt monk mood moon moor more morn moss most moth move much
mule muse mush must mute myth nail name nape navy near neat neck need nest news next nice nick nine
node none noon norm nose note noun numb oath obey ogle ogre oily omen omit once only onto opal open
oral oven over pace pack pact page paid pail pain pair pale palm pane pang pant park part pass past
path pave pawn peak peal pear peat peck peel peer pelt perk pest pier pike pile pill pine pink pint
pipe pity plan play plea plot plow ploy plug plum plus poem poet pole poll pond pony pool poor pope
pore pork port pose post pour pout pray prey prim prod prop prow pull pulp pump punt pure push quit
quiz race rack raft rage raid rail rain rake ramp rang rank rant rare rash rate rave read real ream
reap rear reed reef reel rein rely rend rent rest rice rich ride rife rift rind ring rink riot ripe
rise risk rite road roam roar robe rock rode role roll roof rook room root rope rose rosy rote rout
rove rude ruin rule rung runt ruse rush rust sack safe sage said sail sake sale salt same sand sane
sang sank sash save scan scar seal seam sear seat sect seed seek seem seen seep self sell send sent
shed shin ship shoe shop shot show shun shut sick side sift sigh sign silk sill silo sing sink sire
site size skew skid skim skin skip slab slam slap slat sled slew slid slim slip slit slot slow slug
slum smog smug snag snap snip snob snow soak soap soar sock soda sofa soft soil sold sole solo some
song soon soot sore sort soul soup sour sown span spar spat sped spin spit spot spun spur stab stag
star stay stem step stew stir stop stow stub stud stun such suit sulk sung sunk sure surf swab swam
swan swap sway swim tack tail take tale talk tall tame tank tape tart task teal team tear tell tend
tent term test text than that thaw them then they thin this thud thus tick tide tidy tier tile till
tilt time tint tiny tire toad toil told toll tomb tone took tool tore torn toss tour town trap tray
tree trek trim trio trip trot true tuck tuft tuna tune turf turn tusk twig twin type ugly undo unit
unto upon urge used user vain vane vase vast veal veer veil vein vent verb very vest veto vice view
vine visa void vole vote wade waft wage wail wait wake walk wall wand wane want ward ware warm warn
warp wart wary wash wasp wave wavy weak wean wear weed week weep weld well welt went wept were west
what when whim whip whom wick wide wife wild will wilt wind wine wing wink wipe wire wise wish with
wolf wood wool word wore work worm worn wove wrap wren yard yarn yawn year yell yelp yoga yoke yolk
your zeal zero zest zone
about actor acute admit adopt adult after again agent agree ahead alarm alert alike alive alley
allow alone along aloud alter amend ample angel anger angle ankle apart apple apply arena argue
arise armor aroma arrow aside asset audio avoid awake award aware badge baker banjo barge basic
basil baton beach beard beast began begin being belly below bench berry birth black blade blame
bland blank blast blaze bleak blend bless blind block bloom blown blunt board boast bonus boost
booth bound brace braid brain brake brand brave bread break breed brick bride brief bring brink
brisk broad broke brook broom brown brush build built bunch burnt burst cabin cable camel canal
candy canoe cargo carol carry carve catch cause cease cedar chain chair chalk charm chart chase
cheap check cheek cheer chess chest chief child chill choir chose chunk churn cider cigar civic
civil claim clash clasp clean clear clerk click cliff climb cling cloak clock close cloth cloud
clown coach coast cocoa color comet comic coral couch could count court cover crack craft crane
crash crate crawl crazy cream creek crept crest crime crisp cross crowd crown crumb crush curve
cycle daily dairy dance dealt debut decay decor delay delta dense depth diary dirty ditch diver
dodge doing donor doubt dough dozen draft drain drama drank dream dress dried drift drill drink
drive drone drove dusty dwell eager eagle early earth easel eaten eight elbow elder elect elite
empty enemy enjoy enter entry equal error essay event every exact exert exist extra fable faint
fairy faith false fancy fatal fault favor feast fence ferry fetch fever fiber field fiery fifth
fifty fight final first flair flake flame flash fleet flesh flick fling flint float flock flood
floor flora flour fluid flush focus foggy force forge forth forty forum found frame frank fraud
fresh front frost fruit fudge fully funny gauge ghost giant given giver glade gland glare glass
gleam glide globe gloom glory glove gnome going grace grade grain grand grant grape graph grasp
grass grave graze great greed green greet grief grill grind groan groom grove growl grown guard
guess guest guide guild habit hairy handy happy hardy haste hasty hatch haunt haven hazel heard
heart heavy hedge hefty hello hence hobby hoist holly honey honor horse hotel hound house hover
human humid humor hurry ideal image imply index inner input irony issue ivory jelly jewel joint
jolly judge juice juicy kneel knife knock known label labor lance large laser latch later laugh
layer learn lease least leave ledge legal lemon level lever light limit linen liner liver lobby
local lodge logic loose loser lousy lover lower loyal lucid lucky lunar lunch lyric magic major
maker mango manor maple march marsh match mayor meant medal media melon mercy merge merit merry
metal meter midst might miner minor minus mirth model moist money month moral mossy motel motor
mound mount mourn mouse mouth mover movie mural music nasty naval nerve never newer newly night
noble noise noisy north notch noted novel nurse occur ocean offer often olive onion onset opera
orbit order organ other otter ought ounce outer owner oxide ozone paint panel panic paper party
pasta paste patch patio pause peace peach pearl pedal penny perch peril petal phase phone photo
piano piece pilot pinch pitch pivot pixel place plaid plain plane plank plant plate plaza plead
pluck plumb plume point polar porch pouch pound power press price pride prime print prior prize
probe prone proof prose proud prove prune pulse punch pupil puppy purse queen query quest queue
quick quiet quilt quota quote radar radio rainy raise rally ranch range rapid ratio raven reach
react ready realm rebel refer reign relax relay renew repay reply resin rhyme rider ridge rifle
right rigid rinse ripen risen risky rival river roast robin robot rocky rogue roost rotor rough
round route royal ruler rumor rural rusty sadly salad salty sandy satin sauce scale scalp scare
scarf scene scent scoop scope score scout scrap screw scrub seize sense serve setup seven shade
shaft shake shall shame shape share shark sharp shave shear sheep sheer sheet shelf shell shift
shine shiny shirt shock shoot shore short shout shove shown shrub shrug sight silky since siren
sixth sixty skate skill skirt skull slack slain slant slate sleek sleep sleet slept slice slick
slide slime slope small smart smash smell smile smoke snack snail snake snare sneak snore snout
snowy sober solar solid solve sonar sonic sorry sound south space spade spare spark spawn speak
spear speed spell spend spent spice spicy spike spill spine spite split spoil spoke spoon sport
spout spray spree stack staff stage stain stair stake stale stalk stall stamp stand stare stark
start state steak steal steam steel steep steer stern stick stiff still sting stock stole stomp
stone stony stood stool stoop store stork storm story stout stove strap straw stray strip stuck
study stump stung style sugar suite sunny super surge swamp swarm swear sweat sweep sweet swell
swept swift swing sword syrup table taken talon tango taste teach tempo tenor tense tenth thank
theft their theme there these thick thief thigh thing think third thorn those three threw throw
thumb tidal tiger tight timer title toast today token tonic tooth topic torch total touch tough
towel tower toxic trace track trade trail train trait trash tread treat trend trial tribe trick
tried troop trout truce truck truly trunk trust truth tulip tumor tunic tutor twice twist ultra
uncle under union unite unity until upper upset urban usage usher usual utter vague valid valor
value valve vapor vault venue verse video vigor vinyl virus visit vital vivid vocal voice vowel
wagon waist waive waltz waste watch water weary weave wedge weigh weird whale wheat wheel where
which while whirl white whole whose widen widow width wince windy wiser witch woken woman women
worse worst worth would wound woven wrist wrong yacht yeast yield young youth zebra zesty
absorb accent access accuse across action active actual advice advise afford agenda almost always
amount animal annual answer anthem anyone appeal appear arctic around arrive artist aspect assist
assume attack attend author autumn avenue bakery bamboo banana banner barrel basket battle beacon
beauty become before behind belief belong beside better beyond bishop bitter bottle bounce branch
breath breeze bridge bright broken bronze bubble bucket budget bundle burden butter button camera
campus candle cannon canvas canyon carbon career carpet carrot castle casual cattle caught cellar
center cereal change chapel charge cherry choice choose chorus church circle circus clever client
closet coffee collar column combat comedy coming common copper corner cotton county couple course
cousin cradle crayon create credit crisis critic crunch custom dagger damage danger debate decade
decent decide defeat defend define degree demand depend desert design desire detail detect device
dinner direct divide doctor dollar domain donkey double dragon drawer driven driver during easily
eating editor effect effort either eleven emerge empire enable ending energy engine enough ensure
entire escape estate exceed except excuse exotic expand expect expert extend fabric falcon family
famous farmer father fellow female fierce figure filter finger finish flavor flight flower follow
forest forget formal former fossil foster fourth freeze friend frozen future galaxy garage garden
garlic gather gentle global golden gospel gossip ground growth guitar hammer handle happen harbor
hardly hazard health heaven height helmet herald hidden hollow honest horror humble hunger hunter
impact import income indeed indoor infant inform injury insect inside intact intend invest island
jacket jargon jungle junior kernel kettle kidney kitten ladder lagoon lately launch lawyer leader
league legacy legend length lesson letter likely liquid listen little living lizard locker lonely
longer losing lovely luxury magnet mainly mammal manage manner mantle marble margin marine marker
market master matter meadow medium member memory mental mentor merely method middle mighty mirror
mobile modern modest module moment monkey mosaic mostly mother motion murmur muscle museum mutual
myself mystic narrow nation native nature nearby nearly nectar nephew nickel nimble nobody normal
notice notion number nutmeg object oblige obtain occupy offend office online option orange orchid
origin orphan outfit output oyster palace parade parcel pardon parent patrol peanut pebble pencil
people pepper period permit person phrase picnic pigeon pillar pillow pirate pistol planet please
pledge plenty pocket poetry police policy polish porter postal potato powder praise prayer prefer
pretty priest prince prison profit prompt proper public puddle pulley puppet purple pursue puzzle
rabbit racket random rarely rather reason recall recent recipe record reduce reform refuse regard
region regret relate relief remain remark remedy remind remote render rental repair repeat report
rescue resort result retain return reveal review reward rhythm ribbon riddle rising ritual robust
rocket rotate rubber rustic sacred saddle safari safety salmon sample saying scheme school scream
screen script search season second secret sector secure seldom select senior sequel serene sermon
settle severe shadow shaken shovel shower shrine signal silent silver simple simply singer single
sister sketch slight smooth soccer social socket sodium solemn sonnet sorrow source speech sphere
spider spirit spread spring sprout square squash stable stance staple statue steady sticky stitch
stolen strain strand streak stream street stress strict stride strike string stripe stroke strong
studio submit subtle sudden suffer summer summit sunset supper supply surely survey switch symbol
system tackle tailor talent target temple tender tennis theory thirty thread threat thrive throne
tissue tomato tongue toward travel treaty tremor trench tribal triple trophy tunnel turkey turtle
twelve twenty unfold unique unless unrest unveil update upward urgent useful vacuum valley velvet
vendor verify vessel victim violet violin virtue vision visual volume voyage waffle wallet walnut
wander wealth weapon weekly weight window winner winter wisdom within wizard wonder wooden worthy
writer yellow yonder zenith zigzag zodiac
ability absence academy account achieve acquire address advance adverse advice against airline
alcohol already amateur amazing ancient anxiety anybody applied arrange article assault athlete
attempt attract auction average balance balloon banquet bargain battery bedroom believe beneath
benefit besides between bicycle billion biology blanket blossom breathe brother cabinet caption
capture careful carrier caution ceiling century certain chamber channel chapter charity charter
chicken chimney classic climate clothes collect college combine comfort command comment common
company compare compete complex concept concern concert conduct confirm connect consist contact
contain content contest context control convert correct cottage council counter country courage
crystal culture curious current curtain custody dessert destroy develop diagram diamond digital
dignity discuss disease display distant drawing eastern economy edition element embrace emotion
enhance evening exactly examine example excited exhibit expense explain explore express factory
faculty fashion feature federal fiction fifteen finance finding fitness foreign forever formula
fortune forward freedom further gallery general genuine gesture greater grocery habitat halfway
harvest heading healthy hearing heavily herself highway himself history holiday horizon hundred
husband imagine improve include initial inquiry insight inspire instead journal journey justice
kitchen landing largely lasting laundry leather lecture liberty library licence lighter limited
machine manager mansion massive maximum meaning measure medical meeting mention message million
mineral minister? mission mistake mixture monster morning musical mystery natural neither nervous
network nothing nowhere obvious offense officer opening operate opinion organic outcome outdoor
outside overall package painter parking partner passage passion patient pattern payment penalty
percent perfect perform perhaps physics picture pioneer plastic pleased popular portion poverty
prairie precise predict premium prepare present prevent primary printer privacy private problem
process produce product profile program project promise protect protein provide purpose pursuit
quality quarter radical readily reality receipt receive recover reflect regular related release
remains removal replace request require reserve resolve respect respond restore retreat reunion
revenue reverse routine running satisfy science section segment serious service session setting
seventy several shelter silence similar sixteen society somehow speaker special species sponsor
stadium station stomach storage strange stretch student subject success suggest summary support
supreme surface surgery surplus survive suspect sustain teacher theatre therapy thought through
tonight totally tourist traffic trouble typical uniform unknown unusual upgrade utility variety
vehicle venture version veteran victory village vintage visible visitor waiting warmth? warrior
weather website weekend welcome welfare western whether willing without witness wondrous? wording
`;
let wsprWordSetCache = null;
function wsprWordSet() {
  if (!wsprWordSetCache) {
    wsprWordSetCache = new Set(
      WSPR_WORDS_RAW.split(/\s+/).map(w => w.replace(/[^a-z]/g, '')).filter(w => w.length >= 3).map(w => w.toUpperCase())
    );
  }
  return wsprWordSetCache;
}

function wsprGrid(rng) {
  const dice = ceShuffle(WSPR_DICE.slice(), rng);
  return dice.map(d => d[Math.floor(rng() * d.length)]);
}

function WordSprintGame({ onWin, onStepChange, offset, savedProgress, onSaveProgress, playMode, band }) {
  const dayNum = useRef(utcDayNum(offset)).current;
  /* #176 — this was already the closest daily to arcade: the clock ends the
     run and the score genuinely varies, so a fresh grid per run was the only
     thing missing. Arcade also widens the clock by band, since 90 seconds is
     the daily's fixed contract rather than a property of the game. */
  const isArcade = playMode === 'arcade';
  /* #331 — the daily gains Easy/Hard: the clock widens or tightens (arcade's
     own ladder already does exactly this) and each level deals its own grid
     from the same day anchor. Normal keeps the fixed 90s and the un-mixed
     seed byte-for-byte. */
  const dailyBand = !isArcade && (band === 'easy' || band === 'hard') ? band : null;
  const bandIdx = isArcade ? Math.max(0, ARCADE_BANDS.findIndex(b => b.id === band)) : 1;
  const secsForRun = isArcade
    ? [120, 90, 60][bandIdx]
    : dailyBand === 'easy' ? 120
    : dailyBand === 'hard' ? 60
    : WSPR_SECS;
  const seedRef = useRef(null);
  const letters = useRef(null);
  if (!letters.current) {
    if (isArcade) {
      const { rng, seed } = modeSeed('arcade', 'wordsprint', bandIdx, offset);
      seedRef.current = seed;
      letters.current = wsprGrid(rng);
    } else {
      // dailyRng treats null/'normal'/undefined alike, so Normal is untouched.
      letters.current = wsprGrid(dailyRng(offset, 'wordsprint', dailyBand));
    }
  }
  const L = letters.current;

  const resumed = savedProgress && savedProgress.dayNum === dayNum && Array.isArray(savedProgress.found)
    ? savedProgress
    : null;
  const [found, setFound] = useState(() => (resumed ? resumed.found.filter(w => wsprWordSet().has(w)) : []));
  const [path, setPath] = useState([]); // cell indices in trace order
  const [msg, setMsg] = useState(null); // { kind: 'good'|'bad', text }
  const [done, setDone] = useState(false);
  const initialSecs = savedProgress && Number.isFinite(savedProgress.elapsedSecs)
    ? Math.min(savedProgress.elapsedSecs, secsForRun) : 0;
  const { secs } = useTimer(!done, initialSecs);
  const remaining = Math.max(0, secsForRun - secs);

  const score = found.reduce((s, w) => s + wsprPoints(w.length), 0);
  const scoreRef = useRef(score); scoreRef.current = score;
  const foundRef = useRef(found); foundRef.current = found;
  const doneRef = useRef(false);

  // Idle/leave autosave; per-word saves happen in submit(). Disabled for the
  // final seconds so no progress write can race the timer-end finish call
  // (a racing write 409s against the finished row — the shared no-save-on-
  // the-winning-move rule, adapted for a clock-driven finish).
  const stateRef = useRef({});
  stateRef.current = { found, secs };
  useAutosave(
    onSaveProgress,
    () => ({ progress: { dayNum, found: stateRef.current.found }, steps: stateRef.current.found.length, secs: stateRef.current.secs }),
    !done && remaining > 3
  );

  // The countdown hitting zero IS the finish. Deliberately no progress save
  // on the finishing tick — the finish call closes the attempt (409 rule).
  useEffect(() => {
    if (remaining > 0 || doneRef.current) return;
    doneRef.current = true;
    setDone(true);
    const words = foundRef.current;
    const sc = scoreRef.current;
    const best = words.reduce((m, w) => (w.length > m.length ? w : m), '');
    onWin(sc, words.length, secsForRun, {
      share: `🔠 Word Sprint — ${words.length} words · ${sc} pts${best ? ` · best "${best.toLowerCase()}"` : ''}`,
    });
  }, [remaining]);

  const adjacent = (a, b) => {
    const ar = Math.floor(a / WSPR_SIZE), ac = a % WSPR_SIZE;
    const br = Math.floor(b / WSPR_SIZE), bc = b % WSPR_SIZE;
    return Math.abs(ar - br) <= 1 && Math.abs(ac - bc) <= 1 && a !== b;
  };

  const word = path.map(i => L[i]).join('');

  const submit = () => {
    if (done) return;
    const w = word;
    setPath([]);
    if (w.length < 3) { setMsg({ kind: 'bad', text: 'Words need 3+ letters' }); return; }
    if (found.includes(w)) { setMsg({ kind: 'bad', text: `Already found ${w}` }); return; }
    if (!wsprWordSet().has(w)) { setMsg({ kind: 'bad', text: `${w} isn't in the word list` }); return; }
    const nf = [...found, w];
    setFound(nf);
    setMsg({ kind: 'good', text: `+${wsprPoints(w.length)} · ${w}` });
    onStepChange(nf.length);
    // Skip the save in the final seconds — the finish call is about to close
    // the attempt and a racing progress write would 409.
    if (remaining > 3) onSaveProgress && onSaveProgress({ dayNum, found: nf }, nf.length, secs);
  };

  const tap = (i) => {
    if (done) return;
    setMsg(null);
    if (path.length === 0) { setPath([i]); return; }
    const last = path[path.length - 1];
    if (i === last) { submit(); return; } // tap the last tile again to submit
    const pos = path.indexOf(i);
    if (pos !== -1) { setPath(path.slice(0, pos + 1)); return; } // backtrack
    if (!adjacent(last, i)) return;
    setPath([...path, i]);
  };

  const fmtLeft = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;

  /* The whole frame is ONE canvas (controls wave): pills, letter grid, the
     live trace word, the feedback line and Clear/Submit draw together; only
     the found-words scroll strip stays DOM. Same tap grammar — start
     anywhere, extend to an adjacent tile, tap an earlier tile to backtrack,
     tap the last tile again to submit. Tile chrome reads PAL. */
  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const { boxW, boxH } = useFitBox(boxRef, { cols: 1, rows: 1, maxCell: 100000 });
  const W = Math.floor(boxW);
  const GAP = 8, PILL_H = 46, WORD_H = 26, MSG_H = 18, ACT_H = 44;
  const chrome = PILL_H + WORD_H + MSG_H + ACT_H + GAP * 4;
  const availB = Math.max(0, Math.min(W, Math.floor(boxH) - chrome));
  const wsprCell = Math.max(44, Math.min(76, Math.floor((availB - 6 * (WSPR_SIZE - 1)) / WSPR_SIZE)));
  const wsprStep = wsprCell + 6;
  const wsprSide = wsprStep * WSPR_SIZE - 6;
  const H = chrome + wsprSide;
  const boardX = Math.floor((W - wsprSide) / 2);
  const boardY = PILL_H + GAP;
  const wordY = boardY + wsprSide + GAP;
  const msgY = wordY + WORD_H;
  const actY = msgY + MSG_H + GAP;

  const controls = [];
  if (W > 80) {
    const pr = cuiRow(0, 0, W, PILL_H, 3);
    controls.push({ id: 'p-left', kind: 'pill', r: pr[0], label: 'Left', value: fmtLeft, color: remaining <= 10 ? PAL.rose : PAL.gold });
    controls.push({ id: 'p-words', kind: 'pill', r: pr[1], label: 'Words', value: found.length });
    controls.push({ id: 'p-score', kind: 'pill', r: pr[2], label: 'Score', value: score });
    controls.push({ id: 'word', kind: 'label', r: [0, wordY, W, WORD_H], label: word || ' ', font: 17, mono: true, bold: true, color: PAL.text });
    if (msg) controls.push({ id: 'msg', kind: 'label', r: [0, msgY, W, MSG_H], label: msg.text, font: 12, color: msg.kind === 'good' ? PAL.emerald : PAL.rose });
    const ar = cuiRow(Math.floor(W * 0.08), actY, Math.floor(W * 0.84), ACT_H, 2);
    controls.push({ id: 'clear', kind: 'button', r: ar[0], label: 'Clear', disabled: done || path.length === 0, action: () => { setPath([]); setMsg(null); } });
    controls.push({ id: 'submit', kind: 'button', r: ar[1], label: 'Submit', primary: true, disabled: done || word.length < 3, action: submit });
  }
  const ctlRef = useRef([]);
  ctlRef.current = controls;
  const [pressedId, setPressedId] = useState(null);

  const geomRef = useRef({});
  geomRef.current = { wsprStep, boardX, boardY };
  usePointerCell(canvasRef, cuiWrapHandlers(ctlRef, setPressedId, {
    onTap: (p) => {
      const g = geomRef.current;
      const c = Math.floor((p.x - g.boardX) / g.wsprStep), r = Math.floor((p.y - g.boardY) / g.wsprStep);
      if (c < 0 || c >= WSPR_SIZE || r < 0 || r >= WSPR_SIZE) return;
      const i = r * WSPR_SIZE + c;
      const onPath = path.includes(i);
      const selectable = !done && (path.length === 0 || onPath || adjacent(path[path.length - 1], i));
      if (selectable) tap(i);
    },
  }));
  useCanvasBoard(canvasRef, {
    width: W,
    height: H,
    deps: [path, done, wsprCell, W, fmtLeft, found, msg, pressedId],
    draw: (ctx) => {
      cuiDrawControls(ctx, ctlRef.current, pressedId);
      ctx.save();
      ctx.translate(boardX, boardY);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < WSPR_SIZE * WSPR_SIZE; i++) {
        const r = Math.floor(i / WSPR_SIZE), c = i % WSPR_SIZE;
        const x = c * wsprStep, y = r * wsprStep;
        const onPath = path.includes(i);
        const isLast = path.length > 0 && path[path.length - 1] === i;
        const selectable = !done && (path.length === 0 || onPath || adjacent(path[path.length - 1], i));
        ctx.save();
        if (!selectable) ctx.globalAlpha = 0.45;
        klRR(ctx, x, y, wsprCell, wsprCell, 10);
        ctx.fillStyle = onPath ? PAL.accent : PAL.card;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = onPath ? PAL.accent : PAL.border;
        ctx.stroke();
        ctx.font = `700 ${Math.round(wsprCell * 0.42)}px 'JetBrains Mono', monospace`;
        ctx.fillStyle = onPath ? '#fff' : PAL.text;
        ctx.fillText(L[i], x + wsprCell / 2, y + wsprCell / 2 + 1);
        ctx.restore();
        if (isLast) {
          klRR(ctx, x - 1.5, y - 1.5, wsprCell + 3, wsprCell + 3, 11);
          ctx.lineWidth = 3;
          ctx.strokeStyle = PAL.gold;
          ctx.stroke();
        }
      }
      ctx.restore();
    },
  });

  return (
    // PHASE 3 (#131) — .fit-col + fitShell: true stops the page scrolling as the
    // found-words list grows (that list now has its own scroll strip).
    <div className="fit-col">
      <div className="wspr-grid cui-frame" ref={boxRef}>
        <canvas
          ref={canvasRef}
          className="wspr-canvas board-canvas"
          role="grid"
          aria-label={`Word Sprint letters — tracing ${word || 'nothing'}, ${found.length} words found`}
        />
      </div>
      <CuiTwin controls={controls} />

      {found.length > 0 && (
        <div className="wspr-found">
          {found.slice().reverse().map(w => <span key={w}>{w.toLowerCase()} +{wsprPoints(w.length)}</span>)}
        </div>
      )}
    </div>
  );
}
