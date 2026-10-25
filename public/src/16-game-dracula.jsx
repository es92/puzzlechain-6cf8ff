/* ============================================================
   Escape from Dracula — a gothic narrative reader
   ============================================================
   The change this file ships is PAGING: a long prose scene must never scroll
   off screen. `TextPager` measures the box a scene actually has, wraps and
   chunks the prose to it, and shows ONE page at a time behind a quiet "More"
   control. Every page shows every line of the prose on some page — this is a
   measured layout, not a line-clamp that hides what the reader never gets
   back.

   It is declared once and globally available (the files are concatenated, one
   scope), so the next paged surface — a dialogue line, an item or room
   description — reuses it instead of growing a second copy.

   The house is atmospheric, not violent: nothing here is harmed, and the
   scares are lace, floorboards and the colour of dried roses.
   ============================================================ */

/* ---- Pure pager core ----------------------------------------------------
   DOM-free except through a caller-supplied measure callback, so the self-tests
   hold it without a browser layout. The page size is DERIVED from the measured
   box and the RENDERED line height — never a character budget, which would
   drift the moment the font changed. */

/* One cached canvas context, re-fonted per measurement. A canvas measures the
   exact string at the exact font the DOM will render it in. */
let _tpCtx = null;
function tpMeasureCtx(font) {
  if (typeof document === 'undefined') return null;
  if (!_tpCtx) {
    const c = document.createElement('canvas');
    _tpCtx = c && c.getContext ? c.getContext('2d') : null;
  }
  if (_tpCtx && font) _tpCtx.font = font;
  return _tpCtx;
}

/* The font the page renders at, read from computed style. */
function tpFontOf(el) {
  const cs = getComputedStyle(el);
  return (cs.fontStyle || 'normal') + ' ' + (cs.fontWeight || '400') + ' '
    + (cs.fontSize || '15px') + ' ' + (cs.fontFamily || 'sans-serif');
}

/* Rendered line height in px. `line-height: normal` computes to the string
   "normal"; fall back to a sane multiple of the font size. */
function tpLineHeightOf(el) {
  const cs = getComputedStyle(el);
  const fs = parseFloat(cs.fontSize) || 15;
  const lh = parseFloat(cs.lineHeight);
  return lh > 0 ? lh : fs * 1.5;
}

/* Greedy word wrap to `maxW`. Never splits a word: a single word wider than the
   line gets its own (overflowing) line rather than being cut. */
function tpWrapText(measure, text, maxW) {
  const words = String(text == null ? '' : text).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  if (typeof measure !== 'function') return [words.join(' ')];
  const lines = [];
  let line = words[0];
  for (let i = 1; i < words.length; i++) {
    const probe = line + ' ' + words[i];
    if (measure(probe) <= maxW) { line = probe; continue; }
    lines.push(line);
    line = words[i];
  }
  lines.push(line);
  return lines;
}

/* How many whole lines fit in `boxH` at `lineH`. */
function tpLinesPerPage(boxH, lineH) {
  if (!(boxH > 0) || !(lineH > 0)) return 0;
  return Math.max(1, Math.floor(boxH / lineH));
}

/* Chunk paragraphs into pages that each fit `maxLines` measured lines.

   A paragraph is ATOMIC whenever it fits, so a page can end on a paragraph
   boundary; a paragraph longer than a page is the one case that continues
   across pages, split at a line boundary and closed cleanly. LOSSLESS: joining
   every block with a space reproduces the paragraphs (modulo whitespace), and
   every word is whole.

   Each block carries `pi`, the paragraph it came from, so a re-wrap can hold
   the reader's position by PARAGRAPH — the page number is not stable across a
   resize, the position is. `gapPx` is the top margin between blocks, charged
   here so a page cannot overflow on the margins alone. */
function tpPaginate(measure, paragraphs, maxW, maxLines, lineH, gapPx) {
  const perLines = Math.max(1, maxLines | 0);
  const budget = perLines * lineH;
  const pages = [[]];
  let used = 0;
  paragraphs.forEach((para, pi) => {
    const lines = tpWrapText(measure, para, maxW);
    if (!lines.length) return;
    let i = 0;
    while (i < lines.length) {
      const page = pages[pages.length - 1];
      const gap = page.length ? gapPx : 0;
      const fitLines = Math.floor((budget - used - gap) / lineH);
      if (fitLines <= 0) { pages.push([]); used = 0; continue; }
      const whole = lines.length - i;
      if (whole <= fitLines) {
        page.push({ pi, text: lines.slice(i).join(' '), lines: whole });
        used += gap + whole * lineH;
        i = lines.length;
        continue;
      }
      // Longer than what remains on this page.
      if (page.length === 0) {
        // A fresh page and still too long: split at the page boundary.
        const take = Math.min(fitLines, whole);
        page.push({ pi, text: lines.slice(i, i + take).join(' '), lines: take });
        used = take * lineH;
        i += take;
        if (i < lines.length) { pages.push([]); used = 0; }
        continue;
      }
      // Keep a still-pageable paragraph whole: start it on a fresh page.
      if (whole <= perLines) { pages.push([]); used = 0; continue; }
      // Genuinely longer than a page: fill what remains, then continue.
      const take = Math.min(fitLines, whole);
      page.push({ pi, text: lines.slice(i, i + take).join(' '), lines: take });
      used += gap + take * lineH;
      i += take;
      if (i < lines.length) { pages.push([]); used = 0; }
    }
  });
  while (pages.length > 1 && pages[pages.length - 1].length === 0) pages.pop();
  return pages;
}

