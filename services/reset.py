"""Botni «yangidek» qilish: faoliyat ma'lumotlarini tozalash.

QOLADI: tovarlar va narxlar (butun katalog), kontent (banner, story,
promo, musiqa), adminlar, bloklanganlar, to'lov rekvizitlari va
ro'yxatdan o'tgan (ismi + telefoni bor) mijozlar.

O'CHIRILADI: do'kon buyurtmalari, Bi-LED buyurtmalari, navbatlar,
Worker kutayotgan buyurtmalar, band vaqtlar, VIP belgilar, kutish
ro'yxati, story javoblari/ko'rishlari/reaksiyalari, savat va
«Saqlanganlar», AI suhbat tarixi. Statistika shu ma'lumotlardan
hisoblangani uchun nolga tushadi. Ismi yoki telefoni yo'q mijozlar
ham o'chiriladi.

Tozalashdan OLDIN to'liq nusxa `backups/before_reset` ga yoziladi —
xato bo'lsa ma'lumotni qaytarish imkoni qoladi.
"""

import logging
from dataclasses import dataclass, field

from config import all_admins, config
from database import queries as q
from services import backup, firebase, identity, shogird, sync

logger = logging.getLogger(__name__)


class ResetAborted(RuntimeError):
    """Zaxira nusxa olinmadi — tozalash boshlanmadi."""


@dataclass
class ResetReport:
    local: dict[str, int] = field(default_factory=dict)
    cloud: dict[str, bool] = field(default_factory=dict)
    users_removed_local: int = 0
    users_removed_cloud: int = 0

    @property
    def cloud_failed(self) -> list[str]:
        return [node for node, ok in self.cloud.items() if not ok]


async def _backup_before_reset() -> None:
    if not config.has_firebase:
        return  # Firebase yo'q — nusxa yozadigan joy yo'q, faqat mahalliy baza
    if not firebase.is_enabled():
        raise ResetAborted("Firebase hozir ulanmagan — zaxira nusxa olinmadi")
    data = await backup.export_all()
    if not await firebase.put("backups/before_reset", data):
        raise ResetAborted("Zaxira nusxa Firebase'ga yozilmadi")


async def cleanup_clients() -> tuple[int, int]:
    """Ismi yoki telefoni yo'q mijozlarni o'chiradi. Qaytaradi: (mahalliy, bulut)."""
    cloud = await sync.purge_incomplete_cloud_users()
    local = await q.purge_incomplete_users(keep_ids=all_admins())
    identity.clear_all_caches()
    return local, cloud


async def reset_bot() -> ResetReport:
    """Botni tozalaydi. Zaxira olinmasa `ResetAborted` ko'taradi."""
    await _backup_before_reset()

    report = ResetReport()
    report.local = await q.reset_activity()
    report.cloud = await sync.reset_cloud_activity()
    report.users_removed_local, report.users_removed_cloud = await cleanup_clients()

    shogird._talks.clear()

    # `backups/latest` endi tozalangan holatni ko'rsatsin
    try:
        await backup.backup_to_firebase()
    except Exception as error:  # noqa: BLE001 — tozalash baribir bajarildi
        logger.warning("Tozalashdan keyingi zaxira yozilmadi: %s", error)

    logger.warning(
        "BOT TOZALANDI: mahalliy=%s, bulut=%s, o'chirilgan mijozlar=%s/%s",
        report.local,
        report.cloud,
        report.users_removed_local,
        report.users_removed_cloud,
    )
    return report
