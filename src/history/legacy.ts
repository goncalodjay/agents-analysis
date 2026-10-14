// Legacy migration is isolated from the canonical store so old EDN payload knowledge
// can be removed without affecting normal persistence.
import type { Consultation } from "../consultation/consultation.ts";
import type { StoredConsultation } from "./serialization.ts";

function legacyValue(source: string, key: string, pattern: string): string {
  const match = source.match(new RegExp(`:${key}\\s+${pattern}`));
  return match ? match[1]! : "";
}

const legacyString = (source: string, key: string): string => legacyValue(source, key, `"([^"]*)"`);
const legacyKeyword = (source: string, key: string): string => legacyValue(source, key, `:([^\\s}]+)`);
const legacyRate = (source: string, key: string): number => parseFloat(legacyValue(source, key, `([0-9.]+)`)) || 0;

export function legacyConsultation(encoded: string): StoredConsultation {
  const text = Buffer.from(encoded, "base64").toString("utf8");
  return {
    id: legacyString(text, "id"),
    status: legacyKeyword(text, "status"),
    provider: legacyString(text, "provider") || undefined,
    model: legacyString(text, "model") || undefined,
    legacy_edn: text,
    usage: { Input: 0, Prompt: 0, Thinking: 0, Output: 0 },
  };
}

export function legacyRates(encoded: string): { Input: number; Prompt: number; Thinking: number; Output: number } {
  const text = Buffer.from(encoded, "base64").toString("utf8");
  return {
    Input: legacyRate(text, "input"),
    Prompt: legacyRate(text, "prompt"),
    Thinking: legacyRate(text, "thinking"),
    Output: legacyRate(text, "output"),
  };
}

export function isLegacyPayload(payload: string): boolean {
  return !payload.startsWith("{");
}

export type { Consultation };
