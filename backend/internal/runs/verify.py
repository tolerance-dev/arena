"""Checks an agent's app (run by internal/runs/worker.go in a clean arena-runtime container, never in the snapshot).

The app runs in its own container from the agent's snapshot (spec "app_host"); this script pipes 127.0.0.1:3000 to
it, so the checks and the browser see the app on localhost. Nothing the agent wrote runs here.

1. waits for the app to answer;
2. tasks with "ui": checks that / serves HTML, screenshots it on desktop and mobile and checks it shows the seed
   data, all before the API checks change the state; 3. runs the task's checks in order (HTTP calls against the API
   contract, and pages opened in the browser), the hidden ones last and without details.

Writes /verify/out/result.json (+ shot.jpg, shot-mobile.jpg). Logs go to stdout.
"""
import json
import os
import re
import socket
import sys
import threading
import time
import urllib.error
import urllib.request

SPEC = json.load(open("/verify/spec.json"))
OUT = "/verify/out"
PORT = 3000
BASE = f"http://127.0.0.1:{PORT}"
START_TIMEOUT = 90

os.makedirs(OUT, exist_ok=True)
result = {"start": {"ok": False, "seconds": 0, "error": ""}, "checks": [], "console_errors": 0}


def log(*a):
    print("[verify]", *a, flush=True)


def save():
    with open(os.path.join(OUT, "result.json"), "w") as f:
        json.dump(result, f)


# ---------------------------------------------------------------- the app

def http(method, path, body=None, headers=None, timeout=15):
    data = None
    h = dict(headers or {})
    if body is not None:
        data = json.dumps(body).encode()
        h.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers or {}), e.read()


def forward(host, port):
    """Serves 127.0.0.1:PORT and pipes each connection to the app's container (some dev servers refuse other Host
    names, and the app is checked exactly as it would be on localhost)."""
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", PORT))
    srv.listen(256)

    def pipe(a, b):
        try:
            while True:
                d = a.recv(65536)
                if not d:
                    break
                b.sendall(d)
            b.shutdown(socket.SHUT_WR)
        except OSError:
            for x in (a, b):
                try:
                    x.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

    def handle(c):
        try:
            u = socket.create_connection((host, port), timeout=5)
            u.settimeout(None)
        except OSError:
            c.close()
            return
        t = threading.Thread(target=pipe, args=(c, u), daemon=True)
        t.start()
        pipe(u, c)
        t.join()
        c.close()
        u.close()

    def accept():
        while True:
            c, _ = srv.accept()
            threading.Thread(target=handle, args=(c,), daemon=True).start()

    threading.Thread(target=accept, daemon=True).start()


def wait_app():
    if SPEC.get("start_error"):
        result["start"]["error"] = SPEC["start_error"]
        return False
    forward(SPEC["app_host"], int(SPEC.get("app_port") or PORT))
    t0 = SPEC.get("app_started_at") or time.time()  # when the worker started the app's container
    while time.time() - t0 < START_TIMEOUT:
        try:
            status, _, _ = http("GET", "/", timeout=3)
            if status < 500:
                result["start"]["ok"] = True
                result["start"]["seconds"] = round(time.time() - t0, 1)
                log(f"app is up in {result['start']['seconds']}s")
                return True
        except Exception:
            pass
        time.sleep(1)
    result["start"]["error"] = f"nothing answered on port {PORT} within {START_TIMEOUT}s"
    return False


# ---------------------------------------------------------------- automatic checks

MISSING = object()


def resolve(doc, path):
    if path == "":
        return doc
    cur = doc
    for part in path.split("."):
        m = re.fullmatch(r"(\w*)\[(\w+)=([^\]]+)\]", part)
        if m:
            key, fk, fv = m.groups()
            if key:
                cur = cur.get(key, MISSING) if isinstance(cur, dict) else MISSING
            if not isinstance(cur, list):
                return MISSING
            cur = next((x for x in cur if isinstance(x, dict) and str(x.get(fk)) == fv), MISSING)
        elif isinstance(cur, list) and part.isdigit():
            i = int(part)
            cur = cur[i] if i < len(cur) else MISSING
        elif isinstance(cur, dict):
            cur = cur.get(part, MISSING)
        else:
            return MISSING
        if cur is MISSING:
            return MISSING
    return cur


