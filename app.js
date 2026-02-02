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
  // keep first option, wipe the rest
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

function matchItem(item) {
  const tournamentValue = tournamentSelect.value;
  const p = norm(playerInput.value);
  const m = norm(pokemonInput.value);

  // Tournament filter
  if (tournamentValue !== "__all__" && tournamentValue !== "__none__") {
    if ((item.tournament || "") !== tournamentValue) return false;
  }

  const teams = item.teams || {};
  const players = Object.values(teams).map(x => x?.name || "");
  const mons = Object.values(teams).flatMap(x => (x?.team || []).map(cleanMon));

  if (p) {
    const ok = players.some(name => norm(name).includes(p));
    if (!ok) return false;
  }

  if (m) {
    const ok = mons.some(mon => norm(mon).includes(m));
    if (!ok) return false;
  }

  return true;
}

function render(data) {
  resultsEl.innerHTML = "";

  if (!data.length) {
    statusEl.textContent = "No matches found.";
    return;
  }

  statusEl.textContent = `Showing ${data.length} replays`;

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

    // Optional: show source thread link if present
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
const playerQuery = norm(playerInput.value);

// Start with both teams
let entries = Object.entries(teams);

// If player search is active, only show the matching player's team(s)
if (playerQuery) {
  entries = entries.filter(([pid, info]) => norm(info?.name).includes(playerQuery));
}

// Fallback: if no match (should be rare), show both teams
if (entries.length === 0) entries = Object.entries(teams);

for (const [pid, info] of entries) {
  const teamDiv = document.createElement("div");
  teamDiv.className = "team";

  const name = document.createElement("div");
  name.className = "teamName";
  name.textContent = info?.name ? info.name : pid;

  const monsDiv = document.createElement("div");
  monsDiv.className = "mons";

  for (const monRaw of (info?.team || [])) {
    const mon = cleanMon(monRaw);

    // showdown-style filename
    let key = mon.toLowerCase()
      .replace(/[^a-z0-9\- ]/g, "")  // strip punctuation
      .replace(/ /g, "-");           // spaces → dashes

    const img = document.createElement("img");
    img.src = `https://play.pokemonshowdown.com/sprites/ani/${key}.gif`;
    img.alt = mon;
    img.title = mon;                // hover shows name
    img.className = "monImg";

    // fallback to static sprite if ani gif doesn't exist
    img.onerror = () => {
      img.onerror = null;
      img.src = `https://play.pokemonshowdown.com/sprites/xyani/${key}.gif`;
    };

    monsDiv.appendChild(img);
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
