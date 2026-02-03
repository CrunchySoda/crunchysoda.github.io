const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");

const tournamentSelect = document.getElementById("tournamentFilter");
const playerInput = document.getElementById("playerFilter");
const pokemonInput = document.getElementById("pokemonFilter");
const clearBtn = document.getElementById("clearBtn");

let allData = [];

function norm(s) {
  return (s ?? "").toString().trim().toLowerCase();
}

function cleanMon(mon) {
  // "Froslass, F" -> "Froslass"
  // "Oricorio-Pa'u, M" -> "Oricorio-Pa'u"
  return (mon ?? "").toString().split(",")[0].trim();
}

function populateTournamentDropdown(data) {
  while (tournamentSelect.options.length > 1) tournamentSelect.remove(1);

  const groups = [...new Set(data.map(d => d.tournament).filter(Boolean))].sort();

  for (const g of groups) {
    const opt = document.createElement("option");
    opt.value = g;
    opt.textContent = g;
    tournamentSelect.appendChild(opt);
  }

  if (groups.length === 0) {
    const opt = document.createElement("option");
    opt.value = "__none__";
    opt.textContent = "No tournament data (check test.json)";
    tournamentSelect.appendChild(opt);
    tournamentSelect.value = "__all__";
  }
}

/**
 * Convert a displayed mon name into a Pokemon Showdown sprite key.
 * Goal: match play.pokemonshowdown.com sprite filenames.
 */
