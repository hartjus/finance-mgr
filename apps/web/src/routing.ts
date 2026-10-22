import { useEffect, useRef, useState } from "react";

export type AccountScreen =
  "ledger" | "analysis" | "budget" | "forecast" | "reconcile" | "bulk";
export type SettingsTab = "general" | "categories" | "accounts";
export function parseRoute(path: string) {
  if (path === "/") return { screen: "home" as const };
  if (path === "/transfer") return { screen: "transfer" as const };
  const forecast = path.match(/^\/accounts\/([^/]+)\/forecast(?:\/((?:19\d{2}|20\d{2}|21\d{2}|2200)-(?:0[1-9]|1[0-2])))?\/?$/);
  if (forecast) return { screen: 'forecast' as const, accountId: forecast[1], month: forecast[2] ?? new Date().toISOString().slice(0, 7) };
  const settings = path.match(
    /^\/settings(?:\/(general|categories|accounts))?\/?$/,
  );
  if (settings)
    return {
      screen: "settings" as const,
      tab: (settings[1] || "general") as SettingsTab,
    };
  const account = path.match(
    /^\/accounts\/([^/]+)\/(ledger|analysis|budget|reconcile|bulk)\/?$/,
  );
  if (account)
    return { screen: account[2] as AccountScreen, accountId: account[1] };
  return { screen: "missing" as const };
}

export function useRoute(dirty: boolean) {
  const [path, setPath] = useState(window.location.pathname);
  const index = useRef<number>(window.history.state?.financeIndex ?? 0);
  const restoring = useRef(false);
  useEffect(() => {
    window.history.replaceState(
      { ...window.history.state, financeIndex: index.current },
      "",
    );
  }, []);
  useEffect(() => {
    const pop = () => {
      const next = window.history.state?.financeIndex ?? 0;
      if (restoring.current) {
        restoring.current = false;
        return;
      }
      if (dirty && !window.confirm("Discard unsaved transactions?")) {
        restoring.current = true;
        window.history.go(index.current - next);
        return;
      }
      index.current = next;
      setPath(window.location.pathname);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [dirty]);
  const navigate = (next: string) => {
    if (next === path) return;
    if (dirty && !window.confirm("Discard unsaved transactions?")) return;
    index.current += 1;
    window.history.pushState({ financeIndex: index.current }, "", next);
    setPath(next);
  };
  return { path, route: parseRoute(path), navigate };
}
