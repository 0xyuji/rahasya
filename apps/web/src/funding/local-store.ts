import type { RecordStore } from "@pay/rail/browser";

/**
 * localStorage-backed record store: lets an in-flight deposit or top-up survive
 * a reload and resume instead of starting over. Stores ids, addresses, tx
 * hashes and signed (single-use, time-limited) payment headers — never keys.
 */
export class LocalStore<T extends { id: string }> implements RecordStore<T> {
  private readonly prefix: string;
  constructor(name: string) {
    this.prefix = `iw:${name}:`;
  }
  get(id: string): T | undefined {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(this.prefix + id);
    return raw ? (JSON.parse(raw) as T) : undefined;
  }
  put(record: T): T {
    localStorage.setItem(this.prefix + record.id, JSON.stringify(record, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
    return record;
  }
  all(): T[] {
    const out: T[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(this.prefix)) out.push(JSON.parse(localStorage.getItem(k)!) as T);
    }
    return out;
  }
}