function monToShowdownKey(mon) {
  let key = (mon ?? "").toString().trim().toLowerCase();

  // normalize unicode apostrophe -> ascii
  key = key.replace(/’/g, "'");

  // remove special characters except letters/numbers/space/hyphen/apostrophe
  // (we'll remove apostrophes next, PS filenames don't include them)
  key = key.replace(/[^a-z0-9 \-']/g, "");

  // remove apostrophes (e.g., "pa'u" -> "pau")
  key = key.replace(/'/g, "");

  // collapse spaces to hyphen
  key = key.replace(/\s+/g, "-");

  // collapse multiple hyphens
  key = key.replace(/\-+/g, "-");

  // common form normalizations
  // basculin stripes
  key = key
    .replace("basculin-blue-striped", "basculin-bluestriped")
    .replace("basculin-white-striped", "basculin-whitestriped");

  // oricorio variants (after apostrophe removal, pa'u becomes pau)
  key = key
    .replace("oricorio-pau", "oricorio-pau") // fine, but keep here for clarity
    .replace("oricorio-pompom", "oricorio-pompom")
    .replace("oricorio-sensu", "oricorio-sensu")
    .replace("oricorio-baile", "oricorio-baile");
    // Paradox mons are often concatenated in PS sprite filenames
  key = key
    .replace("brute-bonnet", "brutebonnet")
    .replace("scream-tail", "screamtail")
    .replace("flutter-mane", "fluttermane")
    .replace("slither-wing", "slitherwing")
    .replace("sandy-shocks", "sandyshocks")
    .replace("roaring-moon", "roaringmoon")
    .replace("iron-treads", "irontreads")
    .replace("iron-bundle", "ironbundle")
    .replace("iron-hands", "ironhands")
    .replace("iron-jugulis", "ironjugulis")
    .replace("iron-moth", "ironmoth")
    .replace("iron-thorns", "ironthorns")
    .replace("iron-valiant", "ironvaliant");

  return key;
}

/**
 * Some logs will have player names as "p1" / "p2" or blank.
 * We keep it readable but do not invent names.
 */
function displayPlayerName(pid, info) {
  const n = (info?.name ?? "").toString().trim();
  if (n && n !== "p1" && n !== "p2") return n;
  // fallback to pid ("p1"/"p2") if name is missing or generic
  return pid;
}

function matchItem(item) {
  const tournamentValue = tournamentSelect.value;
  const p = norm(playerInput.value);
  const m = norm(pokemonInput.value);

  if (tournamentValue !== "__all__" && tournamentValue !== "__none__") {
    if ((item.tournament || "") !== tournamentValue) return false;
  }

  const teams = item.teams || {};
  const players = Object.values(teams).map(x => x?.name || "");
  const mons = Object.values(teams).flatMap(x => (x?.team || []).map(cleanMon));

  if (p) {
    // match either actual player names OR pid as a backup
    const ok =
      players.some(name => norm(name).includes(p)) ||
      Object.keys(teams).some(pid => norm(pid).includes(p));
    if (!ok) return false;
  }

  if (m) {
    const ok = mons.some(mon => norm(mon).includes(m));
    if (!ok) return false;
  }

  return true;
}

/**
 * Create a sprite element:
 * <div class="monSprite"><img ... /></div>
 * so CSS can scale without distortion.
 */
function makeSprite(monName) {
  const key = monToShowdownKey(monName);

  const sprite = document.createElement("div");
  sprite.className = "monSprite";

  const img = document.createElement("img");
  img.alt = monName;
  img.title = monName;

  // Try multiple sources in order (most "alive" to most "reliable")
  // ani: modern animated gifs but not always available
  // gen5ani: lots of animated coverage
  // xyani: older animated
  // dex: static PNG fallback
  const candidates = [
    `https://play.pokemonshowdown.com/sprites/ani/${key}.gif`,
    `https://play.pokemonshowdown.com/sprites/gen5ani/${key}.gif`,
    `https://play.pokemonshowdown.com/sprites/xyani/${key}.gif`,
    `https://play.pokemonshowdown.com/sprites/dex/${key}.png`,
  ];

  let i = 0;
  img.src = candidates[i];

  img.onerror = () => {
    i += 1;
    if (i >= candidates.length) {
      img.onerror = null;
      return;
    }
    img.src = candidates[i];
  };

  sprite.appendChild(img);
  return sprite;
}

function render(data) {
  resultsEl.innerHTML = "";

  if (!data.length) {
    statusEl.textContent = "No matches found.";
    return;
  }

  statusEl.textContent = `Showing ${data.length} replays`;

  const playerQuery = norm(playerInput.value);

  for (const item of data) {
    const card = document.createElement("div");
    card.className = "card";

    const top = document.createElement("div");
    top.className = "cardTop";

    const left = document.createElement("div");
    const a = document.createElement("a");
    a.href = item.link;
    a.target = "_blank";
    a.rel = "noreferrer";
    a.textContent = item.link;
    left.appendChild(a);

    const right = document.createElement("div");
    const t = document.createElement("small");
    t.textContent = `Tournament: ${item.tournament || "Unknown"}`;
    right.appendChild(t);

    top.appendChild(left);
    top.appendChild(right);
    card.appendChild(top);

    if (item.thread_url) {
      const threadLine = document.createElement("div");
      threadLine.style.marginTop = "6px";

      const threadA = document.createElement("a");
      threadA.href = item.thread_url;
      threadA.target = "_blank";
      threadA.rel = "noreferrer";
      threadA.textContent = "Source thread";

      threadLine.appendChild(threadA);
      card.appendChild(threadLine);
    }

    const teamsWrap = document.createElement("div");
    teamsWrap.className = "teams";

    const teams = item.teams || {};

    // Start with both teams
    let entries = Object.entries(teams);

    // If player search is active, only show matching player's team(s)
    if (playerQuery) {
      entries = entries.filter(([pid, info]) => {
        const n = norm(info?.name);
        return n.includes(playerQuery) || norm(pid).includes(playerQuery);
      });
    }

    // Fallback: if no match, show both teams
    if (entries.length === 0) entries = Object.entries(teams);

    for (const [pid, info] of entries) {
      const teamDiv = document.createElement("div");
      teamDiv.className = "team";

      const name = document.createElement("div");
      name.className = "teamName";
      name.textContent = displayPlayerName(pid, info);

      const monsDiv = document.createElement("div");
      monsDiv.className = "mons";

      for (const monRaw of (info?.team || [])) {
        const mon = cleanMon(monRaw);
        monsDiv.appendChild(makeSprite(mon));
      }

      teamDiv.appendChild(name);
      teamDiv.appendChild(monsDiv);
      teamsWrap.appendChild(teamDiv);
    }

    card.appendChild(teamsWrap);
    resultsEl.appendChild(card);
  }
}

function applyFilters() {
  const filtered = allData.filter(matchItem);
  render(filtered);
}

async function main() {
  try {
    statusEl.textContent = "Loading…";

    // cache-buster so GitHub Pages never serves stale JSON
    const url = `test.json?cb=${Date.now()}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load test.json (${res.status})`);

    allData = await res.json();

    populateTournamentDropdown(allData);
    applyFilters();
  } catch (e) {
    statusEl.textContent = `Error: ${e.message}`;
  }
}

tournamentSelect.addEventListener("change", applyFilters);
playerInput.addEventListener("input", applyFilters);
pokemonInput.addEventListener("input", applyFilters);

clearBtn.addEventListener("click", () => {
  tournamentSelect.value = "__all__";
  playerInput.value = "";
  pokemonInput.value = "";
  applyFilters();
});

main();
