import { RailError } from "./util.ts";

/**
 * A state machine as plain data: which states may follow which. A state with no
 * exits is final. `Record<S, ...>` makes the table exhaustive, so adding a state
 * without deciding its exits is a compile error. Saved records keep their plain
 * state strings, so a table can change without migrating anything in storage.
 */
export interface Machine<S extends string> {
  readonly name: string;
  readonly transitions: Readonly<Record<S, readonly S[]>>;
  readonly final: ReadonlySet<S>;
  can(from: S, to: S): boolean;
  /** Call before persisting a move. Throws, leaving the saved state untouched, if the move isn't in the table. */
  assert(from: S, to: S): void;
}

export function defineMachine<S extends string>(name: string, transitions: Record<S, readonly S[]>): Machine<S> {
  const final = new Set((Object.keys(transitions) as S[]).filter((s) => transitions[s].length === 0));
  const can = (from: S, to: S) => transitions[from]?.includes(to) ?? false;
  return {
    name,
    transitions,
    final,
    can,
    assert(from, to) {
      if (!can(from, to)) throw new RailError("ILLEGAL_TRANSITION", `${name}: ${from} -> ${to} is not allowed`);
    },
  };
}
