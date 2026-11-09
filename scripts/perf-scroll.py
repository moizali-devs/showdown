"""Scroll-smoothness benchmark for Showdown (Playwright, WebKit + Chromium).

Loads a page, waits for the load-in animations, then wheel-scrolls the whole page
down and back up in small steps while a requestAnimationFrame loop in the page
records every frame interval. Reports frames, avg fps, p50/p95/p99 frame time and
the number of frames slower than 16.7 ms (one 60 Hz frame) and 33.3 ms (dropped
two+ frames). Chromium also reports layer count, long tasks and style/layout
counts via CDP.

Usage (server must already be running):
  python scripts/perf-scroll.py --base http://localhost:5196
  python scripts/perf-scroll.py --base URL --browsers webkit --pages home,hall --viewports 1440x900 --runs 3 --json out.json

Note: WebKit on Windows/Linux is a proxy for Safari on macOS (same engine, different
compositor/GPU backend). Absolute numbers differ; relative before/after holds.
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import urllib.request

from playwright.sync_api import sync_playwright

RECORDER = """
(() => {
  const w = window;
  w.__perf = { frames: [], long: [], last: 0, on: false };
  try {
    new PerformanceObserver(l => { for (const e of l.getEntries()) if (w.__perf.on) w.__perf.long.push(e.duration); })
      .observe({ type: 'longtask', buffered: false });
  } catch (e) { w.__perf.noLongtask = true; }
  const tick = t => {
    const p = w.__perf;
    if (p.on) { if (p.last) p.frames.push(t - p.last); p.last = t; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  w.__perfStart = () => { w.__perf.frames = []; w.__perf.long = []; w.__perf.last = 0; w.__perf.on = true; };
  w.__perfStop = () => { w.__perf.on = false; return { frames: w.__perf.frames, long: w.__perf.long, noLongtask: !!w.__perf.noLongtask }; };
})();
"""


def pct(xs: list[float], p: float) -> float:
    if not xs:
        return 0.0
    s = sorted(xs)
    k = min(len(s) - 1, max(0, round(p / 100 * (len(s) - 1))))
    return s[k]


def summarize(frames: list[float], long: list[float]) -> dict:
    total = sum(frames) or 1
    return {
        "frames": len(frames),
        "avg_fps": round(len(frames) / (total / 1000), 1),
        "p50_ms": round(pct(frames, 50), 1),
        "p95_ms": round(pct(frames, 95), 1),
        "p99_ms": round(pct(frames, 99), 1),
        "max_ms": round(max(frames) if frames else 0, 1),
        "over16": sum(1 for f in frames if f > 17.5),  # >1 vsync at 60 Hz (0.8 ms jitter slack)
        "over33": sum(1 for f in frames if f > 34.2),
        "longtasks": len(long),
        "longtask_ms": round(sum(long), 1),
    }


def resolve_path(base: str, page: str) -> str:
    if page == "home":
        return "/"
    if page == "hall":
        with urllib.request.urlopen(base + "/api/demo") as r:
            return f"/hall/{json.load(r)['showtimeId']}"
    return "/" + page


def scroll_run(pg, step: int, delay_ms: int) -> None:
    height = pg.evaluate("document.documentElement.scrollHeight - innerHeight")
    pg.mouse.move(pg.viewport_size["width"] * 0.9, pg.viewport_size["height"] * 0.5)
    n = max(1, int(height / step) + 2)
    for _ in range(n):
        pg.mouse.wheel(0, step)
        pg.wait_for_timeout(delay_ms)
    pg.wait_for_timeout(300)
    for _ in range(n):
        pg.mouse.wheel(0, -step)
        pg.wait_for_timeout(delay_ms)
    pg.wait_for_timeout(300)


CEILING_JS = """new Promise(r => { const f = []; let l = 0; const t = x => { if (l) f.push(x - l); l = x;
  if (f.length < 120) requestAnimationFrame(t); else r(f); }; requestAnimationFrame(t); })"""


def ceiling(browser) -> float:
    """Median rAF interval on a blank page: the engine's own frame cadence on this machine.
    (Playwright WebKit on Windows ticks at ~40 fps even when idle, so '>16.7 ms' alone misleads.)"""
    pg = browser.new_page()
    pg.set_content("<div style='height:4000px'></div>")
    f = pg.evaluate(CEILING_JS)
    pg.close()
    return pct(f, 50)


def bench(pw, browser_name: str, base: str, pages: list[str], viewports: list[tuple[int, int]], runs: int,
          headed: bool, step: int, delay: int, xray: bool) -> list[dict]:
    out = []
    browser = getattr(pw, browser_name).launch(headless=not headed)
    base_iv = ceiling(browser)
    print(f"[{browser_name}] blank-page cadence: {base_iv:.1f} ms ({1000 / base_iv:.0f} fps ceiling)", flush=True)
    try:
        for vw, vh in viewports:
            for page in pages:
                path = resolve_path(base, page)
                ctx = browser.new_context(viewport={"width": vw, "height": vh}, device_scale_factor=2 if vw < 600 else 1)
                pg = ctx.new_page()
                errors: list[str] = []
                pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
                pg.on("pageerror", lambda e: errors.append(str(e)))
                pg.add_init_script(RECORDER)
                pg.goto(base + path, wait_until="networkidle")
                pg.wait_for_timeout(2000)  # load-in stagger + fonts
                if xray:
                    pg.locator('[data-testid="xray-switch"]').first.click()
                    pg.wait_for_timeout(800)
                cdp = None
                if browser_name == "chromium":
                    cdp = ctx.new_cdp_session(pg)
                    cdp.send("Performance.enable")
                    cdp.send("LayerTree.enable")
                    layers = {"n": 0}
                    cdp.on("LayerTree.layerTreeDidChange", lambda ev: layers.__setitem__("n", len(ev.get("layers") or []) or layers["n"]))
                # idle (no input) frames over 2 s: shows cost of the always-on animation
                pg.evaluate("__perfStart()")
                pg.wait_for_timeout(2000)
                idle = pg.evaluate("__perfStop()")
                results = []
                for _ in range(runs):
                    pg.evaluate("scrollTo(0,0)")
                    pg.wait_for_timeout(400)
                    m0 = {x["name"]: x["value"] for x in cdp.send("Performance.getMetrics")["metrics"]} if cdp else {}
                    pg.evaluate("__perfStart()")
                    scroll_run(pg, step, delay)
                    r = pg.evaluate("__perfStop()")
                    m1 = {x["name"]: x["value"] for x in cdp.send("Performance.getMetrics")["metrics"]} if cdp else {}
                    results.append((r, m0, m1))
                frames = [f for r, _, _ in results for f in r["frames"]]
                long = [f for r, _, _ in results for f in r["long"]]
                row = {"browser": browser_name, "viewport": f"{vw}x{vh}", "page": page + ("+xray" if xray else ""),
                       **summarize(frames, long), "ceiling_fps": round(1000 / base_iv, 1),
                       "dropped": sum(1 for f in frames if f > base_iv * 1.5), "idle_fps": summarize(idle["frames"], [])["avg_fps"],
                       "idle_over16": summarize(idle["frames"], [])["over16"], "console_errors": len(errors)}
                if cdp:
                    _, m0, m1 = results[-1]
                    row.update({
                        "layers": layers["n"],
                        "layouts": int(m1.get("LayoutCount", 0) - m0.get("LayoutCount", 0)),
                        "style_recalcs": int(m1.get("RecalcStyleCount", 0) - m0.get("RecalcStyleCount", 0)),
                        "layout_ms": round((m1.get("LayoutDuration", 0) - m0.get("LayoutDuration", 0)) * 1000, 1),
                        "style_ms": round((m1.get("RecalcStyleDuration", 0) - m0.get("RecalcStyleDuration", 0)) * 1000, 1),
                        "script_ms": round((m1.get("ScriptDuration", 0) - m0.get("ScriptDuration", 0)) * 1000, 1),
                    })
                if errors:
                    row["errors"] = errors[:5]
                out.append(row)
                print(json.dumps(row), flush=True)
                ctx.close()
    finally:
        browser.close()
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5173")
    ap.add_argument("--browsers", default="webkit,chromium")
    ap.add_argument("--pages", default="home")
    ap.add_argument("--viewports", default="1440x900,390x844")
    ap.add_argument("--runs", type=int, default=2)
    ap.add_argument("--step", type=int, default=60, help="px per wheel event")
    ap.add_argument("--delay", type=int, default=16, help="ms between wheel events")
    ap.add_argument("--headed", action="store_true", help="real window (GPU compositing); default headless")
    ap.add_argument("--xray", action="store_true", help="toggle X-Ray on before measuring")
    ap.add_argument("--json", help="write rows to this file")
    a = ap.parse_args()
    vps = [tuple(int(v) for v in s.split("x")) for s in a.viewports.split(",")]
    rows: list[dict] = []
    with sync_playwright() as pw:
        for b in a.browsers.split(","):
            rows += bench(pw, b.strip(), a.base.rstrip("/"), a.pages.split(","), vps, a.runs, a.headed, a.step, a.delay, a.xray)
    if a.json:
        with open(a.json, "w") as f:
            json.dump(rows, f, indent=1)
    cols = ["browser", "viewport", "page", "frames", "avg_fps", "ceiling_fps", "p95_ms", "p99_ms", "over16", "over33", "dropped",
            "longtasks", "idle_fps"]
    print("\n" + " | ".join(cols))
    for r in rows:
        print(" | ".join(str(r.get(c, "")) for c in cols))
    return 0


if __name__ == "__main__":
    sys.exit(main())
