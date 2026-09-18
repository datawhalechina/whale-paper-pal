import type { PdfFile } from "../types";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

export async function openPdfFile(): Promise<PdfFile | null> {
  if (isTauri()) {
    const [{ open }, { readFile }] = await Promise.all([
      import("@tauri-apps/plugin-dialog"),
      import("@tauri-apps/plugin-fs"),
    ]);
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "PDF document", extensions: ["pdf"] }],
    });
    if (!selected || Array.isArray(selected)) return null;
    const data = await readFile(selected);
    return {
      name: selected.split(/[\\/]/).pop() || "document.pdf",
      data,
      sourcePath: selected,
    };
  }

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,.pdf";
    input.hidden = true;
    document.body.appendChild(input);
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return resolve(null);
      resolve({ name: file.name, data: new Uint8Array(await file.arrayBuffer()) });
    });
    input.addEventListener("cancel", () => {
      input.remove();
      resolve(null);
    });
    input.click();
  });
}

export async function openPdfPath(sourcePath: string): Promise<PdfFile> {
  if (/^https?:\/\//i.test(sourcePath)) {
    let data: Uint8Array;
    if (isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      const response = await invoke<ArrayBuffer | Uint8Array | number[]>("download_pdf", { url: sourcePath });
      data = response instanceof Uint8Array
        ? response
        : response instanceof ArrayBuffer
          ? new Uint8Array(response)
          : new Uint8Array(response);
    } else {
      const response = await fetch(sourcePath);
      if (!response.ok) throw new Error(`无法下载 PDF（${response.status}）。`);
      data = new Uint8Array(await response.arrayBuffer());
    }
    return {
      name: decodeURIComponent(new URL(sourcePath).pathname.split("/").pop() || "document.pdf"),
      data,
      sourcePath,
    };
  }
  if (!isTauri()) throw new Error("只有桌面版可以从历史路径重新打开文件。");
  const { readFile } = await import("@tauri-apps/plugin-fs");
  return {
    name: sourcePath.split(/[\\/]/).pop() || "document.pdf",
    data: await readFile(sourcePath),
    sourcePath,
  };
}

export async function saveBytes(suggestedName: string, data: Uint8Array, mimeType: string): Promise<boolean> {
  if (isTauri()) {
    const [{ save }, { writeFile }] = await Promise.all([
      import("@tauri-apps/plugin-dialog"),
      import("@tauri-apps/plugin-fs"),
    ]);
    const extension = suggestedName.split(".").pop() || "file";
    const selected = await save({
      defaultPath: suggestedName,
      filters: [{ name: `${extension.toUpperCase()} file`, extensions: [extension] }],
    });
    if (!selected) return false;
    await writeFile(selected, data);
    return true;
  }

  const blob = new Blob([data as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = suggestedName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

export async function pdfFileFromDrop(file: File): Promise<PdfFile> {
  return { name: file.name, data: new Uint8Array(await file.arrayBuffer()) };
}
