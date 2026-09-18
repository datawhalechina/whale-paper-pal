function legacyStorageKeys(key: string): string[] {
  const keys: string[] = [];
  if (key.startsWith("whalepaper.")) keys.push(`openpaper.${key.slice("whalepaper.".length)}`);
  if (key.startsWith("whale-paper:")) keys.push(`open-paper:${key.slice("whale-paper:".length)}`);
  return keys;
}

export function readBrandedStorage(key: string): string | null {
  try {
    const current = localStorage.getItem(key);
    if (current !== null) return current;
    for (const legacyKey of legacyStorageKeys(key)) {
      const legacy = localStorage.getItem(legacyKey);
      if (legacy === null) continue;
      localStorage.setItem(key, legacy);
      localStorage.removeItem(legacyKey);
      return legacy;
    }
  } catch {
    // Storage is optional in restricted browser contexts.
  }
  return null;
}
