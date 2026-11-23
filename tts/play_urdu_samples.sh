#!/bin/bash
# Plays every Urdu audition sample in order (each announces "voice number N").
cd "$(dirname "$0")/samples_ur"
for f in $(ls *.wav | sort -n); do echo "now playing: $f"; paplay "$f"; sleep 1; done
