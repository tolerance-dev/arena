"""Checks an agent's app inside its snapshot container (run by internal/runs/worker.go as root).

1. starts /work/start.sh as uid 1001 (the app can't read /verify: the checklist and the judge token live there);
2. tasks with "ui": checks that / serves HTML, screenshots it on desktop and mobile and checks it shows the seed
   data, all before the API checks change the state; 3. runs the task's API checks in order;
4. lets the judge model use the app (browser + API + code) and score it against the hidden checklist (tasks with a
   judge only; spec "judge" is null otherwise).

Writes /verify/out/result.json (+ shot.jpg, shot-mobile.jpg). Logs go to stdout.
"""
import base64
import json
import os
import re
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request

SPEC = json.load(open("/verify/spec.json"))
OUT = "/verify/out"
APP_UID = 1001
PORT = 3000
BASE = f"http://127.0.0.1:{PORT}"
START_TIMEOUT = 90
JUDGE_TIMEOUT = 15 * 60
JUDGE_MAX_STEPS = 70

os.makedirs(OUT, exist_ok=True)
result = {"start": {"ok": False, "seconds": 0, "error": ""}, "checks": [], "console_errors": 0, "judge": None}


def log(*a):
    print("[verify]", *a, flush=True)


def save():
    with open(os.path.join(OUT, "result.json"), "w") as f:
        json.dump(result, f)


# ---------------------------------------------------------------- start the app

app = None


def demote():
    os.setgroups([])
    os.setgid(APP_UID)
    os.setuid(APP_UID)


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


def start_app():
    global app
    if not os.path.isfile("/work/start.sh"):
        result["start"]["error"] = "no start.sh in /work"
        return False
    subprocess.run(["chown", "-R", f"{APP_UID}:{APP_UID}", "/work"], check=False)
    os.makedirs("/tmp/apphome", exist_ok=True)
    os.chown("/tmp/apphome", APP_UID, APP_UID)
    env = {
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "HOME": "/tmp/apphome", "PORT": str(PORT), "HOST": "0.0.0.0", "NODE_ENV": "production", "LANG": "C.UTF-8",
    }
    logf = open("/tmp/app.log", "wb")
    t0 = time.time()
    app = subprocess.Popen(["sh", "start.sh"], cwd="/work", env=env, stdout=logf, stderr=subprocess.STDOUT,
                           preexec_fn=demote, start_new_session=True)
    while time.time() - t0 < START_TIMEOUT:
        if app.poll() is not None:
            result["start"]["error"] = f"start.sh exited with code {app.returncode}"
            return False
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


def app_log_tail(n=4000):
    try:
        with open("/tmp/app.log", "rb") as f:
            return f.read()[-n:].decode("utf-8", "replace")
    except OSError:
        return ""


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


def rbtree_problem(root):
    """Why root is not a valid red-black tree, or "" when it is (BST order, black root, no red-red, equal black
    heights)."""
    if root is None:
        return ""
    if not isinstance(root, dict):
        return "the root is not an object"
    if root.get("color") != "black":
        return "the root is not black"

    def walk(n, lo, hi, parent_red):
        if n is None:
            return 1
        if not isinstance(n, dict):
            raise ValueError("a node is not an object")
        k, color = n.get("key"), n.get("color")
        if not isinstance(k, (int, float)) or isinstance(k, bool):
            raise ValueError(f"node key {json.dumps(k)[:30]} is not a number")
        if color not in ("red", "black"):
            raise ValueError(f"node {k}: color {json.dumps(color)[:30]}")
        if (lo is not None and k <= lo) or (hi is not None and k >= hi):
            raise ValueError(f"node {k} breaks the search-tree order")
        red = color == "red"
        if red and parent_red:
            raise ValueError(f"red node {k} has a red parent")
        left = walk(n.get("left"), lo, k, red)
        right = walk(n.get("right"), k, hi, red)
        if left != right:
            raise ValueError(f"black heights differ under {k}: {left} vs {right}")
        return left + (0 if red else 1)

    try:
        walk(root, None, None, False)
    except ValueError as ex:
        return str(ex)
    except RecursionError:
        return "the tree is too deep"
    return ""


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
    if e.get("rbtree"):
        why = rbtree_problem(v)
        return (not why, why)
    if e.get("exists"):
        return (v is not None, f"{where} is null")
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
            missing = [w for w in want if w not in text]
        except Exception as ex:
            log(f"page text failed: {ex}")
        checks.append({"name": "page shows the seed data", "passed": not missing,
                       "detail": "" if not missing else "not on the page after it loads: " + ", ".join(missing)})
    return checks


