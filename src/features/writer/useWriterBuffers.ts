import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { EditorBuffer } from "./types";

type Buffers = Record<string, EditorBuffer>;
type WriteFile = (path: string, content: string) => Promise<void>;

export function useWriterBuffers(writeFile: WriteFile, onError: (error: unknown) => void) {
  const [buffers, renderBuffers] = useState<Buffers>({});
  const latest = useRef(buffers);
  const pendingSave = useRef<Promise<void> | null>(null);
  // Keep edits available to a flush before React commits its next render.
  const setBuffers = useCallback<Dispatch<SetStateAction<Buffers>>>((update) => {
    const next = typeof update === "function" ? update(latest.current) : update;
    latest.current = next;
    renderBuffers(next);
  }, []);

  const saveAll = useCallback((): Promise<void> => {
    // Even a currently clean buffer may have an older write still in flight.
    if (pendingSave.current) return pendingSave.current;
    const saving = Promise.resolve().then(async () => {
      try {
        while (true) {
          const pending = Object.entries(latest.current).filter(([, buffer]) => buffer.content !== buffer.savedContent);
          if (!pending.length) return;
          setBuffers((current) => {
            const next = { ...current };
            for (const [path] of pending) next[path] = { ...next[path], saving: true };
            return next;
          });
          // A failed file must not release the queue while other files still write.
          const results = await Promise.allSettled(pending.map(async ([path, buffer]) => writeFile(path, buffer.content)));
          setBuffers((current) => {
            const next = { ...current };
            pending.forEach(([path, buffer], index) => {
              next[path] = {
                ...next[path],
                savedContent: results[index].status === "fulfilled" ? buffer.content : next[path].savedContent,
                saving: false,
              };
            });
            return next;
          });
          const failure = results.find((result) => result.status === "rejected");
          if (failure?.status === "rejected") throw failure.reason;
          // Edits made during this batch are now dirty against the saved snapshot.
        }
      } catch (error) {
        onError(error);
        throw error;
      } finally {
        pendingSave.current = null;
      }
    });
    pendingSave.current = saving;
    return saving;
  }, [onError, setBuffers, writeFile]);
  return { buffers, setBuffers, saveAll };
}
