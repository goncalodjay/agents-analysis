import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { createServer } from "node:net";
import { dirname } from "node:path";

import { serve } from "./capture/daemon.ts";
import { HistoryStore } from "./history/history.ts";
import { DEFAULT_PRICING_CACHE_PATH, parseDaemonConfig, resolveSocketPath, resolveUserPath } from "./paths.ts";
import { PRICING_REFRESH_INTERVAL_MS, refreshPricingCache } from "./pricing.ts";
import { USAGE } from "./usage.ts";

export async function runDaemon(args: string[], home: string, print: (line: string) => void): Promise<number> {
  let config;
  try {
    config = parseDaemonConfig(args);
  } catch {
    print(`${USAGE}Unknown option or arguments`);
    return 2;
  }

  let socketPath: string;
  try {
    socketPath = resolveSocketPath(config.socketAddress, home);
  } catch {
    print("Daemon socket must use unix://");
    return 2;
  }

  try {
    const dir = dirname(socketPath);
    if (dir !== "." && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  } catch (error) {
    print(`Unable to create daemon directory: ${(error as Error).message}`);
    return 1;
  }

  try {
    if (existsSync(socketPath)) unlinkSync(socketPath);
  } catch (error) {
    print(`Unable to clear daemon socket: ${(error as Error).message}`);
    return 1;
  }

  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
  } catch (error) {
    print(`Unable to listen for capture events: ${(error as Error).message}`);
    return 1;
  }

  let store: HistoryStore;
  try {
    store = HistoryStore.open(resolveUserPath(config.historyPath, home));
  } catch (error) {
    server.close();
    print(`Unable to open history: ${(error as Error).message}`);
    return 1;
  }

  const autoPricingCachePath = resolveUserPath(DEFAULT_PRICING_CACHE_PATH, home);
  void refreshPricingCache(autoPricingCachePath); // fire-and-forget: never blocks daemon startup
  const refreshTimer = setInterval(() => void refreshPricingCache(autoPricingCachePath), PRICING_REFRESH_INTERVAL_MS);
  refreshTimer.unref(); // a pending refresh must never keep the process alive on its own

  try {
    await serve(server, store, { pricingPath: resolveUserPath(config.pricingPath, home), autoPricingCachePath });
    return 0;
  } catch (error) {
    print(`Capture daemon stopped: ${(error as Error).message}`);
    return 1;
  } finally {
    clearInterval(refreshTimer);
    store.close();
    if (existsSync(socketPath)) unlinkSync(socketPath);
  }
}
