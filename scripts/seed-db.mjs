import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const file = "db/seed.sql";
const client = createClient({
  url: process.env.TURSO_DATABASE_URL ?? "file:db/keynesian-beauty-contest.dev.db",
  authToken: process.env.TURSO_AUTH_TOKEN || undefined,
});

try {
  await client.executeMultiple(await readFile(resolve(projectRoot, file), "utf8"));
  console.log(`Applied ${file}`);
} finally {
  client.close();
}
