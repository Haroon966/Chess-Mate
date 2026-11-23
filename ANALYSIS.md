# Chess.com Android app — architecture notes (educational analysis)

Static analysis of the `com.chess` Android app (base.apk + splits), done by extracting
the APK and decompiling its dex files with [jadx](https://github.com/skylot/jadx).

> No full decompiled source, APKs, or keys are checked into this repo — consistent
> with the rest of this study (see root `README.md`). This file is the write-up only.
> **No modified/repackaged build was produced from this analysis.**

## 1. Puzzles

No puzzle set is shipped on-device. Puzzles are fetched live via Twirp RPC
(protobuf-over-HTTP), e.g.:

- `chesscom.puzzles.v1.PuzzleService/GetNextRatedPuzzle`
- `chesscom.puzzles.v1.PuzzleService/SubmitRatedSolution`
- `chesscom.puzzles.v1.PuzzleService/GetUnratedBatch` / `SubmitUnratedSolution`
- `chesscom.puzzles.v2.DailyPuzzleService/*` (daily puzzle, history, stats, friends)

A local Room/SQLite DB caches **progress only** — tables like `puzzle_path_user_xp`
(xp, streak, tier, level, easy/hard/x-hard counts solved) and `coach_for_puzzle`
(coach hint/goal speech keyed by `problem_id`). No puzzle positions or solutions
live in these tables; they're populated from server responses as you play.

Code: `com.chess.features.puzzles`, `com.chess.internal.puzzles`,
`com.chess.puzzles.recent`, `com.chess.stats.puzzles`.

## 2. Play vs Coach

- Coach roster (David, Hikaru, Magnus, Ben, Mae, Anna, Levy, Canty, Danny, Dante,
  Judit, Nadia, Tania, Vishy) comes from `chesscom.coaches.v2.CoachesService/ListCoaches`.
  Images load from `assets-coaches.chess.com`; speech lines from
  `GetCoachSpeech`/`text-and-audio.chess.com` — not bundled.
- Bundled: one coach's (David) facial-animation rig (`coach_david_expressions.riv`),
  nudge-trigger configs (`coach_nudge_*.pb`) and avatar art.
- Bot opponents use 14 bundled opening books (`assets/*.bin`: aggressive, balanced,
  beginner, classical, fischer, gambit, indian, nakamura, offbeat, positional,
  quick_queen, rensch, winger, f-pawner) plus a local engine
  (`com.chess.compengine.*`).
- Game lifecycle: `StartedGameAgainstCoach` → `SaveCoachGame`, gated by
  `GetCoachQuota` (server-tracked usage limit).

## 3. Learn (lessons / courses / skills)

- `chesscom.lessons.{v1,v2,v3}.LessonService`: `GetLessonPath`, `GetNextLesson`,
  `GetLesson`, `CompleteLesson`, `SkipToLesson`, `SetUserInitialLevel`.
- The Courses UI (`assets/courses/`, `assets/family/`) is React Native via Module
  Federation (`__federation_expose_App.chunk.bundle`) — content still server-fetched.
- `chesscom.skills.v1.SkillsService`: `GetSkills`, `GainSkillPoints`,
  `GetSkillsPositions`.

## 4. Paywall / entitlement mechanism (the interesting part)

This is **not** a local boolean flag like the Free Fire ad-gate this repo's root
patch targets. It's server-authoritative:

```
LoginData (server's /login response)
  premium_status: Int            ──┐
  show_ads: Boolean                 │  plain fields on the
  show_interstitial_ads: Boolean?   │  session DTO, no local
  has_lc_priority: Boolean?       ──┘  signature/attestation

        │ PremiumStatus.of(intVal)
        ▼
PremiumStatus enum (BASIC/NO_ADS/GOLD/PLATINUM/DIAMOND/STAFF)
        │
        ▼
SessionStore (com.chess.net.v1.users.SessionStore)
  H()  -> current PremiumStatus (cached from session)
  o()  -> isAtLeastGold(H())
  m()  -> H() == BASIC
  t()/K() -> show_ads / show_interstitial_ads flows
        │
        ▼
~190 call sites across com.chess.features.paywall and feature code
check these flows to gate ads, coach quota, lesson tiers, etc.
```

Key classes: `com.chess.entities.UserMembershipLevel` (maps raw server `level`/`code`
→ `PremiumStatus`), `com.chess.entities.PremiumStatus` /`PremiumStatusKt`
(`isAtLeastGold/Platinum/Diamond`), `com.chess.net.v1.users.SessionStore` (reads it
all off the cached `LoginData`), `com.chess.net.model.LoginData` (the DTO itself).

Purchases go through `com.chess.features.paywall.GoogleBillingRepository` (Play
Billing), but **that only initiates a purchase** — the server validates the receipt
and is what actually sets `premium_status` on the account; the client just mirrors
whatever the server returns on every login/session refresh.

**Why this matters for "can I just patch it":** Free Fire's ad gate (`ApiData.ADS_ENABLED`)
is a pure client-side boolean with no server check, so forcing it is a complete, durable
bypass. Chess.com's premium gate is different in kind: even a client patch that forces
`H()` to always return `DIAMOND` would only fake the *UI* state — puzzles, lessons, and
coach content are server-served per-request and keyed to your account's real
`premium_status`/`GetCoachQuota`, so the server would still serve free-tier content/limits
and reject unentitled actions. There's no single call site to patch that yields real
unlocked content; it would require spoofing the login/session API responses, which
is a server-trust bypass against someone else's service — out of scope for this repo's
"patch an app you own, on-device" method, and the reason no patch was written for it.

## Build-your-own alternative

If the goal is "a chess app with puzzles, bots, and lessons," the Free Fire/Chess.com
pattern above still applies in reverse: build those features on **open** foundations
instead:

- Puzzles: [Lichess puzzle database](https://database.lichess.org/#puzzles) (CC0).
- Engine: [Stockfish](https://stockfishchess.org/) (GPL).
- Opening books: open Polyglot `.bin` books, or generate your own.
- Lessons: your own original curriculum.

Happy to scaffold this as a fresh Android project on request.
