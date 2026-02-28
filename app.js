const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");

const tournamentSelect = document.getElementById("tournamentFilter");
const playerInput = document.getElementById("playerFilter");
const pokemonInput = document.getElementById("pokemonFilter");
const clearBtn = document.getElementById("clearBtn");

const statsPanel = document.getElementById("statsPanel");
const statsToggleBtn = document.getElementById("statsToggleBtn");
let showStats = false;

let allData = [];

/* -------------------- helpers -------------------- */
function norm(s) {
  return (s ?? "").toString().trim().toLowerCase();
}

// Showdown "toID" style: remove ALL non-alnum, no hyphens.
// This is the key fix for Brute Bonnet + most formes.
function toId(s) {
  return (s ?? "")
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function cleanMon(mon) {
  // "Froslass, F" -> "Froslass"
  return (mon ?? "").toString().split(",")[0].trim();
}

function monToSpriteId(monRaw) {
  const mon = cleanMon(monRaw);
  return toId(mon);
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

/* -------------------- stats -------------------- */
/**
 * Pokémon stats (on filtered set):
 * - uses: counts per team slot (mon on a team counts as 1)
 * - gamesPresent: counts per match where mon appears at least once (either side)
 * - wins/losses: per-use (if winner known)
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
  const { rows, totalUses, totalGames } = computePokemonStats(filtered);
  const hasWinner = filtered.some(x => x.winner);

  const top = rows.slice(0, 50);

  const note = document.createElement("div");
  note.className = "statsNote";
  note.innerHTML = `
    <div class="statsTitle">Pokémon stats (filtered)</div>
    <small>
      Games: ${totalGames} · Team-slot uses: ${totalUses}
      ${hasWinner ? "" : " · Winrate unavailable (missing winner in test.json)"}
      <br/>
      Usage% (Uses) = uses / total team slots · Usage% (Games) = games where mon appears / total games
      <br/>
      Mirror matches are handled automatically (each side counts as one use; one win + one loss).
    </small>
  `;

  const table = document.createElement("table");
  table.className = "statsTable";

  table.innerHTML = `
    <thead>
      <tr>
        <th>Pokémon</th>
        <th>Uses</th>
        <th>Usage% (Uses)</th>
        <th>Games</th>
        <th>Usage% (Games)</th>
        <th>Wins</th>
        <th>Losses</th>
        <th>Winrate</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector("tbody");
  for (const r of top) {
    const tr = document.createElement("tr");
    const wrText = r.winrate == null ? "—" : `${r.winrate.toFixed(1)}%`;
    tr.innerHTML = `
      <td>${r.mon}</td>
      <td>${r.uses}</td>
      <td>${r.usageUsesPct.toFixed(2)}%</td>
      <td>${r.gamesPresent}</td>
      <td>${r.usageGamesPct.toFixed(2)}%</td>
      <td>${r.wins}</td>
      <td>${r.losses}</td>
      <td>${wrText}</td>
    `;
    tbody.appendChild(tr);
  }

  statsPanel.innerHTML = "";
  statsPanel.appendChild(note);
  statsPanel.appendChild(table);
}

/* -------------------- rendering -------------------- */
function spriteImg(monRaw) {
  const mon = cleanMon(monRaw);
  const id = monToSpriteId(mon);

  const img = document.createElement("img");
  img.className = "monImg";
  img.alt = mon;
  img.title = mon;

  // Primary: animated gen sprites (best coverage, not 3D models)
  img.src = `https://play.pokemonshowdown.com/sprites/ani/${id}.gif`;

  // Fallback: static dex sprite
  img.onerror = () => {
    img.onerror = null;
    img.src = `https://play.pokemonshowdown.com/sprites/dex/${id}.png`;
  };

  return img;
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

    // Compact header line (link + tournament)
    const header = document.createElement("div");
    header.className = "matchHeader";

    const linkA = document.createElement("a");
    linkA.href = item.link;
    linkA.target = "_blank";
    linkA.rel = "noreferrer";
    linkA.textContent = item.link;

    const meta = document.createElement("div");
    meta.className = "matchMeta";
    meta.textContent = item.tournament || "Unknown";

    header.appendChild(linkA);
    header.appendChild(meta);
    card.appendChild(header);

    const teamsWrap = document.createElement("div");
    teamsWrap.className = "teamsCompact";

    const teams = item.teams || {};
    let entries = Object.entries(teams);

    // If player filter active, only show that player's team rows
    if (playerQuery) {
      entries = entries.filter(([pid, info]) => norm(info?.name).includes(playerQuery));
    }
    if (entries.length === 0) entries = Object.entries(teams);

    // Winner/loser coloring
    const winnerName = item.winner ? norm(item.winner) : null;

    for (const [pid, info] of entries) {
      const nameText = (info?.name || pid).toString();
      const isWinner = winnerName && norm(nameText) === winnerName;

      // Entire row clickable to replay
      const row = document.createElement("a");
      row.className = "teamRow";
      row.href = item.link;
      row.target = "_blank";
      row.rel = "noreferrer";

      if (winnerName) row.classList.add(isWinner ? "winner" : "loser");

      const name = document.createElement("div");
      name.className = "teamRowName";
      name.textContent = nameText;

      const mons = document.createElement("div");
      mons.className = "teamRowMons";

      for (const monRaw of (info?.team || []).slice(0, 6)) {
        mons.appendChild(spriteImg(monRaw));
      }

      const right = document.createElement("div");
      right.className = "teamRowRight";
      right.textContent = item.tournament || "Unknown";

      row.appendChild(name);
      row.appendChild(mons);
      row.appendChild(right);

      teamsWrap.appendChild(row);
    }

    card.appendChild(teamsWrap);
    resultsEl.appendChild(card);
  }
}

function applyFilters() {
  const filtered = allData.filter(matchItem);

  if (showStats) renderStats(filtered);
  else statsPanel.innerHTML = "";

  render(filtered);
}

/* -------------------- boot -------------------- */
async function main() {
  try {
    statusEl.textContent = "Loading…";

    const url = `test.json?cb=${Date.now()}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load test.json (${res.status})`);

    allData = await res.json();

    populateTournamentDropdown(allData);
    applyFilters();
  } catch (e) {
    statusEl.textContent = `Error: ${e.message}`;
    statsPanel.innerHTML = "";
  }
}

tournamentSelect.addEventListener("change", applyFilters);
playerInput.addEventListener("input", applyFilters);
pokemonInput.addEventListener("input", applyFilters);

statsToggleBtn.addEventListener("click", () => {
  showStats = !showStats;
  statsPanel.classList.toggle("hidden", !showStats);
  statsToggleBtn.textContent = showStats ? "Hide stats" : "Show stats";
  applyFilters();
});

clearBtn.addEventListener("click", () => {
  tournamentSelect.value = "__all__";
  playerInput.value = "";
  pokemonInput.value = "";
  applyFilters();
});

main();
