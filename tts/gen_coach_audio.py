#!/usr/bin/env python3
"""Generate coach audio clips (edge-tts) from lines.json + lessons.json.

Run from chess/tts:   .venv/bin/python -I gen_coach_audio.py [options]

Output: <out>/<coachId>/<lang>/<clipId with '#'->'_'>.mp3 and <out>/manifest.json
        ({coachId:{en:[clip ids],ur:[...]}}, only clips present on disk).
"""
import argparse
import asyncio
import json
import os
import random
import re
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import edge_tts

HERE = Path(__file__).resolve().parent
GAME_COACH = HERE.parent / "game" / "coach"

# Mild persona via edge-tts prosody (percent for rate, Hz for pitch).
PERSONA = {
    "ayesha": {"rate": -4, "pitch": 0},
    "bilal": {"rate": -6, "pitch": 0},
    "sana": {"rate": +3, "pitch": 0},
    "hamza": {"rate": +2, "pitch": 0},
}
UR_RATE_OFFSET = -5          # Urdu a touch slower, relative to persona
MIN_BYTES = 1200             # smaller output counts as failed
LESSON_FIELDS = ("intro", "success", "wrong", "hint", "extra", "wrong_piece")
FRAG_MIN_S, FRAG_MAX_S = 0.20, 2.5   # duration outlier thresholds for fragments


def fmt_rate(p):
    return f"{p:+d}%"


def fmt_pitch(p):
    return f"{p:+d}Hz"


def load_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return None


def spoken(entry, lang):
    """Text to speak for an object with en/ur/say_en/say_ur."""
    if not isinstance(entry, dict):
        return None
    if lang == "ur":
        t = entry.get("say_ur")
    else:
        t = entry.get("say_en") or entry.get("en")
    return t.strip() if isinstance(t, str) and t.strip() else None


def build_clips(lines, lessons, log):
    """Return ordered list of (clip_id, {en: text|None, ur: text|None})."""
    clips = []
    if lines:
        for eid, ev in (lines.get("lines") or {}).items():
            for i, v in enumerate((ev or {}).get("variants") or []):
                clips.append((f"{eid}#{i}", v))
        for fid, fr in (lines.get("frags") or {}).items():
            clips.append((fid, fr))
    if lessons:
        for les in lessons.get("lessons") or []:
            for st in les.get("steps") or []:
                for name in LESSON_FIELDS:
                    obj = st.get(name)
                    if isinstance(obj, dict):
                        clips.append((f"lesson.{les['id']}.{st['id']}.{name}", obj))
    out, seen = [], set()
    for cid, obj in clips:
        if cid in seen:
            log(f"WARN duplicate clip id {cid}; keeping first")
            continue
        seen.add(cid)
        out.append((cid, {"en": spoken(obj, "en"), "ur": spoken(obj, "ur")}))
    return out


def clip_path(out_dir, coach, lang, cid):
    return out_dir / coach / lang / (cid.replace("#", "_") + ".mp3")


def probe_duration(path):
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", str(path)],
            capture_output=True, text=True, timeout=30)
        return float(r.stdout.strip())
    except Exception:
        return None


def normalize_file(path):
    """Trim leading/trailing silence (>300ms -> keep ~50ms) and loudnorm to -16 LUFS."""
    tmp = path.with_suffix(".norm.mp3")
    trim = ("silenceremove=start_periods=1:start_duration=0.02:start_threshold=-45dB:start_silence=0.05,"
            "areverse,"
            "silenceremove=start_periods=1:start_duration=0.02:start_threshold=-45dB:start_silence=0.05,"
            "areverse")
    af = trim + ",loudnorm=I=-16:TP=-1.5:LRA=11"
    cmd = ["ffmpeg", "-y", "-v", "error", "-i", str(path), "-af", af,
           "-ar", "24000", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "64k", str(tmp)]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if r.returncode != 0 or not tmp.exists() or tmp.stat().st_size < MIN_BYTES:
        tmp.unlink(missing_ok=True)
        return False, (r.stderr or "ffmpeg failed")[-200:]
    os.replace(tmp, path)
    return True, ""


async def synth(text, voice, rate, pitch, dest, timeout):
    part = dest.with_suffix(".part")
    comm = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
    try:
        await asyncio.wait_for(comm.save(str(part)), timeout=timeout)
        if not part.exists() or part.stat().st_size < MIN_BYTES:
            raise RuntimeError(f"output too small ({part.stat().st_size if part.exists() else 0} bytes)")
        os.replace(part, dest)
    finally:
        part.unlink(missing_ok=True)


