import { createStore, prefs, useStore } from './store';

// Light / dark / follow the system, for every page (stored per browser).

export type Theme = 'auto' | 'light' | 'dark';

const theme = createStore<{ value: Theme }>({ value: prefs.get<Theme>('theme', 'auto') });

function apply(t: Theme) {
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}
apply(theme.get().value);

export function setTheme(t: Theme) {
  theme.set({ value: t });
  prefs.set('theme', t);
  apply(t);
}
export const useTheme = () => useStore(theme, (s) => s.value);
