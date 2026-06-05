// Hash router. Routes:
//   #/                      landing (join by code / host a game)
//   #/join?g=CODE           join form (code prefilled from QR deep link)
//   #/play?id=GAMEID        player view
//   #/gm?id=GAMEID          game-master control panel
//   #/display?id=GAMEID     shared display (TV)
import { isConfigured } from "./firebase.js";
import * as join from "./views/join.js";
import * as play from "./views/play.js";
import * as gm from "./views/gm.js";
import * as display from "./views/display.js";

const routes = { "": join, "/": join, "/join": join, "/play": play, "/gm": gm, "/display": display };

const appEl = document.getElementById("app");
let cleanup = null;

function parse() {
  const raw = location.hash.replace(/^#/, "");
  const [path, query] = raw.split("?");
  return { path: path || "/", params: new URLSearchParams(query || "") };
}

async function render() {
  if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
  appEl.innerHTML = "";

  if (!isConfigured) {
    appEl.innerHTML = `
      <div class="card setup">
        <h1>Setup needed</h1>
        <p>Edit <code>js/firebase-config.js</code> with your Firebase project's
        web config, then reload. See <code>js/firebase-config.example.js</code>
        for step-by-step instructions (free Spark plan is enough).</p>
      </div>`;
    return;
  }

  const { path, params } = parse();
  const view = routes[path] || join;
  try {
    cleanup = await view.mount(appEl, params);
  } catch (err) {
    appEl.innerHTML = `<div class="card"><h1>Something went wrong</h1><p>${(err && err.message) || err}</p>
      <p><a href="#/">Back to start</a></p></div>`;
  }
}

window.addEventListener("hashchange", render);
render();
