export type SaveStatus = "saved" | "saving" | "unsaved" | "error";

export type SaveState = { status: SaveStatus; savedAt: number | null };

export const SAVE_KEY = "slate-board-v13";

const DELAY = 900;
const listeners = new Set<(s: SaveState) => void>();

let status: SaveStatus = "saved";
let savedAt: number | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let pending: string | null = null;
let last: string | null = null;

function emit() {
  const snap = { status, savedAt };
  for (const listener of listeners) listener(snap);
}

function setStatus(next: SaveStatus) {
  if (status === next && next !== "saved") return;
  status = next;
  emit();
}

export function getSaveState(): SaveState {
  return { status, savedAt };
}

export function hadPersistedProject(name = SAVE_KEY, storage: Pick<Storage, "getItem"> = typeof localStorage !== "undefined" ? localStorage : { getItem: () => null }): boolean {
  try {
    const raw = storage.getItem(name);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    const project = parsed?.state?.project;
    return project != null && typeof project.id === "string" && typeof project.name === "string";
  } catch {
    return false;
  }
}

export function subscribeSave(listener: (s: SaveState) => void): () => void {
  listeners.add(listener);
  listener({ status, savedAt });
  return () => {
    listeners.delete(listener);
  };
}

export function markSaveClean() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (pending != null) {
    last = pending;
    pending = null;
  }
  setStatus("saved");
}

function write(name: string) {
  if (typeof localStorage === "undefined") return;
  if (pending == null) {
    setStatus("saved");
    return;
  }
  setStatus("saving");
  try {
    localStorage.setItem(name, pending);
    last = pending;
    pending = null;
    savedAt = Date.now();
    setStatus("saved");
  } catch {
    setStatus("error");
  }
}

export function flushSave(name?: string) {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  write(name ?? SAVE_KEY);
}

export const saveStorage: {
  getItem: (name: string) => string | null;
  setItem: (name: string, value: string) => void;
  removeItem: (name: string) => void;
} = {
  getItem: (name) => {
    if (typeof localStorage === "undefined") return null;
    const value = localStorage.getItem(name);
    last = value;
    return value;
  },
  setItem: (name, value) => {
    if (value === last && pending == null) return;
    if (value === pending) return;
    pending = value;
    setStatus("unsaved");
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => write(name), DELAY);
  },
  removeItem: (name) => {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(name);
  },
};
