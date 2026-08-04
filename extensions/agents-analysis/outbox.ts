import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createConnection } from "node:net";

import type { CompletedEvent, Outbox } from "./core.ts";

type OutboxState = { pending: CompletedEvent[]; delivered: string[] };

export class FileOutbox implements Outbox {
  private operation: Promise<unknown> = Promise.resolve();
  private readonly path: string;

  constructor(path: string) { this.path = path; }

  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const next = this.operation.then(work, work);
    this.operation = next.catch(() => undefined);
    return next;
  }

  private async read(): Promise<OutboxState> {
    try {
      const state = JSON.parse(await readFile(this.path, "utf8")) as Partial<OutboxState>;
      return { pending: Array.isArray(state.pending) ? state.pending : [], delivered: Array.isArray(state.delivered) ? state.delivered : [] };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { pending: [], delivered: [] };
      throw error;
    }
  }

  private async write(state: OutboxState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    await rename(temporary, this.path);
  }

  hasDelivered(id: string): Promise<boolean> {
    return this.serialized(async () => (await this.read()).delivered.includes(id));
  }

  enqueue(event: CompletedEvent): Promise<void> {
    return this.serialized(async () => {
      const state = await this.read();
      if (!state.delivered.includes(event.id) && !state.pending.some((item) => item.id === event.id)) {
        state.pending.push(event);
        await this.write(state);
      }
    });
  }

  listPending(): Promise<CompletedEvent[]> {
    return this.serialized(async () => [...(await this.read()).pending]);
  }

  markDelivered(id: string): Promise<void> {
    return this.serialized(async () => {
      const state = await this.read();
      state.pending = state.pending.filter((event) => event.id !== id);
      state.delivered = [...state.delivered.filter((item) => item !== id), id].slice(-1000);
      await this.write(state);
    });
  }
}

export function expandHome(path: string): string {
  return path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

export function sendToDaemon(address: string, event: CompletedEvent): Promise<void> {
  // Stryker disable next-line Regex: callers provide either a Unix URI or an already resolved socket path.
  const socketPath = expandHome(address.replace(/^unix:\/\//, ""));
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    socket.once("connect", () => socket.end(`${JSON.stringify(event)}\n`, resolve));
    socket.once("error", reject);
  });
}
