// Zone theme registry — the single source of per-zone visual identity.
// A room (or a whole mode) names a ZoneThemeId; everything visual that
// differs between zones reads the resolved theme: floor wash colors,
// arena-bg sublayer tints, margin decor vocabulary, wall style, and
// whether the campaign darkness overlay applies.
//
// Color values reference PALETTE (single source of truth for colors —
// the zone entries live there, this module only composes them).
//
// HUD exemption policy: HUD elements (HP pips, score, status banners,
// key icon, door indicators) are NEVER themed. If a zone's floor wash
// erodes HUD contrast, the fix is lowering that zone's wash alpha in
// the tuning pass — not recoloring the HUD.
//
// Gameplay-semantic colors are likewise exempt from theming: dashable
// wall cyan dash language, door lock gold, infected wall red, and the
// dash flash cyan (PALETTE.playerDash) keep their meaning in every zone.
//
// `intensity` is the reactivity hook: 0..1, statically set in v1.
// Consumers scale their alpha / activity budgets by it so a later
// iteration can drive it from gameplay (multiplier, aggro, boss phase)
// without reshaping any API.

import { PALETTE } from "./palette";

export type ZoneThemeId =
  | "default"
  | "infected"
  | "boss"
  | "sandbox"
  | "tutorial";

/** Wireframe silhouette kinds the margin/under-floor decor can draw.
 *  Themes pick dominant kinds (frequent) and suppressed kinds (never
 *  drawn in that zone) so zones read as different places, not the same
 *  wallpaper recolored. */
export type DecorSilhouette = "hexCluster" | "circuit" | "dataBlock" | "eye";

export type ZoneTheme = {
  id: ZoneThemeId;
  /** Campaign darkness overlay applies in rooms with this theme. */
  darkness: boolean;
  /** Reactivity hook — 0..1, static in v1. Scales wash alpha and
   *  decor activity. 1 = the zone's designed look. */
  intensity: number;
  /** Zone accent pair — bright accent for decor/trim highlights, dim
   *  accent for far layers and faint fills. */
  accent: string;
  accentDim: string;
  /** Floor wash — radial bloom baked into arena-bg. Inner = center
   *  color, outer = edge color. Alphas are the at-intensity-1 budget;
   *  kept low so threats stay the brightest layer (R11). */
  washInner: string;
  washOuter: string;
  washAlpha: number;
  /** Arena-bg sublayer tints (dust dot layers back→front, grid pulse,
   *  radar sweep) so the deep field matches the zone instead of staying
   *  fixed cyan under every wash. */
  dustColors: [string, string, string];
  pulseColor: string;
  sweepColor: string;
  /** Margin / under-floor decor vocabulary. */
  decorDominant: DecorSilhouette[];
  decorSuppressed: DecorSilhouette[];
  /** Skip the legacy background-energy margin pass for this zone —
   *  its fixed cyan palette would bleed under zones whose identity
   *  conflicts with it (e.g. infected red-purple). */
  suppressBackgroundEnergy: boolean;
  /** Wall style the walls bake uses for walls without a per-wall
   *  semantic override (infected flag, dashable). Consumed from the
   *  themed-walls unit onward. */
  wallStyleId: "normal" | "infected";
};

/** Resolved theme handed to consumers — theme definition plus the
 *  effective intensity (room override wins over the theme default). */
export type ZoneThemeState = {
  theme: ZoneTheme;
  intensity: number;
};

