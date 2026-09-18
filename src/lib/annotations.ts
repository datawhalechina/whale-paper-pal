import type { Annotation } from "../types";
import { getReaderState, READER_ANNOTATIONS_KEY, setReaderState } from "./reader-store";

const STORAGE_KEY = READER_ANNOTATIONS_KEY;

function readAll(): Record<string, Annotation[]> {
  try {
    return JSON.parse(getReaderState(STORAGE_KEY) || "{}") as Record<string, Annotation[]>;
  } catch {
    return {};
  }
}

export function loadAnnotations(documentId: string): Annotation[] {
  return readAll()[documentId] || [];
}

export function saveAnnotations(documentId: string, annotations: Annotation[]): void {
  const all = readAll();
  all[documentId] = annotations;
  setReaderState(STORAGE_KEY, JSON.stringify(all));
}
