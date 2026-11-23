# Chess Coach — shared contract (all agents must follow this)

Project: browser chess game in `chess/game/` (index.html + engine.js + pieces/). Rules engine in `engine.js`
(global `Chess`, perft-verified — DO NOT break it; re-run perft after any change: start d4=197281, kiwipete
`r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -` d3=97862).
Board squares are indices 0..63, `r*8+c`, r=0 is rank 8 (so a8=0, h1=63). Pieces are strings like `'wK'`,`'bP'`.
State = `{board, turn:'w'|'b', castle:{wK,wQ,bK,bQ}, ep:index|-1}`. Move = `{from,to,promo?,flag?}`
(flag: 'double'|'ep'|'castleK'|'castleQ'). Existing API: `Chess.{fromFEN,newGame,legal,apply,status,inCheck,bestMove,perft,kingSq,score}`.
`Chess.score(state, depth)` = centipawns from White's view (+99000 ≈ White mates).

## Product
A coach the user picks (4 coaches × 2 languages, see `coaches.json`), speaking pre-generated human-sounding audio
AND showing a caption. Languages: English (`en`) and Urdu (`ur`). Three levels (`coaches.json` → levels):
- `learn`: guided lessons (`lessons.json`) + free hints, coach explains rules, never judges harshly.
- `friendly`: play the bot; coach comments on moves, warns BEFORE a bad move is committed, offers take-back/retry.
- `serious`: coach silent except illegal-move explanations, game result, and hints the user asks for.

## Urdu text rules (IMPORTANT)
Urdu coaching is **code-mixed**: Urdu sentences, but chess terms stay English the way Pakistani players say them:
Queen, King, Rook, Bishop, Knight, Pawn, Check, Checkmate, Stalemate, Castling, En passant, Promotion, Fork, Pin,
Skewer, Draw, Opening, Endgame, Center, Develop, Capture, Square, File, Rank, Move, Hint, Takeback, Undo, Resign.
Each Urdu line has TWO strings:
- `ur`  — caption shown on screen: Urdu script, English chess terms written in **Latin** (e.g. `یہ چال Stalemate بنا دے گی۔`)
- `say_ur` — what the TTS reads: Urdu script ONLY, every English term transliterated phonetically into Urdu script
  (کوئین، کنگ، رُک، بشپ، نائٹ، پان، چیک، چیک میٹ، اسٹیل میٹ، کاسلنگ، ان پاسنٹ، پروموشن، فورک، پن، ڈرا، اوپننگ، اینڈ گیم،
  سینٹر، موو، ہنٹ، ٹیک بیک). No Latin letters, no digits in `say_ur` (TTS mispronounces them). Use Urdu punctuation ۔ ، ؟ !
- When a term is introduced the first time in a lesson, the coach also explains it once in plain Urdu
  (e.g. "Stalemate یعنی جب آپ کے پاس کوئی legal move نہ ہو مگر کنگ پر چیک بھی نہ ہو") — that is the point of the code-mix.
English: `en` caption; `say_en` only needed when `en` has `{placeholders}`; otherwise the TTS reads `en`.

## File layout & ownership (each agent writes ONLY its own files)
| path (under chess/) | owner |
|---|---|
| `game/coach/coaches.json`, `SPEC.md` | lead (done) |
| `game/coach/lines.json` | agent **lines** |
| `game/coach/lessons.json` | agent **lessons** |
| `game/engine.js` (additive exports only), `game/coach/coach.js`, `game/coach/test_coach.js` | agent **brain** |
| `tts/gen_coach_audio.py`, `game/coach/audio/**` (generated) | agent **tts** |
| `game/index.html`, `game/coach/coach-ui.js`, `game/coach/coach.css` | agent **ui** |

## lines.json schema  (agent: lines)
```json
{ "version": 1,
  "lines": { "<event.id>": { "variants": [ { "en": "...", "ur": "...", "say_ur": "...", "say_en": "(optional)" }, ... ] }, ... },
  "frags": { "<frag.id>": { "en": "knight", "ur": "Knight", "say_en": "knight", "say_ur": "نائٹ" }, ... } }
```
- Every event id in the catalog below needs **2–3 variants** (more for frequent ones: move.good, move.best, praise.*).
- Captions may contain placeholders `{piece}` `{square}` `{from}` `{to}` `{san}` `{opp_piece}` `{color}`; coach.js substitutes the localized
  piece name (`frag.piece.*` ur display = English word) / square text. **say_* never contains placeholders** — spoken content is static,
  details are in the caption; where a move must be spoken the brain appends fragment clips (below).
