// app.js (full file) — copy/paste the whole thing

const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");

const tournamentSelect = document.getElementById("tournamentFilter");
const playerInput = document.getElementById("playerFilter");
const pokemonInput = document.getElementById("pokemonFilter");
const clearBtn = document.getElementById("clearBtn");

// Stats UI (must exist in HTML)
const statsPanel = document.getElementById("statsPanel");
const statsToggleBtn = document.getElementById("statsToggleBtn");

let allData = [];
let showStats = false;

function norm(s) {
  return (s ?? "").toString().trim().toLowerCase();
}

function cleanMon(mon) {
  // "Froslass, F" -> "Froslass"
  // "Oricorio-Pa'u, M" -> "Oricorio-Pa'u"
  return (mon ?? "").toString().split(",")[0].trim();
}

// --- Sprite helpers (static sprites by default, smaller + reliable) ---
function showdownKeyFromMon(mon) {
  // Convert display name to showdown sprite key
  // examples:
  // "Brute Bonnet" -> "brutebonnet"
  // "Basculin-Blue-Striped" -> "basculinbluestriped"
  // "Sneasel-Hisui" -> "sneaselhisui"
  // "Exeggutor-Alola" -> "exeggutoralola"

  let key = (mon ?? "")
    .toString()
    .toLowerCase()
    .replace(/['’\.]/g, "")      // remove apostrophes/dots
    .replace(/[^a-z0-9\- ]/g, "")// strip weird chars
    .replace(/[\s\-]+/g, "");    // remove spaces + hyphens

  // A few common special cases (add more if you see a broken one)
  const fixes = {
    // Oricorio forms
    oricoriopau: "oricoriopau",
    oricoriopompom: "oricoriopompom",
    oricoriosensu: "oricoriosensu",
    oricoriobaile: "oricoriobaile",
    // Basculin stripes
    basculinbluestriped: "basculinbluestriped",
    basculinwhitestriped: "basculinwhitestriped",
  };

  return fixes[key] || key;
}

function spriteUrlsFor(mon) {
  const key = showdownKeyFromMon(mon);

  // Static sprites are way more stable than GIFs
  // Primary: gen5 icons (tiny, crisp)
  // Fallback: dex sprites (larger png)
  return [
    `https://play.pokemonshowdown.com/sprites/gen5/${key}.png`,
    `https://play.pokemonshowdown.com/sprites/dex/${key}.png`,
  ];
}

function makeMonSprite(mon) {
  const img = document.createElement("img");
  img.className = "monImg";
  img.alt = mon;
  img.title = mon;

  const urls = spriteUrlsFor(mon);
  let i = 0;
  img.src = urls[i];

  img.onerror = () => {
    i++;
    if (i < urls.length) img.src = urls[i];
    else img.onerror = null;
  };

  return img;
}

// --- Dropdown ---
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

// --- Filtering ---
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
    const ok = players.some(name => norm(name).includes(p));
    if (!ok) return false;
  }

  if (m) {
    const ok = mons.some(mon => norm(mon).includes(m));
    if (!ok) return false;
  }

  return true;
}

// --- Stats ---
/**
 * Pokémon stats:
 * - uses: team-slot uses (each appearance on a team counts as 1)
 * - gamesPresent: matches where mon appears at least once (either side)
 * - wins/losses: per-use, based on winner field (mirror games count as 1 win + 1 loss)
 */
function computePokemonStats(matches) {
  const map = new Map();
  let totalUses = 0;
  const totalGames = matches.length;

  for (const item of matches) {
    const winner = item.winner || null;
    const teams = item.teams || {};
    const presentThisGame = new Set();

    for (const [pid, info] of Object.entries(teams)) {
      const playerName = info?.name || pid;

      const roster = (info?.team || [])
        .map(cleanMon)
        .filter(Boolean)
        .slice(0, 6);

      const rosterUniq = [...new Set(roster)];
      const isWinner = winner && norm(playerName) === norm(winner);

      for (const mon of rosterUniq) {
        totalUses++;
        if (!map.has(mon)) {
          map.set(mon, { mon, uses: 0, wins: 0, losses: 0, gamesPresent: 0 });
        }
        const row = map.get(mon);
        row.uses++;

        if (winner) {
          if (isWinner) row.wins++;
          else row.losses++;
        }

        presentThisGame.add(mon);
      }
    }

    for (const mon of presentThisGame) {
      if (!map.has(mon)) {
        map.set(mon, { mon, uses: 0, wins: 0, losses: 0, gamesPresent: 0 });
      }
      map.get(mon).gamesPresent++;
    }
  }

  const rows = [...map.values()].map(r => {
    const usageUsesPct = totalUses ? (r.uses / totalUses) * 100 : 0;
    const usageGamesPct = totalGames ? (r.gamesPresent / totalGames) * 100 : 0;
    const winrate = r.uses ? (r.wins / r.uses) * 100 : null;

    return { ...r, usageUsesPct, usageGamesPct, winrate };
  });

  rows.sort((a, b) => {
    if (b.uses !== a.uses) return b.uses - a.uses;
    const aw = a.winrate ?? -1;
    const bw = b.winrate ?? -1;
    return bw - aw;
  });

  return { rows, totalUses, totalGames };
}

