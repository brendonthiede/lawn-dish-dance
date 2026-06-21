// Vector drawing: capture pointer strokes as normalized coordinates, and
// render/animate them back. Drawing shape:
//   { w, h, strokes: [ { color, width, points: [[x,y], ...] } ] }
// where x,y are in 0..1 (fraction of canvas), width is a fraction of canvas
// width, and w/h are the aspect reference at capture time.

function dpr() {
  return Math.min(window.devicePixelRatio || 1, 3);
}

/** Size a canvas's backing store to its CSS box at the current DPR. */
function fitCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const ratio = dpr();
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { w: rect.width, h: rect.height };
}

function strokePath(ctx, stroke, cw, ch) {
  const pts = stroke.points;
  if (!pts || pts.length === 0) return;
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = Math.max(1, stroke.width * cw);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(pts[0][0] * cw, pts[0][1] * ch);
  if (pts.length === 1) {
    // a dot
    ctx.lineTo(pts[0][0] * cw + 0.01, pts[0][1] * ch + 0.01);
  } else {
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * cw, pts[i][1] * ch);
  }
  ctx.stroke();
}

/** Statically render a whole drawing into a canvas element. */
export function renderDrawing(canvas, drawing) {
  const { w, h } = fitCanvas(canvas);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);
  if (!drawing || !drawing.strokes) return;
  for (const s of drawing.strokes) strokePath(ctx, s, w, h);
}

/**
 * Progressively reveal a drawing (for the highlight reveal). Returns a stop fn.
 */
export function animateDrawing(canvas, drawing, durationMs = 2500) {
  const { w, h } = fitCanvas(canvas);
  const ctx = canvas.getContext("2d");
  const strokes = (drawing && drawing.strokes) || [];
  const totalPts = strokes.reduce((n, s) => n + (s.points?.length || 0), 0) || 1;
  let raf = 0;
  let start = null;
  const step = (ts) => {
    if (start == null) start = ts;
    const frac = Math.min(1, (ts - start) / durationMs);
    const reveal = Math.ceil(frac * totalPts);
    ctx.clearRect(0, 0, w, h);
    let seen = 0;
    for (const s of strokes) {
      const n = s.points?.length || 0;
      if (seen >= reveal) break;
      const take = Math.min(n, reveal - seen);
      strokePath(ctx, { ...s, points: s.points.slice(0, take) }, w, h);
      seen += n;
    }
    if (frac < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

/**
 * Make a canvas element an interactive drawing pad.
 * @returns controller: { getDrawing, isEmpty, clear, undo, setColor, setWidth, destroy }
 */
export function createDrawingPad(canvas, { color = "#111827", width = 0.012 } = {}) {
  let dims = fitCanvas(canvas);
  const ctx = canvas.getContext("2d");
  const strokes = [];
  let current = null;
  let curColor = color;
  let curWidth = width;

  function redraw() {
    ctx.clearRect(0, 0, dims.w, dims.h);
    for (const s of strokes) strokePath(ctx, s, dims.w, dims.h);
    if (current) strokePath(ctx, current, dims.w, dims.h);
  }

  function pos(e) {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    return [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))];
  }

  function down(e) {
    e.preventDefault();
    canvas.setPointerCapture?.(e.pointerId);
    current = { color: curColor, width: curWidth, points: [pos(e)] };
    redraw();
  }
  function move(e) {
    if (!current) return;
    e.preventDefault();
    current.points.push(pos(e));
    redraw();
  }
  function up() {
    if (current && current.points.length) strokes.push(current);
    current = null;
  }

  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);

  const onResize = () => {
    dims = fitCanvas(canvas);
    redraw();
  };
  window.addEventListener("resize", onResize);

  return {
    getDrawing() {
      return { w: dims.w, h: dims.h, strokes: JSON.parse(JSON.stringify(strokes)) };
    },
    isEmpty: () => strokes.length === 0,
    clear() {
      strokes.length = 0;
      current = null;
      redraw();
    },
    undo() {
      strokes.pop();
      redraw();
    },
    setColor(c) {
      curColor = c;
    },
    setWidth(w) {
      curWidth = w;
    },
    /** Lock or unlock the pad to prevent further drawing (e.g. after submit). */
    setLocked(locked) {
      if (locked) {
        canvas.removeEventListener("pointerdown", down);
        canvas.removeEventListener("pointermove", move);
        canvas.style.cursor = "default";
        canvas.style.opacity = "0.7";
      } else {
        canvas.addEventListener("pointerdown", down);
        canvas.addEventListener("pointermove", move);
        canvas.style.cursor = "crosshair";
        canvas.style.opacity = "";
      }
    },
    destroy() {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("resize", onResize);
    },
  };
}
