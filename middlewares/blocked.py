"""Bloklangan mijozning HAR QANDAY xabari/tugmasi to'xtatiladi (Avto_A1 modeli).

Callback bo'lsa — qisqa ogohlantirish (alert). Xabar bo'lsa — ogohlantirish
10 daqiqada bir martadan ko'p yuborilmaydi (spam bo'lmasin). Handler umuman
ishga tushmaydi.
"""

import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any

from aiogram import BaseMiddleware
from aiogram.types import TelegramObject, Update, User

from services.blocked import BLOCKED_TEXT, is_blocked

logger = logging.getLogger(__name__)

_notified: dict[int, float] = {}


class BlockedMiddleware(BaseMiddleware):
    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        user = data.get("event_from_user")
        if not isinstance(user, User) or user.is_bot or not await is_blocked(user.id):
            return await handler(event, data)

        try:
            if isinstance(event, Update) and event.callback_query is not None:
                await event.callback_query.answer(BLOCKED_TEXT, show_alert=True)
            elif isinstance(event, Update) and event.message is not None:
                now = time.time()
                if now - _notified.get(user.id, 0) > 600:
                    if len(_notified) > 5000:
                        _notified.clear()
                    _notified[user.id] = now
                    await event.message.answer(BLOCKED_TEXT)
        except Exception as error:  # noqa: BLE001
            logger.warning("Bloklangan foydalanuvchiga javob yuborilmadi (%s): %s", user.id, error)
        return None
