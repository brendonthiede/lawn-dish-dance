// Default word bank for starting words — fun, drawable, party-friendly.
// The host can override this with a custom list in settings.
export const DEFAULT_WORDS = [
  "banana phone", "pirate ship", "traffic jam", "robot dog", "haunted house",
  "ice cream truck", "snail race", "flying saucer", "ninja cat", "disco ball",
  "campfire", "roller coaster", "bubble bath", "lawn flamingo", "taco stand",
  "thunderstorm", "treasure map", "vampire", "mermaid", "sandcastle",
  "hot air balloon", "spaghetti monster", "broken umbrella", "dancing skeleton",
  "grumpy wizard", "lightning bug", "rubber duck", "wrecking ball", "lava lamp",
  "sock puppet", "tornado", "jellyfish", "unicorn", "lighthouse",
  "carousel", "scarecrow", "yeti", "kraken", "garden gnome",
  "paper airplane", "melting clock", "spilled coffee", "runaway shopping cart",
  "dragon", "werewolf", "ghost", "mummy", "alien abduction",
  "sumo wrestler", "cowboy", "astronaut", "deep sea diver", "knight in armor",
  "magician", "clown car", "marching band", "tightrope walker", "fortune teller",
  "volcano", "quicksand", "avalanche", "geyser", "whirlpool",
  "trampoline", "pogo stick", "skateboard ramp", "ferris wheel", "bumper cars",
  "popcorn machine", "vending machine", "claw machine", "jukebox", "pinball",
  "barbecue grill", "birthday cake", "wedding cake", "ice sculpture", "gingerbread house",
  "kazoo", "bagpipes", "trombone", "drum solo", "air guitar",
  "loch ness monster", "bigfoot", "leprechaun", "tooth fairy", "easter bunny",
  "snowman", "jack-o-lantern", "turkey dinner", "cornucopia", "piñata",
  "lemonade stand", "garage sale", "food fight", "pillow fight", "water balloon",
  "messy desk", "tangled headphones", "burnt toast", "leaky faucet", "flat tire",
  "parallel parking", "rush hour", "long line", "spilled milk", "stubbed toe",
  "cat on a keyboard", "dog chasing tail", "squirrel with acorn", "duck pond",
  "flock of sheep", "herd of cows", "swarm of bees", "ant farm", "spider web",
  "shooting star", "solar eclipse", "rainbow", "double rainbow", "aurora borealis",
  "message in a bottle", "ship in a bottle", "genie in a lamp", "crystal ball",
  "magic carpet", "wizard hat", "potion bottle", "spell book", "cauldron",
  "secret handshake", "group hug", "high five", "fist bump", "victory dance",
];

/** Pick up to n distinct random words from a list. */
export function pickWords(list, n, rand = Math.random) {
  const pool = list.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(n, pool.length));
}

/** Parse a textarea (one word/phrase per line) into a clean list. */
export function parseWordList(text) {
  return (text || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 500);
}
