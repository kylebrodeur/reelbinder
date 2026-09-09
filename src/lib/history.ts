import { create } from "zustand";
import type { Project, View } from "./types";

export interface HistoryEntry {
  id: string;
  label: string;
  at: number;
  project: Project;
  selectedId: string | null;
  selectedElementId: string | null;
  selectedElementIds: string[];
  view: View;
}

type Binder = {
  take: () => Omit<HistoryEntry, "id" | "label" | "at">;
  put: (snap: Omit<HistoryEntry, "id" | "label" | "at">) => void;
};

const MAX = 40;
const COALESCE_MS = 800;

let binder: Binder | null = null;
let lastLabel = "";
let lastAt = 0;

export function bindHistory(next: Binder) {
  binder = next;
}

function cloneSnap(): Omit<HistoryEntry, "id" | "label" | "at"> | null {
  if (!binder) return null;
  return binder.take();
}

interface HistoryState {
  past: HistoryEntry[];
  future: HistoryEntry[];
  applying: boolean;
  capture: (label: string) => void;
  undo: () => void;
  redo: () => void;
  jumpTo: (id: string) => void;
}

export const useHistory = create<HistoryState>((set, get) => ({
  past: [],
  future: [],
  applying: false,
  capture: (label) => {
    if (get().applying || !binder) return;
    const now = Date.now();
    if (label === lastLabel && now - lastAt < COALESCE_MS) return;
    const snap = cloneSnap();
    if (!snap) return;
    lastLabel = label;
    lastAt = now;
    const entry: HistoryEntry = {
      id: `h_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      label,
      at: now,
      ...snap,
    };
    set((s) => ({ past: [...s.past.slice(-(MAX - 1)), entry], future: [] }));
  },
  undo: () => {
    const { past, future } = get();
    const entry = past[past.length - 1];
    if (!entry || !binder) return;
    const current = cloneSnap();
    if (!current) return;
    lastLabel = "";
    set({ applying: true, past: past.slice(0, -1), future: [...future, { ...entry, ...current, label: "Now" }] });
    binder.put(entry);
    set({ applying: false });
  },
  redo: () => {
    const { past, future } = get();
    const entry = future[future.length - 1];
    if (!entry || !binder) return;
    const current = cloneSnap();
    if (!current) return;
    lastLabel = "";
    set({
      applying: true,
      past: [...past, { ...current, id: entry.id, label: entry.label, at: entry.at } as HistoryEntry],
      future: future.slice(0, -1),
    });
    binder.put(entry);
    set({ applying: false });
  },
  jumpTo: (id) => {
    const { past } = get();
    const idx = past.findIndex((e) => e.id === id);
    if (idx < 0 || !binder) return;
    const current = cloneSnap();
    if (!current) return;
    const target = past[idx];
    const rest = past.slice(idx + 1);
    lastLabel = "";
    set({
      applying: true,
      past: past.slice(0, idx),
      future: [
        ...rest,
        {
          id: `h_now_${Date.now().toString(36)}`,
          label: "Now",
          at: Date.now(),
          ...current,
        },
      ],
    });
    binder.put(target);
    set({ applying: false });
  },
}));

export function capture(label: string) {
  useHistory.getState().capture(label);
}

export function isHistoryApplying() {
  return useHistory.getState().applying;
}