def write_manifest(out_dir, coaches, clips, log):
    manifest = {}
    for c in coaches:
        manifest[c["id"]] = {}
        for lang in ("en", "ur"):
            ids = []
            for cid, texts in clips:
                p = clip_path(out_dir, c["id"], lang, cid)
                if p.exists() and p.stat().st_size >= MIN_BYTES:
                    ids.append(cid)
            manifest[c["id"]][lang] = ids
    out_dir.mkdir(parents=True, exist_ok=True)
    mp = out_dir / "manifest.json"
    tmp = mp.with_suffix(".tmp")
    tmp.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, mp)
    log("manifest: " + ", ".join(f"{c}/{l}={len(v)}" for c, d in manifest.items() for l, v in d.items()))


async def main_async(args):
    t0 = time.time()

    def log(msg):
        print(msg, flush=True)

    coaches_all = load_json(args.coaches)["coaches"]
    coaches = [c for c in coaches_all if not args.coach or c["id"] in args.coach]
    langs = args.lang or ["en", "ur"]
    lines = load_json(args.lines)
    lessons = load_json(args.lessons)
    if lines is None:
        log(f"WARN {args.lines} missing")
    if lessons is None:
        log(f"WARN {args.lessons} missing")
    clips = build_clips(lines, lessons, log)
    out_dir = Path(args.out)

    # Jobs
    jobs, skipped, empty = [], 0, []
    counts = {}
    for c in coaches:
        for lang in langs:
            for cid, texts in clips:
                if args.only and args.only not in cid:
                    continue
                text = texts[lang]
                if not text:
                    empty.append(f"{c['id']}/{lang}/{cid}")
                    continue
                dest = clip_path(out_dir, c["id"], lang, cid)
                counts[(c["id"], lang)] = counts.get((c["id"], lang), 0) + 1
                if not args.force and dest.exists() and dest.stat().st_size >= MIN_BYTES:
                    skipped += 1
                    continue
                jobs.append((c, lang, cid, text, dest))
    if empty:
        log(f"WARN {len(empty)} empty/missing texts skipped (first 10): {empty[:10]}")
    if args.limit:
        jobs = jobs[: args.limit]

    log(f"clips defined: {len(clips)}; per coach/lang (after --only): "
        + ", ".join(f"{k[0]}/{k[1]}={v}" for k, v in sorted(counts.items())))
    log(f"to generate: {len(jobs)}; already present (skipped): {skipped}")
    if args.dry_run:
        # Rough estimate: ~0.9 s/clip effective at concurrency 6 (typical edge-tts), scale by concurrency.
        est = len(jobs) * 5.0 / max(1, args.concurrency)
        log(f"DRY RUN: estimated generation time ~{est/60:.1f} min at concurrency {args.concurrency} "
            f"(assumes ~5 s/clip/worker incl. retries)")
        return 0

    sem = asyncio.Semaphore(args.concurrency)
    pool = ThreadPoolExecutor(max_workers=max(2, min(8, os.cpu_count() or 4)))
    loop = asyncio.get_running_loop()
    stats = {"generated": 0, "failed": 0, "done": 0}
    failures, durations = [], {}
    total = len(jobs)
    t_start = time.time()

    async def run(job):
        c, lang, cid, text, dest = job
        persona = PERSONA.get(c["id"], {"rate": 0, "pitch": 0})
        rate = persona["rate"] + (UR_RATE_OFFSET if lang == "ur" else 0)
        voice = c["voices"][lang]
        dest.parent.mkdir(parents=True, exist_ok=True)
        err = None
        async with sem:
            for attempt in range(args.retries + 1):
                try:
                    await synth(text, voice, fmt_rate(rate), fmt_pitch(persona["pitch"]), dest, args.timeout)
                    err = None
                    break
                except Exception as e:  # noqa
                    err = f"{type(e).__name__}: {e}"
                    if attempt < args.retries:
                        await asyncio.sleep(min(30, 1.5 * (2 ** attempt)) + random.random())
        if err is None and args.normalize:
            ok, msg = await loop.run_in_executor(pool, normalize_file, dest)
            if not ok:
                err = f"normalize: {msg}"
        if err is None:
            d = await loop.run_in_executor(pool, probe_duration, dest)
            size = dest.stat().st_size
            if size < MIN_BYTES or d is None or d < 0.05:
                err = f"bad output size={size} dur={d}"
                dest.unlink(missing_ok=True)
            else:
                durations[(c["id"], lang, cid)] = d
        stats["done"] += 1
        if err is None:
            stats["generated"] += 1
        else:
            stats["failed"] += 1
            failures.append({"coach": c["id"], "lang": lang, "clip": cid, "voice": voice,
                             "text": text, "error": err})
        if stats["done"] % 25 == 0 or stats["done"] == total:
            el = time.time() - t_start
            eta = el / stats["done"] * (total - stats["done"])
            log(f"[{stats['done']}/{total}] ok={stats['generated']} fail={stats['failed']} "
                f"elapsed={el:.0f}s eta={eta:.0f}s")

    await asyncio.gather(*(run(j) for j in jobs))

    # Optionally normalise already-existing clips too
    if args.normalize_existing:
        todo = [clip_path(out_dir, c["id"], l, cid) for c in coaches for l in langs for cid, _ in clips]
        todo = [p for p in todo if p.exists()]
        log(f"normalising {len(todo)} existing clips")
        res = await asyncio.gather(*(loop.run_in_executor(pool, normalize_file, p) for p in todo))
        bad = sum(1 for ok, _ in res if not ok)
        log(f"normalised ok={len(res)-bad} fail={bad}")

    pool.shutdown(wait=True)
    write_manifest(out_dir, coaches_all, clips, log)

    # Duration outliers
    outliers = []
    for (co, lang, cid), d in sorted(durations.items()):
        if cid.startswith("frag.") and not (FRAG_MIN_S <= d <= FRAG_MAX_S):
            outliers.append((co, lang, cid, round(d, 2)))
    if outliers:
        log(f"duration outliers (frags outside {FRAG_MIN_S}-{FRAG_MAX_S}s): {len(outliers)}")
        for o in outliers[:40]:
            log("  " + " ".join(map(str, o)))
    fr = [d for (_, _, cid), d in durations.items() if cid.startswith("frag.")]
    if fr:
        log(f"frag durations: n={len(fr)} min={min(fr):.2f}s max={max(fr):.2f}s avg={sum(fr)/len(fr):.2f}s")

    fpath = HERE / "coach_audio_failures.json"
    fpath.write_text(json.dumps(failures, ensure_ascii=False, indent=1), encoding="utf-8")
    log(f"SUMMARY generated={stats['generated']} skipped={skipped} failed={stats['failed']} "
        f"empty_text={len(empty)} time={time.time()-t0:.0f}s; failures -> {fpath}")
    if args.durations_json:
        Path(args.durations_json).write_text(json.dumps(
            {f"{a}/{b}/{c}": round(d, 3) for (a, b, c), d in sorted(durations.items())},
            ensure_ascii=False, indent=1), encoding="utf-8")
    return 1 if stats["failed"] else 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--coach", action="append", help="coach id (repeatable)")
    ap.add_argument("--lang", action="append", choices=["en", "ur"], help="language (repeatable)")
    ap.add_argument("--only", help="only clip ids containing this substring")
    ap.add_argument("--limit", type=int, help="max clips to generate")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true", help="regenerate existing clips")
    ap.add_argument("--concurrency", type=int, default=6)
    ap.add_argument("--retries", type=int, default=5)
    ap.add_argument("--timeout", type=float, default=45, help="per-clip timeout (s) per attempt")
    ap.add_argument("--normalize", action="store_true", help="trim silence + loudnorm -16 LUFS on generated clips")
    ap.add_argument("--normalize-existing", action="store_true", help="also normalise clips already on disk")
    ap.add_argument("--coaches", default=str(GAME_COACH / "coaches.json"))
    ap.add_argument("--lines", default=str(GAME_COACH / "lines.json"))
    ap.add_argument("--lessons", default=str(GAME_COACH / "lessons.json"))
    ap.add_argument("--out", default=str(GAME_COACH / "audio"))
    ap.add_argument("--durations-json", help="write per-clip durations of generated clips here")
    args = ap.parse_args()
    sys.exit(asyncio.run(main_async(args)))


if __name__ == "__main__":
    main()