const THEMES: Record<ZoneThemeId, ZoneTheme> = {
  // Neutral fallback — also what legacy JSON rooms get. Mirrors the
  // game's historical cyan-slate deep field.
  default: {
    id: "default",
    darkness: false,
    intensity: 1,
    accent: PALETTE.zoneNeutralAccent,
    accentDim: PALETTE.zoneNeutralAccentDim,
    washInner: PALETTE.zoneNeutralWashInner,
    washOuter: PALETTE.zoneNeutralWashOuter,
    washAlpha: 0.10,
    dustColors: [PALETTE.zoneNeutralDustFar, PALETTE.zoneNeutralDustMid, PALETTE.zoneNeutralDustNear],
    pulseColor: PALETTE.zoneNeutralAccent,
    sweepColor: "rgba(125, 211, 252, 0.10)",
    decorDominant: ["circuit", "dataBlock", "hexCluster"],
    decorSuppressed: ["eye"],
    suppressBackgroundEnergy: false,
    wallStyleId: "normal",
  },
  // The campaign's infected sector (room1 corridor + hub trio) —
  // red-purple identity per the approved reference image. Wash leans
  // purple over red so PALETTE.bullet red threats stay separable (R4).
  infected: {
    id: "infected",
    darkness: true,
    intensity: 1,
    accent: PALETTE.zoneInfectedAccent,
    accentDim: PALETTE.zoneInfectedAccentDim,
    washInner: PALETTE.zoneInfectedWashInner,
    washOuter: PALETTE.zoneInfectedWashOuter,
    washAlpha: 0.16,
    dustColors: [PALETTE.zoneInfectedDustFar, PALETTE.zoneInfectedDustMid, PALETTE.zoneInfectedDustNear],
    pulseColor: PALETTE.zoneInfectedAccent,
    sweepColor: "rgba(177, 76, 255, 0.08)",
    decorDominant: ["hexCluster", "eye", "circuit"],
    decorSuppressed: ["dataBlock"],
    suppressBackgroundEnergy: true,
    wallStyleId: "normal",
  },
  // Boss arena — deeper crimson, fewer cool tones; the Sentinel's own
  // phase colors stay the loudest reds on screen.
  boss: {
    id: "boss",
    darkness: true,
    intensity: 1,
    accent: PALETTE.zoneBossAccent,
    accentDim: PALETTE.zoneBossAccentDim,
    washInner: PALETTE.zoneBossWashInner,
    washOuter: PALETTE.zoneBossWashOuter,
    washAlpha: 0.13,
    dustColors: [PALETTE.zoneBossDustFar, PALETTE.zoneBossDustMid, PALETTE.zoneBossDustNear],
    pulseColor: PALETTE.zoneBossAccent,
    sweepColor: "rgba(255, 85, 119, 0.08)",
    decorDominant: ["hexCluster", "eye"],
    decorSuppressed: ["dataBlock"],
    suppressBackgroundEnergy: true,
    wallStyleId: "normal",
  },
  // Sandbox — neutral cyan, subtle: the under-floor decor must stay
  // far below threat brightness because there is no letterbox
  // separation between decor and gameplay.
  sandbox: {
    id: "sandbox",
    darkness: false,
    intensity: 1,
    accent: PALETTE.zoneNeutralAccent,
    accentDim: PALETTE.zoneNeutralAccentDim,
    washInner: PALETTE.zoneNeutralWashInner,
    washOuter: PALETTE.zoneNeutralWashOuter,
    washAlpha: 0.08,
    dustColors: [PALETTE.zoneNeutralDustFar, PALETTE.zoneNeutralDustMid, PALETTE.zoneNeutralDustNear],
    pulseColor: PALETTE.zoneNeutralAccent,
    sweepColor: "rgba(125, 211, 252, 0.10)",
    decorDominant: ["circuit", "dataBlock", "hexCluster"],
    decorSuppressed: ["eye"],
    suppressBackgroundEnergy: false,
    wallStyleId: "normal",
  },
  // Tutorial — calm slate; quietest zone so the lessons stay in focus.
  tutorial: {
    id: "tutorial",
    darkness: false,
    intensity: 0.7,
    accent: PALETTE.zoneTutorialAccent,
    accentDim: PALETTE.zoneTutorialAccentDim,
    washInner: PALETTE.zoneTutorialWashInner,
    washOuter: PALETTE.zoneTutorialWashOuter,
    washAlpha: 0.08,
    dustColors: [PALETTE.zoneTutorialDustFar, PALETTE.zoneTutorialDustMid, PALETTE.zoneTutorialDustNear],
    pulseColor: PALETTE.zoneTutorialAccent,
    sweepColor: "rgba(148, 163, 184, 0.08)",
    decorDominant: ["dataBlock", "circuit"],
    decorSuppressed: ["eye"],
    suppressBackgroundEnergy: false,
    wallStyleId: "normal",
  },
};

/** Resolve a theme id (possibly absent — legacy rooms) to a theme
 *  state. Unknown / missing ids fall back to the default theme so
 *  legacy JSON rooms keep working without a declared theme. */
export function resolveZoneTheme(
  id?: string,
  intensityOverride?: number,
): ZoneThemeState {
  const theme =
    id && Object.prototype.hasOwnProperty.call(THEMES, id)
      ? THEMES[id as ZoneThemeId]
      : THEMES.default;
  return {
    theme,
    intensity: clamp01(intensityOverride ?? theme.intensity),
  };
}

export function isKnownZoneThemeId(id: string): id is ZoneThemeId {
  return Object.prototype.hasOwnProperty.call(THEMES, id);
}

export function listZoneThemeIds(): ZoneThemeId[] {
  return Object.keys(THEMES) as ZoneThemeId[];
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
