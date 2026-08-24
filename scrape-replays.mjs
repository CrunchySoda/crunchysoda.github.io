/*
 * scrape-replays.mjs — local scraper for the ZU replay archive.
 *
 * Port of the Pipedream "scrape_replays" + "commit_test" steps into one
 * standalone Node 18+ script. Same data model, same safety rules:
 *
 *   - Scans EVERY page of EVERY configured Smogon thread.
 *   - Normalizes thread URLs (strips #post-... fragments) before paginating.
 *   - Fetches Pokemon Showdown logs ONLY for new or broken replays.
 *   - Merges into the existing dataset; existing rows are never dropped.
 *   - Refuses to shrink test.json under any circumstances.
 *   - Transient failures (429/5xx/network) retry with backoff; if retries
 *     are exhausted the run aborts BEFORE anything is written.
 *
 * Usage (PowerShell, from the repo folder):
 *
 *   node .\scrape-replays.mjs --dry-run    # discovery only, writes nothing
 *   node .\scrape-replays.mjs              # updates local test.json
 *   node .\scrape-replays.mjs --push       # also commits test.json to GitHub
 *
 * --push needs $env:GITHUB_TOKEN (fine-grained, Contents: read/write).
 * GITHUB_OWNER / GITHUB_REPO default to CrunchySoda / crunchysoda.github.io.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const THREAD_GROUPS = {
  "ZU CIRCUIT": [
    "https://www.smogon.com/forums/threads/2025-zu-circuit-championship-round-of-16-300-prize-pool.3775270/",
    "https://www.smogon.com/forums/threads/2025-zu-circuit-championship-quarterfinals-300-prize-pool.3775582/",
    "https://www.smogon.com/forums/threads/2025-zu-circuit-championship-semifinals-300-prize-pool.3775834/",
    "https://www.smogon.com/forums/threads/2025-zu-circuit-championship-finals-300-prize-pool-won-by-diegoyuhhi-again.3776340/",
  ],

  "ZU OPEN": [
    "https://www.smogon.com/forums/threads/zu-open-round-1.3776292/",
    "https://www.smogon.com/forums/threads/zu-open-round-2.3776635/",
    "https://www.smogon.com/forums/threads/zu-open-round-3.3776964/",
    "https://www.smogon.com/forums/threads/zu-open-round-4.3777310/",
    "https://www.smogon.com/forums/threads/zu-open-round-5.3777610/",
    "https://www.smogon.com/forums/threads/zu-open-round-6.3777890/",
    "https://www.smogon.com/forums/threads/zu-open-round-7.3778110/",
  ],

  "USA v WORLD": [
    "https://www.smogon.com/forums/threads/usa-vs-world-won-by-world.3775385/",
  ],

  "ZUCL": [
    "https://www.smogon.com/forums/threads/zucl-i-week-one.3776901/",
    "https://www.smogon.com/forums/threads/zucl-i-week-two.3777238/",
    "https://www.smogon.com/forums/threads/zucl-i-week-three.3777566/",
    "https://www.smogon.com/forums/threads/zucl-i-week-four.3777832/",
    "https://www.smogon.com/forums/threads/zucl-i-week-five.3778188/",
  ],

  "ZUWC": [
    "https://www.smogon.com/forums/threads/zuwc-iii-pools.3781164/",
    "https://www.smogon.com/forums/threads/zuwc-iii-quarterfinals.3782966/",
    "https://www.smogon.com/forums/threads/zuwc-iii-play-ins.3782389/",
    "https://www.smogon.com/forums/threads/zuwc-iii-finals-won-by-united-kingdom.3783580/",
    "https://www.smogon.com/forums/threads/zuwc-iii-semifinals.3783352/",
  ],

  "ZU Seasonal": [
    "https://www.smogon.com/forums/threads/zu-seasonal-round-2.3784324/#post-11039010",
    "https://www.smogon.com/forums/threads/zu-seasonal-round-1.3783965/",
    "https://www.smogon.com/forums/threads/zu-seasonal-round-3-losers-only.3784635/",
    "https://www.smogon.com/forums/threads/zu-seasonal-round-4-charizard-is-banned.3784964/",
    "https://www.smogon.com/forums/threads/zu-seasonal-round-5-losers-only.3785245/",
    "https://www.smogon.com/forums/threads/zu-seasonal-round-6-frosmoth-is-banned-unburden-is-unbanned.3785574/",
    "https://www.smogon.com/forums/threads/zu-seasonal-round-7-losers-only-frosmoth-is-banned-unburden-is-unbanned.3785945/",
    "https://www.smogon.com/forums/threads/zu-seasonal-round-8.3786262/",
    "https://www.smogon.com/forums/threads/zu-seasonal-round-9-losers-only.3786643/",
    "https://www.smogon.com/forums/threads/zu-seasonal-round-10.3786966/",
  ],

  "ZUPL": [
    "https://www.smogon.com/forums/threads/zupl-viii-week-one-frosmoth-banned-unburden-unbanned-in-sv-magnemite-banned-in-adv.3785557/",
    "https://www.smogon.com/forums/threads/zupl-viii-week-two.3785882/#post-11075304",
    "https://www.smogon.com/forums/threads/zupl-viii-week-three.3786208/",
    "https://www.smogon.com/forums/threads/zupl-viii-week-4.3786604/",
    "https://www.smogon.com/forums/threads/zupl-viii-week-5.3786915/",
    "https://www.smogon.com/forums/threads/zupl-viii-week-six.3787277/",
  ],
};

const NORMAL_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36",
  "Accept": "text/html,application/json,text/plain,*/*",
};

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function requestWithRetry(url, options = {}, maxAttempts = 5) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, { redirect: "follow", ...options });

      if (res.ok) {
        return res;
      }

      const body = (await res.text()).slice(0, 300);
      const error = new Error(
        `HTTP ${res.status} for ${url}${body ? `: ${body}` : ""}`
      );

      error.status = res.status;

      if (!RETRYABLE_STATUSES.has(res.status)) {
        throw error;
      }

      lastError = error;
    } catch (error) {
      if (error?.status && !RETRYABLE_STATUSES.has(error.status)) {
        throw error;
      }

      lastError = error;
    }

    if (attempt < maxAttempts) {
      const delay =
        Math.min(12000, 1000 * (2 ** (attempt - 1))) +
        Math.floor(Math.random() * 500);

      console.log(
        `Request failed. Retrying ${attempt + 1}/${maxAttempts} in ${delay}ms:`,
        url,
        lastError?.message
      );

      await sleep(delay);
    }
  }

  throw lastError ?? new Error(`Request failed for ${url}`);
}

