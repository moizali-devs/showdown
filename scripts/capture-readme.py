"""Capture README media into docs/media. Run with the dev server up (npm run dev):
   python scripts/capture-readme.py   (needs: pip install playwright pillow; ffmpeg on PATH for race.gif)"""
import json, re, subprocess, tempfile, time, urllib.request, shutil
from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image

import os
BASE = os.environ.get("BASE", "http://localhost:5173")
OUT = Path(__file__).resolve().parent.parent / "docs" / "media"
OUT.mkdir(parents=True, exist_ok=True)
SHOW = json.load(urllib.request.urlopen(BASE + "/api/demo"))["showtimeId"]
SD = f"{BASE}/showdown?show={SHOW}"

def shrink(p, limit=1_500_000):
    p = Path(p)
    im = Image.open(p)
    while p.stat().st_size > limit:
        im = im.resize((int(im.width * .85), int(im.height * .85)), Image.LANCZOS)
        im.save(p, optimize=True)

def save(page_or_el, name, **kw):
    path = OUT / name
    page_or_el.screenshot(path=str(path), **kw)
    shrink(path)

def goto(page, url, wait=2500):
    page.goto(url, wait_until="networkidle")
    page.wait_for_timeout(wait)

def sd_mode(page, label):
    page.get_by_role("button", name=label, exact=True).click()
    page.wait_for_timeout(500)

def sd_run(page):
    page.get_by_role("button", name="Run", exact=True).click()

def sd_reset(page):
    page.get_by_role("button", name="Reset", exact=True).click()
    page.wait_for_timeout(800)

def wait_result(page, timeout=20000):
    page.wait_for_function("document.querySelector('[data-testid=result]').textContent.trim().length>3", timeout=timeout)
    page.wait_for_timeout(1800)

