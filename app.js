// app.js (tidier layout + whole card clickable + better sprite fallback)

const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");

const tournamentSelect = document.getElementById("tournamentFilter");
const playerInput = document.getElementById("playerFilter");
const pokemonInput = document.getElementById("pokemonFilter");
const clearBtn = document.getElementById("clearBtn");

const statsPanel = document.getElementById("statsPanel");
const statsToggleBtn = document.getElementById("statsToggleBtn");

let allData = [];
let showStats = false;

function norm(s) {
  return (s ?? "").toString().trim().toLowerCase();
}

function cleanMon(mon) {
  return (mon ?? "").toString().split(",")[0].trim();
}

// --------------------
// Sprites (better fallbacks)
// --------------------
function showdownKeyFromMon(mon) {
  // normalize to showdown-ish key
  let key = (mon ?? "")
    .toString()
    .toLowerCase()
    .replace(/['’\.]/g, "")
    .replace(/[^a-z0-9\- ]/g, "")
    .replace(/[\s\-]+/g, "");

  // targeted fixes (add more as you see broken ones)
  const fixes = {
    // Basculin stripes
    basculinbluestriped: "basculinbluestriped",
    basculinwhitestriped: "basculinwhitestriped",

    // Hisui
    sneaselhisui: "sneaselhisui",
    samurotthisui: "samurotthisui",

    // Oricorio
    oricoriopau: "oricoriopau",
    oricoriopompom: "oricoriopompom",
    oricoriosensu: "oricoriosensu",
    oricoriobaile: "oricoriobaile",

    // Common “-Alola”
    exeggutoralola: "exeggutoralola",
    raichualola: "raichualola",
    marowakalola: "marowakalola",
  };

  return fixes[key] || key;
}

function spriteUrlsFor(mon) {
  const key = showdownKeyFromMon(mon);

  // Try: modern static icons -> older icons -> dex sprite -> (last resort) gen5
  return [
    `https://play.pokemonshowdown.com/sprites/gen5/${key}.png`,
    `https://play.pokemonshowdown.com/sprites/dex/${key}.png`,
    `https://play.pokemonshowdown.com/sprites/gen4/${key}.png`,
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

// --------------------
// Dropdown
// --------------------
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

// --------------------
// Filtering
// --------------------
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

// --------------------
// Stats
// --------------------
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
      const roster = (info?.team || []).map(cleanMon).filter(Boolean).slice(0, 6);
      const rosterUniq = [...new Set(roster)];

      const isWinner = winner && norm(playerName) === norm(winner);

      for (const mon of rosterUniq) {
        totalUses++;
        if (!map.has(mon)) map.set(mon, { mon, uses: 0, wins: 0, losses: 0, gamesPresent: 0 });
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
      if (!map.has(mon)) map.set(mon, { mon, uses: 0, wins: 0, losses: 0, gamesPresent: 0 });
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
  note.style.margin = "6px 2px";
  note.style.opacity = "0.85";
  note.innerHTML = `
    <div style="font-weight:700; margin-bottom:4px;">Pokémon stats (filtered)</div>
    <small>
      Games: ${totalGames} · Uses: ${totalUses}
      ${hasWinner ? "" : " · Winrate unavailable (missing winner field)"}
    </small>
  `;

  const table = document.createElement("table");
  table.style.width = "100%";
  table.style.borderCollapse = "collapse";
  table.style.marginTop = "8px";

  const thStyle =
    "text-align:left; padding:6px; border-bottom:1px solid #2a2a3a; font-size:12px; opacity:0.9;";
  const tdStyle = "padding:6px; border-bottom:1px solid #2a2a3a; font-size:12px;";

  table.innerHTML = `
    <thead>
      <tr>
        <th style="${thStyle}">Pokémon</th>
        <th style="${thStyle}">Uses</th>
        <th style="${thStyle}">Usage%</th>
        <th style="${thStyle}">Games%</th>
        <th style="${thStyle}">W</th>
        <th style="${thStyle}">L</th>
        <th style="${thStyle}">WR</th>
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

// --------------------
// Rendering (tighter, clickable)
// --------------------
function monToShowdownKey(mon) {
  // takes "Basculin-Blue-Striped" etc -> basculinbluestriped (icon naming)
  return (mon ?? "")
    .toString()
    .split(",")[0]
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ""); // remove hyphens/apostrophes/spaces
}

function spriteUrl(mon) {
  const key = monToShowdownKey(mon);

  // 1) Gen5 dex icons (small, crisp, NOT 3D)
  // This is the closest to the compact “team strip” look you posted.
  return `https://play.pokemonshowdown.com/sprites/gen5/${key}.png`;
}

function spriteFallbackUrl(mon) {
  const key = monToShowdownKey(mon);

  // 2) fallback: static gen5 spritesheet-style icon alt paths can differ by mon,
  // so as a “good enough” fallback we use the full-size gen5 sprite.
  return `https://play.pokemonshowdown.com/sprites/gen5/${key}.png`;
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

    const teams = item.teams || {};
    const entries = Object.entries(teams);

    // determine winner/loser by comparing displayed names to item.winner
    const winnerName = item.winner ? norm(item.winner) : null;

    // If player filter is active, only show matching player rows (but keep match)
    const playerQuery = norm(playerInput.value);
    let shownEntries = entries;

    if (playerQuery) {
      shownEntries = entries.filter(([pid, info]) => norm(info?.name).includes(playerQuery));
      if (shownEntries.length === 0) shownEntries = entries;
    }

    for (const [pid, info] of shownEntries) {
      const row = document.createElement("div");
      row.className = "teamRow";

      // click row -> open replay
      row.addEventListener("click", () => {
        window.open(item.link, "_blank", "noreferrer");
      });

      const playerName = info?.name || pid;

      if (winnerName) {
        if (norm(playerName) === winnerName) row.classList.add("winner");
        else row.classList.add("loser");
      }

      const nameEl = document.createElement("div");
      nameEl.className = "teamPlayer";
      nameEl.textContent = playerName;

      const monsDiv = document.createElement("div");
      monsDiv.className = "mons";

      const roster = (info?.team || [])
        .map(cleanMon)
        .filter(Boolean)
        .slice(0, 6);

      for (const mon of roster) {
        const img = document.createElement("img");
        img.className = "monImg";
        img.alt = mon;
        img.title = mon;

        img.src = spriteUrl(mon);
        img.onerror = () => {
          img.onerror = null;
          img.src = spriteFallbackUrl(mon);
        };

        monsDiv.appendChild(img);
      }

      const badge = document.createElement("div");
      badge.className = "badge";
      badge.textContent = item.tournament || "Unknown";

      row.appendChild(nameEl);
      row.appendChild(monsDiv);
      row.appendChild(badge);

      card.appendChild(row);
    }

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

    const url = `test.json?cb=${Date.now()}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load test.json (${res.status})`);

    allData = await res.json();

    populateTournamentDropdown(allData);

    // start hidden
    if (statsPanel) statsPanel.classList.add("hidden");
    if (statsToggleBtn) statsToggleBtn.textContent = "Show stats";

    applyFilters();
  } catch (e) {
    statusEl.textContent = `Error: ${e.message}`;
    if (statsPanel) statsPanel.innerHTML = "";
  }
}

// Events
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
