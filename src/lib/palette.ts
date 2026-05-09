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
} as const;
