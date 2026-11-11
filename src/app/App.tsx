import { useEffect, useMemo, useState } from "react";
import { StartPage } from "../pages/StartPage";
import { BoardPage } from "../pages/BoardPage";
import { StyleLibraryPage } from "../pages/StyleLibraryPage";
import { ReversePage } from "../pages/ReversePage";

export function App() {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const suiteId = useMemo(() => path.match(/^\/suites\/([^/]+)/)?.[1], [path]);
  const reverseId = useMemo(() => path.match(/^\/reverse\/([^/]+)/)?.[1], [path]);
  const navigate = (to: string) => {
    window.history.pushState({}, "", to);
    setPath(to);
    window.scrollTo({ top: 0 });
  };

  if (path.endsWith("/board") && suiteId) return <BoardPage suiteId={suiteId} navigate={navigate} />;
  if (path === "/style-library") return <StyleLibraryPage navigate={navigate} />;
  if (path === "/reverse" || reverseId) return <ReversePage planId={reverseId} navigate={navigate} />;
  return <StartPage suiteId={suiteId} navigate={navigate} />;
}
