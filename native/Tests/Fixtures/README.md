# Synthetic media fixtures

`tone.mp3` is a one-second synthetic sine tone. `clip.mp4` is a one-second, 160×90 synthetic color clip at 10 frames per second. They contain no recordings or personal data and are covered by this repository's MIT license.

They exercise real WebKit MP3/H.264 metadata decoding through the managed media URL scheme. Equivalent fixtures can be generated with FFmpeg:

```sh
ffmpeg -f lavfi -i 'sine=frequency=440:sample_rate=44100:duration=1' \
  -codec:a libmp3lame -q:a 7 tone.mp3
ffmpeg -f lavfi -i 'color=c=blue:s=160x90:r=10:d=1' \
  -codec:v libx264 -pix_fmt yuv420p -movflags +faststart clip.mp4
```