def run_checks():
    checks = []
    saved = {}
    for c in SPEC["checks"]:
        name = c["name"]
        try:
            path = re.sub(r"\{(\w+)\}", lambda m: str(saved.get(m.group(1), m.group(0))), c["path"])
            headers = {}
            if c.get("auth") and "token" in saved:
                headers["Authorization"] = "Bearer " + str(saved["token"])
            status, _, raw = http(c["method"], path, c.get("body"), headers)
            want = c.get("status_in") or [c.get("status", 200)]
            if status not in want:
                snippet = raw[:160].decode("utf-8", "replace").replace("\n", " ")
                checks.append({"name": name, "passed": False, "detail": f"{c['method']} {path} → {status}, want {want[0] if len(want) == 1 else want}. {snippet}"})
                continue
            doc = None
            if c.get("expect") or c.get("save"):
                try:
                    doc = json.loads(raw or b"null")
                except ValueError:
                    checks.append({"name": name, "passed": False, "detail": f"{c['method']} {path}: response is not JSON"})
                    continue
            ok, detail = True, ""
            for e in c.get("expect", []):
                good, why = expect_ok(doc, e)
                if not good:
                    ok, detail = False, why
                    break
            for var, p in (c.get("save") or {}).items():
                v = resolve(doc, p)
                if v is not MISSING:
                    saved[var] = v
            checks.append({"name": name, "passed": ok, "detail": detail})
        except Exception as ex:  # a hung or broken app fails the check, not the run
            checks.append({"name": name, "passed": False, "detail": f"{type(ex).__name__}: {ex}"[:200]})
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


SNAPSHOT_JS = """() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const els = [...document.querySelectorAll('a,button,input,select,textarea,[role=button],[role=link],[role=tab],[onclick]')].filter(vis);
  let i = 0; const items = [];
  for (const el of els.slice(0, 150)) {
    i++; el.setAttribute('data-jid', String(i));
    const label = (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('placeholder') || el.getAttribute('name') || el.getAttribute('title') || '').trim().replace(/\\s+/g, ' ').slice(0, 60);
    let kind = el.tagName.toLowerCase(); if (el.type) kind += ':' + el.type;
    if (el.tagName === 'A' && el.getAttribute('href')) kind += ' →' + el.getAttribute('href').slice(0, 60);
    if (el.tagName === 'SELECT') kind += ' [' + [...el.options].map(o => o.value).slice(0, 12).join('|') + ']';
    items.push('[' + i + '] ' + kind + ' "' + label + '"');
  }
  const text = document.body ? document.body.innerText.replace(/\\n{3,}/g, '\\n\\n') : '';
  return { url: location.href, title: document.title, text: text.slice(0, 7000), items: items.join('\\n') };
}"""


def snapshot(kind):
    page = browser_page(kind)
    try:
        page.wait_for_load_state("networkidle", timeout=5000)
    except Exception:
        pass
    s = page.evaluate(SNAPSHOT_JS)
    return f"URL: {s['url']}\nTitle: {s['title']}\n\nVisible text:\n{s['text']}\n\nInteractive elements (use their [id] with click/fill/select):\n{s['items']}"


def locate(page, a):
    if a.get("id"):
        return page.locator(f"[data-jid=\"{int(a['id'])}\"]").first
    if a.get("selector"):
        return page.locator(a["selector"]).first
    if a.get("text"):
        return page.get_by_text(a["text"], exact=False).first
    raise ValueError("give id, selector or text")


# ---------------------------------------------------------------- judge tools

def tool_http(a):
    path = a.get("path", "/")
    if not path.startswith("/"):
        path = "/" + path
    headers = a.get("headers") or {}
    status, h, raw = http(a.get("method", "GET").upper(), path, a.get("body"), headers, timeout=20)
    ctype = next((v for k, v in h.items() if k.lower() == "content-type"), "")
    body = raw.decode("utf-8", "replace")
    if len(body) > 6000:
        body = body[:6000] + f"\n… ({len(raw)} bytes total)"
    return f"HTTP {status} ({ctype})\n{body}"


