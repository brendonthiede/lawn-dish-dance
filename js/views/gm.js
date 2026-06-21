// Game-master control panel: lobby + settings, live timer controls, the
// Advance ("pass") button, and the end-of-game review with highlight toggles.
import { ensureAuth } from "../firebase.js";
import { watchGame } from "../stores.js";
import {
  reconnect, updateSettings, startGame, advance, pauseTimer, resumeTimer,
  addTime, restartTimer, toggleHighlight, endGame, playAgain,
} from "../game.js";
import { remainingMs, fmtClock } from "../timer.js";
import { effectivePasses, startOffset, joinUrl, esc } from "../util.js";
import { renderDrawing } from "../canvas.js";
import { parseWordList } from "../wordbank.js";
import { createTaskController } from "../task.js";

export async function mount(el, params) {
  const gameId = params.get("id");
  const uid = await ensureAuth();
  reconnect(gameId).catch(() => {});
  let game = null;
  let sig = null;
  let isHost = false;
  let advancing = false; // guard against concurrent auto-advance calls

  el.innerHTML = `<div class="gm"><div id="gm-body"></div></div>`;
  const body = el.querySelector("#gm-body");

  // The host's own play surface (used when "I'm also playing" is on). It's a
  // persistent node moved across re-renders so an in-progress drawing survives.
  const taskHost = document.createElement("div");
  const task = createTaskController({ gameId, uid, container: taskHost });

  const poolCount = () => {
    const p = game.players || {};
    return Object.keys(p).filter((k) => (p[k].isGM ? game.meta.gmPlays : true) && p[k].connected !== false).length;
  };

  // ---- rebuild (only when structure changes) ----
  function rebuild() {
    body.innerHTML = "";
    if (!game || !game.meta) { body.innerHTML = `<div class="card">Game not found.</div>`; return; }
    isHost = uid === game.meta.createdBy;
    const status = game.meta.status;
    if (!isHost) {
      body.innerHTML = `<div class="card"><h2>Host controls</h2>
        <p>This game is controlled by another device.</p>
        <p><a href="#/display?id=${gameId}">Open the shared display →</a></p></div>`;
      return;
    }
    if (status === "lobby") return renderLobby();
    if (status === "playing") return renderPlaying();
    return renderReview();
  }

  function displayLink() {
    return `<a class="link-btn" href="#/display?id=${gameId}" target="_blank" rel="noopener">📺 Open shared display</a>`;
  }

  function renderLobby() {
    const code = game.meta.code;
    body.innerHTML = `
      <div class="card">
        <h1>Lobby</h1>
        <div class="code-big">${esc(code)}</div>
        <p class="muted">Players join at <code>${esc(joinUrl(code))}</code></p>
        ${displayLink()}
      </div>
      <div class="card">
        <h2>Settings</h2>
        <label class="row"><input type="checkbox" id="s-plays" ${game.meta.gmPlays ? "checked" : ""}/> I'm also playing</label>
        <details class="panel">
          <summary>⏱ Timer settings</summary>
          <label>Draw timer (seconds)
            <input type="number" id="s-draw-timer" min="5" max="600" value="${game.settings.drawTimerSec ?? 45}"/>
          </label>
          <label>Word / guess timer (seconds)
            <input type="number" id="s-word-timer" min="5" max="600" value="${game.settings.wordTimerSec ?? 30}"/>
          </label>
        </details>
        <label>Passes <span class="hint">(blank = auto)</span>
          <input type="number" id="s-passes" min="2" max="40" value="${game.settings.passesOverride ?? ""}" placeholder="auto"/></label>
        <label class="row"><input type="checkbox" id="s-bank" ${game.settings.useWordBank ? "checked" : ""}/> Word bank for starting words</label>
        <div id="s-bank-opts" ${game.settings.useWordBank ? "" : "hidden"}>
          <label class="row"><input type="checkbox" id="s-crowd" ${game.settings.crowdWords ? "checked" : ""}/> Let players add words in the lobby</label>
          <p id="crowd-count" class="hint"></p>
          <label>Custom words <span class="hint">(one per line — blank = built-in)</span>
            <textarea id="s-words" rows="4" placeholder="banana phone&#10;the broken jukebox">${esc((game.settings.wordList || []).join("\n"))}</textarea></label>
        </div>
        <p id="pool-line" class="muted"></p>
      </div>
      <div class="card">
        <h2>Players (<span id="pcount">0</span>)</h2>
        <ul class="players" id="lobby-players"></ul>
        <button id="start" class="primary big">Start game</button>
        <p id="gm-err" class="err"></p>
      </div>`;

    const $ = (s) => body.querySelector(s);
    const persist = () => updateSettings(gameId, {
      gmPlays: $("#s-plays").checked,
      drawTimerSec: Math.max(5, Number($("#s-draw-timer").value) || 45),
      wordTimerSec: Math.max(5, Number($("#s-word-timer").value) || 30),
      passesOverride: $("#s-passes").value.trim() === "" ? null : Number($("#s-passes").value),
      useWordBank: $("#s-bank").checked,
      wordList: $("#s-bank").checked ? parseWordList($("#s-words").value) : null,
      crowdWords: $("#s-bank").checked && $("#s-crowd").checked,
    }).catch(() => {});
    $("#s-plays").addEventListener("change", persist);
    $("#s-draw-timer").addEventListener("change", persist);
    $("#s-word-timer").addEventListener("change", persist);
    $("#s-passes").addEventListener("change", persist);
    $("#s-bank").addEventListener("change", () => { $("#s-bank-opts").hidden = !$("#s-bank").checked; persist(); });
    $("#s-crowd").addEventListener("change", persist);
    $("#s-words").addEventListener("change", persist);
    $("#start").addEventListener("click", async () => {
      try { await startGame(gameId); } catch (e) { $("#gm-err").textContent = e.message || String(e); }
    });
  }

  function renderPlaying() {
    const r = game.round.index;
    const total = game.meta.totalPasses;
    const offset = game.meta?.startOffset ?? 0;
    const isDrawPhase = game.round.type === "image";
    const label = r === 0
      ? (isDrawPhase ? "Starting drawing" : "Starting word")
      : (isDrawPhase ? `Pass ${r}: draw it` : `Pass ${r}: write a word`);

    body.innerHTML = `
      <div class="card center">
        <p class="progress">${label} • ${Math.max(0, total - r)} pass(es) left</p>
        <div id="gm-clock" class="clock huge">–</div>
        <div class="timer-controls">
          <button id="t-pause" class="tool">⏸ Pause</button>
          <button id="t-resume" class="tool">▶ Resume</button>
          <button id="t-15" class="tool">+15s</button>
          <button id="t-30" class="tool">+30s</button>
          <button id="t-restart" class="tool">↻ Restart</button>
        </div>
        <p id="subcount" class="muted"></p>
        <button id="adv" class="primary big">Pass to next ▶</button>
      </div>
      <div id="gm-task-slot"></div>
      <div class="card">${displayLink()}<div id="plist"></div></div>`;

    if (game.meta.gmPlays) {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `<h2>✍️ Your turn</h2>`;
      card.appendChild(taskHost);
      body.querySelector("#gm-task-slot").appendChild(card);
    }

    const $ = (s) => body.querySelector(s);
    $("#t-pause").addEventListener("click", () => pauseTimer(gameId));
    $("#t-resume").addEventListener("click", () => resumeTimer(gameId));
    $("#t-15").addEventListener("click", () => addTime(gameId, 15));
    $("#t-30").addEventListener("click", () => addTime(gameId, 30));
    $("#t-restart").addEventListener("click", () => restartTimer(gameId));
    $("#adv").addEventListener("click", async () => {
      $("#adv").disabled = true;
      try { await task.flush(); await advance(gameId); } finally { $("#adv").disabled = false; }
    });
  }

  function renderReview() {
    const chains = game.chains || {};
    const shown = Object.keys(chains).filter((c) => chains[c].status !== "collapsed");
    const cards = shown.map((cid) => reviewCard(cid, chains[cid])).join("");
    body.innerHTML = `
      <div class="card">
        <h1>Review</h1>
        <p class="muted">Tap chains to highlight them on every device + the display.</p>
        ${displayLink()}
        <button id="again" class="primary">🔄 New game (keep these players)</button>
        <button id="end" class="tool">End game</button>
      </div>
      <div class="review-grid">${cards}</div>`;

    body.querySelectorAll(".rev-card").forEach((cardEl) => {
      const cid = cardEl.dataset.cid;
      cardEl.querySelectorAll("canvas").forEach((cv, idx) => {
        const segIdx = Number(cv.dataset.seg);
        renderDrawing(cv, chains[cid].segments?.[segIdx]?.drawing);
      });
      cardEl.addEventListener("click", () => {
        const on = !game.highlights?.[cid];
        toggleHighlight(gameId, cid, on);
      });
    });
    body.querySelector("#end").addEventListener("click", () => endGame(gameId));
    body.querySelector("#again").addEventListener("click", async (e) => {
      e.currentTarget.disabled = true;
      await playAgain(gameId);
    });
  }

  function reviewCard(cid, chain) {
    const segs = chain.segments || {};
    const order = Object.keys(segs).map(Number).sort((a, b) => a - b);
    const imgs = order.filter((i) => segs[i].type === "image");
    const firstImg = imgs[0];
    const lastImg = imgs[imgs.length - 1];
    const words = order.filter((i) => segs[i].type === "word");
    const finalWord = segs[words[words.length - 1]]?.word || "—";
    const highlighted = game.highlights?.[cid] ? " highlighted" : "";
    return `
      <div class="card rev-card${highlighted}" data-cid="${cid}">
        <div class="rev-word seed">${esc(chain.seedWord || "—")}</div>
        ${firstImg != null ? `<canvas class="rev-img" data-seg="${firstImg}"></canvas>` : ""}
        ${lastImg != null && lastImg !== firstImg ? `<canvas class="rev-img" data-seg="${lastImg}"></canvas>` : ""}
        <div class="rev-word final">${esc(finalWord)}</div>
        ${chain.branchOf ? `<span class="tag">branch</span>` : ""}
      </div>`;
  }

  // ---- lightweight per-update refresh (no rebuild) ----
  function refresh() {
    const clock = body.querySelector("#gm-clock");
    if (clock && game?.meta?.status === "playing") {
      const ms = remainingMs(game.timer);
      clock.textContent = fmtClock(ms);
      clock.classList.toggle("low", ms < 10000);

      // Auto-advance when timer expires (GM is authoritative)
      if (isHost && !advancing && ms === 0 && game.round.state === "active") {
        advancing = true;
        task.flush().then(() => advance(gameId)).catch(() => {}).finally(() => { advancing = false; });
      }
    }
    const sub = body.querySelector("#subcount");
    if (sub && game?.meta?.status === "playing") {
      const r = game.round.index;
      const assigned = Object.keys(game.assignments?.[r] || {});
      const submittedMap = game.submitted?.[r] || {};
      const done = assigned.filter((c) => submittedMap[c]).length;
      sub.textContent = `${done} / ${assigned.length} ready`;

      // Auto-advance when all assigned chains are explicitly submitted
      if (isHost && !advancing && assigned.length > 0 && done === assigned.length && game.round.state === "active") {
        advancing = true;
        task.flush().then(() => advance(gameId)).catch(() => {}).finally(() => { advancing = false; });
      }
    }
    const pc = body.querySelector("#pcount");
    if (pc) pc.textContent = String(Object.keys(game.players || {}).length);
    const plist = body.querySelector("#plist");
    if (plist) {
      const p = game.players || {};
      plist.innerHTML = "<h3>Players</h3><ul class='players'>" + Object.keys(p).map((k) =>
        `<li>${p[k].connected === false ? "💤 " : "🟢 "}${esc(p[k].name)}</li>`).join("") + "</ul>";
    }
    // lobby: live player list + pool/passes preview as people join or leave
    const lp = body.querySelector("#lobby-players");
    if (lp) {
      const p = game.players || {};
      lp.innerHTML = Object.keys(p).map((k) =>
        `<li>${p[k].connected === false ? "💤 " : "🟢 "}${esc(p[k].name)}${p[k].isGM ? " <span class='tag'>host</span>" : ""}</li>`).join("");
    }
    const poolLine = body.querySelector("#pool-line");
    if (poolLine) {
      const n = poolCount();
      const passes = effectivePasses(n, game.settings.passesOverride);
      const offset = startOffset(passes);
      const firstAction = offset ? "draw" : "write a word";
      poolLine.innerHTML = `Pool: <b>${n}</b> connected player(s) → each chain passes <b>${passes}</b> times (starts with ${firstAction}, ends on a word).`;
    }
    const crowdCount = body.querySelector("#crowd-count");
    if (crowdCount) {
      const words = Object.values(game.wordpool || {}).flat().filter(Boolean);
      crowdCount.textContent = `Players have added ${words.length} word(s) so far.`;
    }
  }

  function onUpdate() {
    const newSig = [game?.meta?.status, game?.round?.index, game?.round?.state,
      Object.keys(game?.players || {}).sort().join(","),
      Object.keys(game?.highlights || {}).sort().join(","),
      Object.keys(game?.chains || {}).length, uid === game?.meta?.createdBy].join("|");
    if (newSig !== sig) { sig = newSig; rebuild(); }
    refresh();
    if (isHost) task.sync(game);
  }

  const unGame = watchGame(gameId, (g) => { game = g; onUpdate(); });
  const tick = setInterval(refresh, 250);
  const saver = setInterval(() => task.autosave(), 1500);
  return () => { unGame(); clearInterval(tick); clearInterval(saver); task.destroy(); };
}
