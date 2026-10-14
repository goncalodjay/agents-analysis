// Receives completed-agent events over an already-listening Unix socket server and stores them
// in local history. One event per connection: the client (see sendToDaemon in
// extensions/agents-analysis/outbox.ts) writes the JSON event, half-closes its write side, and
// waits for a single JSON reply before the connection closes.
import type { Server, Socket } from "node:net";

import { attachCost, type Consultation } from "../consultation/consultation.ts";
import { loadPricingTable, rateFor, readAutoPricingTable } from "../pricing.ts";
import { toConsultation, validate, type Event, type Reply } from "./event.ts";

export interface ConsultationStore {
  save(record: Consultation): void;
}

export type PricingOptions = {
  /** Hand-edited override file; re-read on every event so edits apply without a restart. */
  pricingPath?: string;
  /** models.dev-sourced cache (see refreshPricingCache); also just a plain synchronous read
   * here — refreshing it over the network is the caller's job, done on its own timer. */
  autoPricingCachePath?: string;
};

export type ServeOptions = PricingOptions & {
  signal?: AbortSignal;
};

function priceConsultation(consultation: Consultation, pricing: PricingOptions): Consultation {
  const manual = pricing.pricingPath ? rateFor(loadPricingTable(pricing.pricingPath), consultation.model) : undefined;
  const auto = manual ? undefined : pricing.autoPricingCachePath ? rateFor(readAutoPricingTable(pricing.autoPricingCachePath), consultation.model) : undefined;
  const rate = manual ?? auto;
  if (!rate) return consultation;
  const priced = attachCost(consultation, rate);
  // An agent that bills its own turn (opencode reports AssistantMessage.cost) knows the real
  // price; a local rate table is at best an estimate, so it must not overwrite it. Sub-agent
  // costs attachCost filled in are still kept — those the agent did not report.
  return consultation.cost === undefined ? priced : { ...priced, cost: consultation.cost };
}

function handleConnection(socket: Socket, store: ConsultationStore, pricing: PricingOptions): void {
  const chunks: Buffer[] = [];
  socket.on("data", (chunk: Buffer) => chunks.push(chunk));
  socket.once("end", () => {
    const reply = respond(Buffer.concat(chunks).toString("utf8"), store, pricing);
    socket.end(`${JSON.stringify(reply)}\n`);
  });
  socket.once("error", () => socket.destroy());
}

function respond(raw: string, store: ConsultationStore, pricing: PricingOptions): Reply {
  let event: Event;
  try {
    event = JSON.parse(raw) as Event;
  } catch (error) {
    return { accepted: false, reason: (error as Error).message };
  }
  const reason = validate(event);
  if (reason) return { accepted: false, reason };
  store.save(priceConsultation(toConsultation(event), pricing));
  return { accepted: true, id: event.id };
}

/** Accepts connections on `server` until it closes or `options.signal` aborts. */
export function serve(server: Server, store: ConsultationStore, options: ServeOptions = {}): Promise<void> {
  server.on("connection", (socket) => handleConnection(socket, store, options));
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      server.close(() => resolve());
      return;
    }
    options.signal?.addEventListener("abort", () => server.close(), { once: true });
    server.once("error", reject);
    server.once("close", () => resolve());
  });
}