def tool_goto(a):
    kind = a.get("viewport", "desktop")
    page = browser_page(kind)
    path = a.get("path", "/")
    if not path.startswith("/"):
        path = "/" + path
    page.goto(BASE + path, wait_until="domcontentloaded", timeout=20000)
    return snapshot(kind)


def tool_click(a):
    kind = a.get("viewport", "desktop")
    page = browser_page(kind)
    locate(page, a).click(timeout=8000)
    page.wait_for_timeout(700)
    return snapshot(kind)


def tool_fill(a):
    kind = a.get("viewport", "desktop")
    page = browser_page(kind)
    el = locate(page, a)
    el.fill(str(a.get("value", "")), timeout=8000)
    if a.get("submit"):
        el.press("Enter")
        page.wait_for_timeout(700)
    return snapshot(kind)


def tool_select(a):
    kind = a.get("viewport", "desktop")
    page = browser_page(kind)
    locate(page, a).select_option(str(a.get("value", "")), timeout=8000)
    page.wait_for_timeout(700)
    return snapshot(kind)


def tool_snapshot(a):
    return snapshot(a.get("viewport", "desktop"))


def tool_screenshot(a):
    kind = a.get("viewport", "desktop")
    page = browser_page(kind)
    png = page.screenshot(type="jpeg", quality=60, full_page=bool(a.get("full_page")))
    return [{"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": base64.b64encode(png).decode()}},
            {"type": "text", "text": f"Screenshot of {page.url} ({kind})"}]


SKIP_DIRS = {"node_modules", ".git", "dist", "build", ".next", "__pycache__", ".venv", "venv", ".cache", ".npm"}


def tool_list_files(a):
    root = os.path.normpath(os.path.join("/work", a.get("path", ".").lstrip("/")))
    if not root.startswith("/work"):
        return "outside /work"
    out = []
    for d, dirs, files in os.walk(root):
        dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS)
        for f in sorted(files):
            p = os.path.join(d, f)
            try:
                out.append(f"{os.path.relpath(p, '/work')} ({os.path.getsize(p)} B)")
            except OSError:
                pass
        if len(out) > 400:
            out.append("… (truncated)")
            break
    return "\n".join(out) or "(empty)"


def tool_read_file(a):
    p = os.path.normpath(os.path.join("/work", a.get("path", "").lstrip("/")))
    if not p.startswith("/work/") or not os.path.isfile(p):
        return "no such file"
    with open(p, "rb") as f:
        raw = f.read(40000)
    text = raw.decode("utf-8", "replace")
    return text if len(raw) < 40000 else text + "\n… (truncated at 40 KB)"


def tool_app_log(a):
    return app_log_tail(6000) or "(empty)"


def obj(props, required=()):
    return {"type": "object", "properties": props, "required": list(required), "additionalProperties": False}


VIEWPORT = {"type": "string", "enum": ["desktop", "mobile"], "description": "Which browser tab: desktop 1280×800 or mobile 390×844 (separate sessions)."}
TARGET = {"id": {"type": "integer", "description": "Element id from the last snapshot ([id])."},
          "selector": {"type": "string", "description": "CSS selector (when there's no id)."},
          "text": {"type": "string", "description": "Visible text to find (when there's no id)."}}

