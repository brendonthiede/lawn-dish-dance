// Shared display (bar-room TV). Always shows a join QR + code. During play:
// big pass counter + countdown. During review: animated reveal of the chains
// the GM has highlighted.
import { ensureAuth } from "../firebase.js";
import { watchGame } from "../stores.js";
import { remainingMs, fmtClock } from "../timer.js";
import { joinUrl, esc } from "../util.js";
import { drawQR } from "../qr.js";
import { animateDrawing } from "../canvas.js";

export async function mount(el, params) {
  const gameId = params.get("id");
  await ensureAuth(); // anonymous sign-in; reads require auth
  let game = null;
  let sig = null;
  let qrCode = null;

  el.innerHTML = `<div class="display"><div id="d-body"></div></div>`;
  const body = el.querySelector("#d-body");

  function joinCorner() {
    const code = game.meta.code;
    return `<div class="join-corner">
      <canvas id="d-qr" width="200" height="200"></canvas>
      <div class="join-code">${esc(code)}</div>
      <div class="join-hint">scan or enter to join</div>
    </div>`;
  }

  function paintQR() {
    const code = game?.meta?.code;
    const cv = body.querySelector("#d-qr");
    if (cv && code && code !== qrCode) { qrCode = code; drawQR(cv, joinUrl(code), cv.width).catch(() => {}); }
    else if (cv && code) drawQR(cv, joinUrl(code), cv.width).catch(() => {});
  }

  function rebuild() {
    qrCode = null;
    body.innerHTML = "";
    if (!game || !game.meta) { body.innerHTML = `<div class="big-msg">Waiting for game…</div>`; return; }
    const status = game.meta.status;
    if (status === "lobby") renderLobby();
    else if (status === "playing") renderPlaying();
    else renderReview();
    paintQR();
  }

  function renderLobby() {
    const n = Object.keys(game.players || {}).length;
    body.innerHTML = `
      <div class="d-lobby">
        <h1 class="d-title">Lawn Dish Dance</h1>
        <p class="d-sub">Join on your phone — ${n} in so far</p>
        ${joinCorner()}
        <div class="d-cta">Waiting for the host to start…</div>
      </div>`;
  }

  function renderPlaying() {
    const r = game.round.index;
    const total = game.meta.totalPasses ?? 0;
    body.innerHTML = `
      ${joinCorner()}
      <div class="d-play">
        <div class="d-pass">${r === 0 ? "Starting word" : `Pass ${r} of ${total}`}</div>
        <div id="d-clock" class="d-clock">–</div>
        <div class="d-remain">${Math.max(0, total - r)} pass(es) remaining</div>
      </div>`;
  }

  function renderReview() {
    const chains = game.chains || {};
    const ids = Object.keys(game.highlights || {}).filter((c) => chains[c]);
    if (ids.length === 0) {
      body.innerHTML = `${joinCorner()}<div class="big-msg">🎉 Game over! 🎉<br/><span class="d-sub">Host is choosing highlights…</span></div>`;
      return;
    }
    body.innerHTML = `<h1 class="d-title">✨ Highlights ✨</h1><div id="d-reveal" class="d-reveal"></div>`;
    const wrap = body.querySelector("#d-reveal");
    ids.forEach((cid) => {
      const chain = chains[cid];
      const segs = chain.segments || {};
      const order = Object.keys(segs).map(Number).sort((a, b) => a - b);
      const strip = document.createElement("div");
      strip.className = "d-strip";
      order.forEach((i) => {
        const s = segs[i];
        if (s.type === "word") {
          const w = document.createElement("div");
          w.className = "d-strip-word";
          w.textContent = s.word || "—";
          strip.appendChild(w);
        } else {
          const c = document.createElement("canvas");
          c.className = "d-strip-img";
          strip.appendChild(c);
          queueMicrotask(() => animateDrawing(c, s.drawing, 2200));
        }
      });
      wrap.appendChild(strip);
    });
  }

  function refresh() {
    const clock = body.querySelector("#d-clock");
    if (clock && game?.meta?.status === "playing") {
      const ms = remainingMs(game.timer);
      clock.textContent = fmtClock(ms);
      clock.classList.toggle("low", ms < 10000);
    }
  }

  function onUpdate() {
    const newSig = [game?.meta?.status, game?.round?.index, game?.meta?.code,
      Object.keys(game?.highlights || {}).sort().join(","),
      Object.keys(game?.players || {}).length].join("|");
    if (newSig !== sig) { sig = newSig; rebuild(); }
    refresh();
  }

  const unGame = watchGame(gameId, (g) => { game = g; onUpdate(); });
  const tick = setInterval(refresh, 250);
  return () => { unGame(); clearInterval(tick); };
}
