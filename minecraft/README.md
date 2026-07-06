# Minecraft addon client

Drop-in client for talking to a running **NetherGate Bridge** server from a
Bedrock **behaviour pack** script. Pick the language you write your addon in:

| You write your addon in… | Copy this file into your scripts |
| ------------------------ | -------------------------------- |
| **TypeScript**           | [`ts/bridge.ts`](ts/bridge.ts)   |
| **JavaScript**           | [`js/bridge.js`](js/bridge.js)   |

Both expose the exact same `Bridge` class and methods — `get`, `query`,
`write`, `update`, `delete`, `count`. The `example.*` file beside each shows a
working player-data setup.

## Requirements

`@minecraft/server-net` only runs on a **Bedrock Dedicated Server (BDS)**. Declare
it (and `@minecraft/server`) in your pack's `manifest.json`:

```json
{
  "dependencies": [
    { "module_name": "@minecraft/server",     "version": "2.0.0" },
    { "module_name": "@minecraft/server-net",  "version": "1.0.0-beta" }
  ]
}
```

## Usage

```js
import { Bridge } from "./bridge.js";

const db = new Bridge({
  baseUrl: "http://127.0.0.1:3000",
  mongoUri: "mongodb+srv://user:pass@cluster.mongodb.net",
  database: "my_addon",
  // apiKey: "..."  // only if the bridge server has auth enabled
});

await db.write("players", { name: "Steve", coins: 100 });
const steve = await db.get("players", { name: "Steve" });
await db.update("players", { name: "Steve" }, { $inc: { coins: 10 } });
```

> **Version note:** the `HttpRequestMethod` enum member is `.POST` in some
> `@minecraft/server-net` versions and `.Post` in others. If you get an error on
> that line, flip the casing to match your installed version.