TOOLS = [
    {"name": "http_request", "description": "Call the app's HTTP API directly. Returns status, content type and body (first 6 KB).",
     "input_schema": obj({"method": {"type": "string"}, "path": {"type": "string", "description": "Path with query, e.g. /api/products?q=mug"},
                          "headers": {"type": "object", "additionalProperties": {"type": "string"}}, "body": {"description": "JSON body"}}, ["method", "path"])},
    {"name": "browser_goto", "description": "Open a path of the app in the browser and return a text snapshot: visible text plus numbered interactive elements.",
     "input_schema": obj({"path": {"type": "string"}, "viewport": VIEWPORT}, ["path"])},
    {"name": "browser_click", "description": "Click an element, then return a fresh snapshot.", "input_schema": obj({**TARGET, "viewport": VIEWPORT})},
    {"name": "browser_fill", "description": "Type a value into an input (replacing its content); submit=true presses Enter. Returns a snapshot.",
     "input_schema": obj({**TARGET, "value": {"type": "string"}, "submit": {"type": "boolean"}, "viewport": VIEWPORT}, ["value"])},
    {"name": "browser_select", "description": "Pick an option of a <select> by value. Returns a snapshot.",
     "input_schema": obj({**TARGET, "value": {"type": "string"}, "viewport": VIEWPORT}, ["value"])},
    {"name": "browser_snapshot", "description": "Text snapshot of the current page.", "input_schema": obj({"viewport": VIEWPORT})},
    {"name": "browser_screenshot", "description": "Screenshot of the current page, to judge the visual design. Use it on key pages, desktop and mobile.",
     "input_schema": obj({"viewport": VIEWPORT, "full_page": {"type": "boolean"}})},
    {"name": "list_files", "description": "List the submission's source files (dependencies and build output hidden).", "input_schema": obj({"path": {"type": "string"}})},
    {"name": "read_file", "description": "Read a source file from the submission (first 40 KB).", "input_schema": obj({"path": {"type": "string"}}, ["path"])},
    {"name": "app_log", "description": "The tail of the app's own stdout/stderr.", "input_schema": obj({})},
    {"name": "submit_verdict", "description": "Finish: score every checklist item. Call exactly once, at the end.",
     "input_schema": obj({
         "summary": {"type": "string", "description": "3-6 sentences for the public results page: what works, what doesn't, overall impression."},
         "criteria": {"type": "array", "items": obj({
             "title": {"type": "string", "description": "The checklist item, short."},
             "max": {"type": "integer", "description": "Its maximum points from the checklist."},
             "points": {"type": "integer", "description": "Points awarded, 0..max."},
             "note": {"type": "string", "description": "One or two sentences of evidence."}}, ["title", "max", "points", "note"])},
     }, ["summary", "criteria"])},
]

HANDLERS = {"http_request": tool_http, "browser_goto": tool_goto, "browser_click": tool_click, "browser_fill": tool_fill,
            "browser_select": tool_select, "browser_snapshot": tool_snapshot, "browser_screenshot": tool_screenshot,
            "list_files": tool_list_files, "read_file": tool_read_file, "app_log": tool_app_log}

SYSTEM = """You are the judge of a coding benchmark. An autonomous coding agent was given the task below and built a \
complete web app (backend and frontend) for it. The app is running now at http://127.0.0.1:3000 and you can use it \
through a real browser (desktop and mobile tabs), call its API, and read its source code.

Score it against the hidden checklist. Rules:
- Base every point on evidence you gathered yourself in this session: actually click through the flows in the \
browser, call the API, look at screenshots on desktop AND mobile, read the key source files. Never assume.
- Be strict and fair: partial credit for partial work; a feature that exists only in the API but not in the UI gets \
at most half of the item. Crashes, 500s, broken layouts and data that ignores the provided mock data cost points.
- Don't try to fix or modify the app. Use the test users named in the checklist.
- Be efficient: about 30-50 tool calls is usually enough. Then call submit_verdict once with every checklist item \
(same titles and max points as the checklist) and a short public summary.

## The task the agent was given

{task}

## Hidden checklist (max 100 points)

{checklist}

## Automatic checks already run (for context)

{auto}
"""


