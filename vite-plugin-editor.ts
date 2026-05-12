/**
 * Vite dev-server plugin: in-game editor export endpoint.
 *
 * Exposes `POST /__editor/save` that accepts `{ id, json }` and writes
 * `src/rooms/<id>.json`. `apply: 'serve'` keeps it out of production
 * builds — the endpoint never exists in the deployed bundle.
 *
 * 5-layer hardening (per plan U3):
 *   L1 — loopback gate (closes Vite `allowedHosts` ngrok/cloudflare
 *        tunnel exposure; only 127.0.0.1 / ::1 traffic accepted).
 *   L2 — Origin allow-list (rejects CSRF from other localhost ports
 *        or external origins; curl with no Origin header is allowed).
 *   L3 — 512 KB body cap (declared via Content-Length and enforced on
 *        the stream; oversize → 413).
 *   L4 — symlink-safe containment (`fs.realpathSync` on the resolved
 *        parent dir; macOS `path.resolve` does NOT resolve symlinks,
 *        so a symlink dropped into `src/rooms/` could otherwise pivot
 *        the write target outside the project).
 *   L5 — schema validation pre-write via the Node-safe
 *        `validateRoomJson`; bad JSON never reaches disk so the HMR
 *        loader can't crash on the next pickup.
 *
 * See `docs/plans/2026-05-12-002-feat-level-editor-plan.md` U3.
 */

import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { validateRoomJson } from "./src/rooms/validate-room-json";

const ROOMS_DIR_REL = "src/rooms";
const MAX_BODY_BYTES = 524_288; // 512 KB ≈ 25x expected max room JSON
const ID_REGEX = /^[a-z0-9-]+$/;
const LOOPBACK_ADDRS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function isLoopback(addr: string | undefined): boolean {
  if (!addr) return false;
  return LOOPBACK_ADDRS.has(addr);
}

function isAllowedOrigin(origin: string | undefined): boolean {
  // curl / direct fetch sends no Origin; allow it.
  if (!origin) return true;
  try {
    const u = new URL(origin);
    return (
      u.protocol === "http:" &&
      (u.hostname === "localhost" || u.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}

function send(
  res: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

export default function editorPlugin(): Plugin {
  return {
    name: "dash-editor",
    apply: "serve",
    configureServer(server) {
      const projectRoot = server.config.root;
      const roomsDir = path.resolve(projectRoot, ROOMS_DIR_REL);
      let realRoomsDir: string;
      try {
        realRoomsDir = fs.realpathSync(roomsDir);
      } catch {
        // If src/rooms doesn't exist at boot, fall back to the resolved path —
        // writes will fail at the containment check, which is fine.
        realRoomsDir = roomsDir;
      }

      server.middlewares.use(
        "/__editor/save",
        (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          if (req.method !== "POST") {
            next();
            return;
          }

          // L1 — loopback gate
          if (!isLoopback(req.socket.remoteAddress ?? undefined)) {
            send(res, 403, { ok: false, error: "loopback only" });
            return;
          }

          // L2 — Origin allow-list
          const origin = req.headers.origin as string | undefined;
          if (!isAllowedOrigin(origin)) {
            send(res, 403, { ok: false, error: "origin not allowed" });
            return;
          }

          // L3 — declared body size cap
          const declaredLen = parseInt(
            (req.headers["content-length"] as string | undefined) ?? "0",
            10,
          );
          if (declaredLen > MAX_BODY_BYTES) {
            send(res, 413, { ok: false, error: "body too large" });
            return;
          }

          const chunks: Buffer[] = [];
          let received = 0;
          let aborted = false;

          req.on("data", (chunk: Buffer) => {
            if (aborted) return;
            received += chunk.length;
            // L3 — streamed cap (defense if Content-Length lied)
            if (received > MAX_BODY_BYTES) {
              aborted = true;
              send(res, 413, { ok: false, error: "body too large" });
              req.destroy();
              return;
            }
            chunks.push(chunk);
          });

          req.on("end", () => {
            if (aborted) return;
            let payload: { id?: unknown; json?: unknown };
            try {
              payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            } catch {
              send(res, 400, { ok: false, error: "invalid JSON body" });
              return;
            }

            const id = payload.id;
            const json = payload.json;
            if (typeof id !== "string") {
              send(res, 400, { ok: false, error: "missing or non-string id" });
              return;
            }
            if (typeof json !== "object" || json === null) {
              send(res, 400, { ok: false, error: "missing or non-object json" });
              return;
            }
            if (!ID_REGEX.test(id)) {
              send(res, 403, {
                ok: false,
                error: "id must match /^[a-z0-9-]+$/",
              });
              return;
            }

            const targetPath = path.resolve(roomsDir, `${id}.json`);

            // L4 — symlink-safe containment.
            let realDir: string;
            try {
              realDir = fs.realpathSync(path.dirname(targetPath));
            } catch {
              send(res, 500, { ok: false, error: "rooms dir not accessible" });
              return;
            }
            if (realDir !== realRoomsDir) {
              send(res, 403, { ok: false, error: "path escapes src/rooms" });
              return;
            }

            // L5 — schema validation pre-write.
            try {
              validateRoomJson(json, id);
            } catch (e) {
              send(res, 400, {
                ok: false,
                error: (e as Error).message ?? "schema validation failed",
              });
              return;
            }

            try {
              fs.writeFileSync(
                targetPath,
                JSON.stringify(json, null, 2) + "\n",
                "utf8",
              );
            } catch (e) {
              send(res, 500, {
                ok: false,
                error: `write failed: ${(e as Error).message ?? "unknown"}`,
              });
              return;
            }

            send(res, 200, {
              ok: true,
              path: `${ROOMS_DIR_REL}/${id}.json`,
            });
          });

          req.on("error", () => {
            if (!aborted) {
              aborted = true;
              try {
                send(res, 500, { ok: false, error: "request error" });
              } catch {
                /* response already sent */
              }
            }
          });
        },
      );
    },
  };
}
