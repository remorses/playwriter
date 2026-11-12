"""Playwriter -- https://playwriter.dev

Copy into browser-use/benchmark as browsers/playwriter.py and register it in
browsers/__init__.py. browser-use drives a dedicated Chrome (no accounts, not the
user's everyday profile) through the Playwriter extension and relay CDP endpoint.

local_headful starts every task with a fresh profile. The extension lives in one
persistent profile, so connect() resets it instead: one blank tab, no cookies, no cache.

Env:
  PLAYWRITER_RELAY         relay host:port (default 127.0.0.1:19988)
  PLAYWRITER_EXTENSION_ID  extension stableKey from /extensions/status. Required: it pins
                           the run to the benchmark Chrome, never another connected Chrome.
"""

import itertools
import json
import os
import uuid
from urllib.parse import urlencode

import websockets

RELAY = os.environ.get("PLAYWRITER_RELAY", "127.0.0.1:19988")


def _cdp_url() -> str:
    # patchright=1 is the relay side of `session new --patchright`: humanized mouse and keyboard
    # on every page. Patchright's Playwright patches do not apply, browser-use is its own CDP client.
    query = urlencode({"extensionId": os.environ["PLAYWRITER_EXTENSION_ID"], "patchright": "1"})
    return f"ws://{RELAY}/cdp/stealth-{uuid.uuid4().hex[:8]}?{query}"


async def _reset_browser() -> None:
    ids = itertools.count(1)
    async with websockets.connect(_cdp_url(), max_size=None) as ws:

        async def send(method: str, params: dict | None = None, session_id: str | None = None):
            msg_id = next(ids)
            msg = {"id": msg_id, "method": method, "params": params or {}}
            if session_id:
                msg["sessionId"] = session_id
            await ws.send(json.dumps(msg))
            while True:
                reply = json.loads(await ws.recv())
                if reply.get("id") == msg_id:
                    if "error" in reply:
                        raise RuntimeError(f"{method}: {reply['error']}")
                    return reply.get("result", {})

        pages = [t for t in (await send("Target.getTargets"))["targetInfos"] if t["type"] == "page"]
        if not pages:
            await send("Target.createTarget", {"url": "about:blank"})
            pages = [t for t in (await send("Target.getTargets"))["targetInfos"] if t["type"] == "page"]
        keep, *extra = pages
        for page in extra:
            await send("Target.closeTarget", {"targetId": page["targetId"]})
        session_id = (await send("Target.attachToTarget", {"targetId": keep["targetId"], "flatten": True}))["sessionId"]
        await send("Page.navigate", {"url": "about:blank"}, session_id)
        # Clears cookies of the whole profile, like a fresh local_headful profile.
        await send("Network.clearBrowserCookies", {}, session_id)
        await send("Network.clearBrowserCache", {}, session_id)


async def connect() -> str:
    await _reset_browser()
    return _cdp_url()


async def disconnect() -> None:
    pass
