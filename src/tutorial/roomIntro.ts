import type { Room } from "../lib/room";

const ROOM_W = 1200;
const ROOM_H = 800;

// Tutorial entry room — a narrative interlude played the first time
// after the intro cinematic. Visually it IS the cinematic
// background — pure void with the drifting vector grid, no walls,
// no door, no enemies. The hero spawns at centre where the cinematic
// left it, the narrator's lines fade in below the eye, and then the
// game auto-transitions to `room0` (the controls markers room).
//
// tutorial-game.ts owns the narration sequencer and the transition
// trigger — this file just declares the shape of the room. Walls
// are intentionally empty so the player can't bump into anything;
// movement is suppressed in tutorial-game while the narration runs.
export function buildRoomIntro(): Room {
  return {
    id: "roomIntro",
    theme: "tutorial",
    walls: [],
    enemies: [],
    door: null,
    nextRoomId: "room0",
    spawnX: ROOM_W / 2,
    spawnY: ROOM_H / 2,
  };
}
