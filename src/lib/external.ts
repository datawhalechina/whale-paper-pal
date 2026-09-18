import { invoke, isTauri } from "@tauri-apps/api/core";

export async function openExternalUrl(value: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("资源链接格式无效。");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("只能打开 HTTP 或 HTTPS 资源链接。");
  }

  if (isTauri()) {
    await invoke("open_external_url", { url: url.href });
    return;
  }

  const opened = window.open(url.href, "_blank", "noopener,noreferrer");
  if (!opened) throw new Error("浏览器阻止了新窗口。");
}
