// Player view: HUD (progress + timer), the current task (via the shared task
// controller), waiting/lobby states, and the review highlights at the end.
import { ensureAuth } from "../firebase.js";
import { watchGame } from "../stores.js";
import { reconnect, ensurePlayer, setMyWords } from "../game.js";
import { createTaskController } from "../task.js";
import { remainingMs, fmtClock } from "../timer.js";
import { esc } from "../util.js";
import { animateDrawing } from "../canvas.js";

export async function mount(el, params) {
  const gameId = params.get("id");
  const uid = await ensureAuth();
  reconnect(gameId).catch(() => {});
  let game = null;
  let msgSig = null;
  let rejoining = false;

  el.innerHTML = `
    <div class="play">
      <header class="hud">
        <span id="p-progress" class="progress"></span>
        <span id="p-timer" class="clock">–</span>
      </header>
      <main>
        <div id="p-task"></div>
        <div id="p-msg"></div>
      </main>
    </div>`;

  const taskHost = el.querySelector("#p-task");
  const msg = el.querySelector("#p-msg");
  const progressEl = el.querySelector("#p-progress");
  const timerEl = el.querySelector("#p-timer");
  const task = createTaskController({ gameId, uid, container: taskHost });

  function renderMsg(state) {
    if (state === "task") { msg.innerHTML = ""; return; }
    if (state === "none") { msg.innerHTML = `<div class="card">Game not found.</div>`; return; }
    if (state.startsWith("lobby")) {
      const players = game.players || {};
      const names = Object.keys(players).filter((p) => !players[p].isGM || game.meta.gmPlays)
        .map((p) => esc(players[p].name)).join(", ");
      msg.innerHTML = `<div class="card center"><h2>You're in!</h2>
        <p>Waiting for the host to start…</p><p class="muted">Players: ${names || "—"}</p></div>`;
      if (game.settings?.useWordBank && game.settings?.crowdWords) msg.appendChild(mkCrowdEditor());
      return;
    }
    if (state === "waiting") {
      msg.innerHTML = `<div class="card center"><h2>Sit tight ✋</h2>
        <p>You'll get the next word or drawing when the host passes.</p></div>`;
      return;
    }
    // review / finished
    const chains = game.chains || {};
    const ids = Object.keys(game.highlights || {}).filter((c) => chains[c]);
    if (ids.length === 0) {
      msg.innerHTML = `<div class="card center"><h2>That's a wrap! 🎉</h2>
        <p>The host is picking favourites to reveal…</p></div>`;
      return;
    }
    msg.innerHTML = `<h2 class="reveal-title">✨ Highlights ✨</h2>`;
    ids.forEach((cid) => msg.appendChild(renderChainStrip(chains[cid])));
  }

  function mkCrowdEditor() {
    const MAX = 5;
    const mine = (game.wordpool && game.wordpool[uid]) ? game.wordpool[uid].slice() : [];
    const card = document.createElement("div");
    card.className = "card";
    const chips = document.createElement("div");
    chips.className = "word-chips";
    const input = document.createElement("input");
    input.className = "word-input";
    input.maxLength = 40;
    const addBtn = document.createElement("button");
    addBtn.className = "tool";
    addBtn.textContent = "Add";

    const save = () => setMyWords(gameId, mine).catch(() => {});
    const render = () => {
      chips.innerHTML = "";
      mine.forEach((w, i) => {
        const chip = document.createElement("span");
        chip.className = "word-chip";
        chip.textContent = w;
        const x = document.createElement("button");
        x.className = "chip-x"; x.textContent = "✕";
        x.addEventListener("click", () => { mine.splice(i, 1); render(); save(); });
        chip.appendChild(x);
        chips.appendChild(chip);
      });
      const full = mine.length >= MAX;
      input.disabled = addBtn.disabled = full;
      input.placeholder = full ? `Max ${MAX} reached` : "Add a word or phrase…";
    };
    const add = () => {
      const w = input.value.trim();
      if (!w || mine.length >= MAX) return;
      if (!mine.some((x) => x.toLowerCase() === w.toLowerCase())) { mine.push(w); save(); }
      input.value = "";
      render();
    };
    addBtn.addEventListener("click", add);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });

    const h = document.createElement("h2");
    h.textContent = "✍️ Add words to the bank";
    const hint = document.createElement("p");
    hint.className = "muted";
    hint.textContent = `Everyone's words get mixed in as starting words (up to ${MAX} each).`;
    const row = document.createElement("div");
    row.className = "add-row";
    row.append(input, addBtn);
    card.append(h, hint, chips, row);
    render();
    return card;
  }

  function renderChainStrip(chain) {
    const card = document.createElement("div");
    card.className = "card chain-strip";
    const segs = chain.segments || {};
    Object.keys(segs).map(Number).sort((a, b) => a - b).forEach((i) => {
      const s = segs[i];
      if (s.type === "word") {
        const w = document.createElement("div");
        w.className = "chain-word";
        w.textContent = s.word || "—";
        card.appendChild(w);
      } else {
        const c = document.createElement("canvas");
        c.className = "chain-img";
        card.appendChild(c);
        queueMicrotask(() => animateDrawing(c, s.drawing, 1800));
      }
    });
    return card;
  }

  function updateTimer() {
    if (!game || game.meta?.status !== "playing") { timerEl.textContent = ""; return; }
    const ms = remainingMs(game.timer);
    timerEl.textContent = fmtClock(ms);
    timerEl.classList.toggle("low", ms < 10000);
  }

  function updatePeripheral() {
    if (!game?.meta) { progressEl.textContent = ""; return; }
    const s = game.meta.status;
    if (s === "playing") {
      const r = game.round.index;
      progressEl.textContent = r === 0 ? "Starting word" : `Pass ${r} of ${game.meta.totalPasses ?? "?"}`;
    } else progressEl.textContent = s === "lobby" ? "Lobby" : "Review";
  }

  function onUpdate() {
    // Auto-roll back into a recycled lobby if our record was pruned.
    if (game?.meta?.status === "lobby" && game.players && !(uid in game.players) && !rejoining) {
      rejoining = true;
      ensurePlayer(gameId, localStorage.getItem("ldd-name") || "Player").finally(() => { rejoining = false; });
    }

    const { hasTask } = task.sync(game);
    updateTimer();
    updatePeripheral();

    let state;
    if (!game || !game.meta) state = "none";
    else if (game.meta.status === "lobby") {
      state = "lobby:" + Object.keys(game.players || {}).sort().join(",")
        + ":" + (game.settings?.useWordBank ? 1 : 0) + (game.settings?.crowdWords ? 1 : 0);
    } else if (game.meta.status === "review" || game.meta.status === "finished") {
      state = "review:" + Object.keys(game.highlights || {}).sort().join(",");
    } else state = hasTask ? "task" : "waiting";

    if (state !== msgSig) { msgSig = state; renderMsg(state); }
  }

  const unGame = watchGame(gameId, (g) => { game = g; onUpdate(); });
  const tick = setInterval(updateTimer, 250);
  const saver = setInterval(() => task.autosave(), 1500);

  return () => { unGame(); clearInterval(tick); clearInterval(saver); task.destroy(); };
}
