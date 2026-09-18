import { invoke, isTauri } from "@tauri-apps/api/core";
import { readBrandedStorage } from "./brand-storage";

export const READER_LIBRARY_KEY = "whalepaper.library.v1";
export const READER_WORKSPACE_KEY = "whalepaper.document-workspace.v1";
export const READER_ANNOTATIONS_KEY = "whalepaper.annotations.v1";

const READER_KEY_MIGRATIONS = [
  [READER_LIBRARY_KEY, "openpaper.library.v1"],
  [READER_WORKSPACE_KEY, "openpaper.document-workspace.v1"],
  [READER_ANNOTATIONS_KEY, "openpaper.annotations.v1"],
] as const;

type ReaderState = Record<string, string>;
let state: ReaderState = {};
let initialized = false;
let initialization: Promise<void> | null = null;

export function initializeReaderStore(): Promise<void> {
  if (initialization) return initialization;
  initialization = (async () => {
    if (isTauri()) {
      try {
        state = (await invoke<ReaderState>("load_reader_state")) || {};
      } catch {
        // Keep the app usable when a browser preview has no desktop command bridge.
        state = {};
      }
      const migrated: ReaderState = {};
      for (const [key, legacyKey] of READER_KEY_MIGRATIONS) {
        if (state[key] !== undefined) continue;
        const value = state[legacyKey] ?? readBrandedStorage(key) ?? undefined;
        if (value !== undefined) migrated[key] = value;
      }
      if (Object.keys(migrated).length) {
        state = { ...state, ...migrated };
        try {
          await invoke("save_reader_state", { state: migrated });
          for (const [key, legacyKey] of READER_KEY_MIGRATIONS) {
            try {
              localStorage.removeItem(key);
              localStorage.removeItem(legacyKey);
            } catch { /* best effort */ }
          }
        } catch { /* retain the legacy copy if SQLite is unavailable */ }
      }
    } else {
      state = Object.fromEntries(READER_KEY_MIGRATIONS
        .map(([key]) => [key, readBrandedStorage(key) || undefined])
        .filter((entry): entry is [string, string] => Boolean(entry[1])));
    }
    initialized = true;
  })();
  return initialization;
}

export function getReaderState(key: string): string | undefined { return state[key]; }

export function setReaderState(key: string, value: string): void {
  state[key] = value;
  if (isTauri()) {
    void invoke("save_reader_state", { state: { [key]: value } }).catch(() => {
      try { localStorage.setItem(key, value); } catch { /* optional fallback */ }
    });
  }
  else { try { localStorage.setItem(key, value); } catch { /* optional */ } }
}

export function isReaderStoreInitialized(): boolean { return initialized; }
