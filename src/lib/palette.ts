// Single source of truth for the neon-arcade palette. Game-object colors in
// DEFAULT_SETTINGS reference these so a future palette tweak only happens
// here. Existing users who've customized colors keep their picks.
export const PALETTE = {
  bg: "#0a0e1a",
  bgGrid: "#14192b",
  player: "#ffffff",
  playerWalk: "#cbd5e1",
  playerDash: "#00e5ff",
  // dedicated trail colors so the streak reads as light, not as a smear
  // of the body — each is a lighter cousin of its body color
  playerTrail: "#d8b4fe",
  playerWalkTrail: "#cbd5e1",
  playerDashTrail: "#ede9fe",
  bullet: "#ff2d55",
  pickupHP: "#4ade80",
  pickupShield: "#60a5fa",
  pickupBoost: "#c084fc",
  pickupBreaker: "#fb923c",

  // Wall detail language (lib/walls.ts wall styles).
  wallTrimNormal: "#a5f3fc",
  wallTrimInfected: "#ff5577",

  // --- Zone theme colors (composed in lib/zone-theme.ts) ---
  // Neutral / sandbox / default — the historical cyan-slate identity.
  zoneNeutralAccent: "#7dd3fc",
  zoneNeutralAccentDim: "#3b6e8f",
  zoneNeutralWashInner: "#1c3550",
  zoneNeutralWashOuter: "#0a0e1a",
  zoneNeutralDustFar: "#7dd3fc",
  zoneNeutralDustMid: "#a5f3fc",
  zoneNeutralDustNear: "#cffafe",
  // Radar-sweep band colors — MUST stay rgba(...) strings: arena-bg
  // parses them to derive the transparent gradient-edge variant.
  zoneNeutralSweep: "rgba(125, 211, 252, 0.10)",
  zoneInfectedSweep: "rgba(177, 76, 255, 0.08)",
  zoneBossSweep: "rgba(255, 85, 119, 0.08)",
  zoneTutorialSweep: "rgba(148, 163, 184, 0.08)",
  // Infected sector — red-purple per the visual-overhaul reference.
  // Wash leans purple so PALETTE.bullet red stays separable.
  zoneInfectedAccent: "#ff4d6d",
  zoneInfectedAccentDim: "#8a2c4f",
  zoneInfectedWashInner: "#4a1440",
  zoneInfectedWashOuter: "#160a20",
  zoneInfectedDustFar: "#b14cff",
  zoneInfectedDustMid: "#d18aff",
  zoneInfectedDustNear: "#ffb3c8",
  // Boss arena — deep crimson; the Sentinel's phase colors stay loudest.
  zoneBossAccent: "#ff5577",
  zoneBossAccentDim: "#7a2038",
  zoneBossWashInner: "#3c0e22",
  zoneBossWashOuter: "#120612",
  zoneBossDustFar: "#ff5577",
  zoneBossDustMid: "#ff8fa3",
  zoneBossDustNear: "#ffc2cc",
  // Tutorial — calm slate.
  zoneTutorialAccent: "#94a3b8",
  zoneTutorialAccentDim: "#475569",
  zoneTutorialWashInner: "#1a2433",
  zoneTutorialWashOuter: "#0a0e1a",
  zoneTutorialDustFar: "#94a3b8",
  zoneTutorialDustMid: "#b8c4d4",
  zoneTutorialDustNear: "#d8e0ea",
} as const;
