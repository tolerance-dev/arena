"""Checks an agent's app (run by internal/runs/worker.go in a clean arena-runtime container, never in the snapshot).

The app runs in its own container from the agent's snapshot (spec "app_host"); this script pipes 127.0.0.1:3000 to
it, so the checks and the browser see the app on localhost. Nothing the agent wrote runs here.

1. waits for the app to answer;
2. tasks with "ui": checks that / serves HTML, screenshots it on desktop and mobile and checks it shows the seed
   data, all before the API checks change the state; 3. runs the task's checks in order (HTTP calls against the API
   contract, pages opened in the browser, then the browser scenarios: flows clicked through like a person would),
   the hidden ones last and without details.

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


def norm(text):
    """Page text as the checks compare it: lower case (CSS text-transform changes innerText), one space for any run
    of whitespace, straight quotes."""
    text = text.lower().translate({0x2018: "'", 0x2019: "'", 0x201C: '"', 0x201D: '"', 0xA0: " "})
    return re.sub(r"\s+", " ", text)


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
    low = norm(page.evaluate(PAGE_TEXT_JS))
    want = c.get("text", [])
    missing = [t for t in want if norm(t) not in low]
    if c.get("min"):  # at least min of the texts
        found = len(want) - len(missing)
        return (found >= c["min"], "" if found >= c["min"] else f"{c['page']}: {found} of them on the page, want at least {c['min']}, e.g. " + ", ".join(want[:3]))
    return (not missing, "" if not missing else f"{c['page']}: not on the page: " + ", ".join(missing))


def run_checks():
    checks = []
    saved = {}
    for c in SPEC["checks"]:
        name = c["name"]
        if c.get("hidden") and not result.get("hidden_from"):
            result["hidden_from"] = time.time()  # the worker cuts the app's output here
        try:
            if c.get("browser"):
                ok, detail = scenario_check(c["browser"])
                checks.append({"name": name, "passed": ok, "detail": detail})
                continue
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
    close_flows()
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


# ---------------------------------------------------------------- browser scenarios
# A browser check is a few steps (spec "browser": {"flow", "steps", "needs", "gives"}) in the browser context of its
# flow, made fresh when the flow starts: goto, signin, fill a field found by its label, click a button or link by its
# name, expect texts on the page or their absence, reload, wait. Pages render late (SPAs), so finding things and
# expecting texts poll for a few seconds. "gives" names what the check got (signin, cart …) when it passed; a check
# that "needs" something no passed check gave fails without running.

POLL_S = 6
SIGN_IN = r"\b(sign|log)\s*-?\s*in\b"

FIND_FIELD_JS = """([rx, css]) => {
  const re = new RegExp(rx, 'i')
  document.querySelectorAll('[data-verify-pick]').forEach((el) => el.removeAttribute('data-verify-pick'))
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' }
  const text = (el) => {
    if (!el) return ''
    const c = el.cloneNode(true)
    c.querySelectorAll('input, select, textarea, option').forEach((x) => x.remove())
    return c.textContent || ''
  }
  const names = (el) => [el.getAttribute('aria-label'), el.getAttribute('placeholder'), el.getAttribute('name'), el.id,
    el.getAttribute('title'), ...[...(el.labels || [])].map(text),
    ...(el.getAttribute('aria-labelledby') || '').split(/\\s+/).filter(Boolean).map((id) => text(document.getElementById(id)))]
  const fields = [...document.querySelectorAll('input, select, textarea')].filter((f) => shown(f) && !f.disabled && !f.readOnly
    && !['hidden', 'password', 'checkbox', 'radio', 'submit', 'button', 'image', 'reset', 'file'].includes((f.type || '').toLowerCase()))
  let el = fields.find((f) => names(f).some((n) => n && re.test(n)))
  if (!el && css) el = fields.find((f) => f.matches(css))
  if (!el) return null
  el.setAttribute('data-verify-pick', '1')
  return el.tagName.toLowerCase()
}"""

SELECT_JS = """(el, want) => {
  const w = want.toLowerCase()
  return [...el.options].findIndex((o) => o.text.trim().toLowerCase() === w || o.value.toLowerCase() === w
    || o.text.toLowerCase().includes(w))
}"""

flows = {}  # flow → (context, page); one at a time
got = set()  # what passed browser checks gave


class StepFailed(Exception):
    pass


def flow_page(flow):
    if flow not in flows:
        close_flows()
        browser_page("desktop")  # starts the browser
        ctx = browser.new_context(viewport={"width": 1280, "height": 800})
        page = ctx.new_page()
        page.set_default_timeout(10000)
        page.on("dialog", lambda d: d.accept())  # confirm("Cancel the booking?") and alerts
        flows[flow] = (ctx, page)
    return flows[flow][1]


def close_flows():
    for ctx, _ in flows.values():
        try:
            ctx.close()
        except Exception:
            pass
    flows.clear()


def where(page):
    try:
        u = page.url
        return u[len(BASE):] or "/" if u.startswith(BASE) else u
    except Exception:
        return "?"


def settle(page, ms=600):
    try:
        page.wait_for_load_state("networkidle", timeout=4000)
    except Exception:
        pass
    page.wait_for_timeout(ms)


def poll(fn, seconds=POLL_S):
    """fn() until it returns something truthy (a page in the middle of navigating throws: try again)."""
    end = time.time() + seconds
    while True:
        try:
            v = fn()
            if v:
                return v
        except Exception:
            pass
        if time.time() > end:
            return None
        time.sleep(0.3)


def clickable(page, rx):
    """The first visible button or link (then menu item, tab) whose accessible name matches rx."""
    pat = re.compile(rx, re.I)
    for role in ("button", "link", "menuitem", "tab"):
        loc = page.get_by_role(role, name=pat)
        for i in range(min(loc.count(), 30)):
            if loc.nth(i).is_visible():
                return loc.nth(i)
    return None


def field(page, rx, css=""):
    tag = poll(lambda: page.evaluate(FIND_FIELD_JS, [rx, css]))
    if not tag:
        raise StepFailed(f"{where(page)}: no field labelled /{rx}/")
    return tag, page.locator("[data-verify-pick]").first


def visible_password(page):
    loc = page.locator("input[type=password]")
    for i in range(min(loc.count(), 5)):
        if loc.nth(i).is_visible():
            return loc.nth(i)
    return None


def alts(item):
    return item if isinstance(item, list) else [item]


def step_fill(page, st):
    if st.get("or_click"):  # no such field: the button that does the same (a quantity's "+"), clicked once
        found = poll(lambda: page.evaluate(FIND_FIELD_JS, [st["fill"], st.get("css", "")]) or clickable(page, st["or_click"]))
        if found and not isinstance(found, str):
            found.click()
            settle(page)
            return
    if st.get("open") and not poll(lambda: page.evaluate(FIND_FIELD_JS, [st["fill"], st.get("css", "")]), 2):
        opener = poll(lambda: clickable(page, st["open"]), 2)  # a search icon that opens the field or its page
        if opener:
            opener.click()
            settle(page)
    tag, el = field(page, st["fill"], st.get("css", ""))
    value = str(st["value"])
    if tag == "select":
        i = el.evaluate(SELECT_JS, value)
        if i < 0:
            raise StepFailed(f"{where(page)}: the /{st['fill']}/ list has no {value}")
        el.select_option(index=i)
    else:
        el.fill(value)
    if st.get("key"):
        el.press(st["key"])
    settle(page, 300)


def step_signin(page, st):
    if not poll(lambda: visible_password(page), 1.5):
        ctl = poll(lambda: clickable(page, SIGN_IN))
        if not ctl:
            raise StepFailed(f"{where(page)}: no Sign in or Log in button or link")
        ctl.click()
        settle(page, 300)
        if not poll(lambda: visible_password(page)):
            raise StepFailed(f"{where(page)}: no password field after clicking Sign in")
    _, email = field(page, r"e-?mail|user|login", "input[type=email]")
    email.fill(st["email"])
    pw = visible_password(page)
    pw.fill(st["password"])
    pw.press("Enter")
    settle(page)


def in_menu(page, rx, find):
    """Opens the account menu (a button with the user's name, "Account" …, or any element with that text: some are
    plain divs) and returns find() once one of them shows it; None when none does."""
    if not rx:
        return None
    pat = re.compile(rx, re.I)
    tried = 0
    for loc in [clickable(page, rx), *(page.get_by_text(pat).nth(i) for i in range(min(page.get_by_text(pat).count(), 8)))]:
        if tried >= 5:
            break
        try:
            if loc is None or not loc.is_visible():
                continue
            tried += 1
            loc.click(timeout=3000)
            settle(page, 300)
        except Exception:
            continue
        got = poll(find, 1.5)
        if got:
            return got
    return None


def step_click(page, st):
    el = poll(lambda: clickable(page, st["click"]), 2 if st.get("optional") or st.get("menu") else POLL_S)
    if not el and st.get("menu"):
        el = in_menu(page, st["menu"], lambda: clickable(page, st["click"]))
    if not el:
        if st.get("optional"):
            return
        raise StepFailed(f"{where(page)}: no visible button or link named /{st['click']}/")
    el.click()
    settle(page)


def step_expect(page, items, absent, menu=None):
    def check():
        low = norm(page.evaluate(PAGE_TEXT_JS))
        bad = [alts(i)[0] for i in items if any(norm(a) in low for a in alts(i)) == absent]
        return bad, not bad
    res = poll(lambda: check()[1] and "ok")
    if not res and menu:  # maybe in the account menu
        res = in_menu(page, menu, lambda: check()[1] and "ok")
    if res:
        return
    try:
        bad = check()[0]
    except Exception as ex:
        raise StepFailed(f"{where(page)}: the page didn't render: {type(ex).__name__}")
    what = "still on the page" if absent else "not on the page"
    raise StepFailed(f"{where(page)}: {what} after {POLL_S}s: " + ", ".join(bad))


def step_control(page, rx, menu=None):
    """A visible button or link named rx (its text or aria-label: Sign out may be an icon), maybe in the account menu."""
    if poll(lambda: clickable(page, rx)) or in_menu(page, menu, lambda: clickable(page, rx)):
        return
    raise StepFailed(f"{where(page)}: no visible button or link named /{rx}/ after {POLL_S}s")


def run_step(page, st):
    if "goto" in st:
        page.goto(BASE + st["goto"], wait_until="domcontentloaded", timeout=20000)
        settle(page)
    elif st.get("reload"):
        page.reload(wait_until="domcontentloaded", timeout=20000)
        settle(page)
    elif "wait" in st:
        page.wait_for_timeout(int(st["wait"] * 1000))
    elif "signin" in st:
        step_signin(page, st["signin"])
    elif "fill" in st:
        step_fill(page, st)
    elif "click" in st:
        step_click(page, st)
    elif "control" in st:
        step_control(page, st["control"], st.get("menu"))
    elif "no_control" in st:
        if not poll(lambda: not clickable(page, st["no_control"]) and "gone"):
            raise StepFailed(f"{where(page)}: still a button or link named /{st['no_control']}/ after {POLL_S}s")
    elif "expect" in st:
        step_expect(page, st["expect"], False, st.get("menu"))
    elif "absent" in st:
        step_expect(page, st["absent"], True)
    else:
        raise ValueError(f"unknown step {st}")


def scenario_check(b):
    for need in b.get("needs", []):
        if need not in got:
            return False, f"needs {need}, which an earlier check didn't get"
    page = flow_page(b["flow"])
    try:
        for st in b["steps"]:
            run_step(page, st)
    except StepFailed as ex:
        return False, str(ex)[:300]
    except Exception as ex:  # a Playwright timeout, a crashed page
        return False, f"{where(page)}: {type(ex).__name__}: {str(ex).splitlines()[0] if str(ex) else ''}"[:300]
    if b.get("gives"):
        got.add(b["gives"])
    return True, ""


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