async function fetchText(url, options = {}) {
  const res = await requestWithRetry(url, {
    headers: NORMAL_HEADERS,
    ...options,
  });

  return await res.text();
}

async function fetchJson(url, options = {}) {
  const res = await requestWithRetry(url, {
    headers: NORMAL_HEADERS,
    ...options,
  });

  return await res.json();
}

function normalizeThreadUrl(rawUrl) {
  const url = new URL(rawUrl);

  // Important: removes #post-... before adding /page-2.
  url.hash = "";
  url.search = "";

  let normalized = url.toString();

  if (!normalized.endsWith("/")) {
    normalized += "/";
  }

  return normalized;
}

function normalizeReplayUrl(rawUrl) {
  const match = String(rawUrl ?? "").match(
    /https:\/\/replay\.pokemonshowdown\.com\/(?:smogtours-)?gen9zu-[a-z0-9-]+/i
  );

  return match ? match[0] : "";
}

function replayKey(rawUrl) {
  return normalizeReplayUrl(rawUrl).toLowerCase();
}

function extractReplayLinks(html) {
  const matches =
    html.match(
      /https:\/\/replay\.pokemonshowdown\.com\/(?:smogtours-)?gen9zu-[a-z0-9-]+/gi
    ) ?? [];

  const links = new Map();

  for (const rawLink of matches) {
    const link = normalizeReplayUrl(rawLink);
    const key = replayKey(link);

    if (key && !links.has(key)) {
      links.set(key, link);
    }
  }

  return [...links.values()];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function detectTotalPages(html, threadUrl) {
  const baseUrl = new URL(threadUrl);
  const threadPath = baseUrl.pathname.replace(/\/$/, "");
  const escapedThreadPath = escapeRegExp(threadPath);

  let highestPage = 1;

  /*
   * Read numbered pagination links belonging specifically to this thread.
   * This avoids accidentally reading page links to another thread inside a post.
   */
  const hrefRegex = /href\s*=\s*(["'])(.*?)\1/gi;

  for (const match of html.matchAll(hrefRegex)) {
    const rawHref = match[2].replace(/&amp;/g, "&");

    try {
      const linkedUrl = new URL(rawHref, threadUrl);

      const pageMatch = linkedUrl.pathname.match(
        new RegExp(`^${escapedThreadPath}/page-(\\d+)/?$`, "i")
      );

      if (!pageMatch) continue;

      const pageNumber = Number(pageMatch[1]);

      if (Number.isInteger(pageNumber)) {
        highestPage = Math.max(highestPage, pageNumber);
      }
    } catch {
      // Ignore malformed href attributes.
    }
  }

  /*
   * XenForo also commonly includes a mobile indicator such as "1 of 2".
   * Use that as an additional check.
   */
  const simplePageMatch = html.match(
    /pageNavSimple-el--current[^>]*>\s*(\d+)\s+of\s+(\d+)\s*</i
  );

  if (simplePageMatch) {
    const statedTotal = Number(simplePageMatch[2]);

    if (Number.isInteger(statedTotal)) {
      highestPage = Math.max(highestPage, statedTotal);
    }
  }

  if (highestPage > 100) {
    throw new Error(
      `Suspicious page count detected for ${threadUrl}: ${highestPage}`
    );
  }

  return highestPage;
}

async function getAllReplayLinks(rawThreadUrl) {
  const threadUrl = normalizeThreadUrl(rawThreadUrl);
  const replayLinks = new Map();

  let totalPages = 1;
  let pagesScanned = 0;

  for (let page = 1; page <= totalPages; page++) {
    if (page > 1) {
      await sleep(400);
    }

    const pageUrl = page === 1 ? threadUrl : `${threadUrl}page-${page}`;

    const html = await fetchText(pageUrl);
    pagesScanned++;

    // Re-check on every page in case the thread grew during the run.
    totalPages = Math.max(totalPages, detectTotalPages(html, threadUrl));

    const pageLinks = extractReplayLinks(html);

    for (const link of pageLinks) {
      const key = replayKey(link);

      if (key && !replayLinks.has(key)) {
        replayLinks.set(key, link);
      }
    }

    console.log(
      `Thread page ${page}/${totalPages}:`,
      pageUrl,
      `found ${pageLinks.length} Gen 9 ZU links,`,
      `thread total: ${replayLinks.size}`
    );
  }

  return {
    links: [...replayLinks.values()],
    pagesScanned,
  };
}

function ensurePlayer(teams, pid) {
  if (!teams[pid]) {
    teams[pid] = { name: pid, team: [] };
  }

  if (!Array.isArray(teams[pid].team)) {
    teams[pid].team = [];
  }

  if (!teams[pid].name) {
    teams[pid].name = pid;
  }

  return teams[pid];
}

function isPlaceholderName(name, pid) {
  const normalizedName = String(name ?? "").trim().toLowerCase();
  const normalizedPid = String(pid ?? "").trim().toLowerCase();

  return (
    !normalizedName ||
    normalizedName === normalizedPid ||
    normalizedName === "p1" ||
    normalizedName === "p2" ||
    normalizedName === "p1a" ||
    normalizedName === "p2a"
  );
}

function parseReplayLog(logText) {
  const parsed = {
    winner: null,
    teams: {},
  };

  for (const line of logText.split("\n")) {
    if (!line) continue;

    const parts = line.split("|");

    if (parts.length < 2) continue;

    const kind = parts[1];

    if (kind === "player") {
      const pid = parts[2];
      const name = parts[3] ?? pid;
      const player = ensurePlayer(parsed.teams, pid);

      if (!isPlaceholderName(name, pid)) {
        player.name = String(name).trim();
      }

      continue;
    }

    if (kind === "poke") {
      const pid = parts[2];
      const mon = parts[3];
      const player = ensurePlayer(parsed.teams, pid);

      if (mon && player.team.length < 6) {
        player.team.push(mon);
      }

      continue;
    }

    if (kind === "win") {
      parsed.winner = parts[2] ? String(parts[2]).trim() : null;

      continue;
    }
  }

  for (const pid of Object.keys(parsed.teams)) {
    parsed.teams[pid].team = [...new Set(parsed.teams[pid].team)]
      .slice(0, 6)
      .sort();

    if (!parsed.teams[pid].name) {
      parsed.teams[pid].name = pid;
    }
  }

  return parsed;
}

function mergeNamesFromJson(parsed, meta) {
  if (!meta || !parsed?.teams) {
    return parsed;
  }

  const p1 = meta.p1 ?? meta.player1 ?? meta.players?.[0] ?? meta.users?.[0];
  const p2 = meta.p2 ?? meta.player2 ?? meta.players?.[1] ?? meta.users?.[1];

  const p1Name = typeof p1 === "string" ? p1 : p1?.name;
  const p2Name = typeof p2 === "string" ? p2 : p2?.name;

  if (parsed.teams.p1 && isPlaceholderName(parsed.teams.p1.name, "p1") && p1Name) {
    parsed.teams.p1.name = String(p1Name).trim();
  }

  if (parsed.teams.p2 && isPlaceholderName(parsed.teams.p2.name, "p2") && p2Name) {
    parsed.teams.p2.name = String(p2Name).trim();
  }

  return parsed;
}

function parsedReplayIsUsable(parsed) {
  if (!parsed || !parsed.teams) {
    return false;
  }

  const teams = Object.values(parsed.teams);

  if (teams.length < 2) {
    return false;
  }

  return teams.every(team => {
    return Array.isArray(team?.team) && team.team.length > 0;
  });
}

function existingItemIsUsable(item) {
  return Boolean(replayKey(item?.link) && parsedReplayIsUsable(item));
}

async function getTeamContents(replayUrl) {
  let logText;

  try {
    logText = await fetchText(`${replayUrl}.log`);
  } catch (error) {
    if (error?.status === 404 || error?.status === 410) {
      return {
        unavailable: true,
        reason: `HTTP ${error.status}`,
      };
    }

    // A temporary/network failure aborts the run after retries.
    throw error;
  }

  if (!logText.includes("|player|") || !logText.includes("|poke|")) {
    return {
      unavailable: true,
      reason: "Replay log did not contain player/team data",
    };
  }

  const parsed = parseReplayLog(logText);

  if (!parsedReplayIsUsable(parsed)) {
    return {
      unavailable: true,
      reason: "Replay log could not be parsed into two teams",
    };
  }

  const needsFallback =
    (parsed.teams.p1 && isPlaceholderName(parsed.teams.p1.name, "p1")) ||
    (parsed.teams.p2 && isPlaceholderName(parsed.teams.p2.name, "p2"));

  if (needsFallback) {
    try {
      const meta = await fetchJson(`${replayUrl}.json`);
      mergeNamesFromJson(parsed, meta);
    } catch (error) {
      console.log(
        "Replay JSON name fallback failed:",
        replayUrl,
        error?.message
      );
    }
  }

  return {
    unavailable: false,
    parsed,
  };
}

/* ------------------------------------------------------------------ */
/* Local file + GitHub helpers                                        */
/* ------------------------------------------------------------------ */

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_TEST_JSON = path.join(SCRIPT_DIR, "test.json");

function githubConfig() {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER || "CrunchySoda";
  const repo = process.env.GITHUB_REPO || "crunchysoda.github.io";

  return { token, owner, repo };
}

function parseExistingText(existingText, sourceLabel) {
  let existingData;

  try {
    existingData = JSON.parse(existingText);
  } catch {
    throw new Error(`Existing ${sourceLabel} test.json is not valid JSON`);
  }

  if (!Array.isArray(existingData)) {
    throw new Error(`Existing ${sourceLabel} test.json is not an array`);
  }

  return existingData;
}

function loadExistingDataFromLocal() {
  if (!fs.existsSync(LOCAL_TEST_JSON)) {
    return { existingData: [], existingText: "[]" };
  }

  const existingText = fs.readFileSync(LOCAL_TEST_JSON, "utf8");
  const existingData = parseExistingText(existingText, "local");

  return { existingData, existingText };
}

async function loadExistingDataFromGithub() {
  const { token, owner, repo } = githubConfig();

  if (!token) throw new Error("Missing GITHUB_TOKEN (required for --push)");

  const url = `https://api.github.com/repos/${owner}/${repo}/contents/test.json`;

  const headers = {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "ZU-Replay-Archive",
  };

  let res;

  try {
    res = await requestWithRetry(url, { headers });
  } catch (error) {
    if (error?.status === 404) {
      return { existingData: [], existingText: "[]", sha: undefined };
    }

    throw error;
  }

  const fileData = await res.json();
  let existingText = "";

  if (fileData.content) {
    existingText = Buffer.from(fileData.content, "base64").toString("utf8");
  } else if (fileData.download_url) {
    existingText = await fetchText(fileData.download_url);
  } else {
    throw new Error(
      "GitHub returned test.json without content or download_url"
    );
  }

  const existingData = parseExistingText(existingText, "GitHub");

  return { existingData, existingText, sha: fileData.sha };
}

async function pushToGithub(jsonText, sha, addedCount, repairedCount, total) {
  const { token, owner, repo } = githubConfig();

  const headers = {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "ZU-Replay-Archive",
  };

  const fileUrl = `https://api.github.com/repos/${owner}/${repo}/contents/test.json`;

  const body = {
    message:
      `Update test.json: +${addedCount} new, ` +
      `${repairedCount} repaired, ${total} total`,
    content: Buffer.from(jsonText, "utf8").toString("base64"),
  };

  if (sha) {
    body.sha = sha;
  }

  /*
   * The sha acts as compare-and-swap: if something else (e.g. Pipedream)
   * committed test.json since we read it, GitHub answers 409 and we abort
   * instead of clobbering the newer version.
   */
  const putRes = await requestWithRetry(fileUrl, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });

  return await putRes.json();
}

/* ------------------------------------------------------------------ */
/* Main                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const push = argv.includes("--push");

  const unknown = argv.filter(a => a !== "--dry-run" && a !== "--push");

  if (unknown.length > 0) {
    console.error("Unknown argument(s):", unknown.join(" "));
    console.error("Usage: node scrape-replays.mjs [--dry-run] [--push]");
    process.exit(2);
  }

  if (dryRun && push) {
    console.error("--dry-run and --push cannot be combined.");
    process.exit(2);
  }

  console.log(
    `Mode: ${dryRun ? "DRY RUN (no writes)" : push ? "LIVE + push to GitHub" : "LIVE (local test.json only)"}`
  );

  /*
   * When pushing, GitHub is the source of truth we merge against (and its
   * sha protects us from clobbering a concurrent Pipedream run).
   * Otherwise merge against the local file.
   */
  const source = push
    ? await loadExistingDataFromGithub()
    : loadExistingDataFromLocal();

  const { existingData, existingText } = source;

  const existingUsableKeys = new Set(
    existingData
      .filter(existingItemIsUsable)
      .map(item => replayKey(item.link))
      .filter(Boolean)
  );

  console.log(
    `Existing test.json (${push ? "GitHub" : "local"}): ${existingData.length} entries,`,
    `${existingUsableKeys.size} usable unique replay links`
  );

  /*
   * Scan every numbered page of every configured thread.
   * Any temporary forum failure throws and stops the run before any write.
   */
  const jobsByKey = new Map();

  let scannedThreads = 0;
  let scannedPages = 0;

  for (const [tournament, threads] of Object.entries(THREAD_GROUPS)) {
    for (const rawThreadUrl of threads) {
      const threadUrl = normalizeThreadUrl(rawThreadUrl);
      const result = await getAllReplayLinks(threadUrl);

      scannedThreads++;
      scannedPages += result.pagesScanned;

      for (const replayUrl of result.links) {
        const key = replayKey(replayUrl);

        if (!key || jobsByKey.has(key)) {
          continue;
        }

        jobsByKey.set(key, {
          tournament,
          thread_url: threadUrl,
          link: replayUrl,
        });
      }

      await sleep(400);
    }
  }

  const discoveredJobs = [...jobsByKey.values()];

  const newJobs = discoveredJobs.filter(job => {
    return !existingUsableKeys.has(replayKey(job.link));
  });

  console.log("Discovery summary:", {
    scannedThreads,
    scannedPages,
    discoveredUniqueLinks: discoveredJobs.length,
    existingEntries: existingData.length,
    newOrRepairJobs: newJobs.length,
  });

  if (dryRun) {
    console.log("\nDRY RUN — replays that WOULD be fetched:");

    if (newJobs.length === 0) {
      console.log("  (none — dataset is up to date)");
    }

    for (const job of newJobs) {
      console.log(`  [${job.tournament}] ${job.link}`);
    }

    console.log("\nDry run complete. Nothing was written.");
    return;
  }

  /*
   * Only download missing/broken replay logs.
   */
  const newItems = [];
  const unavailableLinks = [];

  for (let index = 0; index < newJobs.length; index++) {
    const job = newJobs[index];

    console.log(`Fetching replay ${index + 1}/${newJobs.length}:`, job.link);

    const result = await getTeamContents(job.link);

    if (result.unavailable) {
      console.log("Replay unavailable; skipping:", job.link, result.reason);

      unavailableLinks.push({ link: job.link, reason: result.reason });

      continue;
    }

    newItems.push({
      tournament: job.tournament,
      thread_url: job.thread_url,
      link: job.link,
      winner: result.parsed.winner,
      teams: result.parsed.teams,
    });

    await sleep(200);
  }

  /*
   * Merge. Preserve every existing row; new rows are appended; an existing
   * replay that was re-scraped (broken data) is replaced in place.
   */
  const finalData = [...existingData];
  const existingIndexByKey = new Map();

  for (let index = 0; index < finalData.length; index++) {
    const key = replayKey(finalData[index]?.link);

    if (key) {
      existingIndexByKey.set(key, index);
    }
  }

  let addedCount = 0;
  let repairedCount = 0;

  for (const item of newItems) {
    const key = replayKey(item.link);

    if (existingIndexByKey.has(key)) {
      finalData[existingIndexByKey.get(key)] = item;
      repairedCount++;
    } else {
      existingIndexByKey.set(key, finalData.length);
      finalData.push(item);
      addedCount++;
    }
  }

  /*
   * One-time hygiene: normalize any historical thread_url still carrying a
   * #post-... fragment. Row count and replay links are untouched.
   */
  let normalizedThreadUrls = 0;

  for (const item of finalData) {
    if (typeof item?.thread_url === "string" && /[#?]/.test(item.thread_url)) {
      try {
        const normalized = normalizeThreadUrl(item.thread_url);

        if (normalized !== item.thread_url) {
          item.thread_url = normalized;
          normalizedThreadUrls++;
        }
      } catch {
        // Leave unparseable values as-is.
      }
    }
  }

  /*
   * Absolute safety check: this script is never allowed to shrink test.json.
   */
  if (finalData.length < existingData.length) {
    throw new Error(
      `Refusing to shrink test.json from ${existingData.length} to ${finalData.length}`
    );
  }

  const jsonText = JSON.stringify(finalData);

  const hash = text => crypto.createHash("sha256").update(text).digest("hex");

  if (hash(jsonText) === hash(existingText)) {
    console.log("No data change; nothing to write.");

    console.log("Summary:", {
      previousCount: existingData.length,
      finalCount: finalData.length,
      addedCount,
      repairedCount,
      normalizedThreadUrls,
      unavailableCount: unavailableLinks.length,
    });

    return;
  }

  // Always update the local file on a live run.
  fs.writeFileSync(LOCAL_TEST_JSON, jsonText, "utf8");
  console.log(`Wrote ${finalData.length} entries to ${LOCAL_TEST_JSON}`);

  if (push) {
    const putResult = await pushToGithub(
      jsonText,
      source.sha,
      addedCount,
      repairedCount,
      finalData.length
    );

    console.log(
      "Committed to GitHub:",
      putResult?.commit?.sha ?? "(no commit sha in response)"
    );
  }

  console.log("Summary:", {
    previousCount: existingData.length,
    finalCount: finalData.length,
    addedCount,
    repairedCount,
    normalizedThreadUrls,
    unavailableCount: unavailableLinks.length,
    unavailableLinks,
    pushedToGithub: push,
  });
}

main().catch(error => {
  console.error("\nRun FAILED safely (nothing overwritten):", error?.message);
  process.exit(1);
});
