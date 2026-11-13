/**
 * Questions the app needs answered, shown one at a time by <ConfirmHost/>. An in-page dialog,
 * because window.confirm is silently answered "no" in many mobile wallet browsers.
 */
export interface Question {
  id: number;
  message: string;
  confirmLabel: string;
  answer: (yes: boolean) => void;
}

let queue: Question[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

export const currentQuestion = (): Question | null => queue[0] ?? null;

export function subscribeQuestions(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function askUser(message: string, confirmLabel = "Continue"): Promise<boolean> {
  return new Promise((resolve) => {
    const question: Question = {
      id: nextId++,
      message,
      confirmLabel,
      answer(yes) {
        queue = queue.filter((q) => q !== question);
        changed();
        resolve(yes);
      },
    };
    queue = [...queue, question];
    changed();
  });
}
