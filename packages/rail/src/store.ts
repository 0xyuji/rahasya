import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { bigintReplacer } from "./log.ts";

/** Minimal record store; JsonStore (Node) and a localStorage store (browser) implement it. */
export interface RecordStore<T extends { id: string }> {
  get(id: string): T | undefined | Promise<T | undefined>;
  put(record: T): T | Promise<T>;
}

/**
 * Durable key/value store for action records. Every state transition is
 * written to disk (atomic rename) BEFORE the side effect it guards, so a crash
 * at any point can be resumed without double-sending.
 *
 * A JSON file is plenty for a single-process bot. Swap for SQLite later if needed.
 */
export class JsonStore<T extends { id: string }> implements RecordStore<T> {
  private readonly file: string;
  private data: Record<string, T>;

  constructor(dir: string, name: string) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, `${name}.json`);
    this.data = existsSync(this.file) ? (JSON.parse(readFileSync(this.file, "utf8")) as Record<string, T>) : {};
  }

  get(id: string): T | undefined {
    const v = this.data[id];
    return v ? structuredClone(v) : undefined;
  }

  all(): T[] {
    return Object.values(this.data).map((v) => structuredClone(v));
  }

  put(record: T): T {
    this.data[record.id] = structuredClone(record);
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, bigintReplacer, 2));
    renameSync(tmp, this.file);
    return record;
  }

  /** Read-modify-write a record; throws if missing. */
  update(id: string, patch: (r: T) => T): T {
    const cur = this.get(id);
    if (!cur) throw new Error(`record ${id} not found`);
    return this.put(patch(cur));
  }
}
