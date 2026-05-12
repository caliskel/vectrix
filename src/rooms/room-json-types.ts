/**
 * JSON schema for editor-authored rooms. Mirrors the runtime `Room` shape
 * (`src/lib/room.ts`) as plain data — no callbacks, no class instances.
 * The loader `buildRoomFromJson` inflates this into a runtime `Room`.
 *
 * Sentinel and boss-rooms are intentionally NOT in the schema — boss rooms
 * remain code-authored (`src/rooms/room5.ts`). Tutorial markers are also
 * excluded (tutorial rooms stay TS-only).
 *
 * See `docs/plans/2026-05-12-002-feat-level-editor-plan.md` U1 for context.
 */

import type { AmbientBulletField, WorldLabel } from "../lib/room";

/** Editor-authorable enemy archetypes. Sentinel intentionally excluded —
 *  boss state-machines stay code-only per scope boundary. */
export type EditorEnemyType = "turret" | "watcher" | "hunter";

export type WallSpec = {
  x: number;
  y: number;
  w: number;
  h: number;
  dashable?: boolean;
  infected?: boolean;
  mergeLeft?: boolean;
  mergeRight?: boolean;
  mergeTop?: boolean;
  mergeBottom?: boolean;
};

export type TurretOpts = {
  startsAggressive?: boolean;
  fireIntervalSec?: number;
  bulletSpeed?: number;
  spawnInvulnerableSec?: number;
};

export type HunterOpts = {
  startsAggressive?: boolean;
  ignoresWalls?: boolean;
};

export type EnemySpec =
  | {
      type: "turret";
      x: number;
      y: number;
      opts?: TurretOpts;
      dropsKey?: boolean;
    }
  | {
      type: "watcher";
      x: number;
      y: number;
      dropsKey?: boolean;
    }
  | {
      type: "hunter";
      x: number;
      y: number;
      opts?: HunterOpts;
      dropsKey?: boolean;
    };

/** Lazy spawn point — either a fixed (x, y) or a random Y within a range
 *  on a fixed x-column. The Room-4 "random hunter per section" pattern is
 *  the `randomY` case. */
export type PendingSpawnSpec =
  | { kind: "point"; x: number; y: number }
  | { kind: "randomY"; x: number; yRange: [number, number] };

export type PendingEnemySpec =
  | {
      type: "turret";
      opts?: TurretOpts;
      dropsKey?: boolean;
      triggerX: number;
      spawn: PendingSpawnSpec;
    }
  | {
      type: "watcher";
      dropsKey?: boolean;
      triggerX: number;
      spawn: PendingSpawnSpec;
    }
  | {
      type: "hunter";
      opts?: HunterOpts;
      dropsKey?: boolean;
      triggerX: number;
      spawn: PendingSpawnSpec;
    };

export type DoorSpec = {
  x: number;
  y: number;
  w: number;
  h: number;
  initial?: "closed" | "open";
  requiresKey?: boolean;
  flipped?: boolean;
};

/** Top-level shape of `src/rooms/<id>.json`. */
export type RoomJson = {
  id: string;
  width?: number;
  height?: number;
  spawnX: number;
  spawnY: number;
  walls: WallSpec[];
  enemies: EnemySpec[];
  pendingEnemies?: PendingEnemySpec[];
  door?: DoorSpec | null;
  backDoor?: DoorSpec | null;
  prevRoomId?: string | null;
  nextRoomId?: string | null;
  initialKey?: { x: number; y: number };
  ambientBullets?: AmbientBulletField;
  worldLabels?: WorldLabel[];
  message?: string;
};
