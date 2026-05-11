// Two-pass screen-space post-process applied IN PLACE on the main canvas:
// take a snapshot of what was just drawn, then layer
//   1) a bloom overlay — Gaussian-blurred copy of the scene composited with
//      "lighter" so anything brighter-than-black gains a soft halo; reads
//      as "the neon glow burns the pixels" without needing a real HDR
//      threshold pass (which Canvas 2D can't do without shaders),
//   2) a chromatic aberration fringe — two channel-isolated copies of the
//      scene shifted ±caOffsetPx so edges between contrasting colors split
//      into thin red / cyan ghosts, the classic "old CRT lens" tell.
//
// Both passes use ctx.filter (GPU-accelerated where supported). The
// channel-isolation matrices live in an SVG filter element injected once
// into <head> on first composite call; Canvas 2D's filter property
// references them by url(#id), so the matrix runs entirely on the GPU
// path with no per-frame allocation. The whole pass is one
// drawImage(self) → scratch + ~3 drawImage(scratch) → self with filters,
// so the cost is roughly four full-screen copies per frame.
//
// `apply()` is the only entry point a render loop touches — call it
// AFTER all world drawing is done and BEFORE the HUD. Keep the HUD
// sharp by drawing it after the post-process completes. Scratch buffer
// is resized lazily to match the target canvas's internal pixel size
// so DPR-scaled rendering composites cleanly.

const SVG_FILTER_ID = "vectrix-post-filters";
const CA_RED_FILTER = "vectrix-ca-red";
const CA_BLUE_FILTER = "vectrix-ca-blue";

export interface PostOptions {
  bloomBlurPx: number;
  bloomStrength: number;
  caOffsetPx: number;
  caStrength: number;
}

// Post-processing currently disabled — bloom + CA each cost a fullscreen
// drawImage with a GPU filter, and on a 2-megapixel canvas this was
// eating 5–10 ms / frame on integrated GPUs once the rest of the scene
// (enemies, bullets, walls with shadowBlur) was already heavy. We kept
// the module wired so re-enabling is a one-line strength bump without
// touching render order.
export const DEFAULT_POST: PostOptions = {
  bloomBlurPx: 0,
  bloomStrength: 0,
  caOffsetPx: 0,
  caStrength: 0,
};

export class PostProcessor {
  private scratch: HTMLCanvasElement;
  private scratchCtx: CanvasRenderingContext2D;

  constructor() {
    this.scratch = document.createElement("canvas");
    const c = this.scratch.getContext("2d");
    if (!c) throw new Error("Failed to acquire scratch 2D context");
    this.scratchCtx = c;
    ensureSvgFilters();
  }

  apply(target: CanvasRenderingContext2D, opts: PostOptions = DEFAULT_POST): void {
    // Early-out if both effects are off — saves one fullscreen
    // drawImage to the scratch buffer per frame.
    if (
      (opts.bloomStrength <= 0 || opts.bloomBlurPx <= 0) &&
      (opts.caStrength <= 0 || opts.caOffsetPx <= 0)
    ) {
      return;
    }
    const canvas = target.canvas;
    const w = canvas.width;
    const h = canvas.height;
    if (w === 0 || h === 0) return;

    if (this.scratch.width !== w || this.scratch.height !== h) {
      this.scratch.width = w;
      this.scratch.height = h;
    }
    this.scratchCtx.clearRect(0, 0, w, h);
    this.scratchCtx.drawImage(canvas, 0, 0);

    target.save();
    target.setTransform(1, 0, 0, 1, 0, 0);

    // Bloom — additive blur copy
    if (opts.bloomStrength > 0 && opts.bloomBlurPx > 0) {
      target.globalCompositeOperation = "lighter";
      target.globalAlpha = opts.bloomStrength;
      target.filter = `blur(${opts.bloomBlurPx}px)`;
      target.drawImage(this.scratch, 0, 0);
    }

    // Chromatic aberration — red ghost shifted +x, blue ghost shifted -x
    if (opts.caStrength > 0 && opts.caOffsetPx > 0) {
      target.globalCompositeOperation = "lighter";
      target.globalAlpha = opts.caStrength;
      target.filter = `url(#${CA_RED_FILTER})`;
      target.drawImage(this.scratch, opts.caOffsetPx, 0);
      target.filter = `url(#${CA_BLUE_FILTER})`;
      target.drawImage(this.scratch, -opts.caOffsetPx, 0);
    }

    target.restore();
  }
}

let filtersInjected = false;
function ensureSvgFilters(): void {
  if (filtersInjected || typeof document === "undefined") return;
  if (document.getElementById(SVG_FILTER_ID)) {
    filtersInjected = true;
    return;
  }
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.id = SVG_FILTER_ID;
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.position = "absolute";
  svg.style.width = "0";
  svg.style.height = "0";
  svg.style.overflow = "hidden";
  svg.style.pointerEvents = "none";

  const defs = document.createElementNS(ns, "defs");

  // Red channel only — kills green + blue so the shifted ghost paints
  // only the red component over the base scene.
  const redFilter = document.createElementNS(ns, "filter");
  redFilter.id = CA_RED_FILTER;
  redFilter.setAttribute("x", "-10%");
  redFilter.setAttribute("y", "-10%");
  redFilter.setAttribute("width", "120%");
  redFilter.setAttribute("height", "120%");
  const redMatrix = document.createElementNS(ns, "feColorMatrix");
  redMatrix.setAttribute("type", "matrix");
  redMatrix.setAttribute(
    "values",
    "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0",
  );
  redFilter.appendChild(redMatrix);

  // Blue+green (cyan) channel — kills red so the opposite shift paints
  // a cyan ghost on the other side of edges.
  const blueFilter = document.createElementNS(ns, "filter");
  blueFilter.id = CA_BLUE_FILTER;
  blueFilter.setAttribute("x", "-10%");
  blueFilter.setAttribute("y", "-10%");
  blueFilter.setAttribute("width", "120%");
  blueFilter.setAttribute("height", "120%");
  const blueMatrix = document.createElementNS(ns, "feColorMatrix");
  blueMatrix.setAttribute("type", "matrix");
  blueMatrix.setAttribute(
    "values",
    "0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0",
  );
  blueFilter.appendChild(blueMatrix);

  defs.appendChild(redFilter);
  defs.appendChild(blueFilter);
  svg.appendChild(defs);
  document.body.appendChild(svg);
  filtersInjected = true;
}
