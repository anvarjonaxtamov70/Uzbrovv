"""Bloklangan mijozlar (Avto_A1 modeli).

Admin Mini App'dagi «Mijozlar» oynasida mijozni bloklasa, Worker
`{ROOT}/blocked_users/{uid}` ga yozadi. Shu tugun UCH joyda tekshiriladi:

  * bot — `BlockedMiddleware` (hech qanday xabar/tugmaga javob bermaydi);
  * Render API — `api/routes.py: _current_user` (403 `blocked`);
  * Worker — `verifyInitData` (403 `blocked`).

Adminlar hech qachon bloklanmaydi. Baza javob bermasa «fail-open» —
bitta tarmoq xatosi tufayli hamma mijoz to'xtab qolmasin. Natija 60 soniya
keshlanadi (har xabarda bazaga bormaslik uchun).
"""

import time

from config import is_admin
from services import firebase

BLOCKED_TEXT = (
    "⛔ Hisobingiz administrator tomonidan bloklangan.\n"
    "Bot va ilovadan foydalanib bo'lmaydi."
)

_TTL = 60
_cache: dict[int, tuple[bool, float]] = {}


async def is_blocked(user_id) -> bool:
    try:
        uid = int(str(user_id))
    except (TypeError, ValueError):
        return False
    if is_admin(uid) or not firebase.is_enabled():
        return False
    now = time.time()
    hit = _cache.get(uid)
    if hit and hit[1] > now:
        return hit[0]
    try:
        value = await firebase.get(f"blocked_users/{uid}")
    except Exception:  # noqa: BLE001 — fail-open
        return False
    blocked = bool(value)
    if len(_cache) > 5000:
        _cache.clear()
    _cache[uid] = (blocked, now + _TTL)
    return blocked
