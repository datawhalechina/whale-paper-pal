import { Compass, Library, PenLine } from "lucide-react";

export type HomeMode = "reader" | "writer" | "discovery";

type HomeNavigationProps = {
  active: HomeMode;
  onNavigate: (mode: HomeMode) => void;
};

export function HomeNavigation({ active, onNavigate }: HomeNavigationProps) {
  return (
    <nav className="library-home-nav" aria-label="主界面导航">
      <button type="button" className={active === "reader" ? "is-active" : ""} onClick={() => onNavigate("reader")}><Library size={16} /><span>论文库</span></button>
      <button type="button" className={active === "writer" ? "is-active" : ""} onClick={() => onNavigate("writer")}><PenLine size={16} /><span>论文写作</span></button>
      <button type="button" className={active === "discovery" ? "is-active" : ""} onClick={() => onNavigate("discovery")}><Compass size={16} /><span>论文发现</span></button>
    </nav>
  );
}
