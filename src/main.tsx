import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import App from "./App";
import { DesktopPet } from "./components/DesktopPet";
import { openExternalUrl } from "./lib/external";
import { initializeReaderStore } from "./lib/reader-store";

const isPetWindow = new URLSearchParams(window.location.search).get("pet") === "1";

if (isTauri()) {
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || !(event.target instanceof Element)) return;
    const link = event.target.closest<HTMLAnchorElement>('a[target="_blank"]');
    if (!link || link.download) return;
    const url = new URL(link.href, window.location.href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    event.preventDefault();
    void openExternalUrl(url.href).catch((error) => console.error("无法打开外部链接", error));
  });
}

void initializeReaderStore().finally(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      {isPetWindow ? <DesktopPet /> : <App />}
    </StrictMode>,
  );
});
