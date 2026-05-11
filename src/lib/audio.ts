import {
  BitCrusher,
  Distortion,
  Filter,
  Gain,
  MembraneSynth,
  NoiseSynth,
  Player,
  PolySynth,
  Reverb,
  Synth,
  getContext,
  now as toneNow,
  start as toneStart,
} from "tone";

import type { PickupType } from "./pickups";

const DUCK_WINDOW_MS = 30;
const DUCK_FACTOR = 0.7;

class AudioEngine {
  private initialized = false;
  private masterVol = 0.8;
  private sfxVol = 0.6;
  private musicVol = 0.8;

  // master chain
  private master?: Gain;
  private sfx?: Gain;
  private music?: Gain;

  // Looping music — keyed multi-track with crossfade. Caller registers
  // any number of tracks (e.g. "rooms" / "boss-1" / "boss-2" / "boss-3")
  // via setMusicTrack(key, url); playMusic(key, crossfadeSec) swaps
  // between them. Load is deferred until init() so the AudioContext
  // exists; calls before a track finishes decoding are queued and fire
  // on load. activeMusicKey tracks what's currently playing for
  // re-entrancy guards and idempotent calls.
  private musicTracks: Map<string, Player> = new Map();
  private musicUrls: Map<string, string> = new Map();
  private musicLoadingKeys: Set<string> = new Set();
  private musicQueuedKey?: string;
  private musicQueuedFadeSec = 0;
  private activeMusicKey?: string;

  // Sound 1: dash (white-noise breath, no pitch sweep, no reverb)
  private dashNoise?: NoiseSynth;

  // Sound 2: dash through (with duck-on-rapid-retrigger)
  private dashThroughSynth?: Synth;
  private dashThroughLast = -Infinity;
  private dashThroughDuck = 1.0;

  // Sound 3: bullet break (also ducked)
  private breakSquare?: Synth;
  private breakSub?: Synth;
  private breakNoise?: NoiseSynth;
  private breakLast = -Infinity;
  private breakDuck = 1.0;

  // Sound 4: pickup spawn
  private spawnSynth?: PolySynth;

  // Sound 5: pickup grab (per type)
  private hpSynth?: PolySynth;
  private shieldSynth?: PolySynth;
  private boostSynth?: Synth;
  private breakerSynth?: PolySynth;

  // Sound 6: hit
  private hitSynth?: MembraneSynth;

  // Impact feedback — three intensities (light/medium/heavy) layered
  // so dash-through bullets don't drown the player in noise but big
  // hits land with weight.
  private hitLightSynth?: Synth;
  private hitMediumSynth?: MembraneSynth;
  private hitHeavyMembrane?: MembraneSynth;
  private hitHeavyNoise?: NoiseSynth;

  // Boss-only telegraph cue. Used by Sentinel for the Ring Burst
  // telegraph beat — generic enemy "detected you" sounds are
  // intentionally silent (the visual ring burst carries that read).
  private alertSynth?: Synth;

  // Per-archetype combat cues.
  private watcherChargeSynth?: Synth;   // 1.2 s rising drone (charge)
  private watcherChargeFilter?: Filter;
  private watcherFireMembrane?: MembraneSynth; // tight sub-thump
  private watcherFireNoise?: NoiseSynth;       // metallic crack
  private hunterSnarlSynth?: Synth;     // contact-damage angry burst
  private hunterSnarlFilter?: Filter;

  // Sentinel boss — dedicated cues (replacing alert / hitHeavy
  // placeholders flagged in CLAUDE.md).
  private bossPhaseSynth?: Synth;       // sub saw for BWAA
  private bossPhaseNoise?: NoiseSynth;  // sweep noise burst
  private bossPhaseFilter?: Filter;
  private bossMineSpawnSynth?: Synth;   // tense beep while mine telegraphs
  private bossMineDetonateMembrane?: MembraneSynth;
  private bossMineDetonateNoise?: NoiseSynth;
  private bossSweepStartSynth?: Synth;  // rising warning drone
  private bossSweepStartFilter?: Filter;
  private bossSweepReverseSynth?: Synth; // heavy pull-back swell
  private bossSweepReverseFilter?: Filter;
  private bossEyeHitSynth?: PolySynth;  // shard-strike reward
  private bossEyeHitNoise?: NoiseSynth;
  private bossRingDetachMembrane?: MembraneSynth; // RB shells tear off
  private bossRingDetachSynth?: Synth;
  private bossRingDetachFilter?: Filter;

  // Menu UI cues — short ticks for hover / click on the landing
  // page. Bit-crushed for that retrofuture arcade tone.
  private uiHoverSynth?: Synth;
  private uiClickSynth?: Synth;
  private narratorTickSynth?: Synth;
  private uiStaticNoise?: NoiseSynth; // big-glitch flash crackle

  // Sound 7: mult tier up
  private multSynth?: Synth;

  // Sound 8: run end
  private endSynth?: PolySynth;
  private endFilter?: Filter;