def same(a, b):
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        return abs(a - b) < 0.011
    if isinstance(b, (int, float)) and isinstance(a, str):
        try:
            return abs(float(a) - b) < 0.011
        except ValueError:
            return False
    return a == b


def expect_ok(doc, e):
    v = resolve(doc, e.get("path", ""))
    where = e.get("path") or "body"
    if e.get("absent"):
        return (v is MISSING, f"{where} should be absent")
    if v is MISSING:
        return (False, f"{where} is missing")
    if "equals" in e:
        return (same(v, e["equals"]), f"{where} = {json.dumps(v)[:80]}, want {json.dumps(e['equals'])}")
    if "len" in e:
        n = len(v) if isinstance(v, (list, str, dict)) else -1
        return (n == e["len"], f"len({where}) = {n}, want {e['len']}")
    if e.get("exists"):
        return (v is not None, f"{where} is null")
    if "ids" in e:
        if not isinstance(v, list):
            return (False, f"{where} is not a list")
        got = sorted(str(x.get("id")) for x in v if isinstance(x, dict))
        want = sorted(str(x) for x in e["ids"])
        return (got == want, f"{where} ids = {got}, want {want}")
    if "sorted_by" in e:
        key = e["sorted_by"]
        desc = key.startswith("-")
        key = key.lstrip("-")
        try:
            vals = [float(x[key]) for x in v]
        except Exception:
            return (False, f"{where} items have no numeric {key}")
        ok = vals == sorted(vals, reverse=desc)
        return (ok, f"{where} is not sorted by {e['sorted_by']}")
    return (True, "")


PAGE_TEXT_JS = """() => [document.body ? document.body.innerText : '',
  ...[...document.querySelectorAll('svg text')].map((t) => t.textContent)].join(' ')"""


def ui_checks():
    """The page, on the fresh seed state (before any API check changes it): it serves HTML, it is screenshotted on
    desktop and mobile, and it shows the seed data (spec "ui_text") as HTML or SVG text."""
    checks = []
    status, headers, _ = http("GET", "/")
    ctype = next((v for k, v in headers.items() if k.lower() == "content-type"), "")
    html = status == 200 and "html" in ctype
    checks.append({"name": "home page serves HTML", "passed": html, "detail": "" if html else f"GET / → {status} {ctype}"})
    screenshots()
    want = SPEC.get("ui_text") or []
    if want:
        missing = list(want)
        try:
            text = browser_page("desktop").evaluate(PAGE_TEXT_JS) if html else ""
            low = text.lower()  # CSS text-transform changes innerText
            missing = [w for w in want if w.lower() not in low]
        except Exception as ex:
            log(f"page text failed: {ex}")
        checks.append({"name": "page shows the seed data", "passed": not missing,
                       "detail": "" if not missing else "not on the page after it loads: " + ", ".join(missing)})
    return checks


VAR = re.compile(r"\{(\w+)\}")


def fill(text, saved):
    """Replaces {name} with a value an earlier check saved; KeyError when that check didn't save it."""
    return VAR.sub(lambda m: str(saved[m.group(1)]), text)


def page_check(c):
    page = browser_page("desktop")
    page.goto(BASE + c["page"], wait_until="networkidle", timeout=20000)
    page.wait_for_timeout(800)
    low = page.evaluate(PAGE_TEXT_JS).lower()
    missing = [t for t in c.get("text", []) if t.lower() not in low]
    return (not missing, "" if not missing else f"{c['page']}: not on the page: " + ", ".join(missing))


