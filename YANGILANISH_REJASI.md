# Uzbrovv — katta yangilanish rejasi (2026)

Har bosqich alohida PR bo'lib chiqadi: avval shu bosqich tugaydi, tekshiriladi,
keyin keyingisiga o'tiladi. Dizayn hamma joyda bir xil: iOS 26 «Liquid Glass»,
qorong'i fon, brend rangi rang generatoridan (`--h/--s/--l`).

| # | Bosqich | Holat |
|---|---|---|
| 1 | Bi-LED Studio — 3D konfigurator | ✅ tayyor (PR #140, #141) |
| 2 | Fara polirovka — «oldin/keyin» surgich | ✅ tayyor (PR #142) |
| 3 | Fara shishasini almashtirish — mashinaga qarab narx + navbat | ✅ tayyor (PR #143) |
| 4 | Rul chexol — materiallar va ranglar (admin boshqaradi) | ✅ tayyor |
| 5 | O'rindiq chexol — 20 qismli o'rindiq, dizaynlar (admin boshqaradi) | ✅ tayyor |
| 6 | «Tez kunda»: Akvaprint, Tonirovka, Broni plyonka | ✅ tayyor |
| 7 | Navbat uchun 100 000 so'm oldindan to'lov (zalog) → admin tasdig'i | ✅ tayyor (karta + chek) |
| 8 | Xizmat kafolati — admin muddat belgilaydi, mijoz va admin ko'radi | ✅ tayyor |

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

## 2. Fara polirovka — «oldin/keyin» ✅

- Xizmat oynasi ochilganda fara **xira va sarg'aygan** turadi, ustida tayoqcha.
  Tayoqcha **chapga** surilsa uning o'ng tomoni **toza** bo'lib ochiladi,
  **o'ngga** surilsa xiralik qaytadi. Butun rasm bo'ylab barmoq bilan suriladi,
  har 20% da yengil tebranish, to'liq tozalanganda «✨ Fara toza».
- «Kunduzi / Kechasi»: kechasi chiroq yoqiladi — xira shisha nurni qanday
  sochishi va toza shisha qanday yorishi ko'rinadi.
- Rasmlar 3D studiyadagi o'sha faradan olinadi (bir xil burchak, faqat shisha
  holati farq qiladi). WebGL yo'q bo'lsa — SVG chizma.
- Pastda tavsif, narx, davomiylik va «Navbat olish» (avvalgidek).
- Kod: `docs/js/app.js -> pzBlock/pzBind/pzPaint`, `docs/js/headlight3d.js ->
  snapshot()` va `haze` (oksidlangan shisha), `docs/styles.css` `.pz-*`.
- Kelajakda (ixtiyoriy): admin o'z ustaxonasidagi haqiqiy «oldin/keyin»
  suratlarini yuklasa, 3D rasm o'rniga o'sha suratlar chiqadi.

## 3. Fara shishasini almashtirish ✅

- Xizmat oynasida **mashina kartasi**: garajdagi mashina darhol olinadi, yo'q
  bo'lsa «Mashinangizni tanlang» (garaj paneli ochiladi). Mashina almashsa narx
  shu zahoti yangilanadi.
- Narx: `catalog/cars/{id}.glass_price` (2 fara), bo'lmasa Bi-LED
  konfiguratordagi standart shisha narxi. Ikkalasi ham **Boshqaruv → Bi-LED
  konfigurator** da yoziladi — konfigurator va shu xizmat bir xil narxda.
- «Navbat olish»: mashinasiz ochilmaydi; navbat panelida mashina ko'rinadi.
- Worker 2.2.0: navbatda `car_id`/`car_name` saqlanadi, shisha narxi serverda
  mashinadan qayta hisoblanadi; admin va mijozga xabarda mashina va narx.
  Admin ro'yxatida va mijoz kabinetida navbat yonida mashina ko'rinadi.
- Eski Mini App (mashinasiz so'rov) avvalgidek ishlayveradi.

## 4. Rul chexol tikish ✅

- **Admin → «Rul chexol materiallari»**: material qo'shish / tahrirlash / yashirish /
  o'chirish. Har material: nomi, narxi, teksturasi (teri, perforatsiyali teri,
  alkantara, karbon, mato), kafolati, tavsifi va **ranglari** (nomi + rang).
  Formada jonli rul — bosilgan rang shu zahoti ko'rinadi.
- **Mijoz**: rul chizmasi (`docs/js/covers.js`), material kartalari, rang va ip
  (chok) rangi. Tanlanganda rulning **chexol tikiladigan gardishi** o'sha rang va
  teksturada, choklar ip rangida chiziladi. Narx — material narxi.
- Navbatda material, rang va ip saqlanadi (`option_*`, `details`); narxni
  Worker katalogdan oladi.

## 5. O'rindiq chexol tikish ✅

- O'rindiq **20 qismga** bo'lingan (bosh tayanch, yelkalar, bolsterlar, markaz
  bo'laklari, bel, o'tirg'ich, old chet, yon panellar).
- **Admin → «O'rindiq dizaynlari»**: qismni bosib rangini tanlash (palitra yoki
  o'z rangi), guruhga qo'llash (hammasi / markaz / bolsterlar / yon panellar /
  bosh tayanch), ip rangi, nomi, narxi, kafolati, tavsifi; nusxa olish,
  yashirish, o'chirish.
- **Mijoz**: katta o'rindiq + dizaynlar karuseli, navbatda dizayn saqlanadi.

## 6. «Tez kunda» — Akvaprint, Tonirovka, Broni plyonka ✅

- Har biriga jonli illyustratsiya (akvaprint — to'lqin va naqsh, tonirovka —
  asta qorayadigan oyna, broni — kuzov bo'ylab yaltiroq qatlam va qaytgan
  toshlar), qisqa tavsif va «🔔 Ishga tushganda xabar bering».
- Bu xizmatlar **narxi qo'yilmaguncha** «Tez kunda» (Mini App ham, Worker ham).
  Admin narx qo'ysa — xizmat o'zi ochiladi.
- «Xabar bering» bosilsa adminga Telegram'da xabar boradi, ro'yxat
  `service_waitlist/{xizmat}/{mijoz}` da saqlanadi.

## 7. Oldindan to'lov (zalog) ✅

- Navbat 3 qadam: **Kun → Vaqt → Zalog**. Zalog qadamida summa, karta raqami
  (nusxa tugmasi), egasi va «Chek rasmini yuklash». Navbat chek bilan band
  qilinadi.
- Admin Telegram xabarida «💳 Zalog … — chekni ko'rish» havolasi, panelda
  chek rasmi. «✅ Tasdiqlash» bosilsa zalog «qabul qilingan» bo'ladi va mijozga
  xabar ketadi. Bekor qilinsa vaqt bo'shaydi.
- **Admin → «Navbat zalogi»**: summa (standart 100 000 so'm) va yoqish/o'chirish.
- Karta raqami — Worker sozlamasi `PAY_CARD_NUMBER`, `PAY_CARD_HOLDER`.
- To'lov usuli: kartaga o'tkazma + chek (shartnoma kerak emas). Click/Payme
  avtomatik to'lovini keyinroq qo'shish mumkin.

## 8. Xizmat kafolati ✅

- Admin navbatni **«✔️ Bajarildi»** (yoki Bi-LED'ni «✨ Topshirildi») qilganda
  kafolat muddati so'raladi: Kafolatsiz / 1 oy / 3 oy / 6 oy / 1 yil / 2 yil
  yoki o'zi yozadi (45 kun, 8 oy…). Standart — material/dizayn yoki xizmat
  kafolati. Telegram tugmasi orqali bajarilsa — standart muddat.
- Kafolat shu lahzadan boshlanadi, mijozga «🛡 Kafolat boshlandi» xabari ketadi;
  Kabinet → Kafolat bo'limida xuddi tovar kafolati kabi teskari sanoq.
- **Admin → «Kafolatlar»**: barcha mijozlarning kafolatlari (faol / kutilmoqda /
  tugagan, qidiruv), qolgan kunlar, va **muddatni o'zgartirish**.

---

## Ochiq savollar

1. **R50 / R80 / R90** ning haqiqiy xususiyatlari (3D ko'rinish uchun).
2. Zalog keyin xizmat narxidan **ayiriladimi**? (Hozir matnda aytilmagan.)
3. Shisha almashtirishda **1 fara / 2 fara** tanlovi kerakmi?
4. Click/Payme orqali avtomatik to'lov kerakmi (merchant shartnomasi bilan)?