/* The one rule that hides the advance control: a single page has nothing to
   advance to, and the last page must not offer a press that does nothing. */
function tpCanAdvance(pageCount, idx) {
  return pageCount > 1 && idx < pageCount - 1;
}

/* ---- The pager component ------------------------------------------------
   One page at a time. The control, the tap-anywhere area and the keyboard all
   call ONE advance(), so they can never disagree. */
function TextPager({ text, endLine, onPageTurn }) {
  const pageRef = useRef(null);
  const { boxW, boxH } = useFitBox(pageRef, { cols: 1, rows: 1, maxCell: 100000 });
  const [pages, setPages] = useState([]);
  const [idx, setIdx] = useState(0);

  const paragraphs = String(text == null ? '' : text)
    .split('\n').map(s => s.trim()).filter(Boolean);
  const paraKey = paragraphs.join('\u0001');

  // Re-wrap and re-chunk whenever the prose or the measured box changes.
  useEffect(() => {
    const el = pageRef.current;
    if (!el || boxW <= 0 || boxH <= 0) return;
    const cs = getComputedStyle(el);
    const pt = parseFloat(cs.paddingTop) || 0, pb = parseFloat(cs.paddingBottom) || 0;
    const pl = parseFloat(cs.paddingLeft) || 0, pr = parseFloat(cs.paddingRight) || 0;
    const width = Math.max(0, boxW - pl - pr - 8);
    const height = Math.max(0, boxH - pt - pb);
    const lineH = tpLineHeightOf(el);
    const per = tpLinesPerPage(height, lineH);
    if (width < 24 || per < 1) return;
    // The block gap is the CSS `margin-top` on .tp-text, in rem.
    const rootFs = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const gapPx = 0.7 * rootFs;
    const ctx = tpMeasureCtx(tpFontOf(el));
    const measure = ctx ? (s) => ctx.measureText(s).width : null;
    setPages(tpPaginate(measure, paragraphs, width, per, lineH, gapPx));
  }, [pageRef, boxW, boxH, paraKey]);

  // Hold the reader's PARAGRAPH, not their page number: a rotation or resize
  // re-chunks, and the first page that starts at the paragraph they were on is
  // where they should land. New prose starts at the top.
  const anchorRef = useRef(0);
  const textRef = useRef(text);
  useEffect(() => {
    if (textRef.current !== text) { textRef.current = text; anchorRef.current = 0; setIdx(0); return; }
    if (!pages.length) return;
    let target = 0;
    for (let i = 0; i < pages.length; i++) {
      const first = pages[i][0];
      if (!first) continue;
      if (first.pi === anchorRef.current) { target = i; break; }
      if (first.pi < anchorRef.current) target = i;
    }
    setIdx(target);
  }, [pages, text]);

  const last = pages.length - 1;
  const multi = pages.length > 1;
  const canAdvance = tpCanAdvance(pages.length, idx);
  const page = pages[idx] || [];

  // The one advance path. A fast double tap resolves to the same next index,
  // so it can never skip a page.
  const advance = () => {
    if (!canAdvance) return;
    const next = idx + 1;
    if (!pages[next] || !pages[next].length) return;
    anchorRef.current = pages[next][0].pi;
    cgSound('click');
    cgHaptic(8);
    setIdx(next);
    if (onPageTurn) onPageTurn(next + 1);
    // The control disappears on the last page; move focus to the text so a
    // keyboard reader is not stranded on a button that just vanished.
    if (next >= last && pageRef.current) {
      requestAnimationFrame(() => { try { pageRef.current.focus(); } catch (_) {} });
    }
  };

  const onKeyDown = (e) => {
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') {
      e.preventDefault();
      advance();
    }
  };

  const ready = boxW > 0 && boxH > 0;
  const showEnd = ready && pages.length > 0 && !canAdvance && !!endLine;

  return (
    <div className="tp-root" data-tp-paged={multi ? '1' : '0'}>
      <div
        ref={pageRef}
        className={'tp-page' + (canAdvance ? ' tp-tappable' : '')}
        data-tp-page={multi ? idx + 1 : 0}
        data-tp-pages={pages.length}
        tabIndex={canAdvance ? 0 : -1}
        aria-label={canAdvance ? 'Show more of the chapter' : undefined}
        onKeyDown={canAdvance ? onKeyDown : undefined}
        {...(canAdvance ? tapProps(advance) : {})}
      >
        {page.map((b, i) => <p key={i} className="tp-text">{b.text}</p>)}
      </div>
      <div className="tp-foot">
        {multi && (
          <div className="tp-dots" aria-hidden="true">
            {pages.map((_, i) => <i key={i} className={i === idx ? 'on' : ''} />)}
          </div>
        )}
        {canAdvance && (
          <button type="button" className="tp-more" {...tapProps(advance)}>More ▾</button>
        )}
        {showEnd && <div className="tp-end">{endLine}</div>}
      </div>
    </div>
  );
}

