import { useEffect, useState } from "react";

// TEMPORARY diagnostics for the installed-app height on iPhone (not for upstream). Tap the panel to hide it.

function probe(css: string): number {
  const el = document.createElement("div");
  el.style.cssText = `position:fixed;left:0;top:0;width:1px;visibility:hidden;pointer-events:none;${css}`;
  document.body.appendChild(el);
  const h = el.getBoundingClientRect().height;
  el.remove();
  return Math.round(h);
}

function inset(side: "top" | "bottom"): number {
  const el = document.createElement("div");
  el.style.cssText = `position:fixed;visibility:hidden;padding-${side}:env(safe-area-inset-${side})`;
  document.body.appendChild(el);
  const v = parseFloat(getComputedStyle(el).getPropertyValue(`padding-${side}`)) || 0;
  el.remove();
  return Math.round(v);
}

function read(): string[] {
  const shell = document.querySelector(".shell")?.getBoundingClientRect();
  const bar = document.querySelector(".tabbar")?.getBoundingClientRect();
  const vv = window.visualViewport;
  const ios = /OS (\d+)_(\d+)/.exec(navigator.userAgent);
  return [
    `iOS ${ios ? `${ios[1]}.${ios[2]}` : "?"} · ${screen.orientation?.type ?? (innerWidth > innerHeight ? "landscape" : "portrait")} · standalone ${document.documentElement.hasAttribute("data-standalone")}`,
    `screen ${screen.width}×${screen.height} · inner ${innerWidth}×${innerHeight} · client ${document.documentElement.clientHeight}`,
    `vv ${vv ? `${Math.round(vv.height)} top ${Math.round(vv.offsetTop)}` : "-"} · fixed-inset0 ${probe("bottom:0")}`,
    `lvh ${probe("height:100lvh")} · svh ${probe("height:100svh")} · dvh ${probe("height:100dvh")} · vh ${probe("height:100vh")}`,
    `safe top ${inset("top")} · bottom ${inset("bottom")}`,
    `shell ${shell ? `${Math.round(shell.top)}→${Math.round(shell.bottom)} (${Math.round(shell.height)})` : "-"}`,
    `tabbar ${bar ? `${Math.round(bar.top)}→${Math.round(bar.bottom)} (${Math.round(bar.height)})` : "-"} · scrollY ${Math.round(scrollY)}`,
  ];
}

export function ViewportDiag() {
  const [lines, setLines] = useState<string[]>([]);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const update = () => setLines(read());
    update();
    const timer = window.setInterval(update, 1000);
    window.addEventListener("resize", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  if (hidden) return null;
  return (
    <div
      onClick={() => setHidden(true)}
      style={{
        position: "fixed",
        zIndex: 9999,
        left: 8,
        right: 8,
        top: "calc(env(safe-area-inset-top) + 70px)",
        padding: 8,
        borderRadius: 8,
        background: "rgba(0,0,0,0.78)",
        color: "white",
        font: "11px/1.45 ui-monospace, Menlo, monospace",
        whiteSpace: "pre-wrap",
      }}
    >
      {lines.join("\n")}
    </div>
  );
}
