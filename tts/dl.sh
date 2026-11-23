#!/bin/bash
cd "$(dirname "$0")/models"
B=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
H=https://huggingface.co/rhasspy/piper-voices/resolve/main/en
get(){ for i in 1 2 3 4 5 6; do curl -sL -C - --retry 3 -o "$1" "$2" && break; sleep 2; done; }
get kokoro-v1.0.onnx $B/kokoro-v1.0.onnx &
get voices-v1.0.bin $B/voices-v1.0.bin &
for v in en_US/lessac/high/en_US-lessac-high en_US/ryan/high/en_US-ryan-high en_GB/alba/medium/en_GB-alba-medium; do n=${v##*/}; get $n.onnx $H/$v.onnx & get $n.onnx.json $H/$v.onnx.json & done
wait; echo ALLDONE > ../dl.done
