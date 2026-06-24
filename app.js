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

function cleanMon(mon) {
  return (mon ?? "").toString().split(",")[0].trim();
}

function statMonName(mon) {
  const clean = cleanMon(mon);

  // Merge ONLY Basculin forms for stats
  if (
    clean === "Basculin" ||
    clean === "Basculin-Blue-Striped" ||
    clean === "Basculin-White-Striped"
  ) {
    return "Basculin";
  }

  return clean;
}

function toId(s) {
  return (s ?? "")
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeMonName(mon) {
  return cleanMon(mon).replace(/’/g, "'");
}

function monToSpriteId(monRaw) {
  const mon = normalizeMonName(monRaw);
  const k = mon.toLowerCase().replace(/’/g, "'").trim();

  const OVERRIDE = {
    "oricorio-pa'u": "oricorio-pau",
    "oricorio-pom-pom": "oricorio-pompom",
  };

  if (OVERRIDE[k]) return OVERRIDE[k];

  // Keep hyphens for formes: rotom-mow, sneasel-hisui, etc.
  return k
    .replace(/[^a-z0-9\- ]/g, "")
    .replace(/\s+/g, "-");
}

/* -------------------- dropdown -------------------- */

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

/* -------------------- filtering -------------------- */

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

function computePokemonStats(matches) {
  const map = new Map();
  let totalUses = 0;
  const totalGames = matches.length;

  function getRow(mon) {
    if (!map.has(mon)) {
      map.set(mon, {
        mon,
        uses: 0,
        wins: 0,
        losses: 0,
        gamesPresent: 0,
        trueUses: 0,
        trueWins: 0,
        trueLosses: 0,
      });
    }
    return map.get(mon);
  }

  for (const item of matches) {
    const winner = item.winner || null;
    const teams = item.teams || {};
    const presentThisGame = new Set();
    const sidesThisGame = new Map();

    for (const [pid, info] of Object.entries(teams)) {
      const playerName = info?.name || pid;

      const roster = (info?.team || [])
        .map(statMonName)
        .filter(Boolean)
        .slice(0, 6);

      const rosterUniq = [...new Set(roster)];
      const isWinner = winner && norm(playerName) === norm(winner);

      for (const mon of rosterUniq) {
        totalUses++;

        const row = getRow(mon);
        row.uses++;

        if (winner) {
          if (isWinner) row.wins++;
          else row.losses++;
        }

        presentThisGame.add(mon);

        if (!sidesThisGame.has(mon)) sidesThisGame.set(mon, []);
        sidesThisGame.get(mon).push({ playerName, isWinner });
      }
    }

    for (const mon of presentThisGame) {
      getRow(mon).gamesPresent++;
    }

    // True WR: only count games where exactly one side brought the mon
    if (winner) {
      for (const [mon, sides] of sidesThisGame.entries()) {
        if (sides.length !== 1) continue;

        const row = getRow(mon);
        row.trueUses++;

        if (sides[0].isWinner) row.trueWins++;
        else row.trueLosses++;
      }
    }
  }

  const rows = [...map.values()].map(r => {
    const usageUsesPct = totalUses ? (r.uses / totalUses) * 100 : 0;
    const usageGamesPct = totalGames ? (r.gamesPresent / totalGames) * 100 : 0;
    const winrate = r.uses ? (r.wins / r.uses) * 100 : null;
    const trueWinrate = r.trueUses ? (r.trueWins / r.trueUses) * 100 : null;

    return {
      ...r,
      usageUsesPct,
      usageGamesPct,
      winrate,
      trueWinrate,
    };
  });

  rows.sort((a, b) => {
    if (b.uses !== a.uses) return b.uses - a.uses;
    const aw = a.winrate ?? -1;
    const bw = b.winrate ?? -1;
    return bw - aw;
  });

  return { rows, totalUses, totalGames };
}
function computeCommonTeammates(matches, targetMon) {
  const target = statMonName(targetMon);
  const teammateCounts = new Map();
  let targetTeams = 0;

  for (const item of matches) {
    const teams = item.teams || {};

    for (const info of Object.values(teams)) {
      const roster = (info?.team || [])
        .map(statMonName)
        .filter(Boolean)
        .slice(0, 6);

      const uniqueRoster = [...new Set(roster)];

      if (!uniqueRoster.includes(target)) continue;

      targetTeams++;

      for (const teammate of uniqueRoster) {
        if (teammate === target) continue;
        teammateCounts.set(teammate, (teammateCounts.get(teammate) || 0) + 1);
      }
    }
  }

  return [...teammateCounts.entries()]
    .map(([mon, count]) => ({
      mon,
      count,
      rate: targetTeams ? (count / targetTeams) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count);
}


function renderTeammates(filtered, mon) {
  const rows = computeCommonTeammates(filtered, mon).slice(0, 12);

  if (!rows.length) return "";

  return `
    <div class="teammatesBox">
      <div class="statsTitle">Common teammates for ${mon}</div>
      <table class="statsTable">
        <thead>
          <tr>
            <th>Teammate</th>
            <th>Times Together</th>
            <th>Pair Rate</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${r.mon}</td>
              <td>${r.count}</td>
              <td>${r.rate.toFixed(1)}%</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
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
      WR = all uses, including mirrors. True WR = only games where exactly one side brought that Pokémon.
      <br/>
      Click a Pokémon row to see common teammates.
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
        <th>WR</th>
        <th>True WR</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector("tbody");

  for (const r of top) {
    const tr = document.createElement("tr");
    tr.className = "clickableStatRow";

    const wrText = r.winrate == null ? "—" : `${r.winrate.toFixed(1)}%`;
    const trueWrText = r.trueWinrate == null
      ? "—"
      : `${r.trueWinrate.toFixed(1)}% (${r.trueWins}-${r.trueLosses})`;

    tr.innerHTML = `
      <td>${r.mon}</td>
      <td>${r.uses}</td>
      <td>${r.usageUsesPct.toFixed(2)}%</td>
      <td>${r.gamesPresent}</td>
      <td>${r.usageGamesPct.toFixed(2)}%</td>
      <td>${r.wins}</td>
      <td>${r.losses}</td>
      <td>${wrText}</td>
      <td>${trueWrText}</td>
    `;

    tr.addEventListener("click", () => {
      const oldBox = statsPanel.querySelector(".teammatesBox");
      if (oldBox) oldBox.remove();

      const html = renderTeammates(filtered, r.mon);
      statsPanel.insertAdjacentHTML("beforeend", html);
    });

    tbody.appendChild(tr);
  }

  statsPanel.innerHTML = "";
  statsPanel.appendChild(note);
  statsPanel.appendChild(table);
}

/* -------------------- sprites -------------------- */

function setSpriteWithFallback(img, urls) {
  let i = 0;

  const tryNext = () => {
    if (i >= urls.length) return;
    img.src = urls[i++];
  };

  img.onerror = () => tryNext();
  tryNext();
}

function spriteImg(monRaw) {
  const mon = normalizeMonName(monRaw);
  const id = monToSpriteId(mon);

  const img = document.createElement("img");
  img.className = "monImg";
  img.alt = mon;
  img.title = mon;

  const baseName = mon.includes("-") ? mon.split("-")[0] : mon;
  const baseId = toId(baseName);

  const urls = [
    `https://play.pokemonshowdown.com/sprites/gen5/${id}.png`,
    `https://play.pokemonshowdown.com/sprites/gen5ani/${id}.gif`,
    `https://play.pokemonshowdown.com/sprites/ani/${id}.gif`,
    `https://play.pokemonshowdown.com/sprites/dex/${id}.png`,

    `https://play.pokemonshowdown.com/sprites/gen5/${baseId}.png`,
    `https://play.pokemonshowdown.com/sprites/gen5ani/${baseId}.gif`,
    `https://play.pokemonshowdown.com/sprites/dex/${baseId}.png`,
  ];

  setSpriteWithFallback(img, urls);
  return img;
}

/* -------------------- rendering -------------------- */

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

    const teamsWrap = document.createElement("div");
    teamsWrap.className = "teamsCompact";

    const teams = item.teams || {};
    let entries = Object.entries(teams);

    if (playerQuery) {
      entries = entries.filter(([pid, info]) => norm(info?.name).includes(playerQuery));
    }

    if (entries.length === 0) entries = Object.entries(teams);

    const winnerName = item.winner ? norm(item.winner) : null;

    for (const [pid, info] of entries) {
      const nameText = (info?.name || pid).toString();
      const isWinner = winnerName && norm(nameText) === winnerName;

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