def run_checks():
    checks = []
    saved = {}
    for c in SPEC["checks"]:
        name = c["name"]
        if c.get("hidden") and not result.get("hidden_from"):
            result["hidden_from"] = time.time()  # the worker cuts the app's output here
        try:
            if c.get("page"):
                ok, detail = page_check(c)
                checks.append({"name": name, "passed": ok, "detail": detail})
                continue
            try:
                path = fill(c["path"], saved)
                expects = [{**e, "path": fill(e.get("path", ""), saved)} for e in c.get("expect", [])]
                headers = {"Authorization": "Bearer " + str(saved[c["auth"]])} if c.get("auth") else {}
            except KeyError as ex:
                checks.append({"name": name, "passed": False, "detail": f"needs {ex.args[0]}, which an earlier check didn't get"})
                continue
            status, _, raw = http(c["method"], path, c.get("body"), headers)
            want = c.get("status_in") or [c.get("status", 200)]
            if status not in want:
                snippet = raw[:160].decode("utf-8", "replace").replace("\n", " ")
                checks.append({"name": name, "passed": False, "detail": f"{c['method']} {path} → {status}, want {want[0] if len(want) == 1 else want}. {snippet}"})
                continue
            doc = None
            if expects or c.get("save"):
                try:
                    doc = json.loads(raw or b"null")
                except ValueError:
                    checks.append({"name": name, "passed": False, "detail": f"{c['method']} {path}: response is not JSON"})
                    continue
            ok, detail = True, ""
            for e in expects:
                good, why = expect_ok(doc, e)
                if not good:
                    ok, detail = False, why
                    break
            for var, p in (c.get("save") or {}).items():
                v = resolve(doc, p)
                if v is not MISSING and v is not None:
                    saved[var] = v
            checks.append({"name": name, "passed": ok, "detail": detail})
        except Exception as ex:  # a hung or broken app fails the check, not the run
            checks.append({"name": name, "passed": False, "detail": f"{type(ex).__name__}: {ex}"[:200]})
    for c, got in zip(SPEC["checks"], checks):
        if c.get("hidden"):
            got["detail"] = ""  # a hidden check's request and expected answer stay hidden
    passed = sum(1 for c in checks if c["passed"])
    log(f"checks: {passed}/{len(checks)} passed")
    return checks


# ---------------------------------------------------------------- browser

pw = browser = None
pages = {}
console_errors = []


def browser_page(kind="desktop"):
    global pw, browser
    if browser is None:
        from playwright.sync_api import sync_playwright
        pw = sync_playwright().start()
        browser = pw.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
    if kind not in pages:
        if kind == "mobile":
            ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        else:
            ctx = browser.new_context(viewport={"width": 1280, "height": 800})
        page = ctx.new_page()
        page.set_default_timeout(10000)
        page.on("console", lambda m: m.type == "error" and console_errors.append(m.text[:300]))
        page.on("pageerror", lambda e: console_errors.append(str(e)[:300]))
        pages[kind] = page
    return pages[kind]


def screenshots():
    for kind, name in (("desktop", "shot.jpg"), ("mobile", "shot-mobile.jpg")):
        try:
            page = browser_page(kind)
            page.goto(BASE + "/", wait_until="networkidle", timeout=20000)
            page.wait_for_timeout(800)
            page.screenshot(path=os.path.join(OUT, name), type="jpeg", quality=72)
        except Exception as ex:
            log(f"screenshot {kind} failed: {ex}")
    result["console_errors"] = len(console_errors)


# ---------------------------------------------------------------- main

def main():
    try:
        ok = wait_app()
        save()
        if not ok:
            log("app did not start:", result["start"]["error"])
            return
        if SPEC.get("ui"):
            result["checks"] = ui_checks()
            save()
        result["checks"] += run_checks()
        result["console_errors"] = len(console_errors)
    finally:
        save()
        try:
            if browser:
                browser.close()
            if pw:
                pw.stop()
        except Exception:
            pass


if __name__ == "__main__":
    main()
    sys.exit(0)