def run_judge(auto_checks):
    j = SPEC["judge"]
    try:
        import anthropic
    except ImportError:
        return {"status": "error", "error": "the anthropic package is missing in the runtime image"}
    client = anthropic.Anthropic(base_url=j["base_url"], api_key=j["token"], max_retries=3, timeout=300)
    auto = "\n".join(f"- {'PASS' if c['passed'] else 'FAIL'} {c['name']}" + (f" ({c['detail']})" if c.get("detail") and not c["passed"] else "") for c in auto_checks)
    system = SYSTEM.format(task=SPEC["task_md"], checklist=SPEC["judge_md"], auto=auto)
    messages = [{"role": "user", "content": "Start judging. Begin with a look at the home page on desktop."}]
    t0 = time.time()
    steps = 0
    nudged = False
    while True:
        if steps >= JUDGE_MAX_STEPS or time.time() - t0 > JUDGE_TIMEOUT:
            if nudged:
                return {"status": "error", "error": "the judge ran out of steps without a verdict", "steps": steps, "model": j["model"]}
            nudged = True
            messages.append({"role": "user", "content": "Time is up. Call submit_verdict now with what you have."})
        try:
            resp = client.beta.messages.create(
                model=j["model"], max_tokens=16000, system=system, tools=TOOLS, messages=messages,
                output_config={"effort": "medium"},
                betas=["server-side-fallback-2026-07-01"], fallbacks="default",
                cache_control={"type": "ephemeral"},
            )
        except anthropic.APIStatusError as e:
            msg = str(getattr(e, "message", e))
            if e.status_code == 503 and "judge_not_configured" in msg:
                return {"status": "skipped", "error": "no judge key configured on the platform"}
            return {"status": "error", "error": f"judge API error {e.status_code}: {msg[:300]}", "steps": steps, "model": j["model"]}
        except anthropic.APIConnectionError as e:
            return {"status": "error", "error": f"judge API unreachable: {e}"[:300], "steps": steps, "model": j["model"]}
        steps += 1
        if resp.stop_reason == "refusal":
            return {"status": "error", "error": "the judge model declined", "steps": steps, "model": j["model"]}
        messages.append({"role": "assistant", "content": resp.content})
        uses = [b for b in resp.content if b.type == "tool_use"]
        if not uses:
            if resp.stop_reason == "pause_turn":
                continue
            messages.append({"role": "user", "content": "Keep going; finish by calling submit_verdict."})
            if nudged:
                return {"status": "error", "error": "the judge stopped without a verdict", "steps": steps, "model": j["model"]}
            nudged = True
            continue
        results = []
        verdict = None
        for u in uses:
            inp = u.input if isinstance(u.input, dict) else {}
            if u.name == "submit_verdict":
                verdict = inp
                results.append({"type": "tool_result", "tool_use_id": u.id, "content": "Verdict recorded."})
                continue
            fn = HANDLERS.get(u.name)
            try:
                out = fn(inp) if fn else f"unknown tool {u.name}"
                results.append({"type": "tool_result", "tool_use_id": u.id, "content": out})
            except Exception as ex:
                results.append({"type": "tool_result", "tool_use_id": u.id, "is_error": True, "content": f"{type(ex).__name__}: {ex}"[:1500]})
            log(f"judge step {steps}: {u.name} {json.dumps(inp)[:120]}")
        if verdict is not None:
            return finish_verdict(verdict, steps, j["model"])
        messages.append({"role": "user", "content": results})


def finish_verdict(v, steps, model):
    crit = []
    for c in v.get("criteria") or []:
        try:
            mx = max(0, int(c.get("max", 0)))
            pts = min(mx, max(0, int(c.get("points", 0))))
        except (TypeError, ValueError):
            continue
        crit.append({"title": str(c.get("title", ""))[:120], "max": mx, "points": pts, "note": str(c.get("note", ""))[:600]})
    total_max = sum(c["max"] for c in crit) or 100
    score = round(100 * sum(c["points"] for c in crit) / total_max)
    log(f"judge verdict: {score}/100 after {steps} steps")
    return {"status": "ok", "score": max(0, min(100, score)), "summary": str(v.get("summary", ""))[:2000], "criteria": crit,
            "steps": steps, "model": model}


# ---------------------------------------------------------------- main

def main():
    try:
        ok = start_app()
        save()
        if not ok:
            log("app did not start:", result["start"]["error"])
            log("app log:\n" + app_log_tail())
            result["judge"] = {"status": "skipped", "error": "the app did not start"} if SPEC.get("judge") else {"status": "off"}
            return
        if SPEC.get("ui"):
            result["checks"] = ui_checks()
            save()
        result["checks"] += run_checks()
        save()
        if not SPEC.get("judge"):
            result["judge"] = {"status": "off"}
            return
        try:
            result["judge"] = run_judge([{"name": "app starts with start.sh", "passed": True}] + result["checks"])
        except Exception as ex:
            result["judge"] = {"status": "error", "error": f"{type(ex).__name__}: {ex}"[:400]}
        result["console_errors"] = len(console_errors)
    finally:
        save()
        if app and app.poll() is None:
            try:
                os.killpg(app.pid, signal.SIGKILL)
            except OSError:
                pass
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
