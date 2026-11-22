"""Serve the Respan Gateway locally for the app's AI proxy (see gateway.toml).

The Vite dev proxy at /api/ai/chat forwards to AI_API_BASE; pointing that at
http://127.0.0.1:8087/v1 routes every AI call through the gateway while the
provider key stays in .env.

Usage: npm run gateway
"""

from __future__ import annotations

import importlib.util
import os
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VENV_PYTHONS = (ROOT / ".venv" / "bin" / "python", ROOT / ".venv" / "Scripts" / "python.exe")
DEFAULT_PORT = 8087


def use_venv_interpreter() -> None:
    """Re-run this script with the project's .venv python when it holds the package."""
    if importlib.util.find_spec("respan_gateway") is not None:
        return
    for candidate in VENV_PYTHONS:
        if candidate.exists():
            os.execv(str(candidate), [str(candidate), *sys.argv])
    print(
        "respan-gateway is not installed.\n"
        "  python3 -m venv .venv\n"
        "  .venv/bin/pip install --only-binary=:all: -r requirements.txt",
        file=sys.stderr,
    )
    raise SystemExit(1)


def load_env_file(path: Path) -> None:
    """Copy KEY=VALUE lines from .env into the environment without overriding it."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        entry = line.strip()
        if not entry or entry.startswith("#") or "=" not in entry:
            continue
        name, _, value = entry.partition("=")
        value = value.strip().strip("\"'")
        if name.strip() and value:
            os.environ.setdefault(name.strip(), value)


def main() -> int:
    use_venv_interpreter()
    load_env_file(ROOT / ".env")

    import respan_gateway as rg

    if not os.environ.get("AI_API_KEY"):
        print("AI_API_KEY is empty: set it in .env before starting the gateway.", file=sys.stderr)
        return 1

    port = int(os.environ.get("GATEWAY_PORT", str(DEFAULT_PORT)))
    gateway = rg.Gateway.from_file(ROOT / "gateway.toml")
    server = gateway.serve(port=port)
    print(f"Respan Gateway on {server.url} — set AI_API_BASE={server.url}/v1 (Ctrl-C to stop)")
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        print("\nstopping gateway")
    finally:
        server.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
