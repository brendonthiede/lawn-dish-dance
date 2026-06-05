// Landing screen: join an existing game by code, or host a new one.
import { createGame, joinGame } from "../game.js";
import { hashParam, esc } from "../util.js";
import { parseWordList } from "../wordbank.js";

export async function mount(el, params) {
  const prefill = (params.get("g") || hashParam("g") || "").toUpperCase();
  const savedName = localStorage.getItem("ldd-name") || "";

  el.innerHTML = `
    <div class="card">
      <h1 class="title">Lawn&nbsp;Dish&nbsp;Dance</h1>
      <p class="subtitle">Write a word, draw the word, pass it on.</p>

      <section class="panel">
        <h2>Join a game</h2>
        <label>Your name
          <input id="j-name" maxlength="24" value="${esc(savedName)}" placeholder="e.g. Sam" />
        </label>
        <label>Game code
          <input id="j-code" maxlength="6" value="${esc(prefill)}" placeholder="ABCD"
                 style="text-transform:uppercase" />
        </label>
        <button id="j-go" class="primary">Join</button>
        <p id="j-err" class="err"></p>
      </section>

      <details class="panel">
        <summary><h2 style="display:inline">Host a game</h2></summary>
        <label>Your name
          <input id="h-name" maxlength="24" value="${esc(savedName)}" placeholder="Host" />
        </label>
        <label class="row">
          <input type="checkbox" id="h-plays" /> I'll also play (join the pool)
        </label>
        <label>Seconds per turn
          <input type="number" id="h-timer" value="60" min="10" max="600" />
        </label>
        <label>Passes <span class="hint">(blank = players − 1, auto-even)</span>
          <input type="number" id="h-passes" placeholder="auto" min="2" max="40" />
        </label>
        <label class="row">
          <input type="checkbox" id="h-bank" /> Use a word bank for starting words
        </label>
        <div id="h-bank-opts" hidden>
          <label class="row"><input type="checkbox" id="h-crowd" /> Let players add words in the lobby</label>
          <label>Custom words <span class="hint">(optional, one per line — blank = built-in list)</span>
            <textarea id="h-words" rows="4" placeholder="banana phone&#10;the broken jukebox&#10;Dave's haircut"></textarea>
          </label>
        </div>
        <button id="h-go" class="primary">Create game</button>
        <p id="h-err" class="err"></p>
      </details>
    </div>`;

  const $ = (id) => el.querySelector(id);

  $("#j-go").addEventListener("click", async () => {
    const name = $("#j-name").value.trim();
    const code = $("#j-code").value.trim().toUpperCase();
    $("#j-err").textContent = "";
    if (!name) return ($("#j-err").textContent = "Enter your name.");
    if (!code) return ($("#j-err").textContent = "Enter the game code.");
    try {
      localStorage.setItem("ldd-name", name);
      const { gameId } = await joinGame(code, name);
      location.hash = `#/play?id=${gameId}`;
    } catch (e) {
      $("#j-err").textContent = e.message || String(e);
    }
  });

  $("#h-bank").addEventListener("change", () => {
    $("#h-bank-opts").hidden = !$("#h-bank").checked;
  });

  $("#h-go").addEventListener("click", async () => {
    const name = $("#h-name").value.trim() || "Host";
    const gmPlays = $("#h-plays").checked;
    const timerDurationSec = Math.max(10, Number($("#h-timer").value) || 60);
    const passesRaw = $("#h-passes").value.trim();
    const passesOverride = passesRaw === "" ? null : Number(passesRaw);
    const useWordBank = $("#h-bank").checked;
    const wordList = useWordBank ? parseWordList($("#h-words").value) : null;
    const crowdWords = useWordBank && $("#h-crowd").checked;
    $("#h-err").textContent = "";
    try {
      localStorage.setItem("ldd-name", name);
      const { gameId } = await createGame({ gmName: name, gmPlays, timerDurationSec, passesOverride, useWordBank, wordList, crowdWords });
      location.hash = `#/gm?id=${gameId}`;
    } catch (e) {
      $("#h-err").textContent = e.message || String(e);
    }
  });

  return null;
}
