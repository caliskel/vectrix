import {
  BitCrusher,
  Distortion,
  Filter,
  Gain,
  MembraneSynth,
  NoiseSynth,
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
  private music?: Gain; // reserved for future, no synths route through it yet

  // Sound 1: dash
  private dashSynth?: Synth;
  private dashFilter?: Filter;

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

  // Sound 7: mult tier up
  private multSynth?: Synth;

  // Sound 8: run end
  private endSynth?: PolySynth;
  private endFilter?: Filter;

  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    // Tone.start() must run inside a user gesture; the caller is responsible.
    void toneStart();
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
    this.setupMultUp();
    this.setupRunEnd();
  }

  private setupDash(): void {
    const reverb = new Reverb({ decay: 0.4, wet: 0.15 }).connect(this.sfx!);
    void reverb.generate();
    const filter = new Filter({
      type: "lowpass",
      frequency: 2000,
      Q: 6,
    }).connect(reverb);
    this.dashFilter = filter;
    this.dashSynth = new Synth({
      oscillator: { type: "sawtooth" },
      envelope: { attack: 0, decay: 0.08, sustain: 0, release: 0.05 },
    }).connect(filter);
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
    multUp: (tier: number): void => this.playMultUp(tier),
    runEnd: (): void => this.playRunEnd(),
  };

  private playDash(): void {
    if (!this.dashSynth || !this.dashFilter) return;
    const t = toneNow();
    try {
      this.dashSynth.frequency.cancelScheduledValues(t);
      this.dashSynth.frequency.setValueAtTime(800, t);
      this.dashSynth.frequency.exponentialRampToValueAtTime(200, t + 0.08);
      this.dashFilter.frequency.cancelScheduledValues(t);
      this.dashFilter.frequency.setValueAtTime(2000, t);
      this.dashFilter.frequency.exponentialRampToValueAtTime(400, t + 0.08);
      this.dashSynth.triggerAttackRelease(800, 0.08, t);
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
