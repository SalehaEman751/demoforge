import { installCrashGuards, loadEnv, startServer } from "./app.js";

loadEnv();
installCrashGuards();

try {
  const { url } = await startServer({
    port: Number(process.env.PORT ?? 4000),
    host: process.env.HOST ?? "localhost",
    logger: true,
  });
  console.log(`[api] DemoForge API listening on ${url}  (health: ${url}/api/health)`);
} catch (err) {
  console.error("[api] could not start:", err);
  process.exit(1);
}
