# Notice, credits and licence caveats

This file is an honest summary, not legal advice. Check the items marked **CONFIRM** before distributing the game publicly or commercially.

## Code
- The chess rules engine, bots, coach, UI and PWA code in `game/` are original to this project. **No third-party chess engine code is bundled** (no Stockfish, chess.js, etc.).
- The **Lichess puzzle database is NOT included.** Any puzzles are hand-written.
- No analytics, ads or tracking. No backend; user data stays in the browser.

## Piece artwork (`game/pieces/*.png`, `game/icons/*`)
- The piece images were **AI-generated** (the project owner's own generations). **CONFIRM** that the generator's terms give you the rights you need (including commercial use and redistribution) and that you are comfortable with the copyright status of AI-generated imagery in your jurisdiction.
- App icons are derived from the white pawn piece image on a generated gradient tile (`game/scripts/make-icons.py`).

## Coach voices (`game/coach/audio/**`)
- The spoken clips were generated with **Microsoft Edge neural text-to-speech voices** through the **unofficial `edge-tts` Python library** (`tts/gen_coach_audio.py`). This is not an official, licensed Microsoft API.
- **CONFIRM before commercial redistribution:** review Microsoft's terms for the Edge / Azure Speech voices. Publishing the generated audio in a public repo or a monetised app may not be covered. If in doubt, regenerate the clips with a voice whose licence clearly permits redistribution (for example Azure Speech under a paid licence, or an open model with a permissive licence).
- Other TTS engines were evaluated only as local samples (Kokoro, Piper, MMS). **Their samples and models are not shipped** and are gitignored.

## Fonts
- Noto Nastaliq Urdu and Noto Naskh Arabic are loaded at runtime from Google Fonts. They are licensed under the SIL Open Font License 1.1. The service worker caches them after first use. Loading them from Google's servers sends the visitor's IP to Google; self-host the font files if that matters for your audience.

## Trademarks
- "Chess Coach" is a descriptive working name. The game is not affiliated with or endorsed by Chess.com, Lichess, Microsoft or Google; any visual resemblance of the UI palette to other chess sites is incidental, so review it before publishing widely.
