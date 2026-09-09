import { create } from "zustand";

interface StagePlaybackState {
  playing: boolean;
  time: number;
  shotClock: number;
  shotId: string | null;
  shotProgress: number;
  setPlaying: (playing: boolean) => void;
  setTime: (time: number, shotClock: number, shotProgress: number, shotId: string) => void;
  reset: () => void;
}

export const useStagePlayback = create<StagePlaybackState>((set) => ({
  playing: false,
  time: 0,
  shotClock: 0,
  shotId: null,
  shotProgress: 0,
  setPlaying: (playing) => set({ playing }),
  setTime: (time, shotClock, shotProgress, shotId) => set({ time, shotClock, shotProgress, shotId }),
  reset: () => set({ playing: false, time: 0, shotClock: 0, shotProgress: 0, shotId: null }),
}));
