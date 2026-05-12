/**
 * Runtime loader: transforms editor-authored JSON into a runtime `Room`.
 *
 * Dispatches the discriminated `EnemySpec` union onto the corresponding
 * enemy constructors and wraps `pendingEnemies` specs in closures the
 * frame loop can call when the player crosses `triggerX`.
 *
 * Validation is strict — missing required fields, unknown enemy types,
 * and invalid pendingEnemy `spawn.kind` values throw immediately so
 * corrupt JSON surfaces at load time, not at frame N during play.
 *
 * Sentinel is NOT in the schema (boss rooms code-only). The loader will
 * throw if a JSON tries to declare one.
 *
 * See `docs/plans/2026-05-12-002-feat-level-editor-plan.md` U1.
 */

import { Hunter } from "../lib/enemies/hunter";
import { Turret } from "../lib/enemies/turret";
import { Watcher } from "../lib/enemies/watcher";
import type { Enemy } from "../lib/enemies/types";
import { makeDoor } from "../lib/door";
import type { Door } from "../lib/door";
import type { PendingEnemy, Room } from "../lib/room";
import type {
  DoorSpec,
  EnemySpec,
  PendingEnemySpec,
  PendingSpawnSpec,
  RoomJson,
} from "./room-json-types";
import { validateRoomJson } from "./validate-room-json";

const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 800;

function buildEnemy(spec: EnemySpec): Enemy {
  let enemy: Enemy;
  switch (spec.type) {
    case "turret":
      enemy = new Turret(spec.x, spec.y, spec.opts ?? {});
      break;
    case "watcher":
      enemy = new Watcher(spec.x, spec.y);
      break;
    case "hunter":
      enemy = new Hunter(spec.x, spec.y, spec.opts ?? {});
      break;
    default: {
      const exhaustive: never = spec;
      throw new Error(
        `buildEnemy: unknown enemy type ${JSON.stringify(exhaustive)}`,
      );
    }
  }
  if (spec.dropsKey) enemy.dropsKey = true;
  return enemy;
}

function resolveSpawnPoint(spawn: PendingSpawnSpec): { x: number; y: number } {
  switch (spawn.kind) {
    case "point":
      return { x: spawn.x, y: spawn.y };
    case "randomY": {
      const [y1, y2] = spawn.yRange;
      const lo = Math.min(y1, y2);
      const hi = Math.max(y1, y2);
      return { x: spawn.x, y: lo + Math.random() * (hi - lo) };
    }
    default: {
      const exhaustive: never = spawn;
      throw new Error(
        `resolveSpawnPoint: unknown spawn kind ${JSON.stringify(exhaustive)}`,
      );
    }
  }
}

function buildPendingEnemy(spec: PendingEnemySpec): PendingEnemy {
  const factory: () => Enemy = () => {
    const point = resolveSpawnPoint(spec.spawn);
    switch (spec.type) {
      case "turret": {
        const e = new Turret(point.x, point.y, spec.opts ?? {});
        if (spec.dropsKey) e.dropsKey = true;
        return e;
      }
      case "watcher": {
        const e = new Watcher(point.x, point.y);
        if (spec.dropsKey) e.dropsKey = true;
        return e;
      }
      case "hunter": {
        const e = new Hunter(point.x, point.y, spec.opts ?? {});
        if (spec.dropsKey) e.dropsKey = true;
        return e;
      }
      default: {
        const exhaustive: never = spec;
        throw new Error(
          `buildPendingEnemy: unknown enemy type ${JSON.stringify(exhaustive)}`,
        );
      }
    }
  };
  return {
    triggerX: spec.triggerX,
    spawned: false,
    spawn: factory,
  };
}

function buildDoor(spec: DoorSpec): Door {
  return makeDoor(
    spec.x,
    spec.y,
    spec.w,
    spec.h,
    spec.initial ?? "closed",
    spec.requiresKey ?? false,
    spec.flipped ?? false,
  );
}

/** Build a runtime `Room` from a JSON definition. Idempotent: each call
 *  produces fresh enemy instances, fresh `pendingEnemies` closures
 *  (`spawned: false`), and a fresh `Door` — safe to call from
 *  `start()` and `rebuildAllRooms()` repeatedly. */
export function buildRoomFromJson(json: RoomJson, idHint?: string): Room {
  validateRoomJson(json, idHint);
  const width = json.width ?? DEFAULT_WIDTH;
  const height = json.height ?? DEFAULT_HEIGHT;
  const useCamera = width > DEFAULT_WIDTH || height > DEFAULT_HEIGHT;

  return {
    id: json.id,
    walls: json.walls.map((w) => ({ ...w })),
    enemies: json.enemies.map(buildEnemy),
    door: json.door ? buildDoor(json.door) : null,
    nextRoomId: json.nextRoomId ?? null,
    spawnX: json.spawnX,
    spawnY: json.spawnY,
    width,
    height,
    useCamera,
    message: json.message,
    pendingEnemies: json.pendingEnemies?.map(buildPendingEnemy),
    initialKey: json.initialKey ? { ...json.initialKey } : undefined,
    backDoor: json.backDoor ? buildDoor(json.backDoor) : null,
    prevRoomId: json.prevRoomId ?? null,
    ambientBullets: json.ambientBullets
      ? {
          spawnArea: { ...json.ambientBullets.spawnArea },
          maxBullets: json.ambientBullets.maxBullets,
          spawnIntervalMs: json.ambientBullets.spawnIntervalMs,
          speed: json.ambientBullets.speed,
        }
      : undefined,
    worldLabels: json.worldLabels?.map((label) => ({ ...label })),
  };
}
