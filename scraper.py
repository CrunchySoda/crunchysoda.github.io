import requests
from tqdm.auto import tqdm
from bs4 import BeautifulSoup
import json
import time

# Tournament -> list of Smogon thread URLs
THREAD_GROUPS = {
    "ZU CIRCUIT": [
        "https://www.smogon.com/forums/threads/2025-zu-circuit-championship-round-of-16-300-prize-pool.3775270/",
        "https://www.smogon.com/forums/threads/2025-zu-circuit-championship-quarterfinals-300-prize-pool.3775582/",
        "https://www.smogon.com/forums/threads/2025-zu-circuit-championship-semifinals-300-prize-pool.3775834/",
        "https://www.smogon.com/forums/threads/2025-zu-circuit-championship-finals-300-prize-pool-won-by-diegoyuhhi-again.3776340/",
    ],
    "ZU OPEN": [
        "https://www.smogon.com/forums/threads/zu-open-round-1.3776292/",
        "https://www.smogon.com/forums/threads/zu-open-round-2.3776635/",
    ],
    "USA v WORLD": [
        "https://www.smogon.com/forums/threads/usa-vs-world-won-by-world.3775385/",
    ],
    "ZUCL": [
        "https://www.smogon.com/forums/threads/zucl-i-week-one.3776901/",
        "https://www.smogon.com/forums/threads/zucl-i-week-two.3777238/",
    ],
}

HEADERS = {"User-Agent": "Mozilla/5.0"}

def get_team_contents(replay_url: str):
    """
    replay_url example: https://replay.pokemonshowdown.com/gen9zu-123456
    log url becomes:    https://replay.pokemonshowdown.com/gen9zu-123456.log
    """
    try:
        req = requests.get(f"{replay_url}.log", headers=HEADERS, timeout=20)
    except Exception:
        return None

    if req.status_code != 200:
        return None

    data = {}

    for line in req.text.splitlines():
        parts = line.split("|")
        if len(parts) < 2:
            continue

        if parts[1] == "player":
            pid = parts[2]
            name = parts[3]
            if pid not in data:
                data[pid] = {"name": name, "team": []}
            continue

        if parts[1] == "poke":
            pid = parts[2]
            mon = parts[3]  # keep raw (e.g. "Froslass, F")
            if pid in data:
                data[pid]["team"].append(mon)
                if len(data[pid]["team"]) == 6:
                    data[pid]["team"].sort()

    return data

def get_all_replay_links(thread_url: str):
    """
    Scrape a Smogon thread for replay links across all pages.
    Pagination format: thread_url + "page-2", "page-3", etc.
    Stops when a page adds no new replay links.
    """
    replays = []
    page = 1

    while True:
        url = thread_url if page == 1 else f"{thread_url}page-{page}"

        try:
            req = requests.get(url, headers=HEADERS, timeout=20)
        except Exception:
            break

        if req.status_code != 200:
            break

        soup = BeautifulSoup(req.text, "html.parser")
        anchors = soup.find_all("a", href=True)

        before = len(replays)

        for a in anchors:
            href = a["href"]
            if (
                "https://replay.pokemonshowdown.com/smogtours-gen9zu" in href
                or "https://replay.pokemonshowdown.com/gen9zu" in href
            ):
                href = href.split("?")[0]
                if href not in replays:
                    replays.append(href)

        # If this page didn't add anything new, we reached the end (or no replays here)
        if len(replays) == before:
            break

        page += 1
        time.sleep(0.25)  # be polite to Smogon

    return replays

def main():
    replay_jobs = []

    # Collect replay links per tournament
    for tournament, thread_urls in THREAD_GROUPS.items():
        for thread_url in thread_urls:
            tqdm.write(f"Scraping {tournament}: {thread_url}")
            replay_links = get_all_replay_links(thread_url)

            for replay in replay_links:
                replay_jobs.append({
                    "tournament": tournament,
                    "thread_url": thread_url,
                    "replay": replay
                })

    tqdm.write(f"Found {len(replay_jobs)} total replay links")

    # Optional: reverse so older -> newer
    replay_jobs.reverse()

    output = []

    for item in tqdm(replay_jobs, colour="green", desc="Fetching teams.."):
        replay = item["replay"]
        teams = get_team_contents(replay)

        if teams is None:
            continue

        output.append({
            "tournament": item["tournament"],
            "thread_url": item["thread_url"],
            "link": replay,
            "teams": teams
        })

        time.sleep(0.15)  # be polite to Pokemon Showdown

    with open("test.json", "w", encoding="utf-8") as f:
        f.write(json.dumps(output))

    tqdm.write(f"Wrote {len(output)} replays to test.json")

if __name__ == "__main__":
    main()
