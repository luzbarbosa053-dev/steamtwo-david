import { createEpicClient, createSteamClient } from "../integrations/index.js";
import { toSlug } from "../integrations/normalizers.js";

const cacheTtlMs = 60_000;

function titleKey(value = "") {
  return toSlug(value).replace(/-the-|-game-|-edition-/g, "-");
}

function steamCover(appId, file = "library_600x900_2x.jpg") {
  return appId ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/${file}` : null;
}

function listing(entry) {
  return {
    store: entry.store,
    externalId: entry.externalId,
    url: entry.url ?? (entry.store === "steam"
      ? `https://store.steampowered.com/app/${encodeURIComponent(entry.externalId)}`
      : `https://store.epicgames.com/p/${encodeURIComponent(entry.externalId)}`),
  };
}

function score(rank, total) {
  return Number((100 * (total - rank + 1) / total).toFixed(1));
}

export function createLiveCatalogSource({ steam, epic, now = () => Date.now() } = {}) {
  const steamClient = steam ?? createSteamClient();
  const epicClient = epic ?? createEpicClient();
  let cache = null;
  let cacheExpiresAt = 0;
  let lastStatus = { steam: "unknown", epic: "unknown", provider: "web" };

  return {
    async listGames() {
      if (cache && now() < cacheExpiresAt) return cache;
      const [steamResult, epicResult] = await Promise.allSettled([
        steamClient.getMostPlayedGames({ limit: 100 }),
        epicClient.getMostPlayedGames(),
      ]);
      const steamEntries = steamResult.status === "fulfilled" ? steamResult.value : [];
      const epicEntries = epicResult.status === "fulfilled" ? epicResult.value : [];
      lastStatus = {
        steam: steamResult.status === "fulfilled" && steamEntries.length ? "live" : "unavailable",
        epic: epicResult.status === "fulfilled" && epicEntries.length ? "live" : "unavailable",
        provider: "web",
      };
      const totalByStore = { steam: steamEntries.length, epic: epicEntries.length };
      const gamesByTitle = new Map();

      for (const entry of [...steamEntries, ...epicEntries]) {
        const key = titleKey(entry.title);
        if (!key) continue;
        const current = gamesByTitle.get(key) ?? {
          id: `${entry.store}-${entry.externalId}`,
          slug: toSlug(entry.title),
          title: entry.title,
          summary: "Dados coletados ao vivo das lojas digitais.",
          coverUrl: null,
          heroUrl: null,
          genres: [],
          stores: [],
          trend: null,
          currentPlayers: null,
          historicalPopularity: 0,
          _scores: [],
        };
        current.stores = [...current.stores.filter((store) => store.store !== entry.store), listing(entry)];
        current._scores.push(score(entry.rank, totalByStore[entry.store] || 1));
        if (entry.store === "steam") {
          current.coverUrl = current.coverUrl ?? steamCover(entry.externalId);
          current.heroUrl = current.heroUrl ?? steamCover(entry.externalId, "library_hero.jpg");
          current.currentPlayers = entry.metric ?? null;
        }
        gamesByTitle.set(key, current);
      }

      const games = [...gamesByTitle.values()].map(({ _scores, ...game }) => ({
        ...game,
        score: Number((_scores.reduce((sum, value) => sum + value, 0) / (_scores.length || 1)).toFixed(1)),
      })).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
      cache = games;
      cacheExpiresAt = now() + cacheTtlMs;
      return games;
    },

    status() {
      return lastStatus;
    },
  };
}
