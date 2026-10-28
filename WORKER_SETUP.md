# Cloudflare Worker — bot va do'kon (bepul, uxlamaydi)

> ## 🧵 2.3.0: Chexollar, zalog, kafolat, «Tez kunda»
>
> Rul chexol materiallari, o'rindiq dizaynlari, navbat zalogi (chek bilan),
> xizmat kafolati, admin «Kafolatlar» ro'yxati va «Ishga tushganda xabar
> bering» — **2.3.0** Worker bilan ishlaydi. `cloudflare-worker.js` ni qo'ying
> va `/health` da `"version": "2.3.0"` ni tekshiring.
>
> ⚠️ Zalog standart holatda **yoqilgan (100 000 so'm)**. Mijoz kartaga
> o'tkazishi uchun Worker → Settings → Variables and Secrets da
> `PAY_CARD_NUMBER` va `PAY_CARD_HOLDER` bo'lishi shart. Zalogni o'chirish yoki
> summani o'zgartirish: Mini App → Boshqaruv → «Navbat zalogi».

> ## 🪟 2.2.0: Fara shishasi — narx mashinaga qarab
>
> «Fara shishasini almashtirish» navbatida mijoz mashinasini tanlaydi va
> narx o'sha mashinaniki bo'ladi (narxni Worker hisoblaydi). Buning uchun
> `cloudflare-worker.js` ni yana qo'ying (5 qadam) va `/health` da
> `"version": "2.2.0"` hamda `"booking_car_price"` borligini tekshiring.

> ## 🔦 2.1.0: Bi-LED Studio (3D konfigurator)
>
> Yangi konfigurator buyurtmasi va admin paneldagi **«Bi-LED konfigurator»**
> narxlari faqat **2.1.0** Worker bilan ishlaydi. Pastdagi «5 qadam» bilan
> `cloudflare-worker.js` ni qayta qo'ying, so'ng `/health` da
> `"version": "2.1.0"` va `features` ichida `"biled_studio"` borligini
> tekshiring. Eski Worker turgan bo'lsa Mini App buni o'zi aytadi
> («Worker eski — yangilash kerak»).

> ## 🤖 2.0.0: BOT ENDI SHU YERDA — Render kerak emas
>
> Telegram bot Cloudflare Worker'ga ko'chdi (webhook). Bepul (kuniga
> 100 000 so'rov), karta so'ramaydi, uxlamaydi. Bir marta qiling:
>
> 1. **Kodni qo'ying** — pastdagi «5 qadam» (Cloudflare → Worker → Edit code →
>    `cloudflare-worker.js` ni to'liq qo'yib → **Deploy**).
> 2. **Karta rekvizitlari** (Render'da edi) — Worker → **Settings →
>    Variables and Secrets** → *Secret* sifatida qo'shing:
>    `PAY_CARD_NUMBER` (masalan `8600 1234 5678 9012`) va `PAY_CARD_HOLDER`.
>    Qo'shilmasa «Karta orqali» to'lovda rekvizit chiqmaydi.
>    *(Ixtiyoriy: `SHOP_PHONE`, `SHOP_TELEGRAM`, `DELIVERY_CITY`.)*
> 3. **Botni ulang** — brauzerda bir marta oching:
>    `https://zimmer-worker.anvaraxtamov70.workers.dev/setup`
>    → `"✅ Bot ulandi"` chiqadi. *(Mini App bir marta ochilsa ham o'zi ulanadi.)*
> 4. **Render'ni o'chiring** — Render → xizmat → **Settings → Suspend**
>    (yoki Delete). Endi u kerak emas va pul so'ramaydi.
> 5. Telegram'da botga **/start** yuboring — menyu chiqsa, tayyor.
>
> **Bot nima qiladi:** /start menyusi (do'kon, 📦 buyurtmalarim, 🛡 kafolatim,
> ☎ aloqa), yangi buyurtma / Bi-LED / navbat adminga **holat tugmalari** bilan
> keladi (✅ Qabul → 🚚 Yo'lda → 🎉 Yetkazildi), mijozga har o'zgarish haqida
> xabar ketadi, «Yetkazildi» / «Topshirildi» bosilsa mijozning **1 yillik
> kafolati** boshlanadi. Mijoz botga yozsa — xabar adminga boradi; admin
> «Reply» qilsa — javob mijozga.
>
> **Python botni qaytarmoqchi bo'lsangiz** (Oracle va h.k.): Worker'da
> `BOT_WEBHOOK=off` qo'ying va serverda `BOT_MODE=polling` bilan ishga tushiring.
> Busiz Python bot Worker webhook'iga tegmaydi (bot.py).

> ## ⚡ KODNI YANGILASH — eng ko'p kerak bo'ladigan ish
>
> **Muhim:** Cloudflare GitHub'dan **o'zi yangilanmaydi**. Repoda
> `cloudflare-worker.js` o'zgargan bo'lsa, uni **qo'lda** qo'yish kerak.
>
> **Qism-qism emas — BUTUN faylni almashtirasiz.** Ichidan biror qatorni
> topib o'zgartirish kerak emas.
>
> ### 5 qadam
>
> 1. <https://dash.cloudflare.com> ni ochib, chapdan **Workers & Pages**
>    ni bosing.
> 2. Ro'yxatdan Worker'ingizni tanlang (nomi `zimmer-worker` yoki
>    `zimmer-bot` — `docs/config.js` dagi `WORKER_URL` da qaysi bo'lsa).
> 3. O'ng tepadan **Edit code** (ba'zi ko'rinishlarda `< >` belgisi yoki
>    **Quick edit**) ni bosing. Kod muharriri ochiladi.
> 4. Muharrirdagi **hamma kodni belgilab o'chiring**
>    (`Ctrl+A`, keyin `Delete`), so'ng repodagi **`cloudflare-worker.js`**
>    faylining **to'liq matnini** qo'ying (`Ctrl+V`).
>    Faylni GitHub'dan olish: repo → `cloudflare-worker.js` → **Raw** →
>    `Ctrl+A` → `Ctrl+C`.
> 5. **Deploy** (yoki **Save and deploy**) ni bosing.
>
> **Secret'lar va o'zgaruvchilarga tegmaysiz** — ular joyida qoladi. Faqat
> kod almashadi.
>
> ### Yangilanganini tasdiqlash
>
> Brauzerda oching (`<manzil>` — o'zingizning Worker manzili):
>
> ```
> https://<manzil>/health
> ```
>
> `version` maydonini qaraysiz:
>
> ```json
> { "status": "ok", "version": "2.0.0", "features": [ ... ] }
> ```
>
> | `version` | Ma'nosi |
> |---|---|
> | **2.0.0** yoki yuqori | ✅ Yangi nusxa (bot ham shu yerda) |
> | 1.10.0 yoki pastroq | ❌ Eski nusxa — 4-qadam bajarilmagan, bot ishlamaydi |
>
> Bot ulanganini tekshirish: `https://<manzil>/health?deep=1` →
> `checks.bot_webhook.ok: true`.
>
> Mini App ham buni o'zi tekshiradi: admin panelni ochganda eski nusxa
> bo'lsa **«Cloudflare'da Worker'ning ESKI nusxasi turibdi»** degan
> ogohlantirish chiqadi.
>
> ### 1.4.0 nima olib keldi
>
> - admin panelida **eski buyurtmalar ham ko'rinadi** (`orders` tuguni
>   yopiq, uni faqat Worker o'qiy oladi);
> - **Bi-LED buyurtmasi va navbat** holatini o'zgartirganda mijozga
>   Telegram xabari ketadi (`kind` parametri).
>
> Bu ikkisi eski nusxada **ishlamaydi** — shuning uchun yangilash kerak.

---

## Render o'chganda buyurtma qabul qilish

Bu Worker bo'lsa Mini App **Render'siz to'liq ishlaydi**: mijoz tanilishi,
katalog, savat, **buyurtma berish** va adminga Telegram xabari. Render faqat
botni ishlatadi — Avto_A1 dagi kabi.

Worker **uxlamaydi** va bepul tarifda kuniga 100 000 so'rov beriladi — bitta
do'kon uchun bu juda ko'p.

---

## Nima ishlaydi

| Imkoniyat | Render ishlaganda | Render o'chganda |
|---|---|---|
| Katalog, mahsulot modali | ✅ | ✅ |
| Stories, bannerlar | ✅ | ✅ |
| **Rasmlar** (`file_id` bilan saqlanganlar ham) | ✅ | ✅ *Worker `/media`* |
| Savat, saqlanganlar | ✅ | ✅ |
| **Mijoz tanilishi** (ism, telefon, mashina) | ✅ | ✅ *Worker `/me`* |
| **Buyurtma berish** | ✅ | ✅ *Worker `/order`* |
| **Adminga Telegram xabari** | ✅ | ✅ *Worker yuboradi* |
| **Buyurtmalarim** tarixi | ✅ | ✅ |
| Navbat olish / bekor qilish, Bi-LED buyurtmasi | ✅ | ✅ *Worker `/booking`, `/biled-order`* |
| Admin panel (buyurtmalar, katalog, mijozlar) | ✅ | ✅ *Worker `/admin/*`* |
| **Telegram bot** (/start, holat tugmalari, xabarlar) | — | ✅ *Worker `/tg` (2.0.0)* |
| **🛡 Tovar kafolati** (Kabinet + `/kafolat`) | — | ✅ *Worker `/me` (2.0.0)* |
| AI yordamchi (Shogird) | ✅ | ⛔ mahalliy bilim bilan javob beradi |

2.0.0 dan Render shart emas: `docs/config.js` dagi `API_BASE` bo'sh — ilova
to'g'ridan Worker + Firebase bilan ishlaydi.

---

## 1. Worker yaratish

1. <https://dash.cloudflare.com> → **Workers & Pages** → **Create** → **Worker**
2. Nom: `zimmer-bot` → **Deploy**
3. **Edit code** → hamma narsani o'chirib, repo ildizidagi
   **`cloudflare-worker.js`** faylining to'liq matnini qo'yish → **Deploy**

Manzil shunday bo'ladi: `https://zimmer-bot.<akkaunt>.workers.dev`

---

## 2. Secret'larni kiritish

**Settings → Variables and Secrets**

### Secret (yashirin) — «Encrypt» belgilangan bo'lsin

| Nom | Qiymat |
|---|---|
| `BOT_TOKEN` | BotFather tokeni |
| `FIREBASE_CLIENT_EMAIL` | `serviceAccount.json` dagi `client_email` |
| `FIREBASE_PRIVATE_KEY` | `serviceAccount.json` dagi `private_key` (**butun matn**, `-----BEGIN PRIVATE KEY-----` bilan birga) |

> `private_key` ichida `\n` belgilari bo'ladi — ularni **o'zgartirmang**.
> Worker ularni haqiqiy yangi qatorga o'zi aylantiradi.

### Oddiy o'zgaruvchi (Text)

| Nom | Qiymat |
|---|---|
| `FIREBASE_DB_URL` | `https://zimmer-42840-default-rtdb.firebaseio.com` |
| `FIREBASE_ROOT` | `zimmer` |
| `ADMIN_IDS` | `5105291033,483425630,5302078` |
| `INIT_DATA_MAX_AGE` | `86400` |

**Deploy** bosing.

---

## 3. Tekshirish

Brauzerda oching:

```
https://zimmer-bot.<akkaunt>.workers.dev/health
```

Shunday javob kelishi kerak:

```json
{
  "status": "ok",
  "configured": {
    "bot_token": true,
    "firebase_key": true,
    "db_url": true,
    "admins": 3
  }
}
```

Biror joyda `false` bo'lsa — o'sha o'zgaruvchi kiritilmagan.

> `/health` maxfiy qiymatlarni **ko'rsatmaydi** — faqat «kiritilgan / yo'q».

---

## 4. Manzilni ilovaga aytish

`docs/config.js` faylida:

```js
WORKER_URL: "https://zimmer-bot.<akkaunt>.workers.dev",
```

Commit qilib push qilsangiz, GitHub Pages 1–2 daqiqada yangilanadi.

---

## 5. Katalogni bulutga chiqarish (bir marta)

Worker buyurtma summasini **katalogdan** o'qiydi. Katalog bulutda bo'lmasa
buyurtma qabul qilinmaydi (`503`, «Katalog o'qilmadi»).

Bot ishlab turganda botga yuboring:

```
/firebase
```

Javobda «Bulutga yuklandi: N katalog yozuvi, M mijoz» ko'rinadi.

> Bot ishga tushganda buni **o'zi** ham bajaradi (`initial_sync`).

---

## Xavfsizlik — nima uchun bu yechim Avto_A1 dagidan yaxshiroq

Avto_A1 da buyurtmani **mijozning brauzeri** to'g'ridan-to'g'ri Firebase'ga
yozadi. Bu quyidagilarni ochib qo'yadi:

| Muammo | Avto_A1 | Zimmer (bu Worker) |
|---|---|---|
| Summani mijoz yuboradi | `total: 0` yozish mumkin | Summa **katalogdan**, server tomonda hisoblanadi. Mijoz yuborgani **o'qilmaydi** |
| Statusni mijoz yozadi | `status: "yetkazildi"` mumkin | Majburan `"new"` |
| Adminga xabar | Mijoz `notified_admin: true` yozib **botning xabarini o'chirib** qo'yadi | Bu maydonni **faqat server** yozadi |
| Yozuv yiqilsa | `.catch(function(){})` yutadi — buyurtma **yo'qoladi**, mijoz «qabul qilindi» ko'radi | Xato **mijozga qaytariladi** va aniq aytiladi |
| Ikki marta bosilsa | Ikki buyurtma | **Idempotent** — bitta buyurtma |
| Firebase qoidalari | Mijozga **yozish** huquqi kerak | Brauzerga **hech qanday** huquq berilmaydi |
| Firebase SDK | ~300 KB yuklanadi | **Kerak emas** |

Barcha chaqiruvlar Telegram `initData` **HMAC imzosi** bilan tekshiriladi.
`uid` **imzodan** olinadi, so'rov tanasidan emas — shuning uchun birov
boshqa mijoz nomidan buyurtma bera olmaydi.

---

## Muammolar

| Belgi | Sabab va yechim |
|---|---|
| `/health` da `firebase_key: false` | `FIREBASE_CLIENT_EMAIL` yoki `FIREBASE_PRIVATE_KEY` kiritilmagan |
| Buyurtmada «Katalog o'qilmadi» (503) | Botga `/firebase` yuborilmagan — katalog bulutda yo'q |
| «imzo mos kelmadi» (401) | `BOT_TOKEN` xato yoki boshqa botning tokeni |
| «initData eskirgan» (401) | Ilova uzoq ochiq turgan. Yopib qayta oching, yoki `INIT_DATA_MAX_AGE` ni oshiring |
| Rasmlar ko'rinmaydi | `WORKER_URL` `docs/config.js` da yozilmagan |
| Adminga xabar kelmaydi | `ADMIN_IDS` kiritilmagan, yoki admin botga hech qachon `/start` yozmagan (Telegram noma'lum chatga yozishga ruxsat bermaydi) |

Loglarni ko'rish: Cloudflare → Worker → **Logs** → **Begin log stream**.
