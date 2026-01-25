import requests
import sys
from tqdm.auto import tqdm
from bs4 import BeautifulSoup
import json
import time

urlList = [
    "https://www.smogon.com/forums/threads/2025-zu-circuit-championship-round-of-16-300-prize-pool.3775270/",
    "https://www.smogon.com/forums/threads/2025-zu-circuit-championship-quarterfinals-300-prize-pool.3775582/",
    "https://www.smogon.com/forums/threads/2025-zu-circuit-championship-semifinals-300-prize-pool.3775834/",
    "https://www.smogon.com/forums/threads/2025-zu-circuit-championship-finals-300-prize-pool-won-by-diegoyuhhi-again.3776340/",
    "https://www.smogon.com/forums/threads/zu-open-round-2.3776635/",
    "https://www.smogon.com/forums/threads/zu-open-round-1.3776292/",
    "https://www.smogon.com/forums/threads/usa-vs-world-won-by-world.3775385/"
]

def get_team_contents(url: str):
    headers = {"User-Agent": "PostmanRuntime/7.32.3"}
    driver = {"headers": [headers]}
    req = requests.get(f"{url}.log", headers=headers)

    if req.status_code != 200:
        return None

    data = {}

    for line in req.content.decode("utf-8").split(sep="\n"):
        parsed = line.split(sep="|")
        if len(parsed) < 2:
            continue
        if parsed[1] == "player":
            tqdm.write(f"Found player {parsed[2]} with name {parsed[3]}")
            if parsed[2] in data:
                continue

            data[parsed[2]] = {
                "name": parsed[3],
                "team": [],
            }
            continue
        if parsed[1] != "poke":
            continue


        tqdm.write(f"Found pokemon {parsed[3]} owned by {parsed[2]}")
        data[parsed[2]]["team"].append(parsed[3])
        if len(data[parsed[2]]["team"]) == 6:
            data[parsed[2]]["team"].sort()


    return data

def get_all_replay_links(url: str):
    correct_links = []
    page = 1
    origUrl = url
    lastTitle = ""
    while True:
        try:
            headers = {"User-Agent": "PostmanRuntime/7.32.3"}
            driver = {"headers": [headers]}
            req = requests.get(f"{url}.log", headers=headers)

            print(req)

            soup = BeautifulSoup(req.content, "html.parser")
            
            title = soup.find_all("title")

            if title == lastTitle:
                return correct_links
            lastTitle = title

            links = soup.find_all("a", href=True)
            
            for link in links:
                if not ("https://replay.pokemonshowdown.com/smogtours-gen9zu" in link["href"] or "https://replay.pokemonshowdown.com/gen9zu" in link["href"]):
                    continue
                if correct_links.count(link["href"]) > 0:
                    continue
                
                correct_links.append(link["href"].split("?")[0])
            page += 1
            url = origUrl + "page-" + str(page)
            
            
        except:
            return correct_links

links = []

for url in urlList:
    links = links + get_all_replay_links(url)

for x in links:
    print(x)
tqdm.write(f"Found {len(links)} links")

if len(links) > 0:
    output = []

    links.reverse()
    
    for link in tqdm(links, colour="green", desc="Fetching teams.."):
        teamcontents = get_team_contents(link)
    
        while teamcontents == {}:
            time.sleep(0.5)
            teamcontents = get_team_contents(link)
    
            if teamcontents == None:
                continue
    
        if teamcontents == None:
            continue
    
        output.append({
            "link": link,
            "teams": teamcontents
        })
    
    # print(json.dumps(output))
    # print(output)
    
    f = open("test.json", "w")
    f.write(json.dumps(output))
    f.close()
    
    # testing
    # print(get_team_contents("https://replay.pokemonshowdown.com/gen81v1-1907362871"))
