# Uzbrovv — katta yangilanish rejasi (2026)

Har bosqich alohida PR bo'lib chiqadi: avval shu bosqich tugaydi, tekshiriladi,
keyin keyingisiga o'tiladi. Dizayn hamma joyda bir xil: iOS 26 «Liquid Glass»,
qorong'i fon, brend rangi rang generatoridan (`--h/--s/--l`).

| # | Bosqich | Holat |
|---|---|---|
| 1 | Bi-LED Studio — 3D konfigurator | ✅ shu PR |
| 2 | Fara polirovka — «oldin/keyin» surgich | ⏳ keyingi |
| 3 | Fara shishasini almashtirish — mashinaga qarab narx + navbat | ⏳ |
| 4 | Rul chexol — materiallar va ranglar (admin boshqaradi) | ⏳ |
| 5 | O'rindiq chexol — 20 qismli o'rindiq, dizaynlar (admin boshqaradi) | ⏳ |
| 6 | «Tez kunda»: Akvaprint, Tonirovka, Broni plyonka | ⏳ |
| 7 | Navbat uchun 100 000 so'm oldindan to'lov (zalog) → admin tasdig'i | ⏳ savol bor |
| 8 | Xizmat kafolati — admin muddat belgilaydi, mijoz va admin ko'radi | ⏳ |

---

## 1. Bi-LED Studio — 3D konfigurator ✅

**Oqim:** mashina → 3D studiya (Linza · Fara ichi · Ochki · Shisha · Korpus · Yakun).

- Linza: R50 / R80 / R90 — 3D'da o'lcham, qoplama va yorug'lik farq qiladi.
- Fara ichi: asl rang (xrom) yoki qora.
- Ochki: oddiy yoki BMW halqa (xrom/qora, yonmaydi); BMW yonadigan halqa —
  mijoz istalgan rangni tanlaydi (10 ta tayyor rang + rang g'ildiragi).
- Shisha va korpus: «hozirgisi» yoki «yangisi», narxi mashinaga qarab.
- Yorug'lik: o'chiq · gabarit · yaqin · uzoq. Kamera: umumiy · linza · yon · nur
  (devorda nur izi, yaqin nurning kesish chizig'i).
- Admin: **Boshqaruv → Bi-LED konfigurator** — barcha narx, nom, tavsif,
  kafolat, yoqish/o'chirish va mashina bo'yicha shisha/korpus narxi.

**Texnik:** `docs/js/headlight3d.js` (procedural 3D, three.js
`docs/vendor/three.min.js`, ≈150 KB gzip, faqat konfigurator ochilganda
yuklanadi), `docs/js/app.js` (UI), `docs/js/offline.js` (`studio()`),
`cloudflare-worker.js` 2.1.0 (`createStudioOrder` — narx serverda),
`docs/js/admin-shop.js` (`openStudioAdmin`).

**Ishga tushirish:** Worker'ni 2.1.0 ga yangilang (WORKER_SETUP.md), keyin
admin panelda narxlarni tekshiring — hozirgi qiymatlar vaqtinchalik standart.

## 2. Fara polirovka — «oldin/keyin»

- Xizmat oynasida katta fara rasmi: chap tomoni **toza**, o'ng tomoni **xira,
  sarg'aygan**. O'rtada surgich (tayoqcha): chapga surilsa toza qism kengayadi,
  o'ngga surilsa xira qism qaytadi. Barmoq bilan silliq, haptic bilan.
- Rasmlar admin yuklaydi (toza va xira juftligi); yuklanmagan bo'lsa — 3D
  studiyadagi faraning o'zidan «eski shisha» va «yangi shisha» holati.
- Pastda narx, davomiylik, kafolat va «Navbat olish».

## 3. Fara shishasini almashtirish

- Avval mashina tanlanadi → narx o'sha mashinaniki (`catalog/cars/{id}.glass_price`,
  1-bosqichda qo'shilgan; bo'lmasa standart narx).
- Keyin navbat (kun → vaqt), navbat yozuvida mashina va narx saqlanadi.
- Narxni server qayta hisoblaydi.

## 4. Rul chexol tikish

- Admin: materiallar ro'yxati (nomi, narxi, tavsif) va har material uchun
  ranglar (nomi, rang kodi). Qo'shish / o'zgartirish / o'chirish / tartib.
- Mijoz: rul ko'rinishi (tikiladigan qismlari ajratilgan), material va rang
  tanlanganda rulning **aynan tikiladigan joyi** o'sha rangga kiradi.
  Ip rangi alohida.
- Narx = material narxi; buyurtma → navbat.

## 5. O'rindiq chexol tikish

- Bitta o'rindiq, **20 qismga** bo'lingan (bosh tayanch, yelka, o'rta panel,
  yon bolsterlar, o'tirgich va h.k.). Har qism alohida bo'yaladi.
- Admin: dizaynlar — nomi, narxi, har 20 qism rangi, ip rangi; saqlash,
  o'zgartirish, nusxa olish, o'chirish.
- Mijoz: dizaynlar karuseli, tanlanganda o'rindiq jonli o'zgaradi.

## 6. «Tez kunda» — Akvaprint, Tonirovka, Broni plyonka

- Har biriga alohida chiroyli oyna (animatsiyali fon, nima bo'lishi haqida
  qisqa matn, «Xabar bering» tugmasi — ishga tushganda botda xabar keladi).

## 7. Oldindan to'lov (zalog) — 100 000 so'm

- Har bir xizmat navbatida: vaqt tanlangach **100 000 so'm** oldindan to'lov.
- To'lov o'tgach navbat «To'lov tekshirilmoqda» holatiga o'tadi, admin
  **tasdiqlaydi** → «Tasdiqlangan». Tasdiqlanmasa slot bo'shatiladi.
- Summa admin panelda o'zgartiriladi.
- **Savol:** to'lov usuli (pastda).

## 8. Xizmat kafolati

- Ish «Bajarildi» qilinganda admin kafolat muddatini belgilaydi
  (masalan 6 oy, 1 yil, 90 kun) — xizmat turi uchun standart muddat ham bo'ladi.
- Mijoz Kabinet → «Kafolat» da, admin panelda esa barcha faol kafolatlar
  ro'yxati — xuddi tovar kafolati kabi teskari sanoq bilan.
- Fara shishasi, Bi-LED o'rnatish, polirovka va boshqa xizmatlar uchun.

---

## Ochiq savollar

1. **Zalog qanday to'lanadi?**
   a) karta raqamiga o'tkazma + chek rasmi (hozir ishlaydi, shartnoma kerak emas);
   b) Click / Payme merchant (avtomatik tasdiq, merchant shartnomasi va kalitlar kerak);
   c) Telegram to'lovi (provider token kerak).
2. **R50 / R80 / R90** ning haqiqiy xususiyatlari va narxlari — admin panelda
   o'zgartiriladi, lekin 3D ko'rinishi to'g'ri bo'lishi uchun asosiy farqlarini
   (o'lchami, rangi, lazer bormi) aytib bering.
3. Korpus almashtirishning standart narxi (hozir 600 000 — vaqtinchalik).
