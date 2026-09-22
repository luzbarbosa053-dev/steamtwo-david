import { mockGames, mockUpdatedAt } from "../mock/games.js";

const storeMatches = (game, store) =>
  store === "all" || (store === "both" ? ["steam", "epic"].every((name) => game.stores.some((listing) => listing.store === name)) : game.stores.some((listing) => listing.store === store));

function rankingView(game, index, field = "score", updatedAt = mockUpdatedAt) {
  return {
    ...game,
    rank: index + 1,
    score: Number(game[field].toFixed(1)),
    metric:
      field === "historicalPopularity"
        ? { type: "popularity", value: game[field], label: "Popularidade histórica" }
        : { type: "players", value: game.currentPlayers, label: "Jogadores Steam" },
    source: field === "historicalPopularity" ? "igdb" : "steamtwo",
    updatedAt,
  };
}

export function createCatalogService({ repository, liveSource } = {}) {
  const source = repository ?? liveSource ?? {
    async listGames() {
      return mockGames;
    },
  };

  const isLive = Boolean(liveSource && !repository);
  const sourceStatus = () => isLive ? liveSource.status() : { steam: "fresh", epic: "fresh", igdb: "fresh" };
  const currentTimestamp = () => isLive ? new Date().toISOString() : mockUpdatedAt;
  const listGames = async () => {
    const games = await source.listGames();
    return games.length || !isLive ? games : mockGames;
  };

  return {
    async dashboard({ store = "all" } = {}) {
      const games = (await listGames()).filter((game) => storeMatches(game, store));
      const current = [...games].sort((a, b) => b.score - a.score);
      const week = current.slice(0, 5).map((game, index) => rankingView(game, index, "score", currentTimestamp()));
      const allTimeField = isLive ? "score" : "historicalPopularity";
      const allTime = [...games]
        .sort((a, b) => b[allTimeField] - a[allTimeField])
        .slice(0, 5)
        .map((game, index) => rankingView(game, index, allTimeField, currentTimestamp()));
      const featuredGame = games.find((game) => game.slug === "elden-ring");
      const hero = featuredGame
        ? rankingView(featuredGame, current.findIndex((game) => game.id === featuredGame.id), "score", currentTimestamp())
        : (week[0] ?? null);

      return {
        hero,
        topFive: week,
        week,
        allTime,
        records: allTime.slice(0, 1).map((game) => ({
          type: "historical-score",
          label: isLive ? "Maior índice ao vivo" : "Maior índice SteamTwo",
          value: game.score,
          game,
          achievedAt: "2026-08-24T12:00:00.000Z",
        })),
        updatedAt: currentTimestamp(),
        sourceStatus: sourceStatus(),
        isFallback: !repository && !isLive,
      };
    },

    async rankings({ period = "now", store = "all", page = 1, limit = 20 } = {}) {
      const games = (await listGames()).filter((game) => storeMatches(game, store));
      const field = period === "all-time" && !isLive ? "historicalPopularity" : "score";
      const ranked = games
        .sort((a, b) => b[field] - a[field])
        .map((game, index) => rankingView(game, index, field, currentTimestamp()));
      const start = (page - 1) * limit;
      return {
        items: ranked.slice(start, start + limit),
        pagination: { page, limit, total: ranked.length, pages: Math.ceil(ranked.length / limit) },
        period,
        store,
        updatedAt: currentTimestamp(),
        sourceStatus: sourceStatus(),
      };
    },

    async games({ q = "", genre, store = "all", sort = "popularity", page = 1, limit = 12 } = {}) {
      const normalizedQuery = q.trim().toLocaleLowerCase("pt-BR");
      let games = (await listGames()).filter((game) => {
        const matchesQuery = !normalizedQuery || game.title.toLocaleLowerCase("pt-BR").includes(normalizedQuery);
        const matchesGenre = !genre || game.genres.some((item) => item.toLocaleLowerCase("pt-BR") === genre.toLocaleLowerCase("pt-BR"));
        return matchesQuery && matchesGenre && storeMatches(game, store);
      });
      games = [...games].sort((a, b) =>
        sort === "name" ? a.title.localeCompare(b.title, "pt-BR") : b.score - a.score,
      );
      const start = (page - 1) * limit;
      return {
        items: games.slice(start, start + limit),
        pagination: { page, limit, total: games.length, pages: Math.ceil(games.length / limit) },
        filters: { q, genre: genre ?? null, store, sort },
      };
    },

    async game(slug) {
      const game = (await listGames()).find((item) => item.slug === slug);
      return game ? { ...game, updatedAt: currentTimestamp() } : null;
    },

    async compare({ slugs = [] } = {}) {
      const games = await listGames();
      const selected = slugs.map((slug) => games.find((game) => game.slug === slug));
      if (selected.some((game) => !game)) {
        const missing = slugs.filter((slug) => !games.some((game) => game.slug === slug));
        const error = new Error("Jogo não encontrado");
        error.status = 404;
        error.details = { missing };
        throw error;
      }
      return { items: selected.map((game) => ({ ...game, updatedAt: currentTimestamp() })) };
    },
  };
}
