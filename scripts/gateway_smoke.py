"""Smoke-test the integrated AI path: app proxy -> Respan Gateway -> provider.

A local OpenAI-compatible fixture stands in for the real provider, so the check
needs no key and no network. The gateway serves the project's gateway.toml with
its provider base URL pointed at the fixture, and the request goes through the
app's own /api/ai/chat proxy.

Usage: start `npm run dev` with AI_API_BASE=http://127.0.0.1:8087/v1, then npm run gateway:smoke
"""

from __future__ import annotations

import json
import os
import re
import sys
import tempfile
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from gateway import DEFAULT_PORT, ROOT, load_env_file, use_venv_interpreter

MARKER = "FIXTURE-REPLY"


class FixtureProvider(BaseHTTPRequestHandler):
    """Minimal OpenAI-compatible provider: echoes the model it was asked for."""

    def do_POST(self) -> None:  # noqa: N802 - http.server's naming
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}")
        model = body.get("model", "")
        payload = {
            "id": "chatcmpl-fixture",
            "object": "chat.completion",
            "model": model,
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": f"{MARKER} {model}".strip()},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
        }
        raw = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, *_args) -> None:
        pass


def patched_config(fixture_base: str) -> str:
    """The project's gateway.toml, with the provider base URL aimed at the fixture."""
    text = (ROOT / "gateway.toml").read_text(encoding="utf-8")
    patched, replaced = re.subn(r'(?m)^base_url\s*=\s*"[^"]*"', f'base_url = "{fixture_base}"', text, count=1)
    if replaced != 1:
        raise SystemExit("gateway.toml has no provider base_url to point at the fixture")
    return patched


def post_json(url: str, payload: dict) -> tuple[int, str]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.status, response.read().decode()


def main() -> int:
    use_venv_interpreter()
    load_env_file(ROOT / ".env")

    import respan_gateway as rg

    app_url = os.environ.get("APP_URL", "http://127.0.0.1:3000").rstrip("/")
    port = int(os.environ.get("GATEWAY_PORT", str(DEFAULT_PORT)))

    fixture = ThreadingHTTPServer(("127.0.0.1", 0), FixtureProvider)
    threading.Thread(target=fixture.serve_forever, daemon=True).start()
    fixture_base = f"http://127.0.0.1:{fixture.server_address[1]}/v1"

    os.environ["AI_API_KEY"] = "fixture-key"  # the fixture accepts any credential
    with tempfile.TemporaryDirectory() as tmp:
        config_path = Path(tmp) / "gateway.toml"
        config_path.write_text(patched_config(fixture_base), encoding="utf-8")
        gateway = rg.Gateway.from_file(config_path)
        server = gateway.serve(port=port)
        print(f"fixture provider  {fixture_base}")
        print(f"gateway           {server.url}")
        print(f"app proxy         {app_url}/api/ai/chat")
        try:
            try:
                status, raw = post_json(
                    f"{app_url}/api/ai/chat",
                    {
                        "messages": [{"role": "user", "content": "اختبار البوابة"}],
                        "temperature": 0.1,
                        "max_tokens": 32,
                    },
                )
            except urllib.error.URLError as error:
                print(
                    f"cannot reach the app proxy ({error.reason}).\n"
                    f"start it first: AI_API_BASE={server.url}/v1 npm run dev",
                    file=sys.stderr,
                )
                return 1

            data = json.loads(raw)
            content = str(data.get("content", ""))
            requests = gateway.requests(limit=5)
            print(f"status            {status}")
            print(f"content           {content}")
            print(f"gateway requests  {len(requests)}")
            if status != 200 or MARKER not in content:
                print(f"FAIL: the app proxy did not return the fixture reply: {raw[:300]}", file=sys.stderr)
                return 1
            if not requests:
                print("FAIL: the gateway logged no request", file=sys.stderr)
                return 1
            print("PASS: app proxy -> Respan Gateway -> provider fixture")
            return 0
        finally:
            server.stop()
            fixture.shutdown()


if __name__ == "__main__":
    raise SystemExit(main())
