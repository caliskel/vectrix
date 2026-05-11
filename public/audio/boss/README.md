# Boss music

Drop **one** music file here as `boss.mp3` (or `.ogg` / `.wav`). The
audio module will load it as the boss-fight track via Tone.js Player
when wired up. Multiple files are not supported right now — the
fight uses a single track for the whole encounter.

Wiring up the load:
1. Place file: `public/audio/boss/boss.mp3`
2. In `src/lib/audio.ts` register: `audio.setMusicTrack("boss", "audio/boss/boss.mp3")`
3. In `src/rooms/rooms-game.ts` (transitionToRoom, room5 branch) swap
   `audio.stopMusic(1.0)` for `audio.playMusic("boss", 1.5)`.

Until then Room 5 plays no music at all.
