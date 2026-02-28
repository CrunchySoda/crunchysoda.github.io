const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");

// Create a stats area above results if it doesn't exist
let statsEl = document.getElementById("stats");
if (!statsEl) {
  statsEl = document.createElement("section");
  statsEl.id = "stats";
  statsEl.className = "stats";
  resultsEl.parentElement.insertBefore(statsEl, resultsEl);
}

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

/**
 * Compute Pokémon stats for a set of matches.
 * - uses: counts per team slot (a mon on each team counts as 1)
 * - gamesPresent: counts per match where mon appears at least once (either side)
 * - wins/losses: per-use (if winner is known)
 */
function computePokemonStats(matches) {
  const map = new Map();

  let totalUses = 0;       // denominator for usage% (uses)
  const totalGames = matches.length; // denominator for usage% (games)

  for (const item of matches) {
    const winner = item.winner || null;

    const teams = item.teams || {};
    const presentThisGame = new Set(); // unique mons in this match

    for (const [pid, info] of Object.entries(teams)) {
      const playerName = info?.name || pid;

      // dedupe + normalize roster to 6
      const roster = (info?.team || [])
        .map(cleanMon)
        .filter(Boolean)
        .slice(0, 6);

      // (optional) if you want to dedupe within a team (should already be unique):
      const rosterUniq = [...new Set(roster)];

      const isWinner =
        winner && norm(playerName) === norm(winner);

      for (const mon of rosterUniq) {
        totalUses++;

        if (!map.has(mon)) {
          map.set(mon, { mon, uses: 0, wins: 0, losses: 0, gamesPresent: 0 });
        }
        const row = map.get(mon);
        row.uses++;

        // winner-based stats
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

    return {
      ...r,
      usageUsesPct,
      usageGamesPct,
      winrate,
    };
  });

  // Sort by uses desc, then winrate desc
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

  // if winner missing, winrate is meaningless
  const hasWinner = filtered.some(x => x.winner);

  const top = rows.slice(0, 50); // show top 50

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
      <br/>
      Mirror matches are handled automatically (each side counts as one use; one win + one loss).
    </small>
  `;

  const table = document.createElement("table");
  table.style.width = "100%";
  table.style.borderCollapse = "collapse";
  table.style.marginTop = "10px";

  const thStyle = "text-align:left; padding:8px; border-bottom:1px solid #2a2a3a; font-size:12px; opacity:0.9;";
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
        <th style="${thStyle}">Winrate (per-use)</th>
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

  statsEl.innerHTML = "";
  statsEl.appendChild(note);
  statsEl.appendChild(table);
}

function render(data) {
  resultsEl.innerHTML = "";

  if (!data.length) {
    statusEl.textContent = "No matches found.";
    statsEl.innerHTML = "";
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

      // Keep your existing sprite logic if you want; omitted here since your sprite part is working.
      for (const monRaw of (info?.team || [])) {
        const mon = cleanMon(monRaw);
        const pill = document.createElement("div");
        pill.className = "mon";
        pill.textContent = mon;
        monsDiv.appendChild(pill);
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
  renderStats(filtered);
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
    applyFilters();
  } catch (e) {
    statusEl.textContent = `Error: ${e.message}`;
    statsEl.innerHTML = "";
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
