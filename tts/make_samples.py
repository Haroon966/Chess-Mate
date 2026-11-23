"""Generate coach-voice audition samples with Kokoro (several voices) and Piper (for comparison).

Usage:  .venv/bin/python make_samples.py
Output: samples/<engine>_<voice>.wav  + prints real-time factor (speed) per voice.
"""
import time, wave, sys, pathlib
import numpy as np, soundfile as sf

HERE = pathlib.Path(__file__).parent
M, OUT = HERE / "models", HERE / "samples"
OUT.mkdir(exist_ok=True)

LINES = [
    "Hi, I'm your chess coach. Today we'll learn how the pieces move. "
    "Don't worry, there are no wrong answers here, only chances to learn.",
    "Hold on a second. If you move there, your queen can be captured for free. "
    "Would you like to take that move back?",
    "Careful! That move leaves your opponent with no legal moves, "
    "and the game would end in a draw. You're winning, so let's find something better.",
]

KOKORO = [  # (voice id, spoken name)
    ("af_heart", "Heart"), ("af_bella", "Bella"), ("af_sarah", "Sarah"),
    ("am_michael", "Michael"), ("bf_emma", "Emma"), ("bm_george", "George"),
]
PIPER = [("en_US-lessac-high", "Lessac"), ("en_US-ryan-high", "Ryan"), ("en_GB-alba-medium", "Alba")]

def kokoro_samples():
    from kokoro_onnx import Kokoro
    k = Kokoro(str(M / "kokoro-v1.0.onnx"), str(M / "voices-v1.0.bin"))
    for vid, name in KOKORO:
        t0 = time.time(); parts = []; sr = 24000
        for text in [f"This is {name}."] + LINES:
            a, sr = k.create(text, voice=vid, speed=1.0, lang="en-gb" if vid.startswith("b") else "en-us")
            parts += [a, np.zeros(int(sr * 0.45), dtype=np.float32)]
        audio = np.concatenate(parts); dt = time.time() - t0
        sf.write(OUT / f"kokoro_{vid}.wav", audio, sr)
        print(f"kokoro {vid:11s} {len(audio)/sr:5.1f}s audio in {dt:4.1f}s  (RTF {dt/(len(audio)/sr):.2f}x)", flush=True)

def piper_samples():
    from piper import PiperVoice
    for vid, name in PIPER:
        v = PiperVoice.load(str(M / f"{vid}.onnx"))
        t0 = time.time(); parts = []; sr = v.config.sample_rate
        for text in [f"This is {name}."] + LINES:
            chunks = [np.frombuffer(c.audio_int16_bytes, dtype=np.int16) for c in v.synthesize(text)]
            parts += [np.concatenate(chunks).astype(np.float32) / 32768, np.zeros(int(sr * 0.45), dtype=np.float32)]
        audio = np.concatenate(parts); dt = time.time() - t0
        sf.write(OUT / f"piper_{vid}.wav", audio, sr)
        print(f"piper  {vid:18s} {len(audio)/sr:5.1f}s audio in {dt:4.1f}s  (RTF {dt/(len(audio)/sr):.2f}x)", flush=True)

if __name__ == "__main__":
    for fn in (kokoro_samples, piper_samples):
        try: fn()
        except Exception as e: print(f"{fn.__name__} failed: {type(e).__name__}: {e}", file=sys.stderr)
