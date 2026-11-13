import type { RecordStore } from "@pay/rail/browser";

/**
 * localStorage-backed record store: lets an in-flight deposit or top-up survive
 * a reload and resume instead of starting over. Stores ids, addresses, tx
 * hashes and signed (single-use, time-limited) payment headers, never keys.
 */
export class LocalStore<T extends { id: string }> implements RecordStore<T> {
  private readonly prefix: string;
  private readonly valid: (r: T) => boolean;
  constructor(name: string, valid: (r: T) => boolean = () => true) {
    this.prefix = `iw:${name}:`;
    this.valid = valid;
  }
  /** A corrupted or half-written record is skipped, never allowed to crash the dialogs. */
  private parse(raw: string | null): T | undefined {
    if (!raw) return undefined;
    try {
      const r = JSON.parse(raw) as T;
      return r && typeof r === "object" && this.valid(r) ? r : undefined;
    } catch {
      return undefined;
    }
  }
  get(id: string): T | undefined {
    return this.parse(typeof localStorage === "undefined" ? null : localStorage.getItem(this.prefix + id));
  }
  put(record: T): T {
    localStorage.setItem(this.prefix + record.id, JSON.stringify(record, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
    return record;
  }
  all(): T[] {
    const out: T[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const r = k?.startsWith(this.prefix) ? this.parse(localStorage.getItem(k)) : undefined;
      if (r) out.push(r);
    }
    return out;
  }
}