- Keep spoken lines short (≤ 18 words). Natural spoken style, contractions in English, no emoji, no markdown.
- Tone: encouraging, never sarcastic or shaming; calm on blunders.

### Fragments (spoken building blocks, concatenated)
`frag.piece.{king,queen,rook,bishop,knight,pawn}`, `frag.color.{white,black}`, `frag.sq.{a1..h8}` (64; en say = "e four", ur say = "ای فور"
i.e. English letter + number words in Urdu script: اے بی سی ڈی ای ایف جی ایچ + ون ٹو تھری فور فائیو سکس سیون ایٹ),
`frag.to` ("to"/"سے"→ use "تک"? choose natural: en "to", ur "کو"), `frag.takes` ("takes"/"لیتا ہے"), `frag.on` ("on"/"پر"), `frag.from`,
`frag.castle_short`, `frag.castle_long`, `frag.promote_to`, `frag.check_word`, `frag.mate_word`.
Spoken move = `[frag.piece.X, frag.to, frag.sq.YY]` (Urdu order differs: `[frag.sq.YY, frag.to?...]` — brain asks `Coach.spokenMove(move, lang)` for the
right clip list; lines agent supplies fragments that compose naturally in both orders).

## Event id catalog (agent lines must write ALL of these; agent brain emits them)
**session**: `session.welcome`, `session.level.learn`, `session.level.friendly`, `session.level.serious`, `session.you_white`, `session.you_black`,
`session.coach_changed`, `session.language_changed`, `session.new_game`, `session.goodbye`
**illegal move (explain why, invite retry)**: `illegal.not_your_turn`, `illegal.opponent_piece`, `illegal.empty_square`, `illegal.own_piece_target`,
`illegal.bishop`, `illegal.rook`, `illegal.knight`, `illegal.queen`, `illegal.king`, `illegal.king_attacked_square`, `illegal.pawn_forward`,
`illegal.pawn_capture_only_diagonal`, `illegal.pawn_blocked`, `illegal.pawn_backward`, `illegal.blocked_path`, `illegal.must_escape_check`,
`illegal.pinned_piece`, `illegal.castle_moved`, `illegal.castle_blocked`, `illegal.castle_in_check`, `illegal.castle_through_check`,
`illegal.en_passant_expired`, `illegal.game_over`, `illegal.wait_bot`, `illegal.repeat_offender` (3rd illegal try in a row: offer a hint)
**move feedback (after the user's move is played)**: `move.brilliant`, `move.best`, `move.good`, `move.ok`, `move.inaccuracy`, `move.mistake`, `move.blunder`,
`move.capture`, `move.capture_free_piece`, `move.good_trade`, `move.bad_trade`, `move.check_given`, `move.castle`, `move.en_passant`, `move.promotion`,
`move.promotion_choice`, `move.center`, `move.develop`, `move.early_queen`, `move.repeat_shuffle`, `move.missed_capture`, `move.missed_mate`, `move.mate_in_one_available`
**pre-move warnings (move NOT yet committed; coach offers choices)**: `warn.hangs_piece` (+ `warn.hangs.{king,queen,rook,bishop,knight,pawn}`),
`warn.blunder_queen`, `warn.walks_into_mate`, `warn.stalemate_trap`, `warn.stalemate_trap_retry`, `warn.missed_mate_confirm`, `warn.repetition_draw`, `warn.fifty_move`
**offers (UI buttons)**: `offer.takeback`, `offer.better_move`, `offer.continue_anyway`, `offer.retry`, `offer.hint`, `offer.show_move`, `offer.lower_bot`
**hints (3 tiers)**: `hint.tier1` (look at where your pieces are attacked / think about checks & captures), `hint.tier2` (move THIS piece — then
brain adds `frag.piece.X`), `hint.tier3` (the move — brain adds piece/to/square clips), `hint.none_needed`, `hint.cooldown`, `hint.learn_idea.{center,develop,king_safety,capture,checkmate}`
**you are in danger / status**: `status.you_in_check`, `status.opp_in_check`, `status.opp_threatens_mate`, `status.piece_attacked`, `status.pinned_warning`
**opponent (bot) moves**: `opp.captured_your_piece`, `opp.captured_pawn`, `opp.check`, `opp.threat`, `opp.blunder_chance`, `opp.castled`, `opp.promoted`
**game end**: `end.win`, `end.lose`, `end.draw.stalemate_you_stalemated`, `end.draw.stalemate_you_delivered`, `end.draw.insufficient`, `end.draw.repetition`, `end.draw.fifty`,
`end.resign_confirm`, `end.resigned`, `end.post_game_tip`, `end.many_takebacks`, `end.lost_encourage`
**endgame teaching**: `teach.king_and_queen_mate`, `teach.avoid_stalemate_when_ahead`, `teach.only_king_left`
**misc**: `idle.nudge`, `idle.long`, `encourage.after_mistake`, `encourage.streak_good_moves`, `thinking.bot`, `undo.done`, `newgame.confirm`, `sound.muted_hint`

## coach.js API (agent: brain) — global `Coach`
```js
await Coach.load(basePath = 'coach/')            // fetches lines.json (and nothing else); idempotent
Coach.configure({ level:'learn'|'friendly'|'serious', lang:'en'|'ur', humanColor:'w'|'b'|null })
Coach.explainIllegal(state, fromSq, toSq)         // → Event | null  (null if the move is actually legal)
Coach.preMove(state, move, ctx)                   // before committing a legal user move → Event|null  (warn.* + offers) ; never for serious level except stalemate trap if ctx.warnStalemate
Coach.afterMove(stateBefore, move, stateAfter, ctx) // → Event|null  quality feedback for the user's move
Coach.afterOpponentMove(stateBefore, move, stateAfter, ctx) // → Event|null
Coach.gameEnd(state, ctx)                         // → Event|null  (win/lose/draws, uses ctx.humanColor)
Coach.hint(state, tier /*1..3*/, ctx)             // → Event  (tier 3 includes spoken move clips), also returns .move for UI highlighting
Coach.bestMove(state)                             // → {move, san, scoreCp}  (depth 3)
Coach.say(id, params, opts)                       // → Event for any catalog id (variant chosen round-robin, not same twice in a row)
Coach.spokenMove(move, state, lang)               // → [clipId,...] clips spelling the move
Coach.san(state, move)                            // → "Nf3"
ctx = { level, lang, humanColor, takebacks:number, moveNumber, illegalStreak, history:[{move,san}], repetitionCount }
```
Event shape (returned by every call):
```js
{ id:'move.blunder', variant:1, severity:'info|praise|warn|danger',
  caption:{ en:'…', ur:'…' },                 // placeholders already substituted, ur = display string (Latin chess terms)
  speak:['move.blunder#1', 'frag.piece.knight','frag.to','frag.sq.f3'],   // ordered clip ids (variants as "id#n", 0-based)
  offers:['takeback','better_move','continue_anyway'],                    // which buttons the UI should show (may be empty)
  highlight:{ squares:[idx,…], arrows:[{from,to,kind:'best|threat'}] },   // optional UI hints
  data:{ quality:'blunder', loss:420, best:{move,san}, piece:'N', … } }
```
Quality thresholds (centipawn loss vs best, depth-3 search, White-view `Chess.score`): best ≤10, good ≤50, ok ≤100, inaccuracy ≤200, mistake ≤400, blunder >400;
brilliant = best move that is a sacrifice (gives up ≥300cp of material immediately) and engine score is still within 30cp of best. Mate-in-1 miss ⇒ always `move.missed_mate`.
Stalemate trap: user move leaves opponent with no legal moves while NOT in check AND user has ≥ +300cp material advantage (or lesson says so) ⇒ `warn.stalemate_trap` with offers `['retry','better_move']`.

## Clip ids & audio files (agent: tts)
Clip id: `"<event.id>#<variantIndex>"` or `"<frag.id>"` or `"lesson.<lessonId>.<stepId>.<intro|success|wrong|hint|extra>"` (lessons.json inline texts).
File: `game/coach/audio/<coachId>/<lang>/<clipId with '#'→'_'>.mp3`; manifest `game/coach/audio/manifest.json`:
`{ "<coachId>": { "en": ["clip",…], "ur": […] } }`. Text spoken = `say_en` (or `en` if no placeholders) / `say_ur`; for lessons: same fields.
Voices per coach per language: `coaches.json`. Use edge-tts (venv `chess/tts/.venv`). Idempotent (skip existing, `--force` to redo), concurrency ~6, retry with backoff.

## lessons.json schema (agent: lessons)
```json
{ "version":1, "lessons":[ { "id":"pawn", "title":{"en":"The Pawn","ur":"Pawn"}, "summary":{"en":"…","ur":"…"},
  "steps":[ { "id":"s1", "fen":"8/8/8/8/8/8/4P3/4K3 w - -", "orientation":"w",
     "type":"show|move|tap|mate1",
     "intro":{"en":"…","ur":"…","say_ur":"…"},      // spoken+caption when the step starts
     "expect":[{"from":"e2","to":"e4"}],             // type=move: accepted moves (any listed); anything else → wrong
     "tap":["d4","f4"],                              // type=tap: squares the user must tap (any order)
     "highlight":["e2"],                             // squares to glow at step start
     "hint":{…}, "success":{…}, "wrong":{…},         // each {en,ur,say_ur,say_en?}; wrong = gentle, explains, user retries (move is undone)
     "reply":{"from":"e7","to":"e5"}                 // optional scripted opponent reply after success
  } ] } ] }
```
Curriculum (in order, ~14 lessons): board & squares/coordinates, the goal (checkmate), King, Rook, Bishop, Knight, Queen, Pawn (move + capture),
promotion, check (and how to escape: move/block/capture), checkmate (back-rank, queen+king, two rooks), **Stalemate** (what it is, why a winner must avoid it),
castling, en passant, piece values & trades, opening principles (center, develop, king safety), simple tactics (fork, pin), draws (repetition, fifty, insufficient).
Every `fen` must be valid for `Chess.fromFEN`, every `expect` move must be legal, `mate1` steps must truly have a mate-in-1, stalemate lesson positions must be real
stalemates/near-stalemates (validate with a node script against `engine.js`). `ur` captions: Urdu with Latin chess terms; `say_ur` per the rules above.

## UI behaviour (agent: ui)
- Coach picker (4 cards: avatar emoji on coach color, name, bio, ▶ "hear voice" preview using `session.welcome#0`), language toggle EN | اردو (RTL + Noto Nastaliq
  Urdu / Noto Naskh Arabic font stack for Urdu captions, `dir="rtl"`), level picker, volume + mute for coach voice, "replay last line" button, captions on/off.
- Persist coach/lang/level/volume in localStorage (try/catch). Keep existing game features (bot, undo, nav, sounds, eval bar).
- Coach bubble: avatar + caption (typing-in effect optional) + offer buttons (Take back / Show better move / Continue anyway / Retry / Hint) rendered from `event.offers`.
- Audio queue: plays `speak` clips sequentially via `<audio>`/WebAudio with a ~40ms gap, interrupts the previous coach line when a new one starts; if a clip file is missing
  (check manifest) still show the caption; never block gameplay on audio.
- Wiring: on every user click-move attempt → `explainIllegal` (if the click targets an illegal square of a selected piece) → show event, keep selection;
  legal move → `preMove` (friendly/learn): if it returns an event with offers, DO NOT commit; show bubble; Take back/Retry = cancel move; Continue anyway = commit; Better move = highlight best.
  After commit → `afterMove`; after bot reply → `afterOpponentMove`; game over → `gameEnd`. Hint button (3 tiers escalate per press, reset each move). Idle timer 45s → `idle.nudge`.
- Learn level: lesson menu (list of lessons from lessons.json with progress ✓ in localStorage), step runner implementing `show|move|tap|mate1` per the schema, own board position via FEN,
  coach speaks intro/success/wrong/hint clips (ids per spec), "Next" button, can skip, can leave to free play.
- Takeback in Friendly must always be available and the coach reacts (`undo.done`).
- Must work with `file://`-less static server (fetch relative paths). Keep Urdu captions legible (font-size ≥ 18px, line-height 2).

## Edge cases to cover (all agents: think about these)
Illegal-move reasons per piece; tapping opponent piece / empty square; moving during bot thinking; moving in check; pinned piece; king into attacked square; castling
variants; en passant window; promotion choice; game over clicks; stalemate trap while ahead; user stalemated (console); K+Q vs K teach; repetition / 50-move / insufficient
material; repeated shuffling; hanging pieces & free captures; missed mate-in-1 / allowing mate-in-1; early queen; undefended attacked piece after the bot's move;
many takebacks in a row (encourage, stop nagging); user keeps blundering (offer lower bot level); idle user; user resigns; language/coach switched mid-game (re-say current tip in new voice);
audio file missing; Urdu RTL caption mixing Latin terms (use unicode bidi isolates `⁨…⁩`/`<bdi>` around Latin terms).
