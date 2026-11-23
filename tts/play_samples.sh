#!/bin/bash
# Plays every audition sample in order (each voice announces its own name).
cd "$(dirname "$0")/samples"
for f in kokoro_af_heart kokoro_af_bella kokoro_af_sarah kokoro_am_michael kokoro_bf_emma kokoro_bm_george piper_en_US-lessac-high piper_en_US-ryan-high piper_en_GB-alba-medium; do
  echo "now playing: $f"; paplay "$f.wav"; sleep 1
done