function renderStats(filtered) {
  if (!statsPanel) return;

  const { rows, totalUses, totalGames } = computePokemonStats(filtered);
  const hasWinner = filtered.some(x => x.winner);

  const top = rows.slice(0, 50);

  const note = document.createElement("div");
  note.style.margin = "10px 2px";
  note.style.opacity = "0.85";
  note.innerHTML = `
    <div style="font-weight:700; margin-bottom:6px;">Pokémon stats (filtered set)</div>
    <small>
      Games: ${totalGames} · Team-slot uses: ${totalUses}
      ${hasWinner ? "" : " · Winrate unavailable (missing winner in test.json)"}
      <br/>
      Usage% (Uses) = uses / total team slots · Usage% (Games) = games where mon appears / total games
    </small>
  `;

  const table = document.createElement("table");
  table.style.width = "100%";
  table.style.borderCollapse = "collapse";
  table.style.marginTop = "10px";

  const thStyle =
    "text-align:left; padding:8px; border-bottom:1px solid #2a2a3a; font-size:12px; opacity:0.9;";
  const tdStyle = "padding:8px; border-bottom:1px solid #2a2a3a; font-size:12px;";

  table.innerHTML = `
    <thead>
      <tr>
        <th style="${thStyle}">Pokémon</th>
        <th style="${thStyle}">Uses</th>
        <th style="${thStyle}">Usage% (Uses)</th>
        <th style="${thStyle}">Games</th>
        <th style="${thStyle}">Usage% (Games)</th>
        <th style="${thStyle}">Wins</th>
        <th style="${thStyle}">Losses</th>
        <th style="${thStyle}">Winrate</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector("tbody");
  for (const r of top) {
    const tr = document.createElement("tr");
    const wrText = r.winrate == null ? "—" : `${r.winrate.toFixed(1)}%`;

    tr.innerHTML = `
      <td style="${tdStyle}">${r.mon}</td>
      <td style="${tdStyle}">${r.uses}</td>
      <td style="${tdStyle}">${r.usageUsesPct.toFixed(2)}%</td>
      <td style="${tdStyle}">${r.gamesPresent}</td>
      <td style="${tdStyle}">${r.usageGamesPct.toFixed(2)}%</td>
      <td style="${tdStyle}">${r.wins}</td>
      <td style="${tdStyle}">${r.losses}</td>
      <td style="${tdStyle}">${wrText}</td>
    `;
    tbody.appendChild(tr);
  }

  statsPanel.innerHTML = "";
  statsPanel.appendChild(note);
  statsPanel.appendChild(table);
}

// --- Render results ---
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
    const winText = item.winner ? ` · Winner: ${item.winner}` : "";
    t.textContent = `Tournament: ${item.tournament || "Unknown"}${winText}`;
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
    const playerQuery = norm(playerInput.value);

    let entries = Object.entries(teams);

    // If player filter is active, only show matching side(s)
    if (playerQuery) {
      entries = entries.filter(([pid, info]) => norm(info?.name).includes(playerQuery));
    }
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
        const img = makeMonSprite(mon);
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

  if (showStats) renderStats(filtered);
  else if (statsPanel) statsPanel.innerHTML = "";

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

    // start hidden (button shows stats on demand)
    if (statsPanel) statsPanel.classList.add("hidden");
    if (statsToggleBtn) statsToggleBtn.textContent = "Show stats";

    applyFilters();
  } catch (e) {
    statusEl.textContent = `Error: ${e.message}`;
    if (statsPanel) statsPanel.innerHTML = "";
  }
}

// --- Events ---
tournamentSelect.addEventListener("change", applyFilters);
playerInput.addEventListener("input", applyFilters);
pokemonInput.addEventListener("input", applyFilters);

if (statsToggleBtn && statsPanel) {
  statsToggleBtn.addEventListener("click", () => {
    showStats = !showStats;
    statsPanel.classList.toggle("hidden", !showStats);
    statsToggleBtn.textContent = showStats ? "Hide stats" : "Show stats";
    applyFilters();
  });
}

clearBtn.addEventListener("click", () => {
  tournamentSelect.value = "__all__";
  playerInput.value = "";
  pokemonInput.value = "";
  applyFilters();
});

main();
