"""Urdu coach-voice audition samples from three engines.

  A) Edge neural voices (ur-PK / ur-IN) - most natural, needs internet at generation time only
  B) Meta MMS-TTS urd-script_arabic     - offline VITS, reads Urdu script directly (CC-BY-NC 4.0 weights)
  C) Kokoro Hindi voices                - offline, Apache-2.0; Urdu is fed as Devanagari (same spoken language)

Usage: .venv/bin/python make_urdu_samples.py   ->  samples_ur/<n>_<engine>_<voice>.wav
"""
import asyncio, subprocess, sys, time, pathlib
import numpy as np, soundfile as sf

HERE = pathlib.Path(__file__).parent
OUT = HERE / "samples_ur"; OUT.mkdir(exist_ok=True)
M = HERE / "models"
NUM_UR = ["ایک", "دو", "تین", "چار", "پانچ", "چھ", "سات", "آٹھ", "نو"]
NUM_HI = ["एक", "दो", "तीन", "चार", "पाँच", "छह", "सात", "आठ", "नौ"]

UR = [  # greeting / blunder warning / stalemate warning
    "السلام علیکم! میں آپ کا شطرنج کوچ ہوں۔ آج ہم سیکھیں گے کہ مہرے کیسے چلتے ہیں۔ "
    "فکر نہ کریں، یہاں کوئی غلطی نہیں، صرف سیکھنے کے مواقع ہیں۔",
    "ایک منٹ رکیں! اگر آپ یہاں چلیں گے تو آپ کی ملکہ مفت میں ماری جائے گی۔ "
    "کیا آپ یہ چال واپس لینا چاہیں گے؟",
    "احتیاط کریں! اس چال سے مخالف کے پاس کوئی جائز چال نہیں بچے گی اور کھیل برابر ہو جائے گا۔ "
    "آپ جیت رہے ہیں، آئیں کوئی بہتر چال تلاش کریں۔",
]
HI = [  # same sentences in Devanagari for Kokoro's Hindi voices
    "अस्सलामु अलैकुम! मैं आपका शतरंज कोच हूँ। आज हम सीखेंगे कि मोहरे कैसे चलते हैं। "
    "फ़िक्र न कीजिए, यहाँ कोई ग़लती नहीं, बस सीखने के मौक़े हैं।",
    "एक मिनट रुकिए! अगर आप यहाँ चलेंगे तो आपकी मलिका मुफ़्त में मारी जाएगी। "
    "क्या आप यह चाल वापस लेना चाहेंगे?",
    "एहतियात कीजिए! इस चाल से मुख़ालिफ़ के पास कोई जायज़ चाल नहीं बचेगी और खेल बराबर हो जाएगा। "
    "आप जीत रहे हैं, आइए कोई बेहतर चाल ढूँढ़ें।",
]
n = 0
def nxt():
    global n; n += 1; return n

def edge():
    import edge_tts
    for voice in ["ur-PK-UzmaNeural", "ur-PK-AsadNeural", "ur-IN-GulNeural", "ur-IN-SalmanNeural"]:
        i = nxt(); text = f"آواز نمبر {NUM_UR[i-1]}۔ " + " ".join(UR)
        mp3 = OUT / f"{i}_edge_{voice}.mp3"; wav = mp3.with_suffix(".wav")
        t0 = time.time()
        try: asyncio.run(edge_tts.Communicate(text, voice).save(str(mp3)))
        except Exception as e:
            print(f"edge {voice} failed: {type(e).__name__}: {e}", file=sys.stderr); continue
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", mp3, wav], check=True); mp3.unlink()
        print(f"{i} edge   {voice:20s} ok ({time.time()-t0:.1f}s)", flush=True)

def mms():
    import torch
    from transformers import VitsModel, AutoTokenizer
    name = "facebook/mms-tts-urd-script_arabic"
    tok, model = AutoTokenizer.from_pretrained(name), VitsModel.from_pretrained(name); model.eval()
    i = nxt(); parts = []; t0 = time.time(); sr = model.config.sampling_rate
    for text in [f"آواز نمبر {NUM_UR[i-1]}۔"] + UR:
        torch.manual_seed(0)
        with torch.no_grad(): w = model(**tok(text, return_tensors="pt")).waveform[0].numpy()
        parts += [w, np.zeros(int(sr * 0.45), dtype=np.float32)]
    a = np.concatenate(parts); sf.write(OUT / f"{i}_mms_urd-arabic.wav", a, sr)
    print(f"{i} mms    urd-script_arabic     ok ({time.time()-t0:.1f}s, {len(a)/sr:.0f}s audio)", flush=True)

def kokoro_hi():
    from kokoro_onnx import Kokoro
    k = Kokoro(str(M / "kokoro-v1.0.onnx"), str(M / "voices-v1.0.bin"))
    for vid in ["hf_alpha", "hf_beta", "hm_omega", "hm_psi"]:
        i = nxt(); parts = []; t0 = time.time(); sr = 24000
        for text in [f"आवाज़ नंबर {NUM_HI[i-1]}।"] + HI:
            a, sr = k.create(text, voice=vid, speed=0.95, lang="hi")
            parts += [a, np.zeros(int(sr * 0.45), dtype=np.float32)]
        a = np.concatenate(parts); sf.write(OUT / f"{i}_kokoro_{vid}.wav", a, sr)
        print(f"{i} kokoro {vid:20s} ok ({time.time()-t0:.1f}s, {len(a)/sr:.0f}s audio)", flush=True)

if __name__ == "__main__":
    for fn in (edge, mms, kokoro_hi):
        try: fn()
        except Exception as e: print(f"{fn.__name__} failed: {type(e).__name__}: {e}", file=sys.stderr)
