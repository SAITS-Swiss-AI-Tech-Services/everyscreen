import { createStore, useStore } from './store';

// Short notices in the corner ("Issue #12 is on another canvas"), with an
// optional link. They go away by themselves.

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error';
  link?: { to: string; label: string };
}

const toasts = createStore<{ list: Toast[] }>({ list: [] });
let seq = 0;

export function toast(text: string, opts: { tone?: Toast['tone']; link?: Toast['link']; ms?: number } = {}) {
  const t: Toast = { id: ++seq, text, tone: opts.tone ?? 'info', link: opts.link };
  toasts.set({ list: [...toasts.get().list, t].slice(-4) });
  setTimeout(() => dismissToast(t.id), opts.ms ?? (t.link ? 9000 : 5000));
}
export function dismissToast(id: number) {
  toasts.set({ list: toasts.get().list.filter((t) => t.id !== id) });
}
export const useToasts = () => useStore(toasts, (s) => s.list);
