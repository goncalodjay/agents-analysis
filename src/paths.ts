import { join } from "node:path";

export const DEFAULT_HISTORY_PATH = "~/.local/share/agents-analysis/trazas.sqlite";
export const DEFAULT_SOCKET_ADDRESS = "unix://~/.local/share/agents-analysis/daemon.sock";
export const DEFAULT_PRICING_PATH = "~/.local/share/agents-analysis/pricing.json";
export const DEFAULT_PRICING_CACHE_PATH = "~/.local/share/agents-analysis/pricing-cache.json";

export function resolveUserPath(path: string, home: string): string {
  if (path === "~") return home;
  if (path.startsWith("~/")) return join(home, path.slice(2));
  return path;
}

export function resolveSocketPath(address: string, home: string): string {
  if (!address.startsWith("unix://")) throw new Error("daemon socket must use unix://");
  return resolveUserPath(address.slice("unix://".length), home);
}

export type DaemonConfig = { historyPath: string; socketAddress: string; pricingPath: string };

export function parseDaemonConfig(args: string[]): DaemonConfig {
  const config: DaemonConfig = { historyPath: DEFAULT_HISTORY_PATH, socketAddress: DEFAULT_SOCKET_ADDRESS, pricingPath: DEFAULT_PRICING_PATH };
  let rest = args;
  while (rest.length > 0) {
    if (rest.length < 2) throw new Error("missing daemon option value");
    const [flag, value] = rest as [string, string];
    if (flag === "--history") config.historyPath = value;
    else if (flag === "--socket") config.socketAddress = value;
    else if (flag === "--pricing") config.pricingPath = value;
    else throw new Error("unknown daemon option");
    rest = rest.slice(2);
  }
  return config;
}