with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"])
    def ctx(w, h, xray=False, **kw):
        c = br.new_context(viewport={"width": w, "height": h}, device_scale_factor=2, **kw)
        # every capture starts with an explicit X-Ray state ('1' on, '0' off)
        c.add_init_script(f"try{{localStorage.setItem('showdown.xray','{'1' if xray else '0'}')}}catch(e){{}}")
        return c

    # 1 home (cinema, X-Ray off)
    c = ctx(1440, 900); p = c.new_page()
    goto(p, BASE + "/", 4000)
    save(p, "hero.png")
    # toggle through the nav switch to prove it works, then capture the X-Ray home
    p.locator('[data-testid=xray-switch]').click(); p.wait_for_timeout(2500)
    p.mouse.move(5, 5); p.wait_for_timeout(500)
    save(p, "xray-home.png")
    c.close()

    # 2 xray: Showdown in Lock mode with X-Ray on, mid-race
    c = ctx(1440, 1000, xray=True); p = c.new_page()
    goto(p, SD, 3500)
    sd_reset(p)
    sd_mode(p, "Lock"); sd_run(p)
    p.wait_for_function("document.body.innerText.toLowerCase().includes('waiting')", timeout=20000, polling=30)
    p.wait_for_timeout(1200)
    save(p, "xray.png")
    wait_result(p)
    sd_reset(p)
    c.close()

    # 3,4 showdown
    c = ctx(1440, 1000); p = c.new_page()
    goto(p, SD)
    sd_reset(p)
    sd_mode(p, "Off"); sd_run(p); wait_result(p)
    save(p, "showdown-off.png")
    sd_reset(p)
    sd_mode(p, "Lock"); sd_run(p)
    p.wait_for_function("document.body.innerText.toLowerCase().includes('waiting')", timeout=20000, polling=30)
    p.wait_for_timeout(300)
    save(p, "showdown-lock.png")
    wait_result(p)
    sd_reset(p)
    c.close()

    # 5 hall
    c = ctx(1440, 1000); p = c.new_page()  # X-Ray off
    goto(p, f"{BASE}/hall/{SHOW}", 3500)
    for s in ["F6", "F7", "F8"]:
        e = p.get_by_role("button", name=re.compile(rf"^Seat {s},")); e.focus(); p.keyboard.press("Enter"); p.wait_for_timeout(500)
    p.mouse.move(5, 5); p.wait_for_timeout(1500)
    save(p, "hall.png")
    c.close()

    # 6-9 lab
    c = ctx(1440, 800); p = c.new_page()
    goto(p, BASE + "/lab", 3000)
    secs = p.locator("section")
    def sec(i):
        s = secs.nth(i); s.scroll_into_view_if_needed(); return s
    s = sec(0)
    s.get_by_role("switch").evaluate("e=>e.getAttribute('aria-checked')")
    if s.get_by_role("switch").get_attribute("aria-checked") == "true": s.get_by_role("switch").click()
    s.get_by_role("button", name="Run", exact=True).click()
    p.wait_for_function("document.querySelectorAll('section')[0].innerText.toLowerCase().includes('abort')", timeout=30000)
    p.wait_for_timeout(2500); s.scroll_into_view_if_needed()
    save(s, "lab-deadlock.png")
    s = sec(1)
    s.get_by_role("button", name="Lock", exact=True).click()
    s.get_by_role("button", name="Release 50").click()
    p.wait_for_function("document.querySelectorAll('section')[1].innerText.includes('50')&&/booked/i.test(document.querySelectorAll('section')[1].innerText)&&!document.querySelectorAll('section')[1].innerText.includes('Racing')", timeout=60000)
    p.wait_for_timeout(3000)
    save(s, "lab-rush.png")
    s = sec(2)
    r = s.locator("input[type=range]"); p.wait_for_timeout(1500)
    mx = int(r.get_attribute("max") or 0)
    r.evaluate("(e,v)=>{const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(e,String(v));e.dispatchEvent(new Event('input',{bubbles:true}))}", int(mx * .45))
    p.wait_for_timeout(2000)
    save(s, "lab-timemachine.png")
    s = sec(3); p.wait_for_timeout(1500)
    save(s, "lab-serializability.png")
    c.close()

    # 10 mobile
    c = ctx(390, 844, is_mobile=True, has_touch=True); p = c.new_page()
    shots = []
    for name, url, w in [("m1", BASE + "/", 4000), ("m2", SD, 2500), ("m3", f"{BASE}/hall/{SHOW}", 3500)]:
        goto(p, url, w); f = Path(tempfile.gettempdir()) / f"{name}.png"; p.screenshot(path=str(f)); shots.append(f)
    c.close()
    ims = [Image.open(f).convert("RGB") for f in shots]
    gap = 80; W = sum(i.width for i in ims) + gap * 4; H = ims[0].height + gap * 2
    canvas = Image.new("RGB", (W, H), "#ECEAE5"); x = gap
    for i in ims: canvas.paste(i, (x, gap)); x += i.width + gap
    canvas.save(OUT / "mobile.png", optimize=True); shrink(OUT / "mobile.png")

    # 11 gif
    vd = Path(tempfile.mkdtemp())
    c = br.new_context(viewport={"width": 1200, "height": 800}, record_video_dir=str(vd), record_video_size={"width": 1200, "height": 800})
    c.add_init_script("try{localStorage.setItem('showdown.xray','0')}catch(e){}")
    p = c.new_page(); goto(p, SD, 2000)
    sd_reset(p)
    sd_mode(p, "Lock"); p.wait_for_timeout(700); sd_run(p); wait_result(p)
    sd_reset(p); sd_mode(p, "Off"); p.wait_for_timeout(700); sd_run(p); wait_result(p)
    p.wait_for_timeout(800)
    sd_reset(p)
    c.close(); br.close()
    webm = next(vd.glob("*.webm"))
    pal = vd / "pal.png"
    vf = "fps=10,scale=1000:-1:flags=lanczos"
    subprocess.run(["ffmpeg", "-y", "-i", str(webm), "-vf", vf + ",palettegen=max_colors=96", str(pal)], check=True, capture_output=True)
    subprocess.run(["ffmpeg", "-y", "-i", str(webm), "-i", str(pal), "-lavfi", vf + "[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5", str(OUT / "race.gif")], check=True, capture_output=True)
    shutil.rmtree(vd, ignore_errors=True)
print("done")
