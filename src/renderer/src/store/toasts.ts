import { create } from 'zustand';
import { tr, trMaybe } from '../i18n';

export interface Toast {
  id: number;
  kind: 'info' | 'error' | 'gold';
  title: string;
  text?: string;
}

interface ToastStore {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id'>, ms?: number) => void;
  dismiss: (id: number) => void;
}

let next = 1;
export const useToasts = create<ToastStore>((set, get) => ({
  toasts: [],
  push: (t, ms = 4500) => {
    const id = next++;
    set({ toasts: [...get().toasts, { ...t, id }].slice(-4) });
    setTimeout(() => get().dismiss(id), ms);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = (t: Omit<Toast, 'id'>, ms?: number) => useToasts.getState().push(t, ms);
/** The message of an error, without the prefix Electron adds to the system side's errors. */
export const errorText = (e: unknown): string => trMaybe((e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, ''));
export const toastError = (e: unknown, title = tr('Erreur')) => toast({ kind: 'error', title, text: errorText(e) }, 7000);
