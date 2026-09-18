import type { CitationCard, DocumentLibraryEntry, PdfDocumentState } from "../types";
import { getReaderState, READER_LIBRARY_KEY, setReaderState } from "./reader-store";

const LIBRARY_KEY = READER_LIBRARY_KEY;

export function loadLibrary(): DocumentLibraryEntry[] {
  try {
    const entries = JSON.parse(getReaderState(LIBRARY_KEY) || "[]") as DocumentLibraryEntry[];
    return entries.sort((left, right) => right.lastOpenedAt.localeCompare(left.lastOpenedAt));
  } catch {
    return [];
  }
}

function saveLibrary(entries: DocumentLibraryEntry[]): DocumentLibraryEntry[] {
  const sorted = [...entries].sort((left, right) => right.lastOpenedAt.localeCompare(left.lastOpenedAt));
  setReaderState(LIBRARY_KEY, JSON.stringify(sorted));
  return sorted;
}

export function rememberDocument(document: PdfDocumentState, lastPage: number): DocumentLibraryEntry[] {
  const existing = loadLibrary().find((entry) => entry.id === document.id);
  const entry: DocumentLibraryEntry = {
    id: document.id,
    title: document.title,
    author: document.author,
    fileName: document.file.name,
    sourcePath: document.file.sourcePath || existing?.sourcePath,
    pageCount: document.pageCount,
    lastPage: Math.min(document.pageCount, Math.max(1, lastPage || existing?.lastPage || 1)),
    lastOpenedAt: new Date().toISOString(),
    addedAt: existing?.addedAt || new Date().toISOString(),
    folder: existing?.folder,
    tags: existing?.tags || [],
    favorite: existing?.favorite || false,
    rating: existing?.rating || 0,
  };
  return saveLibrary([entry, ...loadLibrary().filter((item) => item.id !== document.id)]);
}

export function updateReadingPosition(documentId: string, page: number): DocumentLibraryEntry[] {
  return saveLibrary(loadLibrary().map((entry) => (
    entry.id === documentId
      ? { ...entry, lastPage: Math.min(entry.pageCount, Math.max(1, page)), lastOpenedAt: new Date().toISOString() }
      : entry
  )));
}

export function removeFromLibrary(documentId: string): DocumentLibraryEntry[] {
  return saveLibrary(loadLibrary().filter((entry) => entry.id !== documentId));
}

export function updateLibraryEntry(documentId: string, patch: Partial<Pick<DocumentLibraryEntry, "folder" | "tags" | "favorite" | "rating">>): DocumentLibraryEntry[] {
  return saveLibrary(loadLibrary().map((entry) => entry.id === documentId ? { ...entry, ...patch } : entry));
}

export function addCitationToLibrary(citation: CitationCard): DocumentLibraryEntry[] {
  const sourcePath = citation.openAccessPdf || (citation.url && /\.pdf(?:$|[?#])/i.test(citation.url) ? citation.url : undefined);
  if (!sourcePath) return loadLibrary();
  const id = `citation:${citation.paperId || citation.doi || citation.title.toLocaleLowerCase()}`;
  const timestamp = new Date().toISOString();
  const existing = loadLibrary().find((entry) => entry.id === id);
  const entry: DocumentLibraryEntry = {
    id,
    title: citation.title,
    author: citation.authors,
    fileName: `${citation.title.replace(/[\\/:*?"<>|]/g, "-").slice(0, 100) || "paper"}.pdf`,
    sourcePath,
    pageCount: existing?.pageCount || 0,
    lastPage: existing?.lastPage || 1,
    lastOpenedAt: existing?.lastOpenedAt || timestamp,
    addedAt: existing?.addedAt || timestamp,
    folder: existing?.folder,
    tags: existing?.tags || [],
    favorite: existing?.favorite || false,
    rating: existing?.rating || 0,
  };
  return saveLibrary([entry, ...loadLibrary().filter((item) => item.id !== id)]);
}
