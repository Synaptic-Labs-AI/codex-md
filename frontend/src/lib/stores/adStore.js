import { writable } from 'svelte/store';

export const adStore = writable({ visible: false });
export const showAd = () => adStore.set({ visible: true });
