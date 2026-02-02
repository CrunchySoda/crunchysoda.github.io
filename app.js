const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");

const threadSelect = document.getElementById("threadFilter");
const playerInput = document.getElementById("playerFilter");
const pokemonInput = document.getElementById("pokemonFilter");
const clearBtn = document.getElementById("clearBtn");

let allData = [];

function norm(s) {
  return (s ?? "").toString().trim().toLowerCase();
}

function threadLabel(url) {
  if (!url) return "Unknown thread";
  try {
    // Make it readable: show the last part of the thread URL
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1] || u.hostname;
    return last.replace(/[-_]/g, " ");
  } catch {
    return url;
  }
}

function getThreads(data) {
  const set = new Map(); // label -> url
  for (const item of data) {
    const t = item.thread || "";
    if (!t) continue;
    set.set(threadLabel(t), t);
  }
  return [...set.entries()].sort((a,b) => a[0].localeCompare(b[0]));
}

function populateThreadDropdown(data) {
  // keep first option, wipe the rest
  while (threadSelect.options.length > 1) threadSelect.remove(1);

  const threads = getThreads(data);
  for (const [label, url] of threads) {
    const opt = document.createElement("option");
    opt.value = url;
    opt.textContent = label;
    threadSelect.appendChild(opt);
  }

  // If there are no thread fields yet, explain it
  if (threads.length === 0) {
    const opt = document.createElement("option");
    opt.value = "__none__";
    opt.textContent = "No thread data (update scraper)";
    threadSelect.appendChild(opt);
    threadSelect.value = "__all__";
  }
}

function matchItem(item) {
  const threadValue = threadSelect.value;
  const p = norm(playerInput.value);
  const m = norm(pokemonInput.value);

  // Thread filter
  if (threadValue !== "__all__" && threadValue !== "__none__") {
    if ((item.thread || "") !== threadValue) return false;
  }

  // Flatten teams into searchable text
  const teams = item.teams || {};
  const players = Object.values(teams).map(x => x?.name || "");
  const mons = Object.values(teams).flatMap(x => x?.team || []);

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
    t.textContent = item.thread ? `Thread: ${threadLabel(item.thread)}` : "Thread: (not in data)";
    right.appendChild(t);

    top.appendChild(left);
    top.appendChild(right);
    card.appendChild(top);

    const teamsWrap = document.createElement("div");
    teamsWrap.className = "teams";

    const teams = item.teams || {};
    for (const [pid, info] of Object.entries(teams)) {
      const teamDiv = document.createElement("div");
      teamDiv.className = "team";

      const name = document.createElement("div");
      name.className = "teamName";
      name.textContent = info?.name ? info.name : pid;

      const monsDiv = document.createElement("div");
      monsDiv.className = "mons";

      for (const mon of (info?.team || [])) {
        const span = document.createElement("span");
        span.className = "mon";
        span.textContent = mon;
        monsDiv.appendChild(span);
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

    populateThreadDropdown(allData);
    applyFilters();
  } catch (e) {
    statusEl.textContent = `Error: ${e.message}`;
  }
}

threadSelect.addEventListener("change", applyFilters);
playerInput.addEventListener("input", applyFilters);
pokemonInput.addEventListener("input", applyFilters);

clearBtn.addEventListener("click", () => {
  threadSelect.value = "__all__";
  playerInput.value = "";
  pokemonInput.value = "";
  applyFilters();
});

main();
