// Shared "current task" UI: renders the chains a player is assigned this round
// (word input, word-bank choices, or drawing pad), saves drafts live, and
// preserves in-progress canvases across host re-renders. Used by both the
// player view and the GM panel (when the host is also playing).
import { saveDraft } from "./game.js";
import { segmentType, esc } from "./util.js";
import { createDrawingPad, renderDrawing } from "./canvas.js";
import { DEFAULT_WORDS, pickWords } from "./wordbank.js";

const PALETTE = ["#111827", "#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#a16207"];

/**
 * @param {{gameId:string, uid:string, container:HTMLElement}} opts
 * @returns {{ sync:(game)=>{hasTask:boolean}, autosave:()=>void, destroy:()=>void }}
 */
export function createTaskController({ gameId, uid, container }) {
  const pads = {};
  const wordEls = {};
  const selectedWord = {};
  const lastSaved = {};
  let sig = null;
  let game = null;

  function myChains() {
    const r = game?.round?.index ?? -1;
    const a = game?.assignments?.[r] || {};
    return Object.keys(a).filter((c) => a[c] === uid).sort();
  }

  function teardownPads() {
    Object.values(pads).forEach((p) => p.destroy());
    for (const k in pads) delete pads[k];
    for (const k in wordEls) delete wordEls[k];
    for (const k in selectedWord) delete selectedWord[k];
  }

  function clear() {
    teardownPads();
    container.innerHTML = "";
  }

  function rebuild() {
    teardownPads();
    container.innerHTML = "";
    const r = game.round.index;
    myChains().forEach((cid) => renderTask(cid, r));
  }

  function renderTask(cid, r) {
    const chain = game.chains?.[cid] || {};
    const type = segmentType(r);
    const prev = chain.segments?.[r - 1];

    const wrap = document.createElement("div");
    wrap.className = "card task";

    if (r === 0 && game.settings?.useWordBank) {
      wrap.innerHTML = `<h2>Your starting word</h2><p class="muted">Pick one for someone to draw.</p>`;
      wrap.appendChild(mkWordChoices(cid));
    } else if (r === 0) {
      wrap.innerHTML = `<h2>Your starting word</h2><p class="muted">Pick a word or short phrase for someone to draw.</p>`;
      wrap.appendChild(mkWordInput(cid));
    } else if (type === "word") {
      wrap.innerHTML = `<h2>What is this?</h2>`;
      const c = document.createElement("canvas");
      c.className = "preview-img";
      wrap.appendChild(c);
      wrap.appendChild(mkWordInput(cid));
      queueMicrotask(() => renderDrawing(c, prev?.drawing));
    } else {
      wrap.innerHTML = `<h2>Draw this</h2><p class="prompt-word">${esc(prev?.word || "…")}</p>`;
      const c = document.createElement("canvas");
      c.className = "pad";
      wrap.appendChild(c);
      wrap.appendChild(mkTools(cid));
      queueMicrotask(() => { pads[cid] = createDrawingPad(c); });
    }
    container.appendChild(wrap);
  }

  function mkWordInput(cid) {
    const inp = document.createElement("input");
    inp.className = "word-input";
    inp.maxLength = 80;
    inp.placeholder = "Type here…";
    inp.addEventListener("input", () => saveNow(cid));
    wordEls[cid] = inp;
    return inp;
  }

  function mkWordChoices(cid) {
    const crowd = game.settings?.crowdWords
      ? Object.values(game.wordpool || {}).flat() : [];
    const custom = game.settings?.wordList || [];
    let list = [...new Set([...crowd, ...custom].map((w) => String(w).trim()).filter(Boolean))];
    if (!list.length) list = DEFAULT_WORDS;
    selectedWord[cid] = "";
    let offered = pickWords(list, 3);

    const box = document.createElement("div");
    box.className = "word-bank";
    const choices = document.createElement("div");
    choices.className = "word-choices";
    const chosen = document.createElement("p");
    chosen.className = "chosen-word";

    const draw = () => {
      choices.innerHTML = "";
      offered.forEach((w) => {
        const b = document.createElement("button");
        b.className = "word-choice" + (selectedWord[cid] === w ? " selected" : "");
        b.textContent = w;
        b.addEventListener("click", () => { selectedWord[cid] = w; saveNow(cid); draw(); });
        choices.appendChild(b);
      });
      chosen.textContent = selectedWord[cid] ? `✓ chosen: ${selectedWord[cid]}` : "Tap a word to choose.";
    };
    const shuffle = document.createElement("button");
    shuffle.className = "tool shuffle";
    shuffle.textContent = "🎲 Shuffle these";
    shuffle.addEventListener("click", () => { offered = pickWords(list, 3); draw(); });

    draw();
    box.append(choices, shuffle, chosen);
    return box;
  }

  function mkTools(cid) {
    const bar = document.createElement("div");
    bar.className = "tools";
    PALETTE.forEach((color, i) => {
      const b = document.createElement("button");
      b.className = "swatch" + (i === 0 ? " active" : "");
      b.style.background = color;
      b.addEventListener("click", () => {
        pads[cid]?.setColor(color);
        bar.querySelectorAll(".swatch").forEach((s) => s.classList.remove("active"));
        b.classList.add("active");
      });
      bar.appendChild(b);
    });
    const widths = [{ l: "•", w: 0.008 }, { l: "●", w: 0.02 }, { l: "⬤", w: 0.05 }];
    widths.forEach(({ l, w }) => {
      const b = document.createElement("button");
      b.className = "tool";
      b.textContent = l;
      b.addEventListener("click", () => pads[cid]?.setWidth(w));
      bar.appendChild(b);
    });
    const undo = document.createElement("button");
    undo.className = "tool"; undo.textContent = "↩︎ Undo";
    undo.addEventListener("click", () => pads[cid]?.undo());
    const clr = document.createElement("button");
    clr.className = "tool"; clr.textContent = "✕ Clear";
    clr.addEventListener("click", () => pads[cid]?.clear());
    bar.append(undo, clr);
    return bar;
  }

  function currentPayload(cid) {
    if (pads[cid]) return { drawing: pads[cid].getDrawing() };
    if (wordEls[cid]) return { word: wordEls[cid].value.trim() };
    if (cid in selectedWord) return { word: selectedWord[cid] };
    return null;
  }

  function saveNow(cid) {
    if (!game || game.meta?.status !== "playing") return;
    const r = game.round.index;
    const payload = currentPayload(cid);
    if (!payload) return;
    const json = JSON.stringify(payload);
    if (lastSaved[cid] === json) return;
    lastSaved[cid] = json;
    saveDraft(gameId, r, cid, payload).catch(() => {});
  }

  // ---- public API ----
  function sync(g) {
    game = g;
    if (g?.meta?.status !== "playing") {
      if (sig !== null) { clear(); sig = null; }
      return { hasTask: false };
    }
    const chains = myChains();
    if (chains.length === 0) {
      if (sig !== "none") { clear(); sig = "none"; }
      return { hasTask: false };
    }
    const newSig = `t|${g.round.index}|${chains.join(",")}`;
    if (newSig !== sig) { sig = newSig; rebuild(); }
    return { hasTask: true };
  }

  function autosave() {
    if (game?.meta?.status !== "playing") return;
    myChains().forEach(saveNow);
  }

  // Persist all current work and wait for it (call before advancing).
  function flush() {
    if (game?.meta?.status !== "playing") return Promise.resolve();
    const r = game.round.index;
    return Promise.all(myChains().map((cid) => {
      const p = currentPayload(cid);
      if (!p) return null;
      lastSaved[cid] = JSON.stringify(p);
      return saveDraft(gameId, r, cid, p);
    }));
  }

  return { sync, autosave, flush, destroy: teardownPads };
}
