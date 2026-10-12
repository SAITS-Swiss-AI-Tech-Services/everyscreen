import { useSyncExternalStore } from 'react';

// Tiny external store for state that many nodes read. Each node subscribes to
// its own slice (e.g. "am I selected?"), so hovering or selecting a screen only
// re-renders the frames whose state actually changes.

export interface UiState {
  selected: string | null;
  hovered: string | null;
  /** Screens connected to the selected / hovered one (not dimmed). */
  linked: Set<string>;
  /** Media index per screen id (which state is shown). */
  mediaIdx: Record<string, number>;
  /** Frames are small on screen: use thumbnails. */
  small: boolean;
  /** Frames are tiny on screen: don't mount HTML mockups. */
  tiny: boolean;
  /** A PNG export is rendering: static media only, at this detail. */
  exporting: null | 'thumb' | 'full';
}

type Listener = () => void;

/** Minimal external store; components subscribe to slices via useStore. */
export function createStore<T extends object>(initial: T) {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => state,
    set(patch: Partial<T>) {
      state = { ...state, ...patch };
      for (const l of listeners) l();
    },
    subscribe(l: Listener) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
}
export type Store<T extends object> = ReturnType<typeof createStore<T>>;

/** Subscribe to a slice of a store. The selector must return a primitive or a stable reference. */
export function useStore<T extends object, R>(store: Store<T>, selector: (s: T) => R): R {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()));
}

const uiStore = createStore<UiState>({ selected: null, hovered: null, linked: new Set(), mediaIdx: {}, small: true, tiny: true, exporting: null });
export const ui = {
  ...uiStore,
  setMedia(id: string, i: number) {
    uiStore.set({ mediaIdx: { ...uiStore.get().mediaIdx, [id]: i } });
  },
};
export const useUi = <R,>(selector: (s: UiState) => R): R => useStore(uiStore, selector);

// localStorage for per-viewer preferences; can be unavailable (private mode).
export const prefs = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem('board.' + key);
      return v == null ? fallback : (JSON.parse(v) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem('board.' + key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
};
