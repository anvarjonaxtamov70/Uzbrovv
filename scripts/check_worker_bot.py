#!/usr/bin/env python3
"""Worker `/health?deep=1` javobidan bot ulanganini (webhook) tekshiradi.

Tashxis workflow'i (`.github/workflows/diagnose.yml`) chaqiradi.

Ishlatish:
    python3 scripts/check_worker_bot.py /tmp/wd.json
Chiqish:
    muammo matni (hammasi joyida bo'lsa — bo'sh)
Chiqish kodi:
    0 — bot ulangan, 1 — ulanmagan / eski Worker, 2 — javob o'qilmadi
"""

import json
import sys


def problem(payload: dict) -> str:
    checks = payload.get("checks") or {}
    hook = checks.get("bot_webhook")
    if hook is None:
        return (
            "Worker eski (2.0.0 dan past) — webhook tekshiruvi yo'q. "
            "cloudflare-worker.js ni Cloudflare'ga qayta qo'ying."
        )
    if hook.get("ok"):
        return ""
    return str(hook.get("hint") or "Bot ulanmagan — <WORKER_URL>/setup ni oching.")


def main(argv: list[str]) -> int:
    path = argv[1] if len(argv) > 1 else "-"
    try:
        raw = sys.stdin.read() if path == "-" else open(path, encoding="utf-8").read()
        payload = json.loads(raw)
        if not isinstance(payload, dict):
            raise ValueError("JSON obyekt kutilgan")
    except Exception as error:
        print(f"javob o'qilmadi: {error}")
        return 2

    text = problem(payload)
    print(text)
    return 1 if text else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