/* ---- The chapters ------------------------------------------------------
   Chapter 1 is deliberately longer than one phone screen, so the paged state
   is the DEFAULT state a reader meets rather than a corner they hunt for.
   `?chapter=2` opens the short chapter — one page, so no control at all — the
   other half of the paging rule. */
const DRAC_CHAPTERS = [
  {
    id: '1',
    title: 'The gate at dusk',
    end: 'The clocks have not stopped yet. But the hall is very quiet.',
    paragraphs: [
      'The coach stops where the road gives up and turns to gravel, and the driver will go no further. He points at a gate set into a wall of black pines, says the count has been expecting no one, and is gone before you can ask him what he means by it.',
      'You walk the last mile on foot. The wall is taller than it looked from the road, and the gate is iron and cold and standing open. Beyond it the courtyard swallows sound: your boots on the gravel make no echo at all, and the pines lean in as though listening.',
      'At the door a lantern is already lit and waiting, as if it had been lit before you were born and set down only a moment ago. The hinges do not creak. The hall beyond smells of dust and old wax, and under that something sweeter, like fruit left too long in a warm room.',
      'On the table in the entrance hall there is a letter addressed to you in a hand you do not know. Beside it lies a key that fits no door you have yet seen, and a candle burned down to the tin. The paper is soft with handling, as though it had been read many times by someone who never meant to send it.',
      'The letter says only that you are welcome, that the house has kept a room for you longer than you have been alive, and that you should not go up the west stair after the clocks have stopped. It is signed with a name you almost recognise and cannot quite place, and the ink is the colour of dried roses.',
      'Somewhere above you a floorboard takes one slow step, and then is still. The hall stretches away in both directions, hung with portraits whose faces the years have worn to a pale suggestion. None of them look at you, and all of them seem, somehow, to be listening for the same sound you are.',
      'A draught moves through the corridor and the candle-ends gutter, though no window is open that you can see. On the sill of the tall window at the end of the hall, a handful of dark feathers has been arranged in a neat line, each one pointing the way you came in. The house, it seems, has opinions about your arrival.',
      'You think of the road behind you, unspooling pale and straight under a sky with no moon in it, and of the driver who would not say the count name aloud. You think of how easily you walked through the gate, as though it had been opened for you and never for anyone else, and of how you did not once look back.',
      'A clock somewhere in the house begins to strike, and counts past twelve, past one, and does not stop. The sound is soft and even, like a hand smoothing a sheet, and with every stroke the hall seems to grow a little longer and the portraits a little more attentive.',
      'On the wall beside the west stair there is a small brass plate, polished by use, that reads: guests are asked not to linger in the hall after the clocks have stopped. Below it, in a different and much older hand, someone has scratched a single word.',
      'You could take the letter and the key and go back out through the gate, and no one would ever know you had come this far. Or you could climb the stair the letter warns you away from, and learn what the house has been keeping for you. The clocks, for now, are still ticking.',
    ],
  },
  {
    id: '2',
    title: 'The letter',
    end: 'The end of the chapter.',
    paragraphs: [
      'The letter is shorter than it looked from across the hall. It asks after your journey, hopes the road was kind, and says the room at the top of the east stair has been made up with fresh sheets and a fire that has been burning, on and off, for a very long time. It ends: we have so much to discuss, and so few evenings.',
      'You fold it once and put it in your pocket. The key is warm in your other hand.',
    ],
  },
];

/* `?chapter=2` opens the short chapter, so the one-page state is URL-reachable
   for a check and a screenshot without a click. Anything else is chapter 1. */
function dracChapterParam() {
  try { return new URLSearchParams(window.location.search).get('chapter'); }
  catch (_) { return null; }
}

function EscapeFromDraculaGame({ onStepChange }) {
  const want = dracChapterParam();
  const chapter = DRAC_CHAPTERS.find(c => c.id === want) || DRAC_CHAPTERS[0];
  return (
    <div className="drac-card" data-drac-chapter={chapter.id}>
      <div className="drac-head">
        <div className="drac-kicker">Escape from Dracula</div>
        <h2 className="drac-title">{chapter.title}</h2>
      </div>
      <TextPager
        text={chapter.paragraphs.join('\n')}
        endLine={chapter.end}
        onPageTurn={onStepChange ? (n) => onStepChange(n) : undefined}
      />
    </div>
  );
}