  init(): void {
    // Tone.start() is idempotent — retrying it on every call lets a
    // page-load attempt (autoplay-blocked, no gesture yet) wake up
    // once the user clicks. setupChain still runs once.
    // Resolving the start promise also retries queued music — without
    // this, a pre-gesture playMusic() would schedule the fade ramp in
    // suspended-context time and the first audible samples would land
    // at full gain (audible crackle / pop at track start).
    void toneStart().then(() => this.tryStartMusic());
    if (this.initialized) return;
    this.initialized = true;
    this.setupChain();
    this.applyMute();
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  private setupChain(): void {
    this.master = new Gain(this.masterVol).toDestination();
    this.sfx = new Gain(this.sfxVol).connect(this.master);
    this.music = new Gain(this.musicVol).connect(this.master);

    this.setupDash();
    this.setupDashThrough();
    this.setupBulletBreak();
    this.setupPickupSpawn();
    this.setupPickupGrab();
    this.setupHit();
    this.setupHitLight();
    this.setupHitMedium();
    this.setupHitHeavy();
    this.setupAlert();
    this.setupWatcherCharge();
    this.setupWatcherFire();
    this.setupHunterSnarl();
    this.setupBossPhase();
    this.setupBossMineSpawn();
    this.setupBossMineDetonate();
    this.setupBossSweepStart();
    this.setupBossSweepReverse();
    this.setupBossEyeHit();
    this.setupBossRingDetach();
    this.setupUiCues();
    this.setupNarratorTick();
    this.setupMultUp();
    this.setupRunEnd();
    // Any tracks registered before init() get loaded now.
    for (const key of this.musicUrls.keys()) this.tryLoadMusicTrack(key);
  }

  /** Register a music track under `key` at `url`. Safe to call before
   *  init() — load is deferred until the AudioContext is ready. Caller
   *  can register any number of keyed tracks (e.g. "rooms", "boss-1",
   *  "boss-2", "boss-3") and then crossfade between them via
   *  playMusic(key). Re-registering an existing key with a new URL
   *  swaps the underlying Player; calling with the same URL is a no-op. */
  setMusicTrack(key: string, url: string): void {
    if (this.musicUrls.get(key) === url && this.musicTracks.has(key)) return;
    this.musicUrls.set(key, url);
    // If we already had a player for this key under a different URL,
    // dispose it so the new URL takes its slot.
    const existing = this.musicTracks.get(key);
    if (existing) {
      try {
        existing.stop();
        existing.dispose();
      } catch {}
      this.musicTracks.delete(key);
    }
    this.tryLoadMusicTrack(key);
  }

  /** Crossfade to the registered track under `key`. If the track
   *  hasn't decoded yet, the play request is queued and fires on
   *  load. `crossfadeSec` controls overlap with the previous track
   *  (and the new track's fade-in). Calls targeting the currently
   *  active track are no-ops. */
  playMusic(key: string, crossfadeSec = 1.0): void {
    this.musicQueuedKey = key;
    this.musicQueuedFadeSec = Math.max(0, crossfadeSec);
    this.tryStartMusic();
  }

  /** Fade out whatever is playing. */
  stopMusic(fadeSec = 0.5): void {
    this.musicQueuedKey = undefined;
    const fade = Math.max(0, fadeSec);
    if (this.activeMusicKey) {
      const player = this.musicTracks.get(this.activeMusicKey);
      if (player && player.state === "started") {
        try {
          player.fadeOut = fade;
          player.stop();
        } catch {}
      }
      this.activeMusicKey = undefined;
    }
  }

  private tryLoadMusicTrack(key: string): void {
    if (!this.initialized || !this.music) return;
    const url = this.musicUrls.get(key);
    if (!url) return;
    if (this.musicTracks.has(key) || this.musicLoadingKeys.has(key)) return;
    this.musicLoadingKeys.add(key);
    try {
      const player = new Player({
        url,
        loop: true,
        autostart: false,
        fadeIn: 0.5,
        fadeOut: 0.5,
        onload: () => {
          this.musicLoadingKeys.delete(key);
          // Skip MP3 encoder-delay priming (~576 samples ≈ 12 ms at 48 kHz)
          // so the loop seam doesn't click and the very first samples after
          // start aren't garbage. Safe for non-MP3 sources too — a few ms
          // of head trim is inaudible.
          try {
            player.loopStart = 0.015;
          } catch {}
          this.tryStartMusic();
        },
        onerror: () => {
          this.musicLoadingKeys.delete(key);
        },
      }).connect(this.music);
      this.musicTracks.set(key, player);
    } catch {
      this.musicLoadingKeys.delete(key);
    }
  }

  private tryStartMusic(): void {
    const key = this.musicQueuedKey;
    if (!key) return;
    const next = this.musicTracks.get(key);
    if (!next || !next.loaded) return;
    if (this.activeMusicKey === key && next.state === "started") return;
    // Don't start in a suspended AudioContext — fade-in ramps scheduled
    // here would burn off in suspended time and the first audible
    // samples would arrive at full gain. Caller will retry from
    // init() once Tone.start() resolves on a user gesture.
    if (getContext().state !== "running") return;

    const fade = this.musicQueuedFadeSec;
    // Fade out whatever is currently playing.
    if (this.activeMusicKey && this.activeMusicKey !== key) {
      const prev = this.musicTracks.get(this.activeMusicKey);
      if (prev && prev.state === "started") {
        try {
          prev.fadeOut = fade;
          prev.stop();
        } catch {}
      }
    }
    // Bring up the next.
    try {
      next.fadeIn = fade;
      next.start();
    } catch {}
    this.activeMusicKey = key;
  }

  private setupDash(): void {
    // Tactile "hsh" — short breath of air. Two filters in series
    // (highpass then lowpass) shape the noise; no pitch movement,
    // no reverb. Synth volume is intentionally quiet so the cue
    // sits under everything else, since dashes happen often.
    const lowpass = new Filter({
      type: "lowpass",
      frequency: 600,
      Q: 1,
    }).connect(this.sfx!);
    const highpass = new Filter({
      type: "highpass",
      frequency: 200,
    }).connect(lowpass);
    this.dashNoise = new NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.005, decay: 0.08, sustain: 0, release: 0.02 },
      volume: -22,
    }).connect(highpass);
  }

  private setupDashThrough(): void {
    const reverb = new Reverb({ decay: 0.2, wet: 0.2 }).connect(this.sfx!);
    void reverb.generate();
    const crusher = new BitCrusher(6).connect(reverb);
    this.dashThroughSynth = new Synth({
      oscillator: { type: "triangle" },
      envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.02 },
    }).connect(crusher);
  }

  private setupBulletBreak(): void {
    const dist = new Distortion(0.4).connect(this.sfx!);
    this.breakSquare = new Synth({
      oscillator: { type: "square" },
      envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.05 },
    }).connect(dist);
    this.breakSub = new Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.05 },
    }).connect(this.sfx!);
    this.breakNoise = new NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 },
    }).connect(this.sfx!);
  }

  private setupPickupSpawn(): void {
    this.spawnSynth = new PolySynth(Synth, {
      oscillator: { type: "sine" },
      envelope: { attack: 0.005, decay: 0.04, sustain: 0, release: 0.03 },
    }).connect(this.sfx!);
  }

  private setupPickupGrab(): void {
    this.hpSynth = new PolySynth(Synth, {
      oscillator: { type: "sine" },
      envelope: { attack: 0.01, decay: 0.15, sustain: 0, release: 0.05 },
    }).connect(this.sfx!);

    const shieldReverb = new Reverb({ decay: 0.6, wet: 0.3 }).connect(this.sfx!);
    void shieldReverb.generate();
    this.shieldSynth = new PolySynth(Synth, {
      oscillator: { type: "sine" },
      envelope: { attack: 0.05, decay: 0.2, sustain: 0.3, release: 0.2 },
    }).connect(shieldReverb);

    this.boostSynth = new Synth({
      oscillator: { type: "triangle" },
      envelope: { attack: 0.01, decay: 0.2, sustain: 0, release: 0.05 },
    }).connect(this.sfx!);

    const breakerDist = new Distortion(0.6).connect(this.sfx!);
    this.breakerSynth = new PolySynth(Synth, {
      oscillator: { type: "sawtooth" },
      envelope: { attack: 0.005, decay: 0.18, sustain: 0, release: 0.05 },
    }).connect(breakerDist);
  }

  private setupHit(): void {
    const filter = new Filter({
      type: "lowpass",
      frequency: 400,
    }).connect(this.sfx!);
    const dist = new Distortion(0.6).connect(filter);
    this.hitSynth = new MembraneSynth({
      pitchDecay: 0.05,
      octaves: 4,
      oscillator: { type: "sine" },
      envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.1 },
    }).connect(dist);
  }

  // Light: ~880 Hz triangle through a bit-crusher — a tiny "tic"
  // that reads as a successful pellet hit even when fired rapidly.
  private setupHitLight(): void {
    const crusher = new BitCrusher(4).connect(this.sfx!);
    this.hitLightSynth = new Synth({
      oscillator: { type: "triangle" },
      envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.01 },
    }).connect(crusher);
  }

  // Medium: low-mid membrane through lowpass + distortion — "thwak"
  // for shaving HP off an enemy without killing.
  private setupHitMedium(): void {
    const filter = new Filter({
      type: "lowpass",
      frequency: 600,
    }).connect(this.sfx!);
    const dist = new Distortion(0.3).connect(filter);
    this.hitMediumSynth = new MembraneSynth({
      pitchDecay: 0.04,
      octaves: 3,
      oscillator: { type: "sine" },
      envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.05 },
    }).connect(dist);
  }

  // Boss alert (Ring Burst telegraph). Sub-growl pre-warning — slow
  // attack so it swells rather than punches; heavy distortion +
  // bit-crush + long dark reverb. The visual telegraph (body jitter
  // + glow ramp) covers the read, this layer adds the dread.
  private setupAlert(): void {
    const reverb = new Reverb({ decay: 2.5, wet: 0.45 }).connect(this.sfx!);
    void reverb.generate();
    const filter = new Filter({
      type: "lowpass",
      frequency: 320,
      Q: 4,
    }).connect(reverb);
    const dist = new Distortion(0.9).connect(filter);
    const crusher = new BitCrusher(3).connect(dist);
    this.alertSynth = new Synth({
      oscillator: { type: "sawtooth" },
      envelope: { attack: 0.04, decay: 0.5, sustain: 0.1, release: 0.4 },
    }).connect(crusher);
  }

  // Watcher charge: dark rising drone over the 1.2 s aiming window.
  // Sawtooth pitched sub-low through a resonant lowpass + heavy
  // distortion + crusher — tension builds toward the commit. Pitch +
  // filter ramps live in playWatcherCharge.
  private setupWatcherCharge(): void {
    const filter = new Filter({
      type: "lowpass",
      frequency: 300,
      Q: 5,
    }).connect(this.sfx!);
    this.watcherChargeFilter = filter;
    const dist = new Distortion(0.55).connect(filter);
    const crusher = new BitCrusher(5).connect(dist);
    this.watcherChargeSynth = new Synth({
      oscillator: { type: "sawtooth" },
      envelope: { attack: 0.05, decay: 1.0, sustain: 0.35, release: 0.2 },
    }).connect(crusher);
  }

  // Watcher fire: two-layer industrial impact. Replaces the old
  // tonal downsweep (read as silly). Sub-membrane thump for body +
  // tight pink-noise crack for the beam ignition. ~120 ms total.
  // Reads as a coilgun discharge, not a cartoon "weew".
  private setupWatcherFire(): void {
    const dist = new Distortion(0.8).connect(this.sfx!);
    const crusher = new BitCrusher(4).connect(dist);
    this.watcherFireMembrane = new MembraneSynth({
      pitchDecay: 0.08,
      octaves: 6,
      oscillator: { type: "sine" },
      envelope: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.08 },
    }).connect(crusher);
    const bandpass = new Filter({
      type: "bandpass",
      frequency: 1100,
      Q: 2.2,
    }).connect(this.sfx!);
    this.watcherFireNoise = new NoiseSynth({
      noise: { type: "pink" },
      envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.04 },
    }).connect(bandpass);
  }

  // Hunter snarl: short angry burst on contact damage. Sub-saw low,
  // pitched + filter swept down inside playHunterSnarl. Heavy
  // distortion + crusher for the wet/dirty bite. ~150 ms total.
  private setupHunterSnarl(): void {
    const filter = new Filter({
      type: "lowpass",
      frequency: 320,
      Q: 3,
    }).connect(this.sfx!);
    this.hunterSnarlFilter = filter;
    const dist = new Distortion(0.95).connect(filter);
    const crusher = new BitCrusher(4).connect(dist);
    this.hunterSnarlSynth = new Synth({
      oscillator: { type: "sawtooth" },
      envelope: { attack: 0.005, decay: 0.18, sustain: 0, release: 0.08 },
    }).connect(crusher);
  }

  // Boss phase transition: apocalyptic sub-roar — sawtooth pitched
  // around 30 Hz swept up through resonant lowpass + heavy crusher +
  // dist; pink-noise rumble through a long dark reverb. Total ~1.5 s.
  // Fires at the climax of the 2 s phase-transition cinematic — the
  // longest, lowest cue in the game.
  private setupBossPhase(): void {
    const reverb = new Reverb({ decay: 3.5, wet: 0.4 }).connect(this.sfx!);
    void reverb.generate();
    const filter = new Filter({
      type: "lowpass",
      frequency: 160,
      Q: 6,
    }).connect(reverb);
    this.bossPhaseFilter = filter;
    const dist = new Distortion(0.95).connect(filter);
    const crusher = new BitCrusher(3).connect(dist);
    this.bossPhaseSynth = new Synth({
      oscillator: { type: "sawtooth" },
      envelope: { attack: 0.02, decay: 1.2, sustain: 0.2, release: 0.6 },
    }).connect(crusher);
    const noiseReverb = new Reverb({ decay: 2.5, wet: 0.5 }).connect(this.sfx!);
    void noiseReverb.generate();
    const bandpass = new Filter({
      type: "bandpass",
      frequency: 500,
      Q: 0.8,
    }).connect(noiseReverb);
    this.bossPhaseNoise = new NoiseSynth({
      noise: { type: "pink" },
      envelope: { attack: 0.01, decay: 0.9, sustain: 0, release: 0.4 },
    }).connect(bandpass);
  }

  // Boss mine spawn: sub-thud — sawtooth pitched in the chest, dist
  // + bit-crush + long dark reverb. Player locates the new mine by
  // the bass weight; no high-end content at all.
  private setupBossMineSpawn(): void {
    const reverb = new Reverb({ decay: 2.0, wet: 0.5 }).connect(this.sfx!);
    void reverb.generate();
    const filter = new Filter({
      type: "lowpass",
      frequency: 240,
      Q: 5,
    }).connect(reverb);
    const dist = new Distortion(0.65).connect(filter);
    const crusher = new BitCrusher(4).connect(dist);
    this.bossMineSpawnSynth = new Synth({
      oscillator: { type: "sawtooth" },
      envelope: { attack: 0.005, decay: 0.45, sustain: 0, release: 0.25 },
    }).connect(crusher);
  }

  // Boss mine detonate: cataclysmic sub-thump + filtered crackle —
  // membrane pitched at 30 Hz floor with octaves: 8 for pitch travel
  // on the decay; pink-noise burst through long-tail dark reverb.
  // Loudest single hit in the game.
  private setupBossMineDetonate(): void {
    const reverb = new Reverb({ decay: 1.8, wet: 0.4 }).connect(this.sfx!);
    void reverb.generate();
    const dist = new Distortion(0.95).connect(reverb);
    this.bossMineDetonateMembrane = new MembraneSynth({
      pitchDecay: 0.14,
      octaves: 8,
      oscillator: { type: "sine" },
      envelope: { attack: 0.001, decay: 0.85, sustain: 0, release: 0.4 },
    }).connect(dist);
    const noiseReverb = new Reverb({ decay: 1.6, wet: 0.45 }).connect(this.sfx!);
    void noiseReverb.generate();
    const bandpass = new Filter({
      type: "bandpass",
      frequency: 650,
      Q: 1.5,
    }).connect(noiseReverb);
    this.bossMineDetonateNoise = new NoiseSynth({
      noise: { type: "pink" },
      envelope: { attack: 0.001, decay: 0.6, sustain: 0, release: 0.25 },
    }).connect(bandpass);
  }

  // Boss sweep laser — telegraph start. Sub-pitched rising warning
  // drone through resonant lowpass + heavy distortion + low-bit
  // crusher + long dark reverb. The longest sustained boss cue —
  // signals "wide attack incoming."
  private setupBossSweepStart(): void {
    const reverb = new Reverb({ decay: 2.5, wet: 0.4 }).connect(this.sfx!);
    void reverb.generate();
    const filter = new Filter({
      type: "lowpass",
      frequency: 240,
      Q: 5,
    }).connect(reverb);
    this.bossSweepStartFilter = filter;
    const dist = new Distortion(0.8).connect(filter);
    const crusher = new BitCrusher(3).connect(dist);
    this.bossSweepStartSynth = new Synth({
      oscillator: { type: "sawtooth" },
      envelope: { attack: 0.08, decay: 0.8, sustain: 0.35, release: 0.4 },
    }).connect(crusher);
  }

  // Boss sweep laser — reverse / countdown swell. Heavy pull-back at
  // firing-1 → mid-pause and the final-100ms countdown chirp. Same
  // synth retriggered with different pitches inside playBossSweepReverse.
  // Pushed darker than the first pass: heavier dist, lower crusher
  // bits, reverb tail.
  private setupBossSweepReverse(): void {
    const reverb = new Reverb({ decay: 1.5, wet: 0.35 }).connect(this.sfx!);
    void reverb.generate();
    const filter = new Filter({
      type: "lowpass",
      frequency: 400,
      Q: 6,
    }).connect(reverb);
    this.bossSweepReverseFilter = filter;
    const dist = new Distortion(0.8).connect(filter);
    const crusher = new BitCrusher(3).connect(dist);
    this.bossSweepReverseSynth = new Synth({
      oscillator: { type: "sawtooth" },
      envelope: { attack: 0.01, decay: 0.5, sustain: 0, release: 0.25 },
    }).connect(crusher);
  }

  // Boss eye-hit reward: shard-strike. Sawtooth polyvoice tuned to
  // minor triad through a very long dark reverb + narrower lowpass —
  // ringing metallic shard rather than chime. The noise pop carries
  // the impact transient. Brightness is intentional contrast: this
  // is the ONE "satisfying" moment in the boss fight.
  private setupBossEyeHit(): void {
    const reverb = new Reverb({ decay: 3.0, wet: 0.55 }).connect(this.sfx!);
    void reverb.generate();
    const filter = new Filter({
      type: "lowpass",
      frequency: 1600,
      Q: 2,
    }).connect(reverb);
    const dist = new Distortion(0.35).connect(filter);
    this.bossEyeHitSynth = new PolySynth(Synth, {
      oscillator: { type: "sawtooth" },
      envelope: { attack: 0.002, decay: 0.7, sustain: 0, release: 0.6 },
    }).connect(dist);
    const bandpass = new Filter({
      type: "bandpass",
      frequency: 1800,
      Q: 2.4,
    }).connect(this.sfx!);
    this.bossEyeHitNoise = new NoiseSynth({
      noise: { type: "pink" },
      envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.04 },
    }).connect(bandpass);
  }

  // Boss Ring-Burst detach: shells tear off the body. Sub-membrane
  // thump + filtered saw scrape through long dark reverb + crusher.
  // Replaces the bit-crushed bullet-break placeholder that read as
  // game-y. ~0.6 s total.
  private setupBossRingDetach(): void {
    const reverb = new Reverb({ decay: 2.0, wet: 0.45 }).connect(this.sfx!);
    void reverb.generate();
    const dist = new Distortion(0.8).connect(reverb);
    this.bossRingDetachMembrane = new MembraneSynth({
      pitchDecay: 0.1,
      octaves: 6,
      oscillator: { type: "sine" },
      envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.2 },
    }).connect(dist);
    const filter = new Filter({
      type: "lowpass",
      frequency: 700,
      Q: 4,
    }).connect(reverb);
    this.bossRingDetachFilter = filter;
    const sawDist = new Distortion(0.7).connect(filter);
    const crusher = new BitCrusher(4).connect(sawDist);
    this.bossRingDetachSynth = new Synth({
      oscillator: { type: "sawtooth" },
      envelope: { attack: 0.005, decay: 0.5, sustain: 0, release: 0.25 },
    }).connect(crusher);
  }

  // Heavy: long sub membrane + bandpassed white-noise burst —
  // "BOOM-shhh" for kills, the loudest impact in the game.
  private setupHitHeavy(): void {
    const dist = new Distortion(0.5).connect(this.sfx!);
    this.hitHeavyMembrane = new MembraneSynth({
      pitchDecay: 0.08,
      octaves: 5,
      oscillator: { type: "sine" },
      envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.2 },
    }).connect(dist);
    const bandpass = new Filter({
      type: "bandpass",
      frequency: 800,
      Q: 2,
    }).connect(this.sfx!);
    this.hitHeavyNoise = new NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.05 },
    }).connect(bandpass);
  }

  private setupMultUp(): void {
    const reverb = new Reverb({ decay: 1.2, wet: 0.4 }).connect(this.sfx!);
    void reverb.generate();
    this.multSynth = new Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.05, decay: 0.25, sustain: 0, release: 0.1 },
    }).connect(reverb);
  }

  private setupRunEnd(): void {
    const reverb = new Reverb({ decay: 2.5, wet: 0.5 }).connect(this.sfx!);
    void reverb.generate();
    const filter = new Filter({
      type: "lowpass",
      frequency: 2000,
    }).connect(reverb);
    this.endFilter = filter;
    this.endSynth = new PolySynth(Synth, {
      oscillator: { type: "sawtooth" },
      envelope: { attack: 0.05, decay: 0.4, sustain: 0.4, release: 0.5 },
    }).connect(filter);
  }

  // mute/unmute the AudioContext to save CPU when master is at 0
  private applyMute(): void {
    if (!this.initialized) return;
    try {
      const ctx = getContext();
      const raw = ctx.rawContext as unknown as AudioContext;
      if (this.masterVol === 0) {
        if (ctx.state === "running") void raw.suspend?.();
      } else {
        if (ctx.state === "suspended") void raw.resume?.();
      }
    } catch {
      // ignore — older browsers / edge cases
    }
  }

  /**
   * Force every synth voice into release. Used to recover from the
   * occasional stuck-voice on Tone.PolySynth's voice allocator (the
   * runEnd chord can leak a sustained sawtooth when a death lands
   * during another active envelope) and to clear the death cue's tail
   * when the player hits restart and expects a clean audio start.
   * Reverbs continue to decay naturally — this only releases the
   * underlying voices, not their tails.
   */
  silence(): void {
    if (!this.initialized) return;
    try {
      this.dashNoise?.triggerRelease();
      this.dashThroughSynth?.triggerRelease();
      this.breakSquare?.triggerRelease();
      this.breakSub?.triggerRelease();
      this.breakNoise?.triggerRelease();
      this.spawnSynth?.releaseAll();
      this.hpSynth?.releaseAll();
      this.shieldSynth?.releaseAll();
      this.boostSynth?.triggerRelease();
      this.breakerSynth?.releaseAll();
      this.hitSynth?.triggerRelease();
      this.hitLightSynth?.triggerRelease();
      this.hitMediumSynth?.triggerRelease();
      this.hitHeavyMembrane?.triggerRelease();
      this.hitHeavyNoise?.triggerRelease();
      this.alertSynth?.triggerRelease();
      this.watcherChargeSynth?.triggerRelease();
      this.watcherFireMembrane?.triggerRelease();
      this.watcherFireNoise?.triggerRelease();
      this.hunterSnarlSynth?.triggerRelease();
      this.bossPhaseSynth?.triggerRelease();
      this.bossPhaseNoise?.triggerRelease();
      this.bossMineSpawnSynth?.triggerRelease();
      this.bossMineDetonateMembrane?.triggerRelease();
      this.bossMineDetonateNoise?.triggerRelease();
      this.bossSweepStartSynth?.triggerRelease();
      this.bossSweepReverseSynth?.triggerRelease();
      this.bossEyeHitSynth?.releaseAll();
      this.bossEyeHitNoise?.triggerRelease();
      this.bossRingDetachMembrane?.triggerRelease();
      this.bossRingDetachSynth?.triggerRelease();
      this.uiHoverSynth?.triggerRelease();
      this.uiClickSynth?.triggerRelease();
      this.uiStaticNoise?.triggerRelease();
      this.multSynth?.triggerRelease();
      this.endSynth?.releaseAll();
    } catch {}
  }

  setMasterVolume(v: number): void {
    this.masterVol = clamp01(v);
    if (this.master) this.master.gain.rampTo(this.masterVol, 0.05);
    this.applyMute();
  }

  setSfxVolume(v: number): void {
    this.sfxVol = clamp01(v);
    if (this.sfx) this.sfx.gain.rampTo(this.sfxVol, 0.05);
  }

  setMusicVolume(v: number): void {
    this.musicVol = clamp01(v);
    if (this.music) this.music.gain.rampTo(this.musicVol, 0.05);
  }

  // ---- play API ----
  play = {
    dash: (): void => this.playDash(),
    dashThrough: (chainIndex: number): void => this.playDashThrough(chainIndex),
    bulletBreak: (): void => this.playBulletBreak(),
    pickupSpawn: (): void => this.playPickupSpawn(),
    pickupGrab: (type: PickupType): void => this.playPickupGrab(type),
    hit: (): void => this.playHit(),
    hitLight: (): void => this.playHitLight(),
    hitMedium: (): void => this.playHitMedium(),
    hitHeavy: (): void => this.playHitHeavy(),
    alert: (): void => this.playAlert(),
    watcherCharge: (): void => this.playWatcherCharge(),
    watcherFire: (): void => this.playWatcherFire(),
    hunterSnarl: (): void => this.playHunterSnarl(),
    bossPhase: (): void => this.playBossPhase(),
    bossMineSpawn: (): void => this.playBossMineSpawn(),
    bossMineDetonate: (): void => this.playBossMineDetonate(),
    bossSweepStart: (): void => this.playBossSweepStart(),
    bossSweepReverse: (high: boolean): void => this.playBossSweepReverse(high),
    bossEyeHit: (): void => this.playBossEyeHit(),
    bossRingDetach: (): void => this.playBossRingDetach(),
    uiHover: (): void => this.playUiHover(),
    uiClick: (): void => this.playUiClick(),
    uiStatic: (): void => this.playUiStatic(),
    narratorTick: (): void => this.playNarratorTick(),
    smash: (strength: number): void => this.playSmash(strength),
    multUp: (tier: number): void => this.playMultUp(tier),
    runEnd: (): void => this.playRunEnd(),
  };

  private playDash(): void {
    if (!this.dashNoise) return;
    try {
      this.dashNoise.triggerAttackRelease(0.08, toneNow());
    } catch {}
  }

  private playDashThrough(chainIndex: number): void {
    if (!this.dashThroughSynth) return;
    const now = performance.now();
    if (now - this.dashThroughLast < DUCK_WINDOW_MS) {
      this.dashThroughDuck *= DUCK_FACTOR;
    } else {
      this.dashThroughDuck = 1.0;
    }
    this.dashThroughLast = now;
    const cents = chainIndex * 50;
    const freq = 660 * Math.pow(2, cents / 1200);
    try {
      this.dashThroughSynth.triggerAttackRelease(
        freq,
        0.06,
        toneNow(),
        this.dashThroughDuck,
      );
    } catch {}
  }

  private playBulletBreak(): void {
    if (!this.breakSquare || !this.breakSub || !this.breakNoise) return;
    const now = performance.now();
    if (now - this.breakLast < DUCK_WINDOW_MS) {
      this.breakDuck *= DUCK_FACTOR;
    } else {
      this.breakDuck = 1.0;
    }
    this.breakLast = now;
    const t = toneNow();
    const v = this.breakDuck;
    try {
      this.breakSquare.triggerAttackRelease(150, 0.1, t, v);
      this.breakSub.triggerAttackRelease(150, 0.1, t, v);
      this.breakNoise.triggerAttackRelease(0.05, t, v);
    } catch {}
  }

  private playPickupSpawn(): void {
    if (!this.spawnSynth) return;
    const t = toneNow();
    try {
      this.spawnSynth.triggerAttackRelease("C5", 0.04, t);
      this.spawnSynth.triggerAttackRelease("E5", 0.04, t + 0.04);
      this.spawnSynth.triggerAttackRelease("G5", 0.04, t + 0.08);
    } catch {}
  }

  private playPickupGrab(type: PickupType): void {
    const t = toneNow();
    try {
      switch (type) {
        case "hp":
          this.hpSynth?.triggerAttackRelease(["C5", "E5", "G5"], 0.15, t);
          break;
        case "shield":
          this.shieldSynth?.triggerAttackRelease(["A3", "E4", "A4"], 0.2, t);
          break;
        case "scoreBoost":
          if (this.boostSynth) {
            this.boostSynth.frequency.cancelScheduledValues(t);
            this.boostSynth.frequency.setValueAtTime(523.25, t); // C5
            this.boostSynth.frequency.exponentialRampToValueAtTime(
              1046.5, // C6
              t + 0.2,
            );
            this.boostSynth.triggerAttackRelease(523.25, 0.2, t);
          }
          break;
        case "breaker":
          this.breakerSynth?.triggerAttackRelease(["C2", "G2", "C3"], 0.18, t);
          break;
      }
    } catch {}
  }

  private playHit(): void {
    if (!this.hitSynth) return;
    try {
      this.hitSynth.triggerAttackRelease(80, 0.4, toneNow());
    } catch {}
  }

  private playHitLight(): void {
    if (!this.hitLightSynth) return;
    try {
      this.hitLightSynth.triggerAttackRelease(880, 0.04, toneNow(), 0.18);
    } catch {}
  }

  private playHitMedium(): void {
    if (!this.hitMediumSynth) return;
    try {
      this.hitMediumSynth.triggerAttackRelease(120, 0.15, toneNow());
    } catch {}
  }

  private playHitHeavy(): void {
    if (!this.hitHeavyMembrane || !this.hitHeavyNoise) return;
    try {
      const t = toneNow();
      this.hitHeavyMembrane.triggerAttackRelease(80, 0.4, t);
      this.hitHeavyNoise.triggerAttackRelease(0.2, t);
    } catch {}
  }

  private playAlert(): void {
    if (!this.alertSynth) return;
    // Slow sub-swell — 80 Hz, 0.6 s attack-decay through long dark
    // reverb. Used only by the boss Ring-Burst telegraph now.
    try {
      this.alertSynth.triggerAttackRelease(80, 0.55, toneNow(), 0.7);
    } catch {}
  }

  private playWatcherCharge(): void {
    if (!this.watcherChargeSynth || !this.watcherChargeFilter) return;
    try {
      const t = toneNow();
      // Pitch climbs 70 → 220 Hz over the 1.2 s aiming window (was
      // 110 → 330); filter opens 220 → 1200 Hz. Subbier, dirtier
      // start — reads as something ominous spooling up.
      this.watcherChargeSynth.frequency.cancelScheduledValues(t);
      this.watcherChargeSynth.frequency.setValueAtTime(70, t);
      this.watcherChargeSynth.frequency.exponentialRampToValueAtTime(
        220,
        t + 1.15,
      );
      this.watcherChargeFilter.frequency.cancelScheduledValues(t);
      this.watcherChargeFilter.frequency.setValueAtTime(220, t);
      this.watcherChargeFilter.frequency.exponentialRampToValueAtTime(
        1200,
        t + 1.15,
      );
      this.watcherChargeSynth.triggerAttackRelease(70, 1.15, t, 0.4);
    } catch {}
  }

  private playWatcherFire(): void {
    if (!this.watcherFireMembrane || !this.watcherFireNoise) return;
    try {
      const t = toneNow();
      // Sub-thump at 70 Hz with octaves: 6 for pitch travel; pink-
      // noise crack adds the beam ignition. Two layers strike
      // simultaneously — reads as a hard industrial impact, not a
      // melodic sweep.
      this.watcherFireMembrane.triggerAttackRelease(70, 0.18, t, 0.85);
      this.watcherFireNoise.triggerAttackRelease(0.1, t, 0.6);
    } catch {}
  }

  private playHunterSnarl(): void {
    if (!this.hunterSnarlSynth || !this.hunterSnarlFilter) return;
    try {
      const t = toneNow();
      // 90 → 45 Hz fast descent (was 130 → 70), filter slams 600 →
      // 180 Hz. Sub-territory growl — dropped a half-octave to sit
      // in the chest.
      this.hunterSnarlSynth.frequency.cancelScheduledValues(t);
      this.hunterSnarlSynth.frequency.setValueAtTime(90, t);
      this.hunterSnarlSynth.frequency.exponentialRampToValueAtTime(
        45,
        t + 0.14,
      );
      this.hunterSnarlFilter.frequency.cancelScheduledValues(t);
      this.hunterSnarlFilter.frequency.setValueAtTime(600, t);
      this.hunterSnarlFilter.frequency.exponentialRampToValueAtTime(
        180,
        t + 0.14,
      );
      this.hunterSnarlSynth.triggerAttackRelease(90, 0.14, t, 0.75);
    } catch {}
  }

  private playBossPhase(): void {
    if (!this.bossPhaseSynth || !this.bossPhaseNoise || !this.bossPhaseFilter) {
      return;
    }
    try {
      const t = toneNow();
      // Sub-saw rises 38 → 95 Hz over 900 ms (was 55→110 / 600 ms);
      // filter opens 140 → 1100 Hz. Pink-noise rumble underneath.
      // Subbier, longer, more cataclysmic.
      this.bossPhaseSynth.frequency.cancelScheduledValues(t);
      this.bossPhaseSynth.frequency.setValueAtTime(38, t);
      this.bossPhaseSynth.frequency.exponentialRampToValueAtTime(
        95,
        t + 0.9,
      );
      this.bossPhaseFilter.frequency.cancelScheduledValues(t);
      this.bossPhaseFilter.frequency.setValueAtTime(140, t);
      this.bossPhaseFilter.frequency.exponentialRampToValueAtTime(
        1100,
        t + 0.9,
      );
      this.bossPhaseSynth.triggerAttackRelease(38, 1.1, t, 0.85);
      this.bossPhaseNoise.triggerAttackRelease(0.7, t, 0.5);
    } catch {}
  }

  private playBossMineSpawn(): void {
    if (!this.bossMineSpawnSynth) return;
    try {
      // Sub-saw thud at 165 Hz with a long reverb tail — replaces the
      // 440 Hz triangle bleep. Reads as a heavy seed dropping, not a
      // UI cue.
      this.bossMineSpawnSynth.triggerAttackRelease(165, 0.25, toneNow(), 0.55);
    } catch {}
  }

  private playBossMineDetonate(): void {
    if (!this.bossMineDetonateMembrane || !this.bossMineDetonateNoise) return;
    try {
      const t = toneNow();
      // Membrane at 45 Hz (was 60) — deeper thump, octaves: 7 in
      // setup gives it more pitch travel on the decay; pink-noise
      // crackle slightly louder.
      this.bossMineDetonateMembrane.triggerAttackRelease(45, 0.65, t, 1.0);
      this.bossMineDetonateNoise.triggerAttackRelease(0.5, t, 0.7);
    } catch {}
  }

  private playBossSweepStart(): void {
    if (!this.bossSweepStartSynth || !this.bossSweepStartFilter) return;
    try {
      const t = toneNow();
      // Rising warning drone — 65 → 175 Hz (was 120→280), filter
      // opens 200 → 900 Hz. Subbier start, more dread; longer
      // sustain so it bleeds into the firing-1 sweep.
      this.bossSweepStartSynth.frequency.cancelScheduledValues(t);
      this.bossSweepStartSynth.frequency.setValueAtTime(65, t);
      this.bossSweepStartSynth.frequency.exponentialRampToValueAtTime(
        175,
        t + 0.5,
      );
      this.bossSweepStartFilter.frequency.cancelScheduledValues(t);
      this.bossSweepStartFilter.frequency.setValueAtTime(200, t);
      this.bossSweepStartFilter.frequency.exponentialRampToValueAtTime(
        900,
        t + 0.5,
      );
      this.bossSweepStartSynth.triggerAttackRelease(65, 0.6, t, 0.6);
    } catch {}
  }

  // The mid-pause reverse cue uses `high=false` (heavy pull-back at
  // firing-1 → mid-pause); the final-100ms countdown uses
  // `high=true` (brighter pitch, sells the impending firing-2).
  private playBossSweepReverse(high: boolean): void {
    if (!this.bossSweepReverseSynth || !this.bossSweepReverseFilter) return;
    try {
      const t = toneNow();
      // Dropped both pitches an octave from the first pass — base
      // 70 Hz / countdown 140 Hz. Slower descent (220 → 100/200 ms).
      const pitch = high ? 140 : 70;
      this.bossSweepReverseSynth.frequency.cancelScheduledValues(t);
      this.bossSweepReverseSynth.frequency.setValueAtTime(pitch * 2, t);
      this.bossSweepReverseSynth.frequency.exponentialRampToValueAtTime(
        pitch,
        t + 0.28,
      );
      this.bossSweepReverseFilter.frequency.cancelScheduledValues(t);
      this.bossSweepReverseFilter.frequency.setValueAtTime(1100, t);
      this.bossSweepReverseFilter.frequency.exponentialRampToValueAtTime(
        300,
        t + 0.28,
      );
      this.bossSweepReverseSynth.triggerAttackRelease(pitch * 2, 0.32, t, 0.65);
    } catch {}
  }

  private playBossEyeHit(): void {
    if (!this.bossEyeHitSynth || !this.bossEyeHitNoise) return;
    try {
      const t = toneNow();
      // A3 + C4 + E4 minor triad — dropped another octave to read
      // as a ringing shard, not a chime. Long reverb tail keeps the
      // reward audible without high-end sweetness.
      this.bossEyeHitNoise.triggerAttackRelease(0.06, t, 0.55);
      this.bossEyeHitSynth.triggerAttackRelease(
        ["A3", "C4", "E4"],
        0.7,
        t + 0.005,
        0.55,
      );
    } catch {}
  }

  // Menu UI cues. Hover: tight 880 Hz triangle through crusher,
  // very quiet. Click: 440 Hz triangle through crusher + soft
  // chorus-like detune via two-voice retrigger. Static: short
  // bandpassed white-noise burst for the bg big-glitch flash.
  private setupUiCues(): void {
    const hoverCrusher = new BitCrusher(4).connect(this.sfx!);
    this.uiHoverSynth = new Synth({
      oscillator: { type: "triangle" },
      envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.01 },
      volume: -8,
    }).connect(hoverCrusher);
    const clickCrusher = new BitCrusher(5).connect(this.sfx!);
    this.uiClickSynth = new Synth({
      oscillator: { type: "triangle" },
      envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.03 },
      volume: -4,
    }).connect(clickCrusher);
    const staticBp = new Filter({
      type: "bandpass",
      frequency: 2400,
      Q: 1.4,
    }).connect(this.sfx!);
    this.uiStaticNoise = new NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 },
      volume: -12,
    }).connect(staticBp);
  }

  private playBossRingDetach(): void {
    if (!this.bossRingDetachMembrane || !this.bossRingDetachSynth) return;
    if (!this.bossRingDetachFilter) return;
    try {
      const t = toneNow();
      // Membrane thump at 50 Hz for the body tear, layered with a
      // saw at 120 Hz that drops to 60 Hz through a closing lowpass
      // (700 → 250 Hz) — sells the structure pulling apart.
      this.bossRingDetachMembrane.triggerAttackRelease(50, 0.4, t, 0.95);
      this.bossRingDetachSynth.frequency.cancelScheduledValues(t);
      this.bossRingDetachSynth.frequency.setValueAtTime(120, t);
      this.bossRingDetachSynth.frequency.exponentialRampToValueAtTime(
        60,
        t + 0.5,
      );
      this.bossRingDetachFilter.frequency.cancelScheduledValues(t);
      this.bossRingDetachFilter.frequency.setValueAtTime(700, t);
      this.bossRingDetachFilter.frequency.exponentialRampToValueAtTime(
        250,
        t + 0.5,
      );
      this.bossRingDetachSynth.triggerAttackRelease(120, 0.5, t, 0.7);
    } catch {}
  }

  private playUiHover(): void {
    if (!this.uiHoverSynth) return;
    try {
      this.uiHoverSynth.triggerAttackRelease(880, 0.03, toneNow(), 0.4);
    } catch {}
  }

  private playUiClick(): void {
    if (!this.uiClickSynth) return;
    try {
      const t = toneNow();
      this.uiClickSynth.triggerAttackRelease(440, 0.08, t, 0.6);
      // Faux-chorus — second voice a quartertone up at -3 ms gives a
      // light shimmer without a real Chorus node.
      this.uiClickSynth.triggerAttackRelease(452, 0.08, t + 0.003, 0.4);
    } catch {}
  }

  private playUiStatic(): void {
    if (!this.uiStaticNoise) return;
    try {
      this.uiStaticNoise.triggerAttackRelease(0.04, toneNow(), 0.5);
    } catch {}
  }

  private setupNarratorTick(): void {
    // Short, dry typewriter-style tick used per character during the
    // intro + tutorial-outro narrator beats. Bit-crushed triangle
    // through a bandpass keeps it bright but not harsh; volume sits
    // low so a long sentence doesn't dominate the cinematic.
    const crusher = new BitCrusher(5).connect(this.sfx!);
    const bp = new Filter({ type: "bandpass", frequency: 2400, Q: 1.6 }).connect(
      crusher,
    );
    this.narratorTickSynth = new Synth({
      oscillator: { type: "triangle" },
      envelope: { attack: 0.001, decay: 0.025, sustain: 0, release: 0.02 },
      volume: -16,
    }).connect(bp);
  }

  private playNarratorTick(): void {
    if (!this.narratorTickSynth) return;
    try {
      // Pitch jitter keeps repeated ticks from locking into a single
      // tone — feels like keystrokes instead of a metronome.
      const base = 2100 + (Math.random() - 0.5) * 240;
      this.narratorTickSynth.triggerAttackRelease(base, 0.02, toneNow(), 0.4);
    } catch {}
  }

  // Wall-bump cue. Reuses the hit synth at very low velocity so it sits
  // far below the regular damage hit (-26..-30 dB depending on strength)
  // and doesn't grate during normal play.
  private playSmash(strength: number): void {
    if (!this.hitSynth) return;
    const s = Math.max(0, Math.min(1, strength));
    const velocity = 0.04 + 0.04 * s;
    try {
      this.hitSynth.triggerAttackRelease(70, 0.18, toneNow(), velocity);
    } catch {}
  }

  private playMultUp(tier: number): void {
    if (!this.multSynth) return;
    let target: number;
    if (tier <= 3) target = 440; // A4
    else if (tier <= 5) target = 523.25; // C5
    else if (tier <= 7) target = 659.25; // E5
    else target = 880; // A5
    const t = toneNow();
    try {
      this.multSynth.frequency.cancelScheduledValues(t);
      this.multSynth.frequency.setValueAtTime(target * 0.5, t);
      this.multSynth.frequency.exponentialRampToValueAtTime(target, t + 0.25);
      this.multSynth.triggerAttackRelease(target * 0.5, 0.25, t);
    } catch {}
  }

  private playRunEnd(): void {
    if (!this.endSynth || !this.endFilter) return;
    // Release any voices still lingering from gameplay before the
    // death cue fires. Without this a sustain-stuck note (rare, but
    // happens when a hit lands the same tick as the death) would
    // bleed into the runEnd chord and never let go.
    this.silence();
    const t = toneNow();
    try {
      this.endFilter.frequency.cancelScheduledValues(t);
      this.endFilter.frequency.setValueAtTime(2000, t);
      this.endFilter.frequency.exponentialRampToValueAtTime(200, t + 0.8);
      this.endSynth.triggerAttackRelease(["A4", "E4", "A3"], 0.8, t);
    } catch {}
  }
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

export const audio = new AudioEngine();
