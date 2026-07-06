import { world, system, Player } from "@minecraft/server";
import { Bridge } from "./bridge.js";

// This addon supplies its OWN Mongo connection details. The bridge server
// just needs to be reachable (and share the apiKey if it has auth enabled).
const db = new Bridge({
  baseUrl: "http://127.0.0.1:3000",
  mongoUri: "mongodb+srv://user:pass@cluster.mongodb.net",
  database: "my_addon",
  // apiKey: "..."  // only needed if the bridge server has auth enabled
});

/** Load (or create) a player's saved data when they first spawn in. */
world.afterEvents.playerSpawn.subscribe(async (event) => {
  if (!event.initialSpawn) return;
  const player = event.player;

  try {
    let record = await db.get("players", { name: player.name });

    if (!record) {
      await db.write("players", { name: player.name, coins: 0, joins: 1 });
      record = { name: player.name, coins: 0, joins: 1 };
    } else {
      await db.update("players", { name: player.name }, { $inc: { joins: 1 } });
    }

    player.sendMessage(`§aWelcome! Coins: ${record.coins}, joins: ${record.joins}`);
  } catch (err) {
    console.warn(`[bridge] failed to load ${player.name}: ${err}`);
  }
});

/**
 * Command: run  /scriptevent bridge:coins 50  in-game (or from a command block)
 * to add coins to the player who ran it. scriptEventReceive is a stable API,
 * unlike the beta chat events.
 */
system.afterEvents.scriptEventReceive.subscribe(async (event) => {
  if (event.id !== "bridge:coins") return;

  const player = event.sourceEntity;
  if (!(player instanceof Player)) return;

  const amount = Number(event.message.trim());
  if (!Number.isFinite(amount)) return;

  const name = player.name;
  try {
    await db.update("players", { name }, { $inc: { coins: amount } }, { upsert: true });
    const record = await db.get("players", { name });
    player.sendMessage(`§eCoins now: ${record?.coins ?? 0}`);
  } catch (err) {
    console.warn(`[bridge] coins update failed: ${err}`);
  }
});
