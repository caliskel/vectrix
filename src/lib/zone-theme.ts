// Zone theme registry — the single source of per-zone visual identity.
// A room (or a whole mode) names a ZoneThemeId; everything visual that
// differs between zones reads the resolved theme: floor wash colors,
// arena-bg sublayer tints, margin decor vocabulary, and whether the
// campaign darkness overlay applies (and how dark).
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
 *  Themes list the kinds that appear in their zone (decorDominant);
 *  anything not listed never seeds there, so zones read as different
 *  places, not the same wallpaper recolored. */
export type DecorSilhouette = "hexCluster" | "circuit" | "dataBlock" | "eye";

/** Darkness overlay parameters — null for zones with full visibility. */
export type ZoneDarkness = {
  /** Overlay opacity outside the light pool (0..1). */
  alpha: number;
  /** Light-pool radius around the player, world px. */
  visibilityRadiusPx: number;
  /** Dusk tint as a bare "r, g, b" triplet — the overlay composes
   *  rgba() from it, so a zone's darkness carries the zone's hue
   *  instead of crushing everything to neutral black. */
  duskRgb: string;
};

export type ZoneTheme = {
  id: ZoneThemeId;
  /** Campaign darkness overlay — null = none. Truthy check gates it. */
  darkness: ZoneDarkness | null;
  /** Reactivity hook — 0..1, static in v1. Scales wash alpha and
   *  decor activity. 1 = the zone's designed look. */
  intensity: number;
  /** Zone accent pair — bright accent for decor/trim highlights (also
   *  the arena-bg grid-pulse color), dim accent for far layers and
   *  faint fills. */
  accent: string;
  accentDim: string;
  /** Floor wash — radial bloom baked into arena-bg. Inner = center
   *  color, outer = edge color. Alphas are the at-intensity-1 budget;
   *  kept low so threats stay the brightest layer (R11). */
  washInner: string;
  washOuter: string;
  washAlpha: number;
  /** Arena-bg dust dot tints (back→front) and the radar sweep band
   *  color. sweepColor MUST be an rgba(...) string — arena-bg parses
   *  it to derive the transparent gradient-edge variant. */
  dustColors: [string, string, string];
  sweepColor: string;
  /** Margin / under-floor decor vocabulary (see DecorSilhouette). */
  decorDominant: DecorSilhouette[];
  /** Skip the legacy background-energy margin pass for this zone —
   *  its fixed cyan palette would bleed under zones whose identity
   *  conflicts with it (e.g. infected red-purple). */
  suppressBackgroundEnergy: boolean;
};

/** Resolved theme handed to consumers — theme definition plus the
 *  effective intensity (room override wins over the theme default). */
export type ZoneThemeState = {
  theme: ZoneTheme;
  intensity: number;
};

// Neutral cyan-slate identity shared by the default and sandbox themes —
// the game's historical deep-field look.
const NEUTRAL_BASE = {
  darkness: null,
  intensity: 1,
  accent: PALETTE.zoneNeutralAccent,
  accentDim: PALETTE.zoneNeutralAccentDim,
  washInner: PALETTE.zoneNeutralWashInner,
  washOuter: PALETTE.zoneNeutralWashOuter,
  washAlpha: 0.10,
  dustColors: [
    PALETTE.zoneNeutralDustFar,
    PALETTE.zoneNeutralDustMid,
    PALETTE.zoneNeutralDustNear,
  ] as [string, string, string],
  sweepColor: PALETTE.zoneNeutralSweep,
  decorDominant: ["circuit", "dataBlock", "hexCluster"] as DecorSilhouette[],
  suppressBackgroundEnergy: false,
};

const THEMES: Record<ZoneThemeId, ZoneTheme> = {
  // Neutral fallback — also what legacy JSON rooms get.
  default: { ...NEUTRAL_BASE, id: "default" },
  // Sandbox — same neutral identity, dimmer wash: the under-floor decor
  // has no letterbox separation from gameplay there.
  sandbox: { ...NEUTRAL_BASE, id: "sandbox", washAlpha: 0.08 },
  // The campaign's infected sector (room1 corridor + hub trio) —
  // red-purple identity per the approved reference image. Wash leans
  // purple over red so PALETTE.bullet red threats stay separable (R4).
  infected: {
    id: "infected",
    darkness: null,
    intensity: 1,
    accent: PALETTE.zoneInfectedAccent,
    accentDim: PALETTE.zoneInfectedAccentDim,
    washInner: PALETTE.zoneInfectedWashInner,
    washOuter: PALETTE.zoneInfectedWashOuter,
    washAlpha: 0.55,
    dustColors: [
      PALETTE.zoneInfectedDustFar,
      PALETTE.zoneInfectedDustMid,
      PALETTE.zoneInfectedDustNear,
    ],
    sweepColor: PALETTE.zoneInfectedSweep,
    decorDominant: ["hexCluster", "eye", "circuit"],
    suppressBackgroundEnergy: true,
  },
  // Boss arena — deeper crimson, fewer cool tones; the Sentinel's own
  // phase colors stay the loudest reds on screen.
  boss: {
    id: "boss",
    darkness: null,
    intensity: 1,
    accent: PALETTE.zoneBossAccent,
    accentDim: PALETTE.zoneBossAccentDim,
    washInner: PALETTE.zoneBossWashInner,
    washOuter: PALETTE.zoneBossWashOuter,
    washAlpha: 0.45,
    dustColors: [
      PALETTE.zoneBossDustFar,
      PALETTE.zoneBossDustMid,
      PALETTE.zoneBossDustNear,
    ],
    sweepColor: PALETTE.zoneBossSweep,
    decorDominant: ["hexCluster", "eye"],
    suppressBackgroundEnergy: true,
  },
  // Tutorial — calm slate; quietest zone so the lessons stay in focus.
  tutorial: {
    id: "tutorial",
    darkness: null,
    intensity: 0.7,
    accent: PALETTE.zoneTutorialAccent,
    accentDim: PALETTE.zoneTutorialAccentDim,
    washInner: PALETTE.zoneTutorialWashInner,
    washOuter: PALETTE.zoneTutorialWashOuter,
    washAlpha: 0.08,
    dustColors: [
      PALETTE.zoneTutorialDustFar,
      PALETTE.zoneTutorialDustMid,
      PALETTE.zoneTutorialDustNear,
    ],
    sweepColor: PALETTE.zoneTutorialSweep,
    decorDominant: ["dataBlock", "circuit"],
    suppressBackgroundEnergy: false,
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
