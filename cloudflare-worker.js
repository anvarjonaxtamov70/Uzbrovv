// =====================================================================
//  UZBROVV — Cloudflare Worker (BOT + Mini App backend)
//
//  MAQSAD: hamma narsa BEPUL va uxlamasdan ishlashi. 2.0.0 dan boshlab
//  Telegram BOTNING O'ZI ham shu yerda (webhook) — Render kerak emas.
//  Do'kon, mijoz tanilishi, buyurtma, navbat, Bi-LED, kafolat va admin
//  xabarlari shu Worker + Firebase orqali ishlaydi.
//
//  ENDPOINT'LAR (asosiylari)
//    POST /tg            — Telegram webhook (botga kelgan har xabar)
//    GET  /setup         — botni ulash: webhook, buyruqlar, «Do'kon» tugmasi
//    GET  /health        — holat (`?deep=1` — haqiqiy tekshiruv)
//    POST /me            — profil, buyurtmalar, Bi-LED, navbatlar, KAFOLAT
//    POST /profile       — mijoz profilini saqlash (ism/telefon/mashina)
//    POST /order         — BUYURTMA (summa server tomonda hisoblanadi)
//    POST /booking       — navbat; POST /booking-cancel — mijoz bekor qiladi
//    POST /biled-order   — Bi-LED o'rnatish buyurtmasi
//    POST /admin/*       — Mini App boshqaruv paneli
//    GET  /media?id=     — Telegram fayl proksisi (file_id rasmlar uchun)
//
//  Secret'lar (Worker > Settings > Variables and Secrets):
//     BOT_TOKEN               — BotFather tokeni
//     FIREBASE_CLIENT_EMAIL   — serviceAccount.json dagi client_email
//     FIREBASE_PRIVATE_KEY    — serviceAccount.json dagi private_key
//     PAY_CARD_NUMBER         — (ixtiyoriy) to'lov kartasi raqami
//     PAY_CARD_HOLDER         — (ixtiyoriy) karta egasi
//  Oddiy o'zgaruvchilar:
//     FIREBASE_DB_URL         — https://zimmer-42840-default-rtdb.firebaseio.com
//     FIREBASE_ROOT           — zimmer
//     ADMIN_IDS               — 5105291033,483425630,5302078
//     INIT_DATA_MAX_AGE       — 86400 (soniya)
//     MINI_APP_URL            — (ixtiyoriy) https://anvarjonaxtamov70.github.io/Uzbrovv/
//     SHOP_PHONE, SHOP_TELEGRAM, DELIVERY_CITY — (ixtiyoriy) aloqa ma'lumotlari
//     BOT_WEBHOOK             — "off" bo'lsa Worker botni O'ZI ulamaydi
//                               (faqat Python botni qayta ishlatganda kerak)
//
//  ---------------------------------------------------------------------
//  NEGA AVTO_A1 DAGIDAN BOSHQACHA (ataylab)
//
//  Avto_A1 da buyurtmani MIJOZ BRAUZERI to'g'ridan-to'g'ri RTDB ga
//  yozadi va o'zi adminga xabar yuboradi. Bu 4 ta muammo beradi:
//
//   1. Mijoz `total` ni O'ZI yozadi -> `total: 0` yuborish mumkin
//      (qoidalarda `.validate` yo'q). Bu yerda summa KATALOGDAN
//      o'qib, SERVER tomonda hisoblanadi. Mijoz yuborgan summa
//      butunlay E'TIBORSIZ qoldiriladi.
//   2. Mijoz `status: "yetkazildi"` yozib qo'ya oladi. Bu yerda status
//      har doim "new" bilan boshlanadi.
//   3. Yozuv yiqilsa `.catch(function(){})` uni yutadi -> buyurtma
//      yo'qoladi, mijoz esa "qabul qilindi" ko'radi. Bu yerda xato
//      MIJOZGA QAYTARILADI.
//   4. Mijoz `notified_admin: true` yozib botning xabarini o'chirib
//      qo'yadi. Bu yerda bu maydonni FAQAT server qo'yadi.
//
//  Shuningdek: token `Authorization: Bearer` sarlavhasida (URL'da emas,
//  loglarga tushmasin), access token keshlanadi, va `initData` yo'q
//  bo'lsa HECH QANDAY yo'l ochiq qolmaydi.
// =====================================================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Range",
  "Access-Control-Max-Age": "86400",
};

const DEFAULT_ROOT = "zimmer";
const DEFAULT_MAX_AGE = 86400; // 24 soat

// Deploy qilingan kod versiyasi. `/health` shuni qaytaradi — Cloudflare'da
// ESKI nusxa turganini shu bilan darhol aniqlash mumkin (aks holda "kod
// yangilanmadimi yoki kalit buzuqmi?" degan savolga taxmin bilan javob
// berishga to'g'ri keladi).
// Har deploy'da ko'tariladi — `/health` dagi bu raqam Cloudflare'da
// YANGI nusxa turganini tasdiqlashning eng oson yo'li.
const VERSION = "2.4.0";
const FEATURES = [
  // 2.0.0 — BOT Worker'da: webhook, menyu, holat tugmalari, mijoz↔admin
  // yozishmasi; /me — Bi-LED, navbat va KAFOLAT; mijoz navbatni bekor qiladi;
  // to'lov rekvizitlari Worker'dan (Render'siz).
  "telegram_bot",
  "bot_status_buttons",
  "notify_biled_booking",
  "my_biled_bookings",
  "warranty",
  "booking_cancel",
  "worker_config",
  "order",
  /* Razmerli tovarlar: buyurtma qatorida `size` bo'ladi va qoldiq AYNAN
     o'sha razmerdan kamayadi (`catalog/products/{id}/sizes`). Bu belgi
     bo'lmasa Mini App eski Worker turganini biladi. */
  "order_sizes",
  "me",
  "profile",
  "media",
  "admin_detect",
  // Render'siz admin amallari — katalogni telefondan boshqarish
  "admin_catalog",
  "admin_product_add",
  "admin_edit",
  "admin_orders",
  // 1.4.0 — buyurtmalar: `pending_orders` VA `orders` birlashtirilib beriladi
  // (yopiq tugunni Worker service-account bilan o'qiydi), holat o'zgartirish
  // esa `kind` (order|biled|booking) bo'yicha to'g'ri tugunga yoziladi.
  // Mini App shu belgilarga qarab Cloudflare'da ESKI nusxa turganini
  // aniqlaydi va aniq aytadi.
  "admin_orders_merged",
  "admin_status_kind",
  // Admin CRM: mijoz profillari (`users`) yopiq tugun — Worker service-account
  // bilan o'qiydi (brauzer to'g'ridan o'qiy olmaydi, ism/telefon PII).
  "admin_users",
  // 1.5.0 — story'ga javob va Mini App ichidan VIDEO yuklash
  "story_reply",
  "admin_upload",
  // 1.8.0 — reviewed root-level atomic commits and strict catalog validation.
  "order_cas_reservation",
  "admin_catalog_write",
  "secure_booking",
  "secure_biled_order",
  "order_atomic_root",
  "booking_atomic_root",
  "admin_status_atomic_compensation",
  "catalog_write_validated",
  // 1.9.0 — bosh sahifadagi rang generatori: `catalog/settings/theme`
  "theme",
  // 1.10.0 — Mijozlar oynasi (Avto_A1 modeli): bloklash, qo'lda VIP, xabar
  "admin_block",
  "admin_vip",
  "admin_message",
  "blocked_enforced",
  // 2.1.0 — Bi-LED Studio (3D konfigurator): `/biled-order` `studio`
  // tanlovini qabul qiladi, narx `catalog/configurator` + mashinaning
  // `glass_price`/`housing_price` dan qayta hisoblanadi; admin panel
  // `catalog/configurator` ni va mashina narxlarini yoza oladi.
  "biled_studio",
  // 2.2.0 — navbatda mashina: «Fara shishasini almashtirish» narxi mashinaga
  // qarab (`catalog/cars/{id}.glass_price`, bo'lmasa konfiguratordagi
  // standart shisha narxi) serverda hisoblanadi; navbat yozuvida car_*.
  "booking_car_price",
  // 2.3.0 — rul chexol materiallari va o'rindiq dizaynlari (narx serverda),
  // navbat uchun zalog (chek bilan), «tez kunda» yo'nalishlar, xizmat
  // kafolati (admin muddat belgilaydi), barcha kafolatlar ro'yxati (admin),
  // «ishga tushganda xabar bering».
  "service_options",
  "booking_deposit",
  "service_warranty",
  "admin_warranties",
  "service_notify",
  // 2.4.0 — Shogird AI Worker'da (Groq, GROQ_API_KEY) va to'lov kartasi
  // admin paneldan (`private/payment`).
  "shogird_ai",
  "admin_payment",
];

/** Mini App'dan yuklanadigan fayl chegarasi.
 *  Telegram Bot API `sendVideo` uchun 50 MB beradi, lekin Worker'ning
 *  xotirasi 128 MB — fayl kirish va chiqishda ikki marta buferlanadi.
 *  Shu sababli 32 MB da to'xtaymiz va sababini AYTAMIZ (jimgina
 *  yiqilgandan ko'ra). Kattaroq video botga tashlanadi. */
const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function cfg(env) {
  const dbUrl = String(env.FIREBASE_DB_URL || "").replace(/\/+$/, "");
  const root = String(env.FIREBASE_ROOT || DEFAULT_ROOT).replace(/^\/+|\/+$/g, "");
  const admins = String(env.ADMIN_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const maxAge = parseInt(env.INIT_DATA_MAX_AGE || DEFAULT_MAX_AGE, 10) || DEFAULT_MAX_AGE;
  return { dbUrl, root, admins, maxAge };
}

// =====================================================================
//  Kirish nuqtasi
// =====================================================================
export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    /* `return await` — ATAYLAB. Ilgari `return handleX()` edi va handler
       ichidagi xato (Firebase o'qilmadi, token olinmadi...) bu `try` dan
       QOCHIB chiqardi: Cloudflare CORS sarlavhasiz 500 qaytarardi, brauzer
       esa buni «Internetga ulanmadi» deb ko'rsatardi. */
    try {
      // Telegram webhook — botga kelgan har bir xabar shu yerga tushadi
      if (path === "/tg") return await handleTelegramWebhook(request, env, ctx);
      // Botni ulash (webhook + buyruqlar + «Do'kon» tugmasi). Idempotent.
      if (path === "/setup" || path === "/tg/setup") return await handleBotSetup(request, env);
      if (path === "/media" || path === "/file") return await handleMedia(request, env);
      if (path === "/health" || path === "/") {
        // `?deep=1` — sozlamalar BOR-YO'QLIGINI emas, HAQIQATAN ISHLASHINI
        // tekshiradi: Firebase kalitini imzolab ko'radi va katalogni o'qiydi.
        keepWebhook(ctx, env, url.origin);
        return await handleHealth(env, url.searchParams.get("deep") === "1", url.origin);
      }

      if (request.method !== "POST") {
        return json({ ok: false, error: "Faqat POST" }, 405);
      }
      if (path === "/auth") return await handleAuth(request, env);
      if (path === "/me") {
        // Mini App har ochilganda bot ulanganini tekshiramiz (fonda, bir marta)
        keepWebhook(ctx, env, url.origin);
        return await handleMe(request, env);
      }
      if (path === "/profile") return await handleProfile(request, env);
      if (path === "/order") return await handleOrder(request, env);
      if (path === "/booking") return await handleBooking(request, env);
      if (path === "/booking-cancel") return await handleBookingCancel(request, env);
      if (path === "/biled-order") return await handleBiledOrder(request, env);
      if (path === "/service-notify") return await handleServiceNotify(request, env);
      if (path === "/shogird") return await handleShogird(request, env);
      // Story'ga javob: adminga QAYSI story'dan kelganini bildirib yuboradi
      if (path === "/story-reply") return await handleStoryReply(request, env);

      // ---- Admin: Render'siz katalog boshqaruvi. Har biri imzoni tekshirib,
      // uid ni ADMIN_IDS bilan solishtiradi (`requireAdmin`).
      if (path === "/admin/catalog") return await handleAdminCatalog(request, env);
      if (path === "/admin/product") return await handleAdminProduct(request, env);
      if (path === "/admin/edit") return await handleAdminEdit(request, env);
      if (path === "/admin/catalog-write") return await handleAdminCatalogWrite(request, env);
      // Mini App ichidan video/rasm yuklash (bot orqali file_id olinadi)
      if (path === "/admin/upload") return await handleAdminUpload(request, env);
      if (path === "/admin/orders") return await handleAdminOrders(request, env);
      if (path === "/admin/users") return await handleAdminUsers(request, env);
      if (path === "/admin/block") return await handleAdminBlock(request, env);
      if (path === "/admin/vip") return await handleAdminVip(request, env);
      if (path === "/admin/message") return await handleAdminMessage(request, env);
      if (path === "/admin/order-status") return await handleAdminOrderStatus(request, env);
      if (path === "/admin/warranties") return await handleAdminWarranties(request, env);
      if (path === "/admin/warranty-set") return await handleAdminWarrantySet(request, env);
      if (path === "/admin/payment") return await handleAdminPayment(request, env);

      return json({ ok: false, error: "Bunday manzil yo'q" }, 404);
    } catch (error) {
      // Xato YUTILMAYDI — mijoz sababni ko'rsin, aks holda buyurtma
      // "yo'qolgan" bo'lib qoladi va hech kim bilmaydi.
      console.error("[worker]", path, error);
      return json({ ok: false, error: "server_error", message: String((error && error.message) || error) }, 500);
    }
  },
};

// =====================================================================
//  GET /health
// =====================================================================
async function handleHealth(env, deep, origin) {
  const c = cfg(env);
  const payload = {
    status: "ok",
    service: "zimmer-worker",
    // Cloudflare'da qaysi nusxa turganini bilish uchun
    version: VERSION,
    features: FEATURES,
    // DIQQAT: bu faqat «kiritilgan / yo'q». Qiymatlar oshkor qilinmaydi va
    // kalitning HAQIQATAN ishlashi bu yerda tekshirilmaydi — buning uchun
    // `?deep=1` kerak.
    configured: {
      bot_token: !!env.BOT_TOKEN,
      firebase_key: !!(env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY),
      db_url: !!c.dbUrl,
      admins: c.admins.length,
      ai: !!env.GROQ_API_KEY,
    },
    time: new Date().toISOString(),
  };

  if (!deep) return json(payload);

  // ---- Chuqur tekshiruv: har bir bo'lak ALOHIDA sinaladi, shunda muammo
  // aynan qayerda ekani ko'rinadi (kalitda? bazada? katalogda?).
  const checks = {};

  // 1) Firebase kaliti haqiqatan imzolay oladimi va Google token beradimi?
  let token = null;
  try {
    // `force` — keshni chetlab o'tamiz, aks holda tashxis eski tokenga
    // qarab «joyida» deb yolg'on gapirardi.
    token = await accessToken(env, true);
    checks.firebase_token = { ok: true };
  } catch (error) {
    checks.firebase_token = {
      ok: false,
      // Kalit matni buzilgan bo'lsa odatda shu yerda "Invalid keyData"
      // yoki "invalid_grant" chiqadi.
      error: String(error).slice(0, 300),
      hint:
        "FIREBASE_PRIVATE_KEY matni buzilgan bo'lishi mumkin. " +
        "serviceAccount.json dagi private_key ni -----BEGIN dan -----END gacha " +
        "TO'LIQ nusxalang, ichidagi \\n larni o'zgartirmang.",
    };
  }

  // 2) Baza o'qiladimi va katalog bormi?
  if (token) {
    try {
      const res = await fetch(
        `${c.dbUrl}/${c.root}/catalog/products.json?shallow=true`,
        { headers: authHeaders(token) }
      );
      if (!res.ok) {
        checks.catalog_read = {
          ok: false,
          status: res.status,
          // 401 = token olindi, lekin RTDB uni qabul qilmadi. Deyarli har
          // doim scope kamligi sabab (kalit buzuqligi emas — kalit buzuq
          // bo'lsa yuqoridagi firebase_token bosqichi yiqilardi).
          hint:
            res.status === 401
              ? "Token olingan, lekin RTDB rad etdi. Sabab odatda OAuth scope: " +
                "userinfo.email VA firebase.database — ikkisi ham kerak. " +
                "Cloudflare'dagi Worker nusxasi eski bo'lishi mumkin."
              : res.status === 404
                ? "FIREBASE_DB_URL xato bo'lishi mumkin (baza manzili yoki mintaqa)."
                : undefined,
        };
      } else {
        const node = await res.json();
        const count = node && typeof node === "object" ? Object.keys(node).length : 0;
        checks.catalog_read = {
          ok: count > 0,
          products: count,
          hint: count ? undefined : "Katalog bo'sh — botga /firebase yuborilishi kerak.",
        };
      }
    } catch (error) {
      checks.catalog_read = { ok: false, error: String(error).slice(0, 200) };
    }
  }

  // 3) Bot tokeni haqiqiymi?
  if (env.BOT_TOKEN) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getMe`);
      const data = await res.json();
      checks.bot_token = data && data.ok
        ? { ok: true, username: data.result && data.result.username }
        : { ok: false, error: (data && data.description) || "getMe ishlamadi" };
    } catch (error) {
      checks.bot_token = { ok: false, error: String(error).slice(0, 200) };
    }

    // 4) Bot SHU Worker'ga ulanganmi (webhook)? Ulanmagan bo'lsa bot jim turadi.
    const info = await tgCall(env, "getWebhookInfo", {});
    const want = `${origin}/tg`;
    const r = (info && info.result) || {};
    checks.bot_webhook = info.ok && r.url === want
      ? { ok: true, url: r.url, pending: r.pending_update_count || 0, last_error: r.last_error_message || undefined }
      : {
          ok: false,
          url: r.url || "",
          hint: r.url
            ? "Bot boshqa joyga ulangan (eski Render/Python). Brauzerda " + origin + "/setup ni oching."
            : "Bot ulanmagan. Brauzerda " + origin + "/setup ni bir marta oching.",
        };
  }

  payload.checks = checks;
  payload.status = Object.values(checks).every((x) => x.ok) ? "ok" : "problem";
  return json(payload);
}

// =====================================================================
//  POST /auth — initData -> Firebase custom token
// =====================================================================
async function handleAuth(request, env) {
  const body = await readJson(request);
  const verified = await verifyInitData(body.initData, env);
  if (!verified.ok) return json({ ok: false, error: verified.error, blocked: !!verified.blocked }, verified.status || 401);

  const uid = String(verified.user.id);
  const token = await createCustomToken(uid, env);
  return json({ ok: true, token, uid });
}

// =====================================================================
//  POST /me — mijoz profili + buyurtma tarixi
//
//  NEGA FIREBASE AUTH SDK ISHLATILMADI
//  Avto_A1 da brauzer RTDB ga TO'G'RIDAN yozadi, shuning uchun unga
//  Firebase Auth kerak: `/auth` custom token beradi, so'ng
//  `signInWithCustomToken` bilan `auth.uid` paydo bo'ladi va qoidalar
//  yozishga ruxsat beradi. Bu uchta narxga olib keladi:
//    • ilovaga ~300 KB SDK yuklanadi;
//    • qoidalarda mijozga YOZISH huquqi berilishi kerak, natijada u
//      `total: 0` yoki `status: "yetkazildi"` yozib qo'ya oladi;
//    • auth yiqilsa butun oqim yiqiladi.
//
//  Zimmer'da barcha yozishni Worker admin tokeni bilan bajaradi.
//  Shuning uchun brauzerga RTDB ga kirish huquqi UMUMAN BERILMAYDI —
//  qoidalar yopiq qoladi, SDK kerak emas, soxta ma'lumot yuborish
//  imkonsiz. `/auth` baribir qoldirildi (kelajakda kerak bo'lsa).
// =====================================================================
async function handleMe(request, env) {
  const c = cfg(env);
  if (!c.dbUrl) return json({ ok: false, error: "FIREBASE_DB_URL sozlanmagan" }, 500);

  const body = await readJson(request);
  const verified = await verifyInitData(body.initData, env);
  if (!verified.ok) return json({ ok: false, error: verified.error, blocked: !!verified.blocked }, verified.status || 401);

  const uid = String(verified.user.id);
  const user = verified.user;
  const token = await accessToken(env);

  const [profile, data] = await Promise.all([
    rtdbGet(c.dbUrl, `${c.root}/users/${uid}/profile`, token).then((p) => p || {}),
    /* Buyurtmalar (Worker + eski SQLite nusxasi), Bi-LED va navbatlar —
       hammasi `uid` bo'yicha. Biror manba o'qilmasa o'sha ro'yxat bo'sh
       qoladi, profil esa baribir ishlaydi. */
    customerData(c, token, uid),
  ]);
  // Kafolatlar SERVERDA hisoblanadi — bot (`/kafolat`) va Mini App bir xil
  // sanani ko'rsatadi. Xato bo'lsa bo'sh ro'yxat (profil yiqilmasin).
  const warranties = await warrantiesFor(c, token, data).catch(() => []);

  return json({
    // Render `/api/config` o'rnini bosadi: to'lov rekvizitlari FAQAT imzosi
    // tasdiqlangan mijozga beriladi (ochiq `config.js` ga yozilmaydi).
    config: await workerConfig(env, c, token),
    biled: data.biled,
    bookings: data.bookings,
    warranties,
    // Telefon soati noto'g'ri bo'lsa ham kafolat taymeri aniq ketsin
    now: Date.now(),
    ok: true,
    me: {
      id: Number(uid),
      // Render `/api/me` bu maydonni `user_id` deb ataydi. Ikkalasini ham
      // beramiz — frontend qaysi rejimda bo'lsa ham ID ni topadi.
      user_id: Number(uid),
      first_name: user.first_name || "",
      full_name:
        profile.name || [user.first_name, user.last_name].filter(Boolean).join(" ") || "Mijoz",
      phone: profile.phone || null,
      car: profile.carId ? { id: profile.carId, name: profile.carName || "" } : null,
      // ADMINNI TANIB OLAMIZ — va bu XAVFSIZ.
      //
      // `uid` yuqorida `verifyInitData` orqali Telegram HMAC IMZOSI bilan
      // tasdiqlangan, ya'ni uni soxtalashtirish mumkin emas. `ADMIN_IDS`
      // esa Worker'ning o'zida (env), brauzerda emas.
      //
      // Avto_A1 da bu boshqacha: `ADMIN_IDS` BRAUZERDA yozilgan va
      // `isAdmin()` `window.currentUser` ni solishtiradi — u esa
      // `localStorage` dan olinadi, ya'ni istalgan odam o'zini admin
      // qilib ko'rsatishi mumkin. Bizdagi usul shundan xavfsizroq.
      //
      // Bu belgi FAQAT «Boshqaruv» tugmasini ko'rsatish uchun. Haqiqiy
      // admin amallari Render'dagi `/api/admin/*` ga boradi va u imzoni
      // QAYTA tekshiradi — ya'ni bu yerda xato bo'lsa ham ma'lumot
      // oshkor bo'lmaydi.
      is_admin: c.admins.includes(uid),
    },
    orders: data.orders,
  });
}

// =====================================================================
//  POST /profile — mijozni "tanib qolish"
//
//  Mijoz ismi, telefoni va tanlagan mashinasi Firebase'ga yoziladi.
//  Bot ko'tarilganda `sync.restore_users()` ularni SQLite ga tiklaydi,
//  ya'ni mijoz Render o'chgan paytda ro'yxatdan o'tsa ham YO'QOLMAYDI.
//
//  MUHIM: `uid` mijozdan OLINMAYDI — imzodan olinadi. Shuning uchun
//  birov boshqa mijozning profilini o'zgartira olmaydi (Avto_A1 da
//  `users/$uid` ga cheklovsiz yozish mumkin edi).
// =====================================================================
async function handleProfile(request, env) {
  const c = cfg(env);
  if (!c.dbUrl) return json({ ok: false, error: "FIREBASE_DB_URL sozlanmagan" }, 500);

  const body = await readJson(request);
  const verified = await verifyInitData(body.initData, env);
  if (!verified.ok) return json({ ok: false, error: verified.error, blocked: !!verified.blocked }, verified.status || 401);

  const uid = String(verified.user.id);
  const user = verified.user;

  const phone = normalizePhone(body.phone);
  if (body.phone && !phone) {
    return json({ ok: false, error: "Telefon raqam noto'g'ri" }, 400);
  }

  const token = await accessToken(env);
  const path = `${c.root}/users/${uid}/profile`;

  // Mavjud profilni o'qib, faqat berilgan maydonlarni yangilaymiz —
  // aks holda telefon yoki mashina tasodifan o'chib ketardi.
  const existing = (await rtdbGet(c.dbUrl, path, token)) || {};

  const profile = {
    uid: Number(uid),
    name:
      clean(body.full_name, 120) ||
      clean([user.first_name, user.last_name].filter(Boolean).join(" "), 120) ||
      existing.name ||
      "Mijoz",
    phone: phone || existing.phone || null,
    username: clean(user.username, 60) || existing.username || "",
    carId: body.car_id != null ? Number(body.car_id) : (existing.carId ?? null),
    carName: clean(body.car_name, 80) || existing.carName || null,
    source: "zimmer",
    updatedAt: { ".sv": "timestamp" },
  };

  const res = await rtdbPatch(c.dbUrl, path, profile, token);
  if (!res.ok) {
    const text = await res.text();
    return json({ ok: false, error: "profil saqlanmadi", detail: text.slice(0, 200) }, 502);
  }
  return json({ ok: true, profile: { ...profile, updatedAt: Date.now() } });
}

// =====================================================================
//  POST /order — BUYURTMA (asosiy qism)
//
//  Oqim:
//    1. initData tekshiriladi (imzo + yangilik)
//    2. Katalog Firebase'dan o'qiladi -> HAQIQIY narx va qoldiq
//    3. Summa SERVER tomonda hisoblanadi (mijoz yuborgani e'tiborsiz)
//    4. Qoldiq tekshiriladi
//    5. Buyurtma yoziladi (idempotent kalit bilan — ikki marta bosilsa
//       ham bitta buyurtma bo'ladi)
//    6. Qoldiq atomik kamaytiriladi ({".sv":{"increment":-n}})
//    7. Adminlarga va mijozga Telegram xabari
// =====================================================================
/** Tovarning razmerlar ro'yxati: `[{size, stock}]`.
 *
 *  RTDB bo'sh kataklari bor massivni LUG'AT qilib qaytaradi
 *  (`{"0":{...},"2":{...}}`), shuning uchun ikki shaklni ham tekislaymiz.
 *  INDEKS SAQLANADI: qoldiqni kamaytirishda aynan `sizes/{i}/stock` yo'li
 *  kerak bo'ladi. */
function sizesOfProduct(product) {
  const raw = product && product.sizes;
  let entries = [];
  if (Array.isArray(raw)) entries = raw.map((v, i) => [i, v]);
  else if (raw && typeof raw === "object") entries = Object.keys(raw).map((k) => [k, raw[k]]);

  return entries
    .filter(([, v]) => v && typeof v === "object" && String(v.size || "").trim())
    .map(([key, v]) => ({
      key: String(key), // RTDB dagi kalit (massiv indeksi yoki lug'at kaliti)
      size: String(v.size).trim(),
      stock: Math.max(0, Number(v.stock) || 0),
    }));
}

async function handleOrder(request, env) {
  const c = cfg(env);
  if (!c.dbUrl) return json({ ok: false, error: "FIREBASE_DB_URL sozlanmagan" }, 500);

  const body = await readJson(request);
  const verified = await verifyInitData(body.initData, env);
  if (!verified.ok) return json({ ok: false, error: verified.error, blocked: !!verified.blocked }, verified.status || 401);

  const uid = String(verified.user.id);
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!rawItems.length || rawItems.length > 50) {
    return json({ ok: false, error: rawItems.length ? "Juda ko'p tovar" : "Savatcha bo'sh" }, 400);
  }

  const items = [];
  for (const raw of rawItems) {
    const productId = parseInt(raw && raw.product_id, 10);
    const qty = parseInt(raw && raw.qty, 10);
    if (!Number.isInteger(productId) || productId < 1 || !Number.isInteger(qty) || qty < 1 || qty > 999) {
      return json({ ok: false, error: "Tovar yoki miqdor noto'g'ri" }, 400);
    }
    items.push({ product_id: productId, qty, size: clean(raw && raw.size, 40) || null });
  }

  const address = clean(body.address, 400);
  if (address.length < 5) return json({ ok: false, error: "Manzilni to'liqroq kiriting" }, 400);
  const phone = normalizePhone(body.phone);
  if (!phone) return json({ ok: false, error: "Telefon raqam noto'g'ri" }, 400);

  /* Kalit majburiy va tasodifiy bo'lishi kerak. Savat/manzildan yasalgan
     deterministik kalit keyingi real buyurtmani eski yozuvga ulab qo'yadi. */
  const clientKey = clean(body.client_key, 64).replace(/[^A-Za-z0-9_-]/g, "");
  if (clientKey.length < 16) {
    return json({ ok: false, error: "client_key_required", message: "Checkout kaliti yo'q" }, 400);
  }

  const deliveryMethod = ["courier", "bts"].includes(body.delivery_method)
    ? body.delivery_method
    : null;
  const requestShape = {
    items,
    address,
    phone,
    delivery_method: deliveryMethod,
    delivery_info: clean(body.delivery_info, 400) || null,
    payment_method: clean(body.payment_method, 120) || null,
  };
  const requestHash = await sha256Hex(JSON.stringify(requestShape));
  const orderKey = `${uid}_${clientKey}`;
  const orderPath = `${c.root}/pending_orders/${orderKey}`;
  const token = await accessToken(env);

  /* 1) Order claim: faqat `null_etag` egasi yaratadi. Parallel retrylar
     bitta claimni ko'radi; payload almashtirilsa fail-closed. */
  const claim = {
    code: orderCode(uid, clientKey),
    uid: Number(uid),
    client_key: clientKey,
    request_hash: requestHash,
    claim_state: "claimed",
    status: "processing",
    source: "miniapp_offline",
    imported: false,
    notified_admin: false,
    createdAt: { ".sv": "timestamp" },
  };
  const claimResult = await rtdbCreate(c.dbUrl, orderPath, claim, token);
  let current = claimResult.value;
  if (!claimResult.created) {
    if (!current) return json({ ok: false, error: "order_claim_missing" }, 409);
    if (current.request_hash !== requestHash) {
      /* Yetarli qoldiq bo'lmagani uchun reservation qilinmagan urinishda
         mijoz savatini tuzatishi mumkin. Ayni client_key claimi CAS bilan
         yangi payloadga qayta bog'lanadi; reserved orderda esa qat'iy conflict. */
      if (current.status !== "failed" || current.reservation_state !== "failed") {
        return json({ ok: false, error: "idempotency_conflict", message: "Bu checkout kaliti boshqa buyurtmaga tegishli" }, 409);
      }
      current = await casPatchObject(c.dbUrl, orderPath, token, (row) => {
        if (row.status !== "failed" || row.reservation_state !== "failed") {
          throw new Error("order claim o'zgardi");
        }
        return { ...claim, createdAt: row.createdAt || claim.createdAt };
      });
    }
    if (current.status === "cancelled" || current.status === "delivered") {
      return json({ ok: false, error: "order_final", message: "Bu buyurtma yakunlangan" }, 409);
    }
    if (current.reservation_state === "reserved" && current.status !== "failed") {
      let notified = !!current.notified_admin;
      if (!notified) {
        notified = await notifyOrder(env, c, current, orderKey);
        if (notified) {
          current = await casPatchObject(c.dbUrl, orderPath, token, (row) => ({ ...row, notified_admin: true }));
        }
      }
      return json({
        ok: true,
        order: { code: current.code, total: current.total, total_label: fmtPrice(current.total) },
        notified,
        repeated: true,
      });
    }
  }

  /* 2) Finalize + qoldiq kamayishi (umumiy VA razmer) + exactly-once
     rezerv markeri BITTA root ETag CAS ichida. Bir xil kalit + bir xil
     normalizatsiyalangan payload idempotent replay bo'ladi; boshqa payload
     esa yuqorida idempotency_conflict qaytaradi. */
  const user = verified.user;
  const finalizeFields = {
    customer_name: clean(
      body.full_name || [user.first_name, user.last_name].filter(Boolean).join(" "),
      120
    ) || "Mijoz",
    username: clean(user.username, 60) || "",
    phone,
    address,
    delivery_method: deliveryMethod,
    delivery_info: requestShape.delivery_info,
    payment_method: requestShape.payment_method,
  };

  let committed;
  try {
    committed = await commitOrder(c, token, orderKey, requestHash, items, finalizeFields);
  } catch (error) {
    if (error && error.code === "stock") {
      await casPatchObject(c.dbUrl, orderPath, token, (row) => ({
        ...row,
        status: "failed",
        claim_state: "failed",
        reservation_state: "failed",
        problems: error.problems,
        status_at: { ".sv": "timestamp" },
      }));
      return json({
        ok: false,
        error: "order_failed",
        message: "Ba'zi mahsulotlar yetarli emas. Savatchani yangilang.",
        problems: error.problems,
      }, 409);
    }
    if (error && error.code === "order_final") {
      return json({ ok: false, error: "order_final", message: "Bu buyurtma bekor qilingan" }, 409);
    }
    throw error;
  }

  const record = committed.record;
  let notified = !!record.notified_admin;
  if (!notified) {
    notified = await notifyOrder(env, c, record, orderKey);
    if (notified) {
      await casPatchObject(c.dbUrl, orderPath, token, (row) => ({ ...row, notified_admin: true }));
    }
  }

  return json({
    ok: true,
    order: { code: record.code, total: record.total, total_label: fmtPrice(record.total) },
    notified,
  }, claimResult.created && !committed.repeated ? 201 : 200);
}

/** Buyurtma yozuvini finalize qiladi, qoldiqni kamaytiradi (umumiy VA
    razmer) va exactly-once rezerv markerini BITTA root ETag CAS ichida
    yozadi. Crash bo'lsa ham "kamaygan qoldiq + yashirin processing claim"
    holati QOLMAYDI: hammasi bitta shartli PUT bilan commit bo'ladi. */
async function commitOrder(c, token, orderKey, requestHash, requested, finalizeFields) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const snap = await rtdbGetEtag(c.dbUrl, c.root, token);
    const root = snap.value && typeof snap.value === "object" ? snap.value : {};
    const products = root.catalog && root.catalog.products;
    if (!products || typeof products !== "object") throw new Error("Katalog o'qilmadi");
    const pending = root.pending_orders && typeof root.pending_orders === "object"
      ? root.pending_orders
      : (root.pending_orders = {});
    const orderRow = pending[orderKey];
    if (!orderRow || typeof orderRow !== "object" || orderRow.request_hash !== requestHash) {
      throw new Error("order claim o'zgardi");
    }
    const markers = root.order_reservations && typeof root.order_reservations === "object"
      ? root.order_reservations
      : (root.order_reservations = {});
    const existing = markers[orderKey];
    if (existing && existing.state === "reserved") {
      /* Marker faqat yakuniy PUT'da yoziladi — demak buyurtma yozuvi ham
         AYNI o'sha PUT'da finalize bo'lgan. Idempotent replay. */
      return { record: orderRow, repeated: true };
    }
    if (existing && existing.state === "released") {
      throw Object.assign(new Error("order final"), { code: "order_final" });
    }
    if (!["processing", "failed"].includes(orderRow.status)) {
      throw new Error("order claim yakunlangan");
    }

    const grouped = new Map();
    for (const item of requested) {
      const k = `${item.product_id}\u0000${item.size || ""}`;
      const old = grouped.get(k);
      if (old) old.qty += item.qty;
      else grouped.set(k, { ...item });
    }

    const lines = [];
    const problems = [];
    const perProduct = new Map();
    let total = 0;

    for (const item of grouped.values()) {
      const pid = String(item.product_id);
      const product = products[pid];
      if (!product || product.deleted || product.is_active === 0 || product.is_active === false) {
        problems.push({ product_id: pid, reason: "topilmadi" });
        continue;
      }
      const sizes = sizesOfProduct(product);
      let sizeRow = null;
      if (sizes.length) {
        sizeRow = sizes.find((s) => s.size === item.size) || null;
        if (!sizeRow) {
          problems.push({ product_id: pid, name: product.name, reason: item.size ? "razmer topilmadi" : "razmer tanlanmagan", size: item.size });
          continue;
        }
        if (sizeRow.stock < item.qty) {
          problems.push({ product_id: pid, name: product.name, reason: "yetarli emas", size: item.size, stock: sizeRow.stock });
          continue;
        }
      } else if ((Number(product.stock) || 0) < item.qty) {
        problems.push({ product_id: pid, name: product.name, reason: "yetarli emas", stock: Number(product.stock) || 0 });
        continue;
      }

      const used = perProduct.get(pid) || 0;
      perProduct.set(pid, used + item.qty);
      const price = Number(product.price) || 0;
      const line = { product_id: Number(pid), name: String(product.name || ""), price, qty: item.qty };
      /* KAFOLAT uchun sotilgan paytdagi holat saqlanadi: admin keyin
         tovarni o'chirsa yoki kafolat matnini o'zgartirsa ham, mijozning
         kafolati xarid qilingan shart bilan qoladi. */
      const warrantyText = clean(product.warranty, 60);
      if (warrantyText) line.warranty = warrantyText;
      const catName = clean(productCategoryName(product, root.catalog && root.catalog.categories), 80);
      if (catName) line.cat = catName;
      if (sizeRow) {
        line.size = sizeRow.size;
        line._sizeKey = sizeRow.key;
      }
      lines.push(line);
      total += price * item.qty;
    }

    for (const [pid, qty] of perProduct) {
      const product = products[pid];
      if ((Number(product.stock) || 0) < qty) {
        problems.push({ product_id: pid, name: product.name, reason: "yetarli emas", stock: Number(product.stock) || 0 });
      }
    }
    if (problems.length || !lines.length) throw Object.assign(new Error("stock"), { code: "stock", problems });

    for (const line of lines) {
      const product = products[String(line.product_id)];
      product.stock = (Number(product.stock) || 0) - line.qty;
      if (line._sizeKey != null) {
        const size = product.sizes && product.sizes[line._sizeKey];
        if (!size || (Number(size.stock) || 0) < line.qty) {
          throw Object.assign(new Error("stock"), {
            code: "stock",
            problems: [{ product_id: line.product_id, name: line.name, reason: "yetarli emas", size: line.size }],
          });
        }
        size.stock = (Number(size.stock) || 0) - line.qty;
      }
    }

    const publicLines = lines.map(({ _sizeKey, ...line }) => line);
    markers[orderKey] = {
      state: "reserved",
      lines: lines.map((line) => ({ ...line })),
      total,
      reservedAt: Date.now(),
    };
    /* Buyurtma yozuvi AYNI shu snapshot/PUT ichida finalize bo'ladi —
       qoldiq kamayishi, rezerv markeri va "new" holati birga commit
       qilinadi. Ikki alohida CAS bo'lsa, oraliqda crash "kamaygan qoldiq +
       processing claim" ni qoldirar edi. */
    pending[orderKey] = {
      ...orderRow,
      ...finalizeFields,
      items: publicLines,
      total,
      status: "new",
      claim_state: "complete",
      reservation_state: "reserved",
      problems: null,
    };
    const put = await rtdbPutIfMatch(c.dbUrl, c.root, root, token, snap.etag);
    if (put.status === 412) continue;
    await ensureOk(put, "Buyurtma saqlanmadi");
    return { record: pending[orderKey], repeated: false };
  }
  throw new Error("Qoldiq band — qayta urinib ko'ring");
}

// =====================================================================
//  POST /booking va /biled-order — faqat Telegram imzosi bilan
// =====================================================================
function catalogRowById(node, id) {
  if (!node || typeof node !== "object") return null;
  const direct = node[String(id)];
  if (direct && typeof direct === "object") return direct;
  return Object.values(node).find((row) => row && String(row.id) === String(id)) || null;
}

function catalogRowAvailable(row) {
  return !!row && !row.deleted && row.is_active !== 0 && row.is_active !== false;
}

function tashkentToday() {
  const d = new Date(Date.now() + 5 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function addIsoDays(iso, days) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function hhmmMinutes(value) {
  const m = /^([0-1][0-9]|2[0-3]):([0-5][0-9])$/.exec(String(value || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Bir kun uchun BO'SH vaqtlarni "HH:MM" ro'yxati sifatida hisoblaydi
 *  (`utils/helpers.py: free_slots` va `docs/js/offline.js: freeSlots` bilan
 *  bir xil qoida: 09:00–18:00, 30 daq qadam, bugun uchun hozirdan +30 daq).
 *  slot_taken javobida qaytariladi — Mini App navbat oynasini darhol
 *  yangilaydi (err.slots). */
function computeFreeSlots(day, date, today, durationMin) {
  const step = 30;
  const workStart = 9 * 60;
  const workEnd = 18 * 60;
  const dur = Math.max(step, Number(durationMin) || step);
  const busy = [];
  for (const k of Object.keys(day || {})) {
    const slot = day[k];
    if (!slot || typeof slot !== "object") continue;
    const s = hhmmMinutes(slot.time);
    if (s === null) continue;
    busy.push([s, s + Math.max(step, Number(slot.duration_min) || step)]);
  }
  let minStart = workStart;
  if (date === today) {
    const now = new Date(Date.now() + 5 * 60 * 60 * 1000);
    const lead = now.getUTCHours() * 60 + now.getUTCMinutes() + 30;
    minStart = Math.max(minStart, Math.ceil(lead / step) * step);
  }
  const out = [];
  for (let start = workStart; start + dur <= workEnd; start += step) {
    if (start < minStart) continue;
    const clash = busy.some((b) => start < b[1] && b[0] < start + dur);
    if (!clash) {
      out.push(`${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}`);
    }
  }
  return out;
}

async function handleBooking(request, env) {
  const c = cfg(env);
  const body = await readJson(request);
  const verified = await verifyInitData(body.initData, env);
  if (!verified.ok) return json({ ok: false, error: verified.error, blocked: !!verified.blocked }, verified.status || 401);
  if (!c.dbUrl) return json({ ok: false, error: "FIREBASE_DB_URL sozlanmagan" }, 500);

  const uid = String(verified.user.id);
  const date = clean(body.date, 10);
  const time = clean(body.time, 5);
  const start = hhmmMinutes(time);
  const today = tashkentToday();
  /* Lexical taqqoslash EMAS: Asia/Tashkent bo'yicha bugundan +6 kungacha
     HAQIQIY kalendar sanalar generatsiya qilinadi va faqat AYNAN mos kelgani
     qabul qilinadi. Shu sababli 2025-04-31 kabi mavjud bo'lmagan sanalar
     rad etiladi (avval regex ularni o'tkazib yuborardi). */
  const validDates = [];
  for (let i = 0; i < 7; i++) validDates.push(addIsoDays(today, i));
  if (!validDates.includes(date)) {
    return json({ ok: false, error: "Sana noto'g'ri" }, 400);
  }
  if (start === null || start < 9 * 60 || start >= 18 * 60 || start % 30 !== 0) {
    return json({ ok: false, error: "Vaqt noto'g'ri" }, 400);
  }

  const token = await accessToken(env);
  const services = await rtdbGetStrict(c.dbUrl, `${c.root}/catalog/services`, token);
  const service = catalogRowById(services, body.service_id);
  if (!catalogRowAvailable(service) || serviceSoon(service)) {
    return json({ ok: false, error: "Xizmat topilmadi" }, 404);
  }
  const duration = Math.max(30, Number(service.duration_min) || 30);
  if (start + duration > 18 * 60) return json({ ok: false, error: "Vaqt ish soatidan tashqarida" }, 400);

  /* 2.2.0 — mashina. Ixtiyoriy (eski Mini App yubormaydi), lekin yuborilsa
     katalogda bo'lishi SHART. Shisha almashtirishda narx mashinadan olinadi
     — mijoz yuborgan narxga ishonilmaydi. */
  let car = null;
  if (body.car_id != null && body.car_id !== "") {
    const cars = await rtdbGetStrict(c.dbUrl, `${c.root}/catalog/cars`, token);
    car = catalogRowById(cars, body.car_id);
    if (!catalogRowAvailable(car)) return json({ ok: false, error: "Mashina topilmadi" }, 409);
  }
  let price = Math.max(0, Number(service.price) || 0);
  if (car && serviceIsGlass(service)) {
    const cfgNode = await rtdbGetStrict(c.dbUrl, `${c.root}/catalog/configurator`, token);
    price = studioCarPrice("glass", car, studioCatalog(cfgNode));
  }
  // 2.3.0 — rul chexol materiali / o'rindiq dizayni: narx katalogdan
  const opt = await bookingOptions(c, token, service, body);
  if (opt && opt.error) return json({ ok: false, error: opt.error }, 409);
  if (opt) price = opt.price;
  // 2.3.0 — zalog: chek rasmi (https) bo'lmasa navbat olinmaydi
  const settings = await bookingSettings(c, token);
  let deposit = null;
  if (settings.deposit_on && settings.deposit > 0) {
    const receipt = clean(body.deposit_receipt, 600);
    if (!CATALOG_URL_RE.test(receipt)) {
      return json({
        ok: false,
        error: "deposit_required",
        message: `Navbat uchun ${fmtPrice(settings.deposit)} zalog cheki kerak. Ilovani yangilang.`,
        deposit: settings.deposit,
      }, 400);
    }
    deposit = { amount: settings.deposit, receipt };
  }
  if (date === today) {
    const now = new Date(Date.now() + 5 * 60 * 60 * 1000);
    const minStart = now.getUTCHours() * 60 + now.getUTCMinutes() + 30;
    if (start < minStart) return json({ ok: false, error: "Bu vaqt o'tib ketgan" }, 409);
  }

  const phone = normalizePhone(body.phone);
  if (!phone) return json({ ok: false, error: "Telefon raqam noto'g'ri" }, 400);
  const clientKey = clean(body.client_key, 64).replace(/[^A-Za-z0-9_-]/g, "");
  if (clientKey.length < 16) return json({ ok: false, error: "client_key_required" }, 400);
  const serviceId = service.id == null ? Number(body.service_id) : service.id;
  const carId = car ? (car.id == null ? Number(body.car_id) : car.id) : null;
  const hashBase = carId == null ? { service_id: serviceId, date, time, phone } : { service_id: serviceId, date, time, phone, car_id: carId };
  if (opt) hashBase.option = [opt.fields.option_id, opt.fields.option_hex || "", opt.fields.option_thread || ""];
  if (deposit) hashBase.deposit = deposit.receipt;
  const requestHash = await sha256Hex(JSON.stringify(hashBase));
  const key = `b_${uid}_${clientKey}`;
  const bookingPath = `${c.root}/bookings/${key}`;
  const claim = {
    uid: Number(uid),
    request_hash: requestHash,
    status: "processing",
    imported: false,
    source: "miniapp_worker",
    createdAt: Date.now(),
  };
  const claimed = await rtdbCreate(c.dbUrl, bookingPath, claim, token);
  if (!claimed.created) {
    const old = claimed.value;
    if (!old || old.request_hash !== requestHash) return json({ ok: false, error: "booking_conflict" }, 409);
    if (["cancelled", "done"].includes(old.status)) return json({ ok: false, error: "booking_final" }, 409);
  }

  /* Slot rezervatsiyasi VA booking yozuvining finalize'i BITTA umumiy root
     ETag CAS ichida: `slots/{date}/{key}` va `bookings/{key}` birga commit
     bo'ladi. Shu sababli "slot band, lekin booking yo'q" (yoki aksincha)
     oraliq holati qolmaydi. */
  const bookingFields = {
    service_id: serviceId,
    service_name: clean(service.name, 200),
    date,
    time,
    duration_min: duration,
    price,
    name: clean(body.name || [verified.user.first_name, verified.user.last_name].filter(Boolean).join(" "), 200),
    phone,
  };
  if (car) {
    bookingFields.car_id = carId;
    bookingFields.car_name = clean(car.name, 200);
  }
  if (opt) {
    Object.assign(bookingFields, opt.fields);
    bookingFields.details = clean(opt.details, 300);
  }
  if (deposit) {
    bookingFields.deposit_amount = deposit.amount;
    bookingFields.deposit_receipt = deposit.receipt;
    bookingFields.deposit_status = "pending";
  }
  // Kafolat muddati (snapshot): material/dizayn -> xizmat. Admin «Bajarildi»
  // bosganda o'zgartirishi mumkin.
  const warrantySnap = (opt && opt.warranty) || clean(service.warranty, 40);
  if (warrantySnap) bookingFields.warranty = warrantySnap;
  for (let attempt = 0; attempt < 10; attempt++) {
    const snap = await rtdbGetEtag(c.dbUrl, c.root, token);
    const root = snap.value && typeof snap.value === "object" ? snap.value : {};
    const bookings = root.bookings && typeof root.bookings === "object"
      ? root.bookings
      : (root.bookings = {});
    const bookingRow = bookings[key];
    if (!bookingRow || typeof bookingRow !== "object" || bookingRow.request_hash !== requestHash) {
      return json({ ok: false, error: "booking_conflict" }, 409);
    }
    if (["cancelled", "done"].includes(bookingRow.status)) {
      return json({ ok: false, error: "booking_final" }, 409);
    }
    const slots = root.slots && typeof root.slots === "object" ? root.slots : (root.slots = {});
    const day = slots[date] && typeof slots[date] === "object" ? slots[date] : (slots[date] = {});
    const finalized = bookingRow.status !== "processing" && bookingRow.status !== "failed";
    if (finalized && day[key]) {
      /* Avvalgi PUT'da slot + yozuv birga commit bo'lgan — idempotent replay. */
      return json({ ok: true, booking: { id: key, date: bookingRow.date, time: bookingRow.time, label: bookingRow.date }, repeated: true });
    }
    const clash = Object.keys(day).some((k) => {
      if (k === key) return false;
      const slot = day[k];
      if (!slot || typeof slot !== "object") return false;
      const otherStart = hhmmMinutes(slot.time);
      const otherDuration = Math.max(30, Number(slot.duration_min) || 30);
      return otherStart !== null && start < otherStart + otherDuration && otherStart < start + duration;
    });
    if (clash) {
      const freeList = computeFreeSlots(day, date, today, duration);
      bookings[key] = { ...bookingRow, status: "failed" };
      const put = await rtdbPutIfMatch(c.dbUrl, c.root, root, token, snap.etag);
      if (put.status === 412) continue;
      await ensureOk(put, "Navbat holati saqlanmadi");
      // `slots` — endi BO'SH vaqtlar ("HH:MM"), UI ularni to'g'ridan ko'rsatadi.
      return json({ ok: false, error: "slot_taken", message: "Bu vaqt band qilingan", slots: freeList }, 409);
    }
    day[key] = { time, duration_min: duration };
    bookings[key] = { ...bookingRow, ...bookingFields, status: "new" };
    const put = await rtdbPutIfMatch(c.dbUrl, c.root, root, token, snap.etag);
    if (put.status === 412) continue;
    await ensureOk(put, "Navbat band qilinmadi");
    /* Ilgari Worker navbati haqida adminga HECH NARSA yuborilmasdi — xabarni
       faqat Render'dagi bot (import paytida) berardi. Render o'chsa admin
       yangi navbatni umuman bilmasdi. Endi darhol, holat tugmalari bilan. */
    await notifyBooking(env, c, token, key, bookings[key], verified.user).catch(() => {});
    return json({ ok: true, booking: { id: key, date, time, label: date } }, claimed.created ? 201 : 200);
  }
  return json({ ok: false, error: "slot_busy", message: "Vaqtni band qilishda to'qnashuv" }, 409);
}

async function handleBiledOrder(request, env) {
  const c = cfg(env);
  const body = await readJson(request);
  const verified = await verifyInitData(body.initData, env);
  if (!verified.ok) return json({ ok: false, error: verified.error, blocked: !!verified.blocked }, verified.status || 401);
  if (!c.dbUrl) return json({ ok: false, error: "FIREBASE_DB_URL sozlanmagan" }, 500);
  const phone = normalizePhone(body.phone);
  if (!phone) return json({ ok: false, error: "Telefon raqam noto'g'ri" }, 400);

  const token = await accessToken(env);
  // 2.1.0 — Bi-LED Studio (3D konfigurator) tanlovi
  if (body.studio && typeof body.studio === "object") {
    return await createStudioOrder(env, c, token, verified, body, phone);
  }
  const [cars, bileds, shrouds, colors] = await Promise.all([
    rtdbGetStrict(c.dbUrl, `${c.root}/catalog/cars`, token),
    rtdbGetStrict(c.dbUrl, `${c.root}/catalog/biled_types`, token),
    rtdbGetStrict(c.dbUrl, `${c.root}/catalog/shrouds`, token),
    rtdbGetStrict(c.dbUrl, `${c.root}/catalog/optic_colors`, token),
  ]);
  const car = catalogRowById(cars, body.car_id);
  const biled = catalogRowById(bileds, body.biled_id);
  const shroud = body.shroud_id == null ? null : catalogRowById(shrouds, body.shroud_id);
  const color = body.color_id == null ? null : catalogRowById(colors, body.color_id);
  if (
    !catalogRowAvailable(car) ||
    !catalogRowAvailable(biled) ||
    (body.shroud_id != null && !catalogRowAvailable(shroud)) ||
    (body.color_id != null && !catalogRowAvailable(color))
  ) {
    return json({ ok: false, error: "Konfigurator tanlovi topilmadi yoki faol emas" }, 409);
  }

  const uid = String(verified.user.id);
  const nonce = clean(body.client_key, 64).replace(/[^A-Za-z0-9_-]/g, "");
  if (nonce.length < 16) return json({ ok: false, error: "client_key_required" }, 400);
  const key = `bl_${uid}_${nonce}`;
  const total = (Number(biled.price) || 0) + (Number(shroud && shroud.price) || 0) + (Number(color && color.price) || 0);
  const record = {
    uid: Number(uid),
    car_id: car.id == null ? Number(body.car_id) : car.id,
    car_name: clean(car.name, 200),
    biled_id: biled.id == null ? Number(body.biled_id) : biled.id,
    biled_name: clean(biled.name, 200),
    biled_price: Number(biled.price) || 0,
    shroud_id: shroud ? (shroud.id == null ? Number(body.shroud_id) : shroud.id) : null,
    shroud_name: shroud ? clean(shroud.name, 200) : "",
    shroud_price: Number(shroud && shroud.price) || 0,
    color_id: color ? (color.id == null ? Number(body.color_id) : color.id) : null,
    color_name: color ? clean(color.name, 200) : "",
    color_price: Number(color && color.price) || 0,
    comment: clean(body.comment, 2000),
    total,
    name: clean(body.name || [verified.user.first_name, verified.user.last_name].filter(Boolean).join(" "), 200),
    phone,
    status: "new",
    createdAt: Date.now(),
    imported: false,
    source: "miniapp_worker",
  };
  const requestHash = await sha256Hex(JSON.stringify({
    car_id: record.car_id,
    biled_id: record.biled_id,
    shroud_id: record.shroud_id,
    color_id: record.color_id,
    comment: record.comment,
    phone: record.phone,
  }));
  record.request_hash = requestHash;
  // Kod endi yozuvda ham turadi — bot, admin va kafolat bir xil kodni ko'rsatadi
  record.code = biledCode(key, record);
  const created = await rtdbCreate(c.dbUrl, `${c.root}/biled_orders/${key}`, record, token);
  if (!created.created) {
    if (!created.value || created.value.request_hash !== requestHash) {
      return json({ ok: false, error: "idempotency_conflict" }, 409);
    }
    const oldTotal = Number(created.value.total) || 0;
    if (!created.value.notified_admin) {
      await notifyBiled(env, c, token, key, created.value, verified.user).catch(() => {});
    }
    return json({ ok: true, order: { id: key, code: biledCode(key, created.value), total: oldTotal, total_label: fmtPrice(oldTotal) }, repeated: true });
  }
  // Admin darhol biladi (holat tugmalari bilan), mijoz esa tasdiq oladi
  await notifyBiled(env, c, token, key, record, verified.user).catch(() => {});
  return json({ ok: true, order: { id: key, code: record.code, total, total_label: fmtPrice(total) } }, 201);
}

// =====================================================================
//  2.4.0 — 🎓 SHOGIRD (AI) WORKER'DA va TO'LOV KARTASI ADMIN PANELDAN
//
//  NEGA. Shogird AI ilgari faqat Render (`/api/shogird`, Python) orqali
//  ishlardi. Render o'chirilgach Mini App har doim «Asosiy ma'lumotlar
//  rejimi» da qolib, AI umuman ishlamas edi. Endi Worker Groq'ga o'zi
//  murojaat qiladi:
//    • kalit — Worker secret `GROQ_API_KEY` (brauzerga hech qachon chiqmaydi);
//    • model — `GROQ_TEXT_MODEL` (standart openai/gpt-oss-120b), o'chirilsa
//      zaxira `GROQ_FALLBACK_MODEL` (standart openai/gpt-oss-20b);
//    • bilim — JONLI Firebase: xizmatlar, tovarlar (qoldig'i bilan), Bi-LED
//      konfigurator narxlari, rul materiallari, o'rindiq dizaynlari, zalog;
//    • suhbat tarixi Mini App'dan keladi (Worker xotira saqlamaydi);
//    • kartochkalar MODEL tanlamaydi — javob va savol katalog bilan
//      solishtiriladi, ya'ni yo'q tovar/narx hech qachon chiqmaydi.
//
//  Karta: `private/payment` (YOPIQ tugun) = {card_number, card_holder}.
//  Admin «Boshqaruv → To'lov kartasi» da o'zgartiradi. Bo'sh bo'lsa
//  eski `PAY_CARD_NUMBER`/`PAY_CARD_HOLDER` secret'lari ishlaydi.
// =====================================================================
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const SG_MAX_Q = 700;
const SG_HISTORY = 8;
const SG_COOLDOWN_MS = 1500;
const _sgLast = new Map();

/** Kartaning amaldagi rekvizitlari: admin yozgani, bo'lmasa secret. */
async function paymentConfig(env, c, token) {
  let row = null;
  if (c && c.dbUrl) {
    try {
      const t = token || (await accessToken(env));
      row = await rtdbGet(c.dbUrl, `${c.root}/private/payment`, t);
    } catch (_) {
      row = null;
    }
  }
  const r = row && typeof row === "object" ? row : {};
  return {
    card_number: clean(r.card_number, 40) || clean(env.PAY_CARD_NUMBER, 40),
    card_holder: clean(r.card_holder, 80) || clean(env.PAY_CARD_HOLDER, 80),
    source: r.card_number ? "admin" : env.PAY_CARD_NUMBER ? "secret" : "none",
    updatedAt: Number(r.updatedAt) || null,
  };
}

/** POST /admin/payment — {action:"get"} yoki {action:"set", card_number, card_holder} */
async function handleAdminPayment(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  const { c, body, uid } = gate;
  const token = await accessToken(env);
  if (clean(body.action, 8) === "set") {
    const digits = String(body.card_number || "").replace(/\D/g, "");
    if (digits.length !== 16) {
      return json({ ok: false, error: "validation", message: "Karta raqami 16 ta raqam bo'lishi kerak" }, 400);
    }
    const holder = clean(body.card_holder, 80).replace(/\s+/g, " ");
    if (holder.length < 3) {
      return json({ ok: false, error: "validation", message: "Karta egasining ism-familiyasini kiriting" }, 400);
    }
    const value = {
      card_number: digits.replace(/(\d{4})(?=\d)/g, "$1 "),
      card_holder: holder,
      updatedAt: Date.now(),
      updated_by: Number(uid),
    };
    await ensureOk(await rtdbPut(c.dbUrl, `${c.root}/private/payment`, value, token), "Karta saqlanmadi");
    return json({ ok: true, payment: { ...value, source: "admin" } });
  }
  return json({ ok: true, payment: await paymentConfig(env, c, token) });
}

/* ------------------------------------------------------- shogird: bilim */
function sgNorm(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[’ʻ`ʼ]/g, "'")
    .replace(/\s+/g, " ");
}

const SG_STOP = new Set([
  "fara", "faralar", "uchun", "yangi", "original", "komplekt", "dona", "juft", "zimmer",
  "uzbrovv", "avto", "mashina", "narxi", "narx", "xizmat", "xizmati", "ornatish",
  "o'rnatish", "almashtirish", "tovar", "mahsulot", "yil", "oy", "kun", "soat", "bir", "ham", "eng", "har",
]);

const SG_THEME_HINTS = {
  polish: ["xira", "sarg", "sarig", "polirov", "yaltir", "xiralash", "tusi ketgan", "oqarib"],
  clean: ["bug'", "bug ", "namlik", "suv kir", "terlagan", "ichi kir", "chang", "tozala", "germet"],
  glass: ["shisha", "yoril", "darz", "singan", "sinib"],
  biled: ["linza", "bi-led", "biled", "bi led", "yorug", "nur ", "xenon", "ksenon", "ko'rmaydi"],
  config: ["konfigurator", "r50", "r80", "r90", "ochki", "angel", "bmw"],
  wheel: ["rul", "shturval"],
  seat: ["o'rindiq", "orindiq", "sidenya", "chexol", "chehol"],
  aqua: ["akva", "aqua", "naqsh", "karbon naqsh"],
  tint: ["tanirov", "tonirov", "oyna qorayt"],
  armor: ["broni", "bronli", "plyonka", "kuzov himoya"],
};

function sgTokens(name) {
  return (sgNorm(name).match(/[a-z0-9']+/g) || []).filter(
    (w) => !SG_STOP.has(w) && (w.length >= 3 || /\d/.test(w))
  );
}

function sgHits(tokens, low) {
  let n = 0;
  for (const t of tokens) {
    if (t.length >= 4 ? low.includes(t) : new RegExp("(^|[^a-z0-9])" + t.replace(/[^a-z0-9']/g, "") + "($|[^a-z0-9])").test(low)) n++;
  }
  return n;
}

/** Jonli katalog (60 s kesh) — model uchun matn va kartochka uchun ro'yxat. */
async function sgKnowledge(env, c, token) {
  const [services, products, categories, cfgNode, wheels, seats, settings] = await Promise.all([
    cachedNode(c, token, "catalog/services"),
    cachedNode(c, token, "catalog/products"),
    cachedNode(c, token, "catalog/categories"),
    cachedNode(c, token, "catalog/configurator"),
    cachedNode(c, token, "catalog/wheel_materials"),
    cachedNode(c, token, "catalog/seat_designs"),
    cachedNode(c, token, "catalog/settings"),
  ]);
  const svc = [];
  for (const [k, r] of entriesOf(services)) {
    if (!catalogRowAvailable(r)) continue;
    const theme = serviceTheme(r);
    const soon = serviceSoon(r);
    svc.push({
      id: r.id != null ? r.id : k,
      name: clean(r.name, 120),
      theme,
      soon,
      price: Number(r.price) || 0,
      price_label: soon ? null : fmtPrice(Number(r.price) || 0),
      warranty: clean(r.warranty, 40),
      duration: Number(r.duration_min) || 0,
      description: clean(r.description, 200),
      sort: Number(r.sort) || 0,
    });
  }
  svc.sort((a, b) => a.sort - b.sort);
  const prods = [];
  for (const [k, p] of entriesOf(products)) {
    if (!catalogRowAvailable(p)) continue;
    prods.push({
      id: p.id != null ? p.id : k,
      name: clean(p.name, 120),
      code: clean(p.code, 40),
      price: Number(p.price) || 0,
      price_label: fmtPrice(Number(p.price) || 0),
      stock: Number(p.stock) || 0,
      warranty: clean(p.warranty, 40),
      cat: clean(productCategoryName(p, categories), 60),
    });
  }
  const studio = studioCatalog(cfgNode);
  const pick = (g) =>
    Object.values(studio)
      .filter((r) => r.group === g && catalogRowAvailable(r))
      .sort((a, b) => (a.sort || 0) - (b.sort || 0));
  const wm = entriesOf(wheels).map(([, r]) => r).filter(catalogRowAvailable);
  const sd = entriesOf(seats).map(([, r]) => r).filter(catalogRowAvailable);
  const bk = (settings && settings.booking) || {};
  const deposit = bk.deposit_on === 0 || bk.deposit_on === false ? 0 : Number(bk.deposit) >= 0 && bk.deposit != null ? Number(bk.deposit) : 100000;

  const lines = [];
  lines.push("XIZMATLAR (🛠 Xizmatlar bo'limi):");
  svc.forEach((s) =>
    lines.push(
      `- ${s.name}: ${s.soon ? "TEZ KUNDA (hali ochilmagan, narx va navbat yo'q)" : s.price_label}` +
        (s.warranty && !s.soon ? `, kafolat ${s.warranty}` : "") +
        (s.duration && !s.soon ? `, ~${s.duration} daqiqa` : "") +
        (s.theme === "glass" ? " (narx mashina rusumiga qarab farq qiladi, 2 fara)" : "") +
        (s.theme === "wheel" ? " (narx tanlangan materialga qarab)" : "") +
        (s.theme === "seat" ? " (narx tanlangan dizaynga qarab)" : "")
    )
  );
  lines.push("");
  lines.push("BI-LED KONFIGURATOR (🛠 Xizmatlar → Bi-LED konfigurator, 3D ko'rinishda; narxlar 2 fara, o'rnatish bilan):");
  pick("lens").forEach((r) => lines.push(`- Linza ${r.name}: ${fmtPrice(r.price)}` + [r.size, r.kelvin, r.lumen].filter(Boolean).map((x) => ", " + x).join("") + (r.warranty ? `, kafolat ${r.warranty}` : "")));
  pick("inner").forEach((r) => lines.push(`- Fara ichi ${r.name}: ${r.price ? fmtPrice(r.price) : "bepul"}`));
  pick("ring").forEach((r) => lines.push(`- Ochki ${r.name}: ${fmtPrice(r.price)} (xrom yoki qora${r.code === "glow" ? ", rangini mijoz tanlaydi" : ""})`));
  if (catalogRowAvailable(studio.glass)) lines.push(`- Yangi fara shishasi: odatda ${fmtPrice(studio.glass.price)}, mashinaga qarab farq qiladi`);
  if (catalogRowAvailable(studio.housing)) lines.push(`- Yangi korpus: odatda ${fmtPrice(studio.housing.price)}, mashinaga qarab`);
  if (wm.length) {
    lines.push("");
    lines.push("RUL CHEXOL MATERIALLARI:");
    wm.slice(0, 12).forEach((m) =>
      lines.push(`- ${clean(m.name, 60)}: ${fmtPrice(Number(m.price) || 0)}; ranglar: ${rowsList(m.colors).map((x) => clean(x.name, 30)).join(", ") || "—"}`)
    );
  }
  if (sd.length) {
    lines.push("");
    lines.push("O'RINDIQ CHEXOL DIZAYNLARI:");
    sd.slice(0, 12).forEach((d) => lines.push(`- ${clean(d.name, 60)}: ${fmtPrice(Number(d.price) || 0)}`));
  }
  lines.push("");
  lines.push(
    deposit > 0
      ? `NAVBAT: kun → vaqt → ${fmtPrice(deposit)} zalog (kartaga o'tkazib, chek rasmini yuklaydi); usta chekni ko'rib tasdiqlaydi.`
      : "NAVBAT: kun → vaqt → band qilish (zalog hozir yo'q)."
  );
  const inStock = prods.filter((p) => p.stock > 0).slice(0, 60);
  if (inStock.length) {
    lines.push("");
    lines.push("DO'KONDAGI TOVARLAR (🏠 Asosiy bo'limi, mavjudlari):");
    inStock.forEach((p) => lines.push(`- ${p.name}${p.code ? " [" + p.code + "]" : ""}: ${p.price_label}${p.cat ? " (" + p.cat + ")" : ""}${p.warranty ? ", kafolat " + p.warranty : ""}`));
  }
  return { text: lines.join("\n"), services: svc, products: prods, deposit };
}

function sgMatch(know, question, answer) {
  const low = sgNorm(question + " \n " + answer);
  const qlow = sgNorm(question);
  const themes = new Set(Object.keys(SG_THEME_HINTS).filter((t) => SG_THEME_HINTS[t].some((h) => qlow.includes(h))));
  const services = know.services
    .map((s) => {
      let score = 10 * sgHits(sgTokens(s.name), low);
      if (s.theme && themes.has(s.theme)) score += 8;
      if (s.soon) score -= 4;
      return { score, s };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map(({ s }) => ({ id: s.id, name: s.name, price_label: s.price_label, warranty: s.warranty, theme: s.theme || null, coming_soon: s.soon }));
  const products = know.products
    .map((p) => {
      let score = 10 * sgHits(sgTokens(p.name), low);
      if (p.code && p.code.length >= 3 && low.includes(sgNorm(p.code))) score += 20;
      if (p.stock <= 0) score -= 5;
      return { score, p };
    })
    .filter((x) => x.score >= 10)
    .sort((a, b) => b.score - a.score || a.p.price - b.p.price)
    .slice(0, 3)
    .map(({ p }) => ({ id: p.id, name: p.name, price_label: p.price_label, stock: p.stock }));
  return { services, products, themes };
}

const SG_SUGGEST = {
  polish: ["Polirovka qancha vaqt oladi?", "Polirovkaga kafolat bormi?"],
  clean: ["Fara ichiga nega bug' yig'iladi?", "Navbat qanday olinadi?"],
  glass: ["Shisha narxi mashinaga qarabmi?", "Navbat qanday olinadi?"],
  biled: ["R50, R80 va R90 farqi nima?", "BMW halqa qancha turadi?"],
  config: ["R50, R80 va R90 farqi nima?", "Qora fara ichi qancha?"],
  wheel: ["Rul chexol materiallari qanday?", "Navbat qanday olinadi?"],
  seat: ["O'rindiq dizaynlari qanday?", "Chexol qancha vaqtda tayyor?"],
};

function sgClean(text) {
  return String(text || "")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 1800);
}

function sgPrompt(env, know, user, isAdmin) {
  const b = botConf(env);
  const name = clean(user.first_name, 40);
  const contact = [b.phone ? "telefon " + b.phone : "", b.telegram ? "Telegram @" + b.telegram : ""].filter(Boolean).join(", ") || "ustaxona bilan";
  return `Sen — «Uzbrovv» avtochiroq ustaxonasining SHOGIRDIsan (Mini App ichidagi yordamchi). ${b.city || "Samarqand"}dagi ustaxona. Fara bilan ishlaymiz: Bi-LED linza o'rnatish, fara polirovkasi, ichini tozalash, shishasini va korpusini almashtirish, rul va o'rindiq chexol tikish. Do'konda LED lampalar, DRL va fara materiallari bor.

${isAdmin ? "Bu odam — do'kon ADMINI, unga «admin» deb murojaat qil." : name ? `Mijozning ismi ${name}. «Siz» deb, iliq murojaat qil.` : "Mijozga «siz» deb, iliq murojaat qil."}

MIJOZ ILOVA ICHIDA. Havola yoki «ilovani oching» dema — ilova ichida yo'naltir:
🏠 Asosiy (tovarlar), 🛠 Xizmatlar (narx, kafolat, «Navbat olish», Bi-LED konfigurator), 🧺 Savatcha (Rasmiylashtirish), ❤ Saqlangan, 👤 Kabinet (buyurtmalar, navbatlar, 🛡 kafolat).
Sen o'zing buyurtma bermaysan, navbat olmaysan — mijozga qaysi tugmani bosishni ko'rsatasan.

TIL: o'zbek, LOTIN yozuvi. Mijoz ruscha yoki inglizcha yozsa — o'sha tilda. Qisqa va jonli: 3-6 qator. Markdown va HTML ISHLATMA (yulduzcha, #, <b> yo'q), oddiy matn va zarur bo'lsa «•» bilan punktlar.

MUAMMO: «faram xira», «ichida bug'», «yorug'lik kam» kabi gaplarda sabab va yechimni qisqa tushuntir, mos xizmat va narxni ayt. Kerak bo'lsa bitta aniqlashtiruvchi savol ber (mashina modeli).

QAT'IY:
• Narx, kafolat, mavjudlikni FAQAT pastdagi JONLI MA'LUMOTdan ol. U yerda yo'q narsa narxini o'ylab topma — «ustadan aniqlab beraman» de va aloqani ber: ${contact}.
• «TEZ KUNDA» xizmatga narx aytma, navbat taklif qilma — «ochilganda xabar bering» tugmasini bosishni ayt.
• Chegirma, bepul xizmat yoki aniq tayyor bo'lish muddatini VA'DA QILMA.
• Mavzudan tashqari savolga (siyosat, tibbiyot va h.k.) muloyim rad et va avtochiroq mavzusiga qayt.

JONLI MA'LUMOT:
${know.text}`;
}

/** POST /shogird — {initData, text, history:[{role:"me"|"sg", text}]} */
async function handleShogird(request, env) {
  const c = cfg(env);
  const body = await readJson(request);
  const verified = await verifyInitData(body.initData, env);
  if (!verified.ok) return json({ ok: false, error: verified.error, blocked: !!verified.blocked }, verified.status || 401);
  if (!env.GROQ_API_KEY) return json({ ok: false, reason: "no_key", error: "no_key", message: "AI kaliti sozlanmagan" }, 200);
  const question = clean(body.text, SG_MAX_Q);
  if (question.length < 2) return json({ ok: false, error: "empty", message: "Savolni yozing" }, 400);
  const uid = String(verified.user.id);
  const now = Date.now();
  if (now - (_sgLast.get(uid) || 0) < SG_COOLDOWN_MS) {
    return json({ ok: false, error: "too_fast", message: "Bir lahza kuting…" }, 429);
  }
  _sgLast.set(uid, now);
  if (_sgLast.size > 2000) _sgLast.clear();

  const token = await accessToken(env);
  const know = await sgKnowledge(env, c, token);
  const history = (Array.isArray(body.history) ? body.history : [])
    .slice(-SG_HISTORY)
    .map((m) => ({ role: m && m.role === "me" ? "user" : "assistant", content: clean(m && m.text, 1200) }))
    .filter((m) => m.content);
  const messages = [
    { role: "system", content: sgPrompt(env, know, verified.user, c.admins.includes(uid)) },
    ...history,
    { role: "user", content: question },
  ];
  const primary = clean(env.GROQ_TEXT_MODEL, 80) || "openai/gpt-oss-120b";
  const fallback = clean(env.GROQ_FALLBACK_MODEL, 80) || "openai/gpt-oss-20b";
  let answer = "";
  let lastErr = "";
  for (const model of primary === fallback ? [primary] : [primary, fallback]) {
    const payload = { model, messages, temperature: 0.5, max_completion_tokens: 1400 };
    if (/gpt-oss/i.test(model)) {
      payload.reasoning_effort = "low";
      payload.include_reasoning = false;
    }
    let res;
    try {
      res = await fetch(GROQ_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      lastErr = "network";
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      console.error("[shogird] GROQ_API_KEY rad etildi:", res.status);
      return json({ ok: false, reason: "bad_key", error: "bad_key", message: "AI kaliti noto'g'ri" }, 200);
    }
    if (res.status === 429) {
      lastErr = "rate";
      continue;
    }
    if (!res.ok) {
      lastErr = "http_" + res.status;
      console.error("[shogird] Groq", model, res.status, (await res.text().catch(() => "")).slice(0, 300));
      continue;
    }
    const data = await res.json().catch(() => null);
    const msg = data && data.choices && data.choices[0] && data.choices[0].message;
    answer = sgClean(msg && msg.content);
    if (answer) break;
    lastErr = "empty";
  }
  if (!answer) {
    return json({ ok: false, reason: lastErr === "rate" ? "busy" : "ai_down", error: lastErr || "ai_down", message: "AI hozir javob bera olmadi" }, 200);
  }
  const match = sgMatch(know, question, answer);
  const theme = [...match.themes][0];
  const suggests = (SG_SUGGEST[theme] || ["Xizmat narxlari qanday?", "Navbat qanday olinadi?", "Kafolat qancha?"]).slice(0, 3);
  return json({ ok: true, text: answer, services: match.services, products: match.products, suggests, ai: true });
}

// =====================================================================
//  XIZMATLAR 2.3.0 — rul chexol materiali, o'rindiq dizayni, zalog,
//  «tez kunda» yo'nalishlar, xizmat kafolati va «xabar bering»
//
//  • Rul chexol: `catalog/wheel_materials/{id}` = {name, price, texture,
//    colors:[{name, hex}], warranty?}. Navbatda material + rang + ip.
//  • O'rindiq: `catalog/seat_designs/{id}` = {name, price, zones:{z1..z20},
//    thread, warranty?}. Navbatda dizayn.
//    Ikkala holatda ham narx SERVERDA katalogdan olinadi.
//  • Zalog: `catalog/settings/booking` = {deposit, deposit_on}; yo'q bo'lsa
//    100 000 so'm, yoqilgan. Navbat chek rasmi (https) bilan qabul qilinadi,
//    admin tasdiqlaganda `deposit_status: "paid"`.
//  • «Tez kunda»: akvaprint, tonirovka, broni plyonka — narxi qo'yilmaguncha
//    navbat olinmaydi (admin narx qo'ysa o'zi ochiladi).
//  • Kafolat: navbat «Bajarildi» bo'lganda boshlanadi. Muddat — admin
//    tanlagani, bo'lmasa xizmat/material/dizayndagi muddat.
// =====================================================================
const SOON_THEMES = ["aqua", "tint", "armor"];
const BOOKING_DEFAULTS = { deposit: 100000, deposit_on: 1 };
const HEX6_RE = /^#[0-9a-f]{6}$/i;
const NO_WARRANTY_RE = /^(yo'?q|yoq|0|none|-)$/i;

/** Xizmat temasi: admin yozgan `theme`, bo'lmasa nomdan (app.js themeOf bilan mos). */
function serviceTheme(service) {
  const theme = String((service && service.theme) || "").toLowerCase().trim();
  if (theme) return theme;
  const n = String((service && service.name) || "").toLowerCase();
  if (/akva|aqua/.test(n)) return "aqua";
  if (/laminat/.test(n)) return "laminate";
  if (/tanirov|tonirov/.test(n)) return "tint";
  if (/broni|bronli|plyonka|plonka/.test(n)) return "armor";
  if (/rul/.test(n)) return "wheel";
  if (/rindiq/.test(n)) return "seat";
  if (/shisha/.test(n)) return "glass";
  if (/polirov|polish/.test(n)) return "polish";
  return "";
}

/** «Tez kunda»: admin belgilagan yoki — akvaprint/tonirovka/broni narxsiz. */
function serviceSoon(service) {
  if (!service) return true;
  if (service.coming_soon) return true;
  return SOON_THEMES.includes(serviceTheme(service)) && !(Number(service.price) > 0);
}

function rowsList(raw) {
  if (Array.isArray(raw)) return raw.filter((x) => x && typeof x === "object");
  if (raw && typeof raw === "object") return Object.values(raw).filter((x) => x && typeof x === "object");
  return [];
}

async function bookingSettings(c, token) {
  const row = await rtdbGet(c.dbUrl, `${c.root}/catalog/settings/booking`, token).catch(() => null);
  const r = row && typeof row === "object" ? row : {};
  const deposit = Number(r.deposit);
  return {
    deposit: Number.isFinite(deposit) && deposit >= 0 ? Math.round(deposit) : BOOKING_DEFAULTS.deposit,
    deposit_on: r.deposit_on === undefined ? BOOKING_DEFAULTS.deposit_on : r.deposit_on ? 1 : 0,
  };
}

/** Rul/o'rindiq tanlovi -> {price, fields, details, warranty} | {error} | null. */
async function bookingOptions(c, token, service, body) {
  const theme = serviceTheme(service);
  const o = body.options && typeof body.options === "object" ? body.options : null;
  if (!o) return null;
  if (theme === "wheel") {
    const node = await rtdbGetStrict(c.dbUrl, `${c.root}/catalog/wheel_materials`, token);
    const m = catalogRowById(node, clean(o.material, 60));
    if (!catalogRowAvailable(m)) return { error: "Material topilmadi yoki faol emas" };
    const want = String(o.color || "").toLowerCase();
    const color = rowsList(m.colors).find((x) => String(x.hex || "").toLowerCase() === want);
    if (!color) return { error: "Material rangi topilmadi" };
    const thread = HEX6_RE.test(String(o.thread || "")) ? String(o.thread).toLowerCase() : null;
    const name = clean(m.name, 120);
    const colorName = clean(color.name, 60) || String(color.hex).toUpperCase();
    return {
      price: Math.max(0, Math.round(Number(m.price) || 0)),
      warranty: clean(m.warranty, 40) || null,
      details: [name, colorName, thread ? "ip " + thread.toUpperCase() : ""].filter(Boolean).join(" · "),
      fields: {
        option_kind: "wheel",
        option_id: String(clean(o.material, 60)),
        option_name: name,
        option_color: colorName,
        option_hex: String(color.hex).toLowerCase(),
        option_thread: thread,
      },
    };
  }
  if (theme === "seat") {
    const node = await rtdbGetStrict(c.dbUrl, `${c.root}/catalog/seat_designs`, token);
    const d = catalogRowById(node, clean(o.design, 60));
    if (!catalogRowAvailable(d)) return { error: "Dizayn topilmadi yoki faol emas" };
    const name = clean(d.name, 120);
    return {
      price: Math.max(0, Math.round(Number(d.price) || 0)),
      warranty: clean(d.warranty, 40) || null,
      details: name,
      fields: { option_kind: "seat", option_id: String(clean(o.design, 60)), option_name: name },
    };
  }
  return null;
}

/** Admin yozgan kafolat matni -> «6 oy» / «yo'q» | null (noto'g'ri). */
function normWarrantyText(raw) {
  const s = clean(raw, 40);
  if (!s || NO_WARRANTY_RE.test(s)) return "yo'q";
  const p = wParse(s);
  return p ? wLabel(p) : null;
}

/* ---------------------------------------------------------------------
   POST /admin/warranties — barcha mijozlarning kafolatlari (admin)
   --------------------------------------------------------------------- */
async function handleAdminWarranties(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  const { c } = gate;
  const token = await accessToken(env);
  const [biledNode, bookingNode, pendingNode, products, categories, biledTypes] = await Promise.all([
    rtdbGet(c.dbUrl, `${c.root}/biled_orders`, token).catch(() => null),
    rtdbGet(c.dbUrl, `${c.root}/bookings`, token).catch(() => null),
    rtdbGet(c.dbUrl, `${c.root}/pending_orders`, token).catch(() => null),
    cachedNode(c, token, "catalog/products"),
    cachedNode(c, token, "catalog/categories"),
    cachedNode(c, token, "catalog/biled_types"),
  ]);
  const now = Date.now();
  const base = { products: products || {}, categories: categories || {}, biledTypes: biledTypes || {}, now };
  const out = [];
  const live = (r) => r && r.status !== "processing" && r.status !== "failed";
  const add = (list, ref) => list.forEach((w) => out.push({ ...w, ...ref }));
  const who = (r) => ({ uid: Number(r.uid) || 0, name: clean(r.name, 120), phone: clean(r.phone, 30) });
  for (const [k, r] of entriesOf(biledNode)) {
    if (!live(r)) continue;
    add(buildWarranties({ ...base, biled: [customerBiledView(k, r)] }), { ref_kind: "biled", ref_key: k, editable: true, ...who(r) });
  }
  for (const [k, r] of entriesOf(bookingNode)) {
    if (!live(r)) continue;
    add(buildWarranties({ ...base, bookings: [customerBookingView(k, r)] }), { ref_kind: "booking", ref_key: k, editable: true, ...who(r) });
  }
  for (const [k, r] of entriesOf(pendingNode)) {
    if (!live(r)) continue;
    add(buildWarranties({ ...base, orders: [customerOrderView(k, "pending", r, null)] }), { ref_kind: "order", ref_key: k, editable: false, ...who(r) });
  }
  const rank = { active: 0, pending: 1, expired: 2 };
  out.sort((a, b) => rank[a.state] - rank[b.state] || (a.state === "active" ? a.end - b.end : (b.start || b.created) - (a.start || a.created)));
  return json({ ok: true, warranties: out, now });
}

/* ---------------------------------------------------------------------
   POST /admin/warranty-set — bajarilgan ishning kafolat muddatini o'zgartirish
   --------------------------------------------------------------------- */
async function handleAdminWarrantySet(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  const { c, body, uid } = gate;
  const kind = clean(body.kind, 12);
  if (!KIND_NODES[kind]) return json({ ok: false, error: "kind" }, 400);
  const key = clean(body.key, 120);
  if (!/^[A-Za-z0-9_-]+$/.test(key)) return json({ ok: false, error: "bad_key" }, 400);
  const warranty = normWarrantyText(body.warranty);
  if (warranty == null) return json({ ok: false, error: "validation", message: "Muddat noto'g'ri: masalan 6 oy, 1 yil, 90 kun" }, 400);
  const token = await accessToken(env);
  const path = `${c.root}/${KIND_NODES[kind]}/${key}`;
  const row = await rtdbGet(c.dbUrl, path, token);
  if (!row || typeof row !== "object") return json({ ok: false, error: "not_found" }, 404);
  const patch = { warranty, warranty_set_by: Number(uid), warranty_set_at: Date.now() };
  await ensureOk(await rtdbPatch(c.dbUrl, path, patch, token), "Kafolat saqlanmadi");
  return json({ ok: true, kind, key, warranty });
}

/* ---------------------------------------------------------------------
   POST /service-notify — «Tez kunda» xizmat: «Ishga tushganda xabar bering»
   --------------------------------------------------------------------- */
async function handleServiceNotify(request, env) {
  const c = cfg(env);
  const body = await readJson(request);
  const verified = await verifyInitData(body.initData, env);
  if (!verified.ok) return json({ ok: false, error: verified.error, blocked: !!verified.blocked }, verified.status || 401);
  if (!c.dbUrl) return json({ ok: false, error: "FIREBASE_DB_URL sozlanmagan" }, 500);
  const token = await accessToken(env);
  const services = await rtdbGetStrict(c.dbUrl, `${c.root}/catalog/services`, token);
  const service = catalogRowById(services, body.service_id);
  if (!service || service.deleted) return json({ ok: false, error: "Xizmat topilmadi" }, 404);
  const sid = String(service.id == null ? clean(body.service_id, 40) : service.id).replace(/[^A-Za-z0-9_-]/g, "");
  const uid = String(verified.user.id);
  const path = `${c.root}/service_waitlist/${sid}/${uid}`;
  const existed = await rtdbGet(c.dbUrl, path, token).catch(() => null);
  const name = clean([verified.user.first_name, verified.user.last_name].filter(Boolean).join(" "), 120);
  await ensureOk(await rtdbPut(c.dbUrl, path, { uid: Number(uid), name, at: Date.now() }, token), "Saqlanmadi");
  if (!existed) {
    await notifyAdmins(
      env,
      c,
      `🔔 <b>${escHtml(service.name || "Xizmat")}</b> — mijoz ishga tushishini kutyapti\n` +
        `👤 ${userLink(uid, name, verified.user.username)}`
    ).catch(() => {});
  }
  return json({ ok: true, already: !!existed });
}

// =====================================================================
//  BI-LED STUDIO (3D konfigurator) — 2.1.0
//
//  Mijoz Mini App'da tanlaydi: linza (R50/R80/R90), fara ichi (xrom/qora),
//  ochki (oddiy / BMW halqa / BMW yonadigan + rang), ochki rangi (xrom/qora),
//  yangi shisha va yangi korpus. Narx HECH QACHON mijozdan olinmaydi:
//    variantlar — `catalog/configurator/{qator}` (admin panel yozadi),
//    qator yo'q bo'lsa — STUDIO_DEFAULTS;
//    shisha/korpus — `catalog/cars/{id}.glass_price|housing_price`,
//    bo'lmasa `glass`/`housing` qatorining standart narxi.
//
//  DIQQAT: STUDIO_DEFAULTS `docs/js/offline.js` dagi bilan AYNAN bir xil
//  bo'lishi SHART — aks holda ekrandagi va yozilgan narx farq qiladi.
//  Yozuv eski Bi-LED buyurtmasi bilan bir xil tugunga (`biled_orders`) va
//  bir xil maydonlar bilan tushadi — admin, bot, kabinet va kafolat
//  o'zgarishsiz ishlaydi; yangi maydonlar: glass*, housing*, ring_*,
//  warranty, studio.
// =====================================================================
const STUDIO_DEFAULTS = {
  lens_r50: { group: "lens", code: "r50", sort: 1, name: "Bi-LED R50", price: 1200000, size: "2.5\"", kelvin: "5000K", lumen: "6 500 lm", warranty: "1 yil", badge: "" },
  lens_r80: { group: "lens", code: "r80", sort: 2, name: "Bi-LED R80", price: 1500000, size: "3.0\"", kelvin: "5500K", lumen: "8 500 lm", warranty: "1 yil", badge: "Ommabop" },
  lens_r90: { group: "lens", code: "r90", sort: 3, name: "Bi-LED R90", price: 2200000, size: "3.0\"", kelvin: "6000K", lumen: "11 000 lm", warranty: "1 yil", badge: "Premium" },
  inner_chrome: { group: "inner", code: "chrome", sort: 1, name: "Asl rang (xrom)", price: 0 },
  inner_black: { group: "inner", code: "black", sort: 2, name: "Qora", price: 350000 },
  ring_plain: { group: "ring", code: "plain", sort: 1, name: "Oddiy ochki", price: 250000 },
  ring_bmw: { group: "ring", code: "bmw", sort: 2, name: "BMW halqa", price: 400000 },
  ring_glow: { group: "ring", code: "glow", sort: 3, name: "BMW yonadigan halqa", price: 450000 },
  glass: { group: "glass", code: "glass", sort: 1, name: "Yangi fara shishasi", price: 250000 },
  housing: { group: "housing", code: "housing", sort: 1, name: "Yangi korpus", price: 600000 },
};

/** Bazadagi qatorlar standartlar ustiga qo'yiladi (faqat ma'lum kalitlar). */
function studioCatalog(node) {
  const raw = {};
  for (const k of Object.keys(STUDIO_DEFAULTS)) raw[k] = { id: k, ...STUDIO_DEFAULTS[k] };
  if (node && typeof node === "object" && !Array.isArray(node)) {
    for (const k of Object.keys(node)) {
      const row = node[k];
      if (!raw[k] || !row || typeof row !== "object") continue;
      for (const f of Object.keys(row)) {
        if (row[f] !== null && row[f] !== undefined) raw[k][f] = row[f]; // "" — admin ataylab tozalagan
      }
      raw[k].id = k;
    }
  }
  return raw;
}

function studioRowOk(row, group) {
  return !!row && row.group === group && catalogRowAvailable(row);
}

function studioPrice(row) {
  return Math.max(0, Math.round(Number(row && row.price) || 0));
}

/** Shisha/korpus narxi: mashinaga xos bo'lsa o'sha, aks holda standart (2 fara). */
function studioCarPrice(kind, car, raw) {
  const own = Number(car && car[`${kind}_price`]);
  if (Number.isFinite(own) && own > 0) return Math.round(own);
  return studioPrice(raw[kind]);
}

/** «Fara shishasini almashtirish» xizmatimi (tema yoki nom bo'yicha). */
function serviceIsGlass(service) {
  return serviceTheme(service) === "glass";
}

/** Buyurtma tarkibi (bot, admin va kabinet uchun bitta manba). */
function biledParts(rec) {
  const r = rec || {};
  return [
    r.biled_name || r.biled,
    r.shroud_name || r.shroud,
    r.color_name || r.color,
    r.glass ? "Yangi shisha" : "",
    r.housing ? "Yangi korpus" : "",
  ].filter(Boolean);
}

async function createStudioOrder(env, c, token, verified, body, phone) {
  const pick = body.studio || {};
  const [cars, cfgNode] = await Promise.all([
    rtdbGetStrict(c.dbUrl, `${c.root}/catalog/cars`, token),
    rtdbGetStrict(c.dbUrl, `${c.root}/catalog/configurator`, token),
  ]);
  const raw = studioCatalog(cfgNode);
  const car = catalogRowById(cars, body.car_id);
  const lens = raw[clean(pick.lens, 40)];
  const inner = raw[clean(pick.inner, 40)];
  const ring = raw[clean(pick.ring, 40)];
  const finish = pick.finish === "black" ? "black" : pick.finish === "chrome" ? "chrome" : null;
  const glowRaw = String(pick.glow || "").toLowerCase();
  const glow = /^#[0-9a-f]{6}$/.test(glowRaw) ? glowRaw : null;
  const wantGlass = pick.glass === true;
  const wantHousing = pick.housing === true;
  if (
    !catalogRowAvailable(car) ||
    !studioRowOk(lens, "lens") ||
    !studioRowOk(inner, "inner") ||
    !studioRowOk(ring, "ring") ||
    !finish ||
    (ring.code === "glow" && !glow) ||
    (wantGlass && !catalogRowAvailable(raw.glass)) ||
    (wantHousing && !catalogRowAvailable(raw.housing))
  ) {
    return json({ ok: false, error: "Konfigurator tanlovi topilmadi yoki faol emas" }, 409);
  }

  const uid = String(verified.user.id);
  const nonce = clean(body.client_key, 64).replace(/[^A-Za-z0-9_-]/g, "");
  if (nonce.length < 16) return json({ ok: false, error: "client_key_required" }, 400);
  const key = `bl_${uid}_${nonce}`;

  const lensPrice = studioPrice(lens);
  const innerPrice = studioPrice(inner);
  const ringPrice = studioPrice(ring);
  const glassPrice = wantGlass ? studioCarPrice("glass", car, raw) : 0;
  const housingPrice = wantHousing ? studioCarPrice("housing", car, raw) : 0;
  const total = lensPrice + innerPrice + ringPrice + glassPrice + housingPrice;
  const ringGlow = ring.code === "glow" ? glow : null;
  const ringName = [clean(ring.name, 120), finish === "black" ? "qora" : "xrom", ringGlow ? ringGlow.toUpperCase() : ""]
    .filter(Boolean)
    .join(" · ");

  const record = {
    uid: Number(uid),
    car_id: car.id == null ? Number(body.car_id) : car.id,
    car_name: clean(car.name, 200),
    biled_id: lens.id,
    biled_name: clean(lens.name, 200),
    biled_price: lensPrice,
    shroud_id: ring.id,
    shroud_name: ringName,
    shroud_price: ringPrice,
    color_id: inner.id,
    color_name: "Fara ichi: " + clean(inner.name, 120).toLowerCase(),
    color_price: innerPrice,
    ring_finish: finish,
    ring_glow: ringGlow,
    glass: wantGlass,
    glass_price: glassPrice,
    housing: wantHousing,
    housing_price: housingPrice,
    warranty: clean(lens.warranty, 60) || null,
    studio: 2,
    comment: clean(body.comment, 2000),
    total,
    name: clean(body.name || [verified.user.first_name, verified.user.last_name].filter(Boolean).join(" "), 200),
    phone,
    status: "new",
    createdAt: Date.now(),
    imported: false,
    source: "miniapp_worker",
  };
  record.request_hash = await sha256Hex(JSON.stringify({
    car_id: record.car_id,
    studio: [lens.id, inner.id, ring.id, finish, ringGlow, wantGlass, wantHousing],
    comment: record.comment,
    phone: record.phone,
  }));
  record.code = biledCode(key, record);
  return await commitBiledRecord(env, c, token, key, record, verified.user);
}

/** Idempotent yozish + bildirishnoma (eski va studiya buyurtmasi uchun bir xil). */
async function commitBiledRecord(env, c, token, key, record, user) {
  const created = await rtdbCreate(c.dbUrl, `${c.root}/biled_orders/${key}`, record, token);
  if (!created.created) {
    if (!created.value || created.value.request_hash !== record.request_hash) {
      return json({ ok: false, error: "idempotency_conflict" }, 409);
    }
    const oldTotal = Number(created.value.total) || 0;
    if (!created.value.notified_admin) {
      await notifyBiled(env, c, token, key, created.value, user).catch(() => {});
    }
    return json({ ok: true, order: { id: key, code: biledCode(key, created.value), total: oldTotal, total_label: fmtPrice(oldTotal) }, repeated: true });
  }
  await notifyBiled(env, c, token, key, record, user).catch(() => {});
  return json({ ok: true, order: { id: key, code: record.code, total: record.total, total_label: fmtPrice(record.total) } }, 201);
}

// =====================================================================
//  ADMIN QATLAMI — Render'siz katalog boshqaruvi
//
//  NEGA KATALOGGA TO'G'RIDAN YOZILMAYDI (eng muhim qaror):
//  Bot katalogni `services/sync.py` da `method="put"` bilan yuboradi
//  (`push_catalog`, `push_all_catalog`) — ya'ni `zimmer/catalog/products`
//  tuguni USTIDAN to'liq qayta yoziladi. Zimmer'da haqiqiy manba SQLite,
//  Firebase esa uning ko'zgusi.
//
//  Shuning uchun admin qo'shgan tovarni to'g'ridan `catalog/products` ga
//  yozish XATO bo'lardi: Render uyg'onib birinchi sinxron qilganda tovar
//  JIMGINA O'CHIB KETARDI va admin buni bilmasdi.
//
//  (Avto_A1 da bu muammo yo'q, chunki uning yagona manbasi RTDB. Bizda
//  esa ikkita manba bor — shu sababli usulni ko'chirib bo'lmaydi.)
//
//  Yechim — `pending_orders` uchun allaqachon ishlaydigan naqsh:
//    zimmer/pending_products/{kalit}  — offline qo'shilgan yangi tovarlar
//    zimmer/pending_edits/{tovar_id}  — mavjud tovarga qilingan tuzatish
//  Ikkisi ham katalog sinxronidan TASHQARIDA — ustidan yozilmaydi. Bot
//  uyg'onganda ularni SQLite ga ko'chiradi (`imported: true` belgisi bilan).
//
//  Yangi tovarga RAQAMLI id BERILMAYDI — kalit `off_<uid>_<hash>`. Aks holda
//  SQLite avto-inkrementi bir kun o'sha raqamga yetib, ikki xil tovar bitta
//  id ga tushib qolardi.
// =====================================================================

/** Har bir admin endpointi uchun yagona darvoza: imzo -> uid -> ADMIN_IDS. */
async function requireAdmin(request, env) {
  const c = cfg(env);
  if (!c.dbUrl) {
    return { error: json({ ok: false, error: "FIREBASE_DB_URL sozlanmagan" }, 500) };
  }
  const body = await readJson(request);
  const verified = await verifyInitData(body.initData, env);
  if (!verified.ok) return { error: json({ ok: false, error: verified.error, blocked: !!verified.blocked }, verified.status || 401) };

  const uid = String(verified.user.id);
  // uid HMAC imzosidan olinadi — mijoz yuborgan qiymatga ISHONILMAYDI.
  // ADMIN_IDS esa Worker env'ida, brauzerda emas.
  if (!c.admins.includes(uid)) {
    return {
      error: json({ ok: false, error: "forbidden", message: "Bu amal faqat admin uchun" }, 403),
    };
  }
  return { c, body, uid, user: verified.user };
}

/** Musbat butun son; noto'g'ri qiymat -> null (0 haqiqiy qiymat sifatida qoladi). */
function toCount(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Math.floor(Number(String(value).replace(/[^\d-]/g, "")));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** Narx: bo'shliq/probel bilan yozilgan "120 000" ni ham tushunadi. */
function toPrice(value) {
  const n = toCount(value);
  return n === null || n <= 0 ? null : n;
}

// ---------------------------------------------------------------------
//  POST /admin/catalog — ombor ko'rinishi (katalog + kutilayotgan tuzatishlar)
// ---------------------------------------------------------------------
async function handleAdminCatalog(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  const { c } = gate;

  const token = await accessToken(env);
  const [catalog, edits, pending] = await Promise.all([
    rtdbGet(c.dbUrl, `${c.root}/catalog/products`, token),
    rtdbGet(c.dbUrl, `${c.root}/pending_edits`, token),
    rtdbGet(c.dbUrl, `${c.root}/pending_products`, token),
  ]);

  const items = [];
  if (catalog && typeof catalog === "object") {
    for (const [id, row] of Object.entries(catalog)) {
      if (!row || typeof row !== "object") continue;
      if (row.deleted) continue;
      // Kutilayotgan tuzatish BOR bo'lsa — admin o'zi kiritgan qiymatni
      // ko'rsatamiz, aks holda "saqlamadim shekilli" degan taassurot bo'ladi.
      const patch = edits && edits[id] && !edits[id].imported ? edits[id] : null;
      items.push({
        id,
        name: String(row.name || "Nomsiz"),
        price: patch && patch.price != null ? patch.price : Number(row.price || 0),
        stock: patch && patch.stock != null ? patch.stock : Number(row.stock || 0),
        is_active:
          patch && patch.is_active != null ? !!patch.is_active : row.is_active !== 0,
        photo_id: row.photo_id || null,
        photo_url: row.photo_url || null,
        pending: !!patch,
      });
    }
  }

  const drafts = [];
  if (pending && typeof pending === "object") {
    for (const [key, row] of Object.entries(pending)) {
      if (!row || typeof row !== "object" || row.imported) continue;
      drafts.push({
        key,
        name: String(row.name || "Nomsiz"),
        price: Number(row.price || 0),
        stock: Number(row.stock || 0),
        photo_url: row.photo_url || null,
        created_at: row.createdAt || null,
      });
    }
  }

  return json({ ok: true, items, drafts, counts: { items: items.length, drafts: drafts.length } });
}

// ---------------------------------------------------------------------
//  POST /admin/product — Render'siz YANGI tovar qo'shish
// ---------------------------------------------------------------------
async function handleAdminProduct(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  const { c, body, uid } = gate;

  const name = clean(body.name, 200);
  if (!name || name.length < 2) {
    return json({ ok: false, error: "Tovar nomini kiriting" }, 400);
  }
  const price = toPrice(body.price);
  if (price === null) return json({ ok: false, error: "Narxni to'g'ri kiriting" }, 400);

  const stock = toCount(body.stock);
  if (stock === null) return json({ ok: false, error: "Qoldiqni to'g'ri kiriting" }, 400);

  // Rasm: faqat http(s) havola. `javascript:` va `data:` ataylab rad etiladi.
  const photoUrl = clean(body.photo_url, 600);
  if (photoUrl && !/^https:\/\/[^\s]+$/i.test(photoUrl)) {
    return json({ ok: false, error: "Rasm havolasi https:// bilan boshlanishi kerak" }, 400);
  }

  // Idempotentlik: tarmoq uzilib qayta yuborilsa ikkinchi nusxa yaralmaydi.
  const key = "off_" + uid + "_" + shortHash(uid + ":" + (body.client_key || name + price));
  const token = await accessToken(env);
  const path = `${c.root}/pending_products/${key}`;

  const exists = await rtdbGet(c.dbUrl, path, token);
  if (exists && typeof exists === "object") {
    return json({ ok: true, key, duplicate: true, product: { name, price, stock } });
  }

  const record = {
    name,
    price,
    stock,
    description: clean(body.description, 2000) || "",
    photo_url: photoUrl || null,
    category_id: toCount(body.category_id),
    // Bu maydonlarni FAQAT server qo'yadi — mijoz yuborgani e'tiborsiz.
    created_by: Number(uid),
    createdAt: { ".sv": "timestamp" },
    source: "miniapp_offline",
    imported: false,
  };

  const res = await rtdbPut(c.dbUrl, path, record, token);
  if (!res.ok) {
    return json({ ok: false, error: "Firebase yozmadi", status: res.status }, 502);
  }

  await notifyAdmins(
    env,
    c,
    "🆕 <b>Yangi tovar qo'shildi</b> (zaxira rejim)\n\n" +
      `📦 ${escHtml(name)}\n` +
      `💰 ${fmtPrice(price)}\n` +
      `📊 Qoldiq: ${stock}\n\n` +
      "<i>Server uyg'onganda katalogga o'tadi.</i>"
  ).catch(() => {});

  return json({ ok: true, key, product: { name, price, stock } }, 201);
}

// ---------------------------------------------------------------------
//  POST /admin/edit — mavjud tovarning narx/qoldiq/ko'rinishini o'zgartirish
// ---------------------------------------------------------------------
async function handleAdminEdit(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  const { c, body, uid } = gate;

  const id = clean(body.id, 40);
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
    return json({ ok: false, error: "Tovar id noto'g'ri" }, 400);
  }

  const patch = {};
  if (body.price !== undefined) {
    const price = toPrice(body.price);
    if (price === null) return json({ ok: false, error: "Narxni to'g'ri kiriting" }, 400);
    patch.price = price;
  }
  if (body.stock !== undefined) {
    const stock = toCount(body.stock);
    if (stock === null) return json({ ok: false, error: "Qoldiqni to'g'ri kiriting" }, 400);
    patch.stock = stock;
  }
  if (body.is_active !== undefined) patch.is_active = !!body.is_active;

  if (!Object.keys(patch).length) {
    return json({ ok: false, error: "O'zgartirish uchun maydon berilmadi" }, 400);
  }

  const token = await accessToken(env);

  // Tovar HAQIQATAN bormi? Yo'q bo'lsa "saqlandi" deb yolg'on aytmaymiz.
  const row = await rtdbGet(c.dbUrl, `${c.root}/catalog/products/${id}`, token);
  if (!row || typeof row !== "object") {
    return json({ ok: false, error: "Bunday tovar katalogda yo'q" }, 404);
  }

  patch.updatedAt = { ".sv": "timestamp" };
  patch.updated_by = Number(uid);
  patch.imported = false;

  const res = await rtdbPatch(c.dbUrl, `${c.root}/pending_edits/${id}`, patch, token);
  if (!res.ok) {
    return json({ ok: false, error: "Firebase yozmadi", status: res.status }, 502);
  }
  return json({ ok: true, id, applied: patch });
}

// ---------------------------------------------------------------------
//  POST /admin/catalog-write — yagona signed catalog mutation adapteri
// ---------------------------------------------------------------------
const CATALOG_WRITE_FIELDS = {
  products: new Set(["id", "_key", "name", "description", "price", "old_price", "stock", "code", "badge", "photo_url", "photo_id", "photo2_url", "photo2_id", "photo3_url", "photo3_id", "is_active", "deleted", "category_id", "categoryName", "car_id", "carName", "carNames", "product_type", "sizes", "warranty", "flashUntil", "sort", "createdAt", "updatedAt", "source"]),
  categories: new Set(["id", "_key", "name", "title", "icon", "sort", "is_active", "deleted", "createdAt", "updatedAt", "source"]),
  // 2.1.0 — `glass_price`/`housing_price`: Bi-LED Studio va shisha almashtirish narxi (2 fara)
  cars: new Set(["id", "_key", "name", "years", "note", "sort", "photo_url", "photo_id", "glass_price", "housing_price", "is_active", "deleted", "createdAt", "updatedAt", "source"]),
  /* 2.1.0 — Bi-LED Studio variantlari: `catalog/configurator/{qator}`.
     Qator kalitlari `STUDIO_DEFAULTS` dagi bilan bir xil (lens_r50, ring_glow...). */
  configurator: new Set(["id", "_key", "group", "code", "name", "price", "size", "kelvin", "lumen", "warranty", "badge", "description", "sort", "is_active", "deleted", "createdAt", "updatedAt", "source"]),
  stories: new Set(["id", "_key", "category", "title", "heading", "body", "emoji", "color_from", "color_to", "photo_url", "photo_id", "video_url", "video_id", "link", "sort", "is_active", "deleted", "createdAt", "updatedAt", "source"]),
  banners: new Set(["id", "_key", "title", "subtitle", "tag", "color_from", "color_to", "photo_url", "photo_id", "video_url", "video_id", "sort", "is_active", "deleted", "createdAt", "updatedAt", "source"]),
  music: new Set(["id", "_key", "title", "audio_url", "audio_id", "duration", "sort", "is_active", "deleted", "createdAt", "updatedAt", "source"]),
  /* 1.9.0 — Mini App sozlamalari. Hozircha bitta yozuv: `catalog/settings/theme`
     — bosh sahifadagi «Rang» generatori (admin) tanlagan brend rangi
     (ton/to'yinganlik/ochlik). `catalog` hammaga o'qiladi, ya'ni har bir
     mijoz ilovasi shu rangda ochiladi. */
  /* 2.3.0 — `catalog/settings/booking`: zalog summasi va yoqilganmi. */
  settings: new Set(["h", "s", "l", "deposit", "deposit_on", "updatedAt", "source"]),
  // 2.3.0 — rul chexol materiallari (ranglari bilan) va o'rindiq dizaynlari (20 qism)
  wheel_materials: new Set(["_key", "name", "price", "description", "texture", "colors", "warranty", "sort", "is_active", "deleted", "createdAt", "updatedAt", "source"]),
  seat_designs: new Set(["_key", "name", "price", "description", "zones", "thread", "warranty", "sort", "is_active", "deleted", "createdAt", "updatedAt", "source"]),
};
const CATALOG_COUNTERS = {
  products: "products_counter",
  stories: "stories_counter",
  banners: "banners_counter",
  cars: "cars_counter",
};

/* Server tomonda katalog mutatsiyasini `database.rules.json` bilan AYNAN
   mos tekshiramiz. Worker service-account tokeni bilan yozadi va qoidalarni
   CHETLAB O'TADI — shu sababli tur/diapazon tekshiruvi shu yerda takrorlanadi.
   `null`/`undefined` — kalitni o'chirish/qoldirish (Firebase semantikasi):
   qoida faqat MAVJUD qiymatni tekshiradi, shuning uchun ular ruxsat etiladi. */
const CATALOG_URL_RE = /^https:\/\/[^\s"']{1,600}$/i;
const CATALOG_COLOR_RE = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20})$/;
const MAX_TS = Number.MAX_SAFE_INTEGER;

function catNum(v, min, max) {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
}
function catStr(v, max) {
  return typeof v === "string" && v.length <= max;
}
function catBool01(v) {
  return typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1);
}
function catUrl(v) {
  return v === "" || (typeof v === "string" && CATALOG_URL_RE.test(v));
}
function catColor(v) {
  return typeof v === "string" && CATALOG_COLOR_RE.test(v);
}

const CATALOG_FIELD_CHECK = {
  // raqamlar
  id: (v) => catNum(v, 0, MAX_TS),
  // rang generatori (catalog/settings/theme)
  h: (v) => catNum(v, 0, 360),
  s: (v) => catNum(v, 0, 100),
  l: (v) => catNum(v, 0, 100),
  sort: (v) => catNum(v, -100000, 100000),
  price: (v) => catNum(v, 0, 100000000000),
  old_price: (v) => catNum(v, 0, 100000000000),
  stock: (v) => catNum(v, 0, 10000000),
  glass_price: (v) => catNum(v, 0, 100000000000),
  housing_price: (v) => catNum(v, 0, 100000000000),
  group: (v) => catStr(v, 20),
  texture: (v) => catStr(v, 20),
  thread: (v) => typeof v === "string" && HEX6_RE.test(v),
  deposit: (v) => catNum(v, 0, 100000000),
  deposit_on: catBool01,
  size: (v) => catStr(v, 40),
  kelvin: (v) => catStr(v, 40),
  lumen: (v) => catStr(v, 40),
  duration: (v) => catNum(v, 0, MAX_TS),
  category_id: (v) => typeof v === "number" && Number.isFinite(v),
  car_id: (v) => typeof v === "number" && Number.isFinite(v),
  createdAt: (v) => catNum(v, 0, MAX_TS),
  updatedAt: (v) => catNum(v, 0, MAX_TS),
  flashUntil: (v) => catNum(v, 0, MAX_TS),
  // string va uzunlik (qoidalardagi length bilan bir xil)
  _key: (v) => typeof v === "string" || (typeof v === "number" && Number.isFinite(v)),
  name: (v) => catStr(v, 300),
  title: (v) => catStr(v, 300),
  subtitle: (v) => catStr(v, 500),
  heading: (v) => catStr(v, 300),
  body: (v) => catStr(v, 4000),
  description: (v) => catStr(v, 6000),
  badge: (v) => catStr(v, 60),
  tag: (v) => catStr(v, 60),
  code: (v) => catStr(v, 80),
  warranty: (v) => catStr(v, 200),
  emoji: (v) => catStr(v, 16),
  icon: (v) => catStr(v, 40),
  category: (v) => catStr(v, 80),
  years: (v) => catStr(v, 60),
  note: (v) => catStr(v, 500),
  product_type: (v) => catStr(v, 40),
  source: (v) => catStr(v, 40),
  categoryName: (v) => catStr(v, 200),
  carName: (v) => catStr(v, 200),
  // ranglar
  color_from: catColor,
  color_to: catColor,
  // media havolalari (https yoki bo'sh)
  photo_url: catUrl,
  photo2_url: catUrl,
  photo3_url: catUrl,
  video_url: catUrl,
  audio_url: catUrl,
  link: (v) => v === "" || (typeof v === "string" && CATALOG_URL_RE.test(v)),
  // Telegram file_id
  photo_id: (v) => catStr(v, 200),
  photo2_id: (v) => catStr(v, 200),
  photo3_id: (v) => catStr(v, 200),
  video_id: (v) => catStr(v, 200),
  audio_id: (v) => catStr(v, 200),
  // boolean yoki 0/1
  is_active: catBool01,
  deleted: catBool01,
};

function validateCatalogSizes(raw) {
  const rows = Array.isArray(raw)
    ? raw
    : (raw && typeof raw === "object" ? Object.values(raw) : null);
  if (!rows) return "Razmerlar noto'g'ri";
  if (rows.length > 40) return "Razmerlar juda ko'p";
  for (const row of rows) {
    if (row == null) continue; // siyrak massiv teshigi — o'chirish
    if (typeof row !== "object" || Array.isArray(row)) return "Razmerlar noto'g'ri";
    if (!catStr(row.size, 40) || !row.size.trim()) return "Razmer nomi noto'g'ri";
    if (!catNum(row.stock, 0, 10000000)) return "Razmer qoldig'i noto'g'ri";
  }
  return null;
}

function validateCatalogStringArray(raw, max) {
  const rows = Array.isArray(raw)
    ? raw
    : (raw && typeof raw === "object" ? Object.values(raw) : null);
  if (!rows) return "Ro'yxat noto'g'ri";
  if (rows.length > 100) return "Ro'yxat juda uzun";
  for (const row of rows) {
    if (row == null) continue;
    if (!catStr(row, max)) return "Ro'yxat elementi noto'g'ri";
  }
  return null;
}

function validateCatalogMutation(table, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Yozuv obyekt bo'lishi kerak";
  if (JSON.stringify(value).length > 65536) return "Yozuv juda katta";
  const allowed = CATALOG_WRITE_FIELDS[table];
  if (!allowed) return "Jadval ruxsat etilmagan";
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) return `Ruxsat etilmagan maydon: ${key}`;
    const v = value[key];
    // null/undefined = kalitni o'chirish; qoida faqat mavjud qiymatni tekshiradi.
    if (v === null || v === undefined) continue;
    if (key === "sizes") {
      const why = validateCatalogSizes(v);
      if (why) return why;
      continue;
    }
    if (key === "carNames" || key === "categories" || key === "carnames") {
      const why = validateCatalogStringArray(v, 200);
      if (why) return why;
      continue;
    }
    if (key === "colors") {
      const rows = Array.isArray(v) ? v : (typeof v === "object" ? Object.values(v) : null);
      if (!rows || rows.length > 30) return "Ranglar ro'yxati noto'g'ri";
      for (const r of rows) {
        if (r == null) continue;
        if (typeof r !== "object" || !catStr(r.name, 40) || !HEX6_RE.test(String(r.hex || ""))) return "Rang noto'g'ri (nomi va #RRGGBB)";
      }
      continue;
    }
    if (key === "zones") {
      if (typeof v !== "object" || Array.isArray(v)) return "Qismlar noto'g'ri";
      for (const z of Object.keys(v)) {
        if (!/^z([1-9]|1[0-9]|20)$/.test(z)) return "Qism nomi noto'g'ri: " + z;
        if (v[z] != null && !HEX6_RE.test(String(v[z]))) return "Qism rangi noto'g'ri: " + z;
      }
      continue;
    }
    if (key === "images") {
      const rows = Array.isArray(v) ? v : (typeof v === "object" ? Object.values(v) : null);
      if (!rows) return "Rasmlar ro'yxati noto'g'ri";
      for (const u of rows) {
        if (u == null) continue;
        if (!catUrl(u)) return "Rasm havolasi https bo'lishi kerak";
      }
      continue;
    }
    const check = CATALOG_FIELD_CHECK[key];
    if (check && !check(v)) return `Maydon noto'g'ri: ${key}`;
  }
  return null;
}

async function handleAdminCatalogWrite(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  const { c, body, uid } = gate;
  const method = clean(body.method, 12).toLowerCase();
  const token = await accessToken(env);

  if (method === "allocate") {
    const table = clean(body.table, 30);
    const counter = CATALOG_COUNTERS[table];
    if (!counter) return json({ ok: false, error: "Sanoqchi ruxsat etilmagan" }, 400);
    for (let attempt = 0; attempt < 10; attempt++) {
      const path = `${c.root}/${counter}/n`;
      const snap = await rtdbGetEtag(c.dbUrl, path, token);
      const current = Number(snap.value);
      const next = (Number.isFinite(current) && current >= 900000 ? current : 900000) + 1;
      const put = await rtdbPutIfMatch(c.dbUrl, path, next, token, snap.etag);
      if (put.status === 412) continue;
      await ensureOk(put, "ID ajratilmadi");
      return json({ ok: true, id: next });
    }
    return json({ ok: false, error: "ID band — qayta urinib ko'ring" }, 409);
  }

  if (!["put", "patch", "delete"].includes(method)) {
    return json({ ok: false, error: "Method ruxsat etilmagan" }, 400);
  }
  const match = /^catalog\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)$/.exec(clean(body.path, 160));
  if (!match || !CATALOG_WRITE_FIELDS[match[1]]) {
    return json({ ok: false, error: "Catalog path ruxsat etilmagan" }, 400);
  }
  const table = match[1];
  const row = match[2];
  const path = `${c.root}/catalog/${table}/${row}`;
  let res;
  if (method === "delete") {
    res = await rtdbDelete(c.dbUrl, path, token);
  } else {
    const why = validateCatalogMutation(table, body.value);
    if (why) return json({ ok: false, error: "validation", message: why }, 400);
    const value = { ...body.value, updated_by: Number(uid) };
    /* Audit maydoni katalog sxemasiga kirmaydi; client whitelist qat'iy,
       server esa faqat timestampni qo'shadi. */
    delete value.updated_by;
    res = method === "put"
      ? await rtdbPut(c.dbUrl, path, value, token)
      : await rtdbPatch(c.dbUrl, path, value, token);
  }
  await ensureOk(res, "Katalog yozilmadi");
  return json({ ok: true, table, row, method, value: body.value == null ? null : body.value });
}

// ---------------------------------------------------------------------
//  POST /admin/orders — zaxira rejimda tushgan buyurtmalar
// ---------------------------------------------------------------------
/** RTDB tuguni dict yoki massiv — ikkisini ham [kalit, qiymat] ga keltiradi. */
function entriesOf(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) {
    return node.map((v, i) => [String(i), v]).filter((pair) => pair[1] && typeof pair[1] === "object");
  }
  return Object.entries(node).filter((pair) => pair[1] && typeof pair[1] === "object");
}

/** `items` ro'yxat yoki lug'at bo'lishi mumkin (RTDB siyrak massivni lug'at qiladi). */
function itemsOf(raw) {
  return entriesOf(raw)
    .map((pair) => pair[1])
    .map((i) => {
      const line = {
        // `productId` — SQLite nusxasi (`sync.py: _put_order`) camelCase yozadi
        product_id: i.product_id != null ? i.product_id : i.productId != null ? i.productId : null,
        name: String(i.name || ""),
        price: Number(i.price || 0),
        qty: Number(i.qty || 1),
        // Razmer — admin ro'yxatida va «Buyurtmalarim» da ko'rinishi kerak
        size: i.size ? String(i.size) : null,
      };
      // Sotilgan paytdagi kafolat sharti va turkum (2.0.0+ buyurtmalarda)
      if (i.warranty) line.warranty = String(i.warranty);
      if (i.cat) line.cat = String(i.cat);
      return line;
    })
    .filter((i) => i.name || i.product_id != null);
}

/** Holat nomlarini YAGONA lug'atga keltiradi (pastdagi izohga qarang). */
function normStatus(value) {
  const s = String(value || "new").toLowerCase();
  if (s === "done" || s === "delivered") return "delivered";
  if (s === "shipped" || s === "delivering") return "delivering";
  if (s === "new" || s === "accepted" || s === "cancelled") return s;
  return "new";
}

// ---------------------------------------------------------------------
//  POST /admin/orders — BARCHA do'kon buyurtmalari
//
//  NEGA IKKI TUGUN O'QILADI
//  Buyurtmalar tarixan ikki joyda saqlanadi:
//
//    zimmer/pending_orders/{uid}_{kod}  — Worker qabul qilganlari
//                                          (Render o'chgan paytda), brauzer
//                                          o'qishi mumkin;
//    zimmer/orders/{sqlite_id}          — Render (SQLite) buyurtmalarining
//                                          nusxasi, `sync.push_order` yozadi.
//                                          Qoidalarda `.read: false` —
//                                          brauzer O'QIY OLMAYDI.
//
//  Mini app admin paneli faqat birinchisini o'qirdi. Natijada mijozning
//  profilida buyurtmalar turadi (ular SQLite'dan), admin panelida esa
//  «Hali buyurtma tushmagan» yozuvi chiqadi. Aynan shu holat.
//
//  Yechim: ikkisini SHU YERDA birlashtiramiz. Worker service-account bilan
//  ishlaydi, ya'ni yopiq tugunni ham o'qiydi — va faqat TASDIQLANGAN admin
//  (`requireAdmin`: initData imzosi -> uid -> ADMIN_IDS) javob oladi.
//  Shu sababli `zimmer/orders` ni qoidalarda OCHISH KERAK EMAS: mijoz
//  telefon raqamlari yopiq qoladi.
// ---------------------------------------------------------------------
/** Ikki tugunni bitta ro'yxatga birlashtiradi (TOZA funksiya — sinovga qulay).
 *
 *  `pending_orders` maydonlari snake_case (Worker yozadi),
 *  `orders` maydonlari camelCase (`services/sync.py: _put_order` yozadi).
 *  Shu sababli har maydon ikki nom bilan o'qiladi. */
function mergeAdminOrders(pendingNode, dbNode) {
  const orders = [];
  const dbRows = new Map();
  for (const [key, row] of entriesOf(dbNode)) {
    const id = row.id != null ? row.id : key;
    dbRows.set(String(id), { key: String(key), row });
  }

  /* 1) Worker qabul qilganlari (`pending_orders`).
     2.0.0: Render endi kerak emas, shuning uchun bot SQLite'ga ko'chirgan
     (`imported` + `sqlite_id`) buyurtma ham Worker yozuvi orqali
     boshqariladi — ilgari ular «Render serveri kerak» deb qotib qolardi.
     Holat ikki nusxadan ENG ILG'ORI olinadi (Python admin o'zgartirgan
     bo'lsa ham yo'qolmaydi), o'zgarish esa ikkala nusxaga yoziladi. */
  for (const [key, row] of entriesOf(pendingNode)) {
    // Claim hali tugamagan yoki qoldiq xatosi bilan to'xtagan yozuv admin
    // status amallariga chiqmaydi; aks holda processing order bekor qilinib
    // reservation/finalize bilan poyga qilishi mumkin.
    if (row.status === "processing" || row.status === "failed") continue;
    const twin = row.sqlite_id ? dbRows.get(String(row.sqlite_id)) : null;
    if (twin) dbRows.delete(String(row.sqlite_id));
    const total = Number(row.total || (twin && twin.row.total) || 0);
    orders.push({
      key: String(key),
      source: "pending", // holat `pending_orders/{key}` ga yoziladi
      id: row.sqlite_id || null,
      code: row.code || key,
      uid: row.uid || null,
      name: row.customer_name || row.name || "",
      phone: row.phone || "",
      address: row.address || "",
      delivery_info: row.delivery_info || row.deliveryInfo || "",
      payment_method: row.payment_method || row.paymentMethod || "",
      total: total,
      total_label: fmtPrice(total),
      status: mergedOrderStatus(row.status, twin ? twin.row.status : null),
      items: itemsOf(row.items),
      created_at: Number(row.createdAt || 0) || null,
      imported: !!row.imported,
    });
  }

  // 2) Faqat SQLite nusxasida turgan eski (Render API orqali kelgan) buyurtmalar.
  for (const { key, row } of dbRows.values()) {
    const id = row.id != null ? row.id : key;
    const total = Number(row.total || 0);
    orders.push({
      key: String(key),
      source: "db", // holat o'zgarishi `orders/{id}` ga yoziladi
      id: id,
      code: "#" + id,
      uid: row.uid || null,
      name: row.name || row.customer_name || "",
      phone: row.phone || "",
      address: row.address || "",
      delivery_info: row.deliveryInfo || row.delivery_info || "",
      payment_method: row.paymentMethod || row.payment_method || "",
      total: total,
      total_label: fmtPrice(total),
      status: normStatus(row.status),
      items: itemsOf(row.items),
      created_at: Number(row.createdAt || 0) || null,
      imported: true,
    });
  }

  // Yangi buyurtma TEPADA turishi kerak.
  orders.sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0));
  return orders;
}

/** Do'kon buyurtmasi ikki nusxada bo'lsa (Worker + SQLite) — ENG ILG'OR holat.
 *  Bekor qilingan bo'lsa (qaysi nusxada bo'lmasin) — bekor. */
const ORDER_RANK = { new: 0, accepted: 1, delivering: 2, delivered: 3 };
function mergedOrderStatus(a, b) {
  const x = normStatus(a);
  if (b == null || b === "") return x;
  const y = normStatus(b);
  if (x === "cancelled" || y === "cancelled") return "cancelled";
  return (ORDER_RANK[y] || 0) > (ORDER_RANK[x] || 0) ? y : x;
}

/* ---------------------------------------------------------------------
   POST /admin/orders — admin uchun buyurtmalar ro'yxati

   `kind` bo'yicha uch xil ro'yxat qaytaradi:
       "order"   (standart) — pending_orders + orders birlashtirilgan
       "biled"             — biled_orders
       "booking"           — bookings

   NEGA `biled` VA `booking` HAM SHU YERGA QO'SHILDI. Ilgari admin paneli
   ularni BRAUZERDAN to'g'ridan-to'g'ri o'qirdi, ya'ni `biled_orders` va
   `bookings` tugunlari qoidalarda hammaga ochiq turishi kerak edi. Ularda
   esa mijozning ISMI va TELEFONI bor — istalgan odam yuklab olardi.
   Endi tugunlar YOPIQ, ro'yxatni faqat tasdiqlangan admin shu yerdan
   oladi (`requireAdmin` initData imzosini tekshiradi).
   --------------------------------------------------------------------- */
async function handleAdminOrders(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  const { c, body } = gate;
  const kind = String(body.kind || "order");
  const token = await accessToken(env);

  // Bi-LED va navbat: bitta tugun, xom holda qaytaramiz — panel o'zi
  // kerakli ko'rinishga o'giradi (`admin-shop.js -> loadKind`).
  if (kind === "biled" || kind === "booking") {
    const node = await rtdbGet(c.dbUrl, `${c.root}/${KIND_NODES[kind]}`, token);
    const rows = [];
    if (node && typeof node === "object") {
      for (const key of Object.keys(node)) {
        const row = node[key];
        if (!row || typeof row !== "object") continue;
        rows.push({ ...row, _key: key, id: row.id === undefined ? key : row.id });
      }
    }
    rows.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    return json({ ok: true, kind, orders: rows, count: rows.length });
  }

  const [pendingNode, dbNode] = await Promise.all([
    rtdbGet(c.dbUrl, `${c.root}/pending_orders`, token),
    rtdbGet(c.dbUrl, `${c.root}/orders`, token),
  ]);

  const orders = mergeAdminOrders(pendingNode, dbNode);
  return json({ ok: true, kind: "order", orders, count: orders.length });
}

// ---------------------------------------------------------------------
//  POST /admin/users — mijoz profillari (admin CRM ro'yxati uchun)
//
//  `users` tuguni YOPIQ (database.rules.json: .read=false) — unda ism va
//  telefon (PII) bor, shuning uchun brauzer to'g'ridan o'qiy olmaydi.
//  Worker service-account bilan o'qiydi va FAQAT tasdiqlangan adminga
//  (`requireAdmin`: initData imzosi -> uid -> ADMIN_IDS) qaytaradi.
//  Xom tugunni qaytaramiz — `admin-crm.js` uni o'zi mijozga aylantiradi
//  (`buildCustomers` `users/{uid}/profile` shaklini kutadi).
// ---------------------------------------------------------------------
async function handleAdminUsers(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  const { c } = gate;
  const token = await accessToken(env);
  const [node, blockedNode, vipNode] = await Promise.all([
    rtdbGet(c.dbUrl, `${c.root}/users`, token),
    rtdbGet(c.dbUrl, `${c.root}/blocked_users`, token).catch(() => null),
    rtdbGet(c.dbUrl, `${c.root}/crm_vip`, token).catch(() => null),
  ]);
  const obj = (v) => (v && typeof v === "object" ? v : {});
  return json({ ok: true, users: obj(node), blocked: obj(blockedNode), vip: obj(vipNode) });
}

// ---------------------------------------------------------------------
//  POST /admin/order-status — buyurtma holatini o'zgartirish
// ---------------------------------------------------------------------
/* YAGONA HOLAT LUG'ATI.
   Ilgari uch xil nom ishlatilardi va bir xil narsani bildirardi:
       SQLite / Render  : new, accepted, delivered, cancelled
       Worker + panel   : new, accepted, delivering, done, cancelled
       mijoz profili    : new, accepted, shipped,    done, cancelled
   Ya'ni «yetkazildi» uchun `delivered`, `done` — ikki xil so'z. Natijada
   panelda qo'yilgan holat SQLite uchun NOTANISH bo'lib qolardi va Render
   admin paneli o'sha buyurtmada tiqilib qolardi.
   Endi hamma joyda BIR XIL beshta nom. `normStatus()` eski nomlarni
   yangisiga o'giradi (orqaga moslik). */
const ORDER_STATUSES = ["new", "accepted", "delivering", "delivered", "cancelled"];

/* ---------------------------------------------------------------------
   UCH XIL BUYURTMA TURI

   Admin panelida uchta alohida bo'lim bor va har birining O'Z holatlari,
   O'Z tuguni va O'Z xabar matnlari bo'ladi. Ular `utils/texts.py` va
   `services/orders.py` dagi ro'yxatlar bilan AYNAN bir xil bo'lishi shart —
   aks holda panelda qo'yilgan holat bot uchun notanish bo'lib qoladi.
   --------------------------------------------------------------------- */
const KIND_STATUSES = {
  order: ORDER_STATUSES,
  biled: ["new", "accepted", "in_work", "done", "cancelled"],
  booking: ["new", "confirmed", "done", "cancelled"],
};

const KIND_NODES = { biled: "biled_orders", booking: "bookings" };

const KIND_TEXT = {
  order: {
    accepted: "✅ Buyurtmangiz qabul qilindi",
    delivering: "🚚 Buyurtmangiz yo'lda",
    delivered: "🎉 Buyurtmangiz yetkazildi",
    cancelled: "❌ Buyurtmangiz bekor qilindi",
  },
  biled: {
    accepted: "✅ Bi-LED buyurtmangiz qabul qilindi",
    in_work: "🔧 Ish boshlandi",
    done: "✨ Tayyor — topshirishga hozir",
    cancelled: "❌ Bi-LED buyurtmangiz bekor qilindi",
  },
  booking: {
    confirmed: "✅ Navbatingiz tasdiqlandi",
    done: "✔️ Navbat bajarildi",
    cancelled: "❌ Navbatingiz bekor qilindi",
  },
};

const ALLOWED_STATUS_TRANSITIONS = {
  order: {
    new: ["accepted", "cancelled"],
    accepted: ["delivering", "cancelled"],
    delivering: ["delivered", "cancelled"],
    delivered: [],
    cancelled: [],
  },
  biled: {
    new: ["accepted", "cancelled"],
    accepted: ["in_work", "cancelled"],
    in_work: ["done", "cancelled"],
    done: [],
    cancelled: [],
  },
  booking: {
    new: ["confirmed", "cancelled"],
    confirmed: ["done", "cancelled"],
    done: [],
    cancelled: [],
  },
};

async function handleAdminOrderStatus(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  const { c, body, uid } = gate;
  const token = await accessToken(env);
  let warranty;
  if (body.warranty != null && body.warranty !== "") {
    warranty = normWarrantyText(body.warranty);
    if (warranty == null) {
      return json({ ok: false, error: "validation", message: "Kafolat muddati noto'g'ri: masalan 6 oy, 1 yil, 90 kun" }, 400);
    }
  }
  const res = await applyStatusChange(env, c, token, {
    kind: clean(body.kind, 12),
    key: body.key,
    status: body.status,
    source: clean(body.source, 12),
    by: uid,
    warranty,
  });
  if (res.error) {
    const { http, ...rest } = res.error;
    return json({ ok: false, ...rest, error: rest.code }, http || 409);
  }
  return json({ ok: true, kind: res.kind, key: res.key, status: res.status, node: res.node, repeated: res.repeated });
}

/* =====================================================================
   HOLAT O'ZGARTIRISH — YAGONA YADRO

   Ikki joydan chaqiriladi: Mini App boshqaruv paneli (`/admin/order-status`)
   va bot xabaridagi tugmalar (`s|...` va eski Python `adm:ordst:...`).
   Ikkalasi AYNAN bir xil tekshiruvdan o'tadi: ruxsat etilgan o'tish,
   atomik yozuv, bekor qilinganda qoldiq/slot qaytarish, mijozga xabar va
   — yakunlanganda — KAFOLAT boshlanishi.

   Natija: `{ ok, kind, key, status, node, repeated, row }` yoki
           `{ error: { http, code, message, allowed?, current? } }`.
   ===================================================================== */
function statusErr(http, code, message, extra) {
  return { error: { http, code, message, ...(extra || {}) } };
}

/** Bi-LED va navbat holatlari ham bir nechta nom bilan uchraydi
 *  (SQLite nusxasi, eski panel) — ularni shu bo'lim lug'atiga keltiramiz. */
function normKindStatus(kind, value) {
  const s = String(value || "new").toLowerCase();
  if (kind === "order") return normStatus(s);
  if (kind === "biled") {
    if (s === "delivered" || s === "done") return "done";
    if (s === "delivering" || s === "in_progress" || s === "in_work") return "in_work";
    if (s === "confirmed") return "accepted";
    return ["new", "accepted", "cancelled"].includes(s) ? s : s;
  }
  if (s === "accepted") return "confirmed";
  if (s === "delivered") return "done";
  if (s === "delivering") return "confirmed";
  return s;
}

/** Kafolat shu holatda BOSHLANADI: tovar yetkazildi / Bi-LED topshirildi. */
function isWarrantyStart(kind, status) {
  return (
    (kind === "order" && status === "delivered") ||
    (kind === "biled" && status === "done") ||
    // 2.3.0 — xizmat (navbat) bajarilganda
    (kind === "booking" && status === "done")
  );
}

async function applyStatusChange(env, c, token, opts) {
  const kind = KIND_STATUSES[opts.kind] ? opts.kind : "order";
  const source = kind === "order" && opts.source === "db" ? "db" : "pending";
  const key = clean(opts.key, 120);
  if (!key || !/^[A-Za-z0-9_-]+$/.test(key)) return statusErr(400, "bad_key", "Buyurtma kaliti noto'g'ri");
  const status = normKindStatus(kind, clean(opts.status, 20));
  if (!KIND_STATUSES[kind].includes(status)) {
    return statusErr(400, "bad_status", "Holat noto'g'ri", { allowed: KIND_STATUSES[kind] });
  }
  const by = Number(opts.by) || 0;
  const node = kind === "order" ? (source === "db" ? "orders" : "pending_orders") : KIND_NODES[kind];

  /* BEKOR QILISH — do'kon buyurtmasi va navbat uchun status o'zgarishi VA
     kompensatsiya (qoldiq qaytarish / slot o'chirish) BITTA root ETag CAS
     ichida bajariladi. Aks holda oraliq crash "cancelled, lekin qoldiq
     qaytmagan (yoki slot band qolgan)" holatini qoldirar edi. */
  let outcome;
  if (status === "cancelled" && kind === "order") outcome = await cancelOrderAtomic(c, token, key, by, source);
  else if (status === "cancelled" && kind === "booking") outcome = await cancelBookingAtomic(c, token, key, by);
  else outcome = await setStatusCas(c, token, kind, node, key, status, by, source, { warranty: opts.warranty });
  if (outcome.error) return outcome;

  const row = outcome.row || {};
  const repeated = !!outcome.repeated;
  if (!repeated) {
    // Egizak nusxa (Worker yozuvi ↔ SQLite nusxasi) ham shu holatga keladi
    if (kind === "order" && status !== "cancelled") {
      await syncOrderTwin(c, token, source, key, row, status, by).catch(() => {});
    }
    await afterStatusChange(env, c, token, { kind, key, source, status, row }).catch((e) =>
      console.error("[status] xabar yuborilmadi:", e)
    );
  }
  return { ok: true, kind, key, status, node, repeated, row };
}

/** Bitta yozuvning holatini CAS bilan o'zgartiradi (bekor qilishdan boshqa). */
async function setStatusCas(c, token, kind, node, key, status, by, source, extra) {
  const path = `${c.root}/${node}/${key}`;
  let twinStatus;
  for (let attempt = 0; attempt < 10; attempt++) {
    const snap = await rtdbGetEtag(c.dbUrl, path, token);
    const row = snap.value;
    if (!row || typeof row !== "object") return statusErr(404, "not_found", "Bunday buyurtma yo'q");
    const rawStatus = clean(row.status || "new", 20);
    let current = normKindStatus(kind, rawStatus);
    if (kind === "order") {
      const known = ["new", "accepted", "delivering", "delivered", "cancelled", "done", "shipped"].includes(rawStatus);
      if (!known) {
        return statusErr(409, "order_not_ready", "Buyurtma hali status o'zgarishiga tayyor emas");
      }
      // Ikki nusxadan eng ilg'or holat — haqiqiy holat
      if (twinStatus === undefined) twinStatus = await orderTwinStatus(c, token, source, key, row).catch(() => null);
      current = mergedOrderStatus(current, twinStatus);
    }
    if (!(current in ALLOWED_STATUS_TRANSITIONS[kind])) {
      return statusErr(409, "order_not_ready", "Buyurtma hali status o'zgarishiga tayyor emas");
    }
    if (current === status) return { row: { ...row, status: current }, repeated: true };
    const allowed = (ALLOWED_STATUS_TRANSITIONS[kind] || {})[current] || [];
    if (!allowed.includes(status)) {
      return statusErr(409, "invalid_transition", `Holat allaqachon «${statusName(kind, current)}» — bu amal mumkin emas`, {
        allowed,
        current,
      });
    }
    const next = { ...row, status, status_by: by, status_at: Date.now() };
    // 2.3.0 — zalog cheki tasdiqlangan navbat
    if (kind === "booking" && status === "confirmed" && row.deposit_amount) next.deposit_status = "paid";
    // 2.3.0 — admin «Bajarildi / Topshirildi» da kafolat muddatini belgilaydi
    if (status === "done" && (kind === "booking" || kind === "biled") && extra && extra.warranty) {
      next.warranty = extra.warranty;
    }
    // Kafolat aynan shu lahzadan sanaladi (keyingi tahrirlar uni siljitmaydi)
    if (isWarrantyStart(kind, status) && !row.warranty_from) next.warranty_from = next.status_at;
    const put = await rtdbPutIfMatch(c.dbUrl, path, next, token, snap.etag);
    if (put.status === 412) continue;
    await ensureOk(put, "Holat saqlanmadi");
    return { row: next, repeated: false };
  }
  return statusErr(409, "status_busy", "Holat bir vaqtda o'zgardi — qayta urinib ko'ring");
}

/** `pending_orders` qatoriga mos `orders/{sqlite_id}` (yoki aksincha). */
async function findPendingTwin(c, token, sqliteId, uid) {
  if (!uid) return null;
  const node = await queryByChild(c, token, "pending_orders", "uid", Number(uid), 60);
  for (const [k, row] of entriesOf(node)) {
    if (String(row.sqlite_id || "") === String(sqliteId)) return { key: k, row };
  }
  return null;
}

async function orderTwinStatus(c, token, source, key, row) {
  if (source === "pending") {
    if (!row.sqlite_id) return null;
    const twin = await rtdbGet(c.dbUrl, `${c.root}/orders/${row.sqlite_id}`, token);
    return twin && twin.status ? twin.status : null;
  }
  const twin = await findPendingTwin(c, token, key, row.uid);
  return twin ? twin.row.status : null;
}

async function syncOrderTwin(c, token, source, key, row, status, by) {
  const patch = { status, status_by: by, status_at: Number(row.status_at) || Date.now() };
  if (row.warranty_from) patch.warranty_from = row.warranty_from;
  if (source === "pending") {
    if (!row.sqlite_id) return;
    const path = `${c.root}/orders/${row.sqlite_id}`;
    if (await rtdbGet(c.dbUrl, path, token)) await rtdbPatch(c.dbUrl, path, patch, token);
    return;
  }
  const twin = await findPendingTwin(c, token, key, row.uid);
  if (twin) await rtdbPatch(c.dbUrl, `${c.root}/pending_orders/${twin.key}`, patch, token);
}

/** Holat o'zgargach: mijozga xabar va (yakunlansa) KAFOLAT boshlangani. */
async function afterStatusChange(env, c, token, ev) {
  const { kind, key, status, row } = ev;
  const text = (KIND_TEXT[kind] || {})[status];
  if (!text || !row || !row.uid) return;
  const label = row.code
    ? String(row.code)
    : kind === "biled"
      ? biledCode(key, row)
      : "#" + (row.id != null ? row.id : key);
  let body = `${text}\n\n🧾 ${escHtml(label)}`;
  if (kind === "booking" && status === "confirmed" && row.deposit_amount) {
    body += `\n💳 Zalog qabul qilindi: ${fmtPrice(row.deposit_amount)}`;
  }
  const extra = {};
  if (isWarrantyStart(kind, status)) {
    const one = kind === "order"
      ? { orders: [customerOrderView(key, ev.source, row, null)], biled: [] }
      : kind === "booking"
        ? { orders: [], biled: [], bookings: [customerBookingView(key, row)] }
        : { orders: [], biled: [customerBiledView(key, row)] };
    const list = (await warrantiesFor(c, token, one).catch(() => [])).filter((w) => w.state === "active");
    if (list.length) {
      body +=
        "\n\n🛡 <b>Kafolat boshlandi!</b>\n" +
        list.map((w) => `• ${escHtml(w.title)} — <b>${escHtml(w.period)}</b> (${fmtDate(w.end)} gacha)`).join("\n") +
        "\n\nQolgan muddat «Kabinet → Tovar kafolati» bo'limida soniyalab sanaladi.";
      extra.reply_markup = {
        inline_keyboard: [[{ text: "🛡 Kafolatni ko'rish", web_app: { url: appUrl(env, "kafolat") } }]],
      };
    }
  } else if (kind === "order" && status === "delivering") {
    extra.reply_markup = {
      inline_keyboard: [[{ text: "📦 Buyurtmani kuzatish", web_app: { url: appUrl(env, "orders") } }]],
    };
  }
  await sendMessage(env, row.uid, body, extra);
}

/** Do'kon buyurtmasini bekor qiladi: status→cancelled, qoldiqni qaytarish
    (umumiy + razmer) va rezerv markerini bo'shatish — BARCHASI bitta root
    ETag CAS ichida. 2.0.0: SQLite'ga ko'chirilgan (`imported`) yozuv ham
    shu yerda bekor qilinadi — egizak nusxasi bilan birga. */
async function cancelOrderAtomic(c, token, key, uid, source) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const snap = await rtdbGetEtag(c.dbUrl, c.root, token);
    const root = snap.value && typeof snap.value === "object" ? snap.value : {};
    const pending = root.pending_orders && typeof root.pending_orders === "object" ? root.pending_orders : (root.pending_orders = {});
    const dbNode = root.orders && typeof root.orders === "object" ? root.orders : null;

    // Asosiy yozuv va uning egizagi
    let row;
    let pendingKey = null;
    let dbKey = null;
    if (source === "db") {
      row = dbNode && dbNode[key];
      dbKey = key;
      for (const [k, r] of entriesOf(pending)) {
        if (String(r.sqlite_id || "") === String(key)) {
          pendingKey = k;
          break;
        }
      }
    } else {
      row = pending[key];
      pendingKey = key;
      if (row && row.sqlite_id && dbNode && dbNode[String(row.sqlite_id)]) dbKey = String(row.sqlite_id);
    }
    if (!row || typeof row !== "object") return statusErr(404, "not_found", "Bunday buyurtma yo'q");
    const pRow = pendingKey ? pending[pendingKey] : null;
    const dRow = dbKey && dbNode ? dbNode[dbKey] : null;

    const rawStatus = clean(row.status || "new", 20);
    const knownOrderStatus = ["new", "accepted", "delivering", "delivered", "cancelled", "done", "shipped"].includes(rawStatus);
    if (!knownOrderStatus) {
      return statusErr(409, "order_not_ready", "Buyurtma hali status o'zgarishiga tayyor emas");
    }
    const current = mergedOrderStatus(pRow ? pRow.status : null, dRow ? dRow.status : null);
    if (current === "cancelled") {
      /* Allaqachon bekor qilingan — qoldiq avvalgi CAS'da qaytarilgan.
         Ikki marta qaytarmaslik uchun kompensatsiyani takrorlamaymiz. */
      return { row, repeated: true };
    }
    if (!(ALLOWED_STATUS_TRANSITIONS.order[current] || []).includes("cancelled")) {
      return statusErr(409, "invalid_transition", `Holat allaqachon «${statusName("order", current)}» — bekor qilib bo'lmaydi`, {
        allowed: ALLOWED_STATUS_TRANSITIONS.order[current] || [],
        current,
      });
    }

    const products = root.catalog && root.catalog.products;
    if (!products || typeof products !== "object") throw new Error("Katalog o'qilmadi");
    const markers = root.order_reservations && typeof root.order_reservations === "object"
      ? root.order_reservations
      : (root.order_reservations = {});
    const markerKey = pendingKey || `db_${dbKey}`;
    let marker = markers[markerKey];
    /* Marker yo'q (eski yozuv yoki Render buyurtmasi) — qatorlardan tiklaymiz. */
    if (!marker) {
      const legacyLines = itemsOf((pRow || row).items).map((line) => {
        const product = products[String(line.product_id)];
        const sizeRow = line.size && product ? sizesOfProduct(product).find((s) => s.size === line.size) : null;
        return { ...line, _sizeKey: sizeRow ? sizeRow.key : null };
      });
      marker = { state: "reserved", lines: legacyLines, total: Number(row.total) || 0, legacy: true };
    }
    if (marker.state === "reserved") {
      for (const line of marker.lines || []) {
        const product = products[String(line.product_id)];
        if (!product) continue;
        const qty = Math.max(0, Number(line.qty) || 0);
        product.stock = (Number(product.stock) || 0) + qty;
        if (line._sizeKey != null && product.sizes && product.sizes[line._sizeKey]) {
          product.sizes[line._sizeKey].stock = (Number(product.sizes[line._sizeKey].stock) || 0) + qty;
        }
      }
    }
    marker.state = "released";
    marker.releasedAt = Date.now();
    markers[markerKey] = marker;

    const stamp = { status: "cancelled", status_by: Number(uid), status_at: Date.now() };
    if (pRow) pending[pendingKey] = { ...pRow, ...stamp };
    if (dRow) dbNode[dbKey] = { ...dRow, ...stamp };

    const put = await rtdbPutIfMatch(c.dbUrl, c.root, root, token, snap.etag);
    if (put.status === 412) continue;
    await ensureOk(put, "Buyurtma bekor qilinmadi");
    return { row: pRow ? pending[pendingKey] : dbNode[dbKey], repeated: false };
  }
  throw new Error("Bekor qilish band — qayta urinib ko'ring");
}

/** Navbatni bekor qiladi: status→cancelled va `slots/{date}/{key}` slotini
    O'CHIRISH — bitta root ETag CAS ichida. */
async function cancelBookingAtomic(c, token, key, uid) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const snap = await rtdbGetEtag(c.dbUrl, c.root, token);
    const root = snap.value && typeof snap.value === "object" ? snap.value : {};
    const bookings = root.bookings && typeof root.bookings === "object" ? root.bookings : {};
    const row = bookings[key];
    if (!row || typeof row !== "object") return statusErr(404, "not_found", "Bunday navbat yo'q");
    const current = normKindStatus("booking", clean(row.status || "new", 20));
    if (!(current in ALLOWED_STATUS_TRANSITIONS.booking)) {
      return statusErr(409, "order_not_ready", "Navbat hali status o'zgarishiga tayyor emas");
    }
    if (current === "cancelled") return { row, repeated: true };
    if (!(ALLOWED_STATUS_TRANSITIONS.booking[current] || []).includes("cancelled")) {
      return statusErr(409, "invalid_transition", `Navbat allaqachon «${statusName("booking", current)}» — bekor qilib bo'lmaydi`, {
        allowed: ALLOWED_STATUS_TRANSITIONS.booking[current] || [],
        current,
      });
    }
    if (row.date) {
      const slots = root.slots && typeof root.slots === "object" ? root.slots : null;
      const day = slots && slots[row.date] && typeof slots[row.date] === "object" ? slots[row.date] : null;
      if (day && day[key]) delete day[key];
    }
    bookings[key] = { ...row, status: "cancelled", status_by: Number(uid), status_at: Date.now() };
    root.bookings = bookings;
    const put = await rtdbPutIfMatch(c.dbUrl, c.root, root, token, snap.etag);
    if (put.status === 412) continue;
    await ensureOk(put, "Navbat bekor qilinmadi");
    return { row: bookings[key], repeated: false };
  }
  throw new Error("Bekor qilish band — qayta urinib ko'ring");
}

/** Barcha adminlarga bir xil xabar. */
async function notifyAdmins(env, c, text) {
  if (!env.BOT_TOKEN || !c.admins.length) return false;
  await Promise.all(c.admins.map((id) => sendMessage(env, id, text).catch(() => {})));
  return true;
}

// =====================================================================
//  STORY'GA JAVOB (Instagram'dagi "Reply to story" kabi)
//
//  NEGA WORKER ORQALI
//  Mijozning kim ekanini FAQAT server tomonda ishonchli aniqlash mumkin:
//  `initData` imzosi bot tokeni bilan tekshiriladi va token faqat shu
//  yerda turadi. Brauzer o'zini boshqa odam deb ko'rsata olmaydi.
//
//  Xabar IKKI joyga boradi:
//    1. Adminning Telegram'iga — qaysi bo'lim va qaysi story ekani bilan.
//       Ilgari mijoz `t.me/admin` ga o'tib qo'lda yozardi va admin
//       "qaysi story haqida gapiryapti?" deb tushunmasdi.
//    2. `story_replies` tuguniga — admin panelida story bo'yicha
//       guruhlangan holda ko'rinadi va yo'qolmaydi.
// =====================================================================
// =====================================================================
//  POST /admin/upload — MINI APP ICHIDAN VIDEO (va rasm) YUKLASH
//
//  MUAMMO
//  Bot ichidan video yuklash ishlaydi (`handlers/stories.py`), Mini App
//  ichidan esa MUTLAQO iloji yo'q edi:
//    * `docs/js/upload.js` ImgBB'ga yuklaydi — u FAQAT rasm qabul qiladi;
//    * `api/admin.py` dagi yuklash Render'da va u uxlab yotishi mumkin;
//    * brauzer Telegram'ga to'g'ridan murojaat qila olmaydi, chunki bot
//      tokeni kerak va uni brauzerga berish MUMKIN EMAS.
//
//  YECHIM
//  Fayl Worker'ga keladi, Worker uni bot orqali ADMINNING O'Z chatiga
//  yuboradi va Telegram qaytargan `file_id` ni oladi. Keyin video
//  `GET /media?id=<file_id>` orqali ko'rsatiladi (bu proksi allaqachon
//  bor va `Range` so'rovlarini qo'llaydi, ya'ni videoni orqaga-oldinga
//  surish ham ishlaydi).
//
//  NEGA AYNAN TELEGRAM
//  Yangi saqlash xizmati kerak emas, `file_id` muddatsiz yashaydi va
//  bot ham AYNI shu usulni ishlatadi — ya'ni botdan va Mini App'dan
//  qo'shilgan story bir xil ko'rinadi.
//
//  DIQQAT: bu yerda `requireAdmin()` ishlatilmaydi — u tanani JSON deb
//  o'qiydi, bizda esa multipart fayl keladi. Shuning uchun imzo qo'lda
//  tekshiriladi (mantiq bir xil: HMAC + ADMIN_IDS).
// =====================================================================
async function handleAdminUpload(request, env) {
  const c = cfg(env);
  if (!env.BOT_TOKEN) return json({ ok: false, error: "BOT_TOKEN sozlanmagan" }, 500);

  let form;
  try {
    form = await request.formData();
  } catch (_) {
    return json({ ok: false, error: "Fayl yuborilmadi (multipart kerak)" }, 400);
  }

  const verified = await verifyInitData(form.get("initData"), env);
  if (!verified.ok) return json({ ok: false, error: verified.error, blocked: !!verified.blocked }, verified.status || 401);
  const uid = String(verified.user.id);
  if (!c.admins.includes(uid)) {
    return json({ ok: false, error: "forbidden", message: "Bu amal faqat admin uchun" }, 403);
  }

  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function") {
    return json({ ok: false, error: "Fayl topilmadi" }, 400);
  }
  const size = Number(file.size) || 0;
  if (!size) return json({ ok: false, error: "Fayl bo'sh" }, 400);
  if (size > MAX_UPLOAD_BYTES) {
    const mb = Math.round(size / 1048576);
    return json(
      {
        ok: false,
        error: "too_big",
        message:
          `Fayl juda katta (${mb} MB). Chegara ${Math.round(MAX_UPLOAD_BYTES / 1048576)} MB — ` +
          "kalta video tanlang yoki botga tashlang.",
      },
      413
    );
  }

  const kind = String(form.get("kind") || "video").toLowerCase() === "photo" ? "photo" : "video";
  const method = kind === "photo" ? "sendPhoto" : "sendVideo";
  const field = kind === "photo" ? "photo" : "video";

  const out = new FormData();
  out.append("chat_id", uid); // adminning O'Z chati — fayl u yerda saqlanib turadi
  out.append("disable_notification", "true");
  out.append(
    "caption",
    kind === "photo" ? "🖼 Mini App: story rasmi" : "🎬 Mini App: story videosi"
  );
  out.append(field, file, file.name || (kind === "photo" ? "photo.jpg" : "video.mp4"));
  if (kind === "video") out.append("supports_streaming", "true");

  let data;
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
      method: "POST",
      body: out,
    });
    data = await res.json();
  } catch (error) {
    return json({ ok: false, error: "network", message: "Telegram'ga yuborilmadi" }, 502);
  }

  if (!data || !data.ok || !data.result) {
    // Telegram sababni aytadi — uni YUTMAYMIZ, admin nima bo'lganini bilsin
    const why = (data && (data.description || data.error_code)) || "noma'lum";
    return json({ ok: false, error: "telegram", message: "Telegram rad etdi: " + why }, 502);
  }

  const r = data.result;
  let fileId = null;
  let thumbId = null;
  let duration = 0;

  if (kind === "photo") {
    const photos = Array.isArray(r.photo) ? r.photo : [];
    // Eng katta o'lcham oxirida turadi
    fileId = photos.length ? photos[photos.length - 1].file_id : null;
  } else {
    const v = r.video || r.animation || r.document || null;
    fileId = v ? v.file_id : null;
    duration = (v && Number(v.duration)) || 0;
    const th = v && (v.thumbnail || v.thumb);
    thumbId = th ? th.file_id : null;
  }

  if (!fileId) return json({ ok: false, error: "Telegram file_id bermadi" }, 502);

  /* `url` — darhol ko'rsatish uchun. Bazaga esa `file_id` yoziladi:
     u muddatsiz, va Render ham (`/api/media/...`), Worker ham
     (`/media?id=...`) shu id bo'yicha xizmat qiladi. */
  const base = new URL(request.url).origin;
  return json({
    ok: true,
    kind: kind,
    file_id: fileId,
    thumb_id: thumbId,
    duration: duration,
    size: size,
    url: `${base}/media?id=${encodeURIComponent(fileId)}`,
    thumb_url: thumbId ? `${base}/media?id=${encodeURIComponent(thumbId)}` : null,
  });
}

async function handleStoryReply(request, env) {
  const c = cfg(env);
  const body = await readJson(request);
  const verified = await verifyInitData(body.initData, env);
  if (!verified.ok) return json({ ok: false, error: verified.error, blocked: !!verified.blocked }, verified.status || 401);

  const user = verified.user;
  const uid = String(user.id);

  const text = clean(body.text, 900);
  if (text.length < 1) return json({ ok: false, error: "Xabar bo'sh" }, 400);

  const storyId = clean(body.story_id, 40);
  if (!storyId) return json({ ok: false, error: "story_id yo'q" }, 400);
  const ringTitle = clean(body.ring_title, 80);
  const ringKey = clean(body.ring_key, 40);
  const heading = clean(body.heading, 160);

  const name = clean(
    [user.first_name, user.last_name].filter(Boolean).join(" ") || "Mijoz",
    80
  );
  const username = clean(user.username, 40);

  // ---- 1) Tugunga yozamiz (admin paneli shu yerdan o'qiydi)
  let saved = false;
  if (c.dbUrl) {
    try {
      const token = await accessToken(env);
      // `{root}/story_replies` — ilgari ildizsiz yozilardi va qoidalardagi
      // tugundan (zimmer/story_replies) tashqariga, baza ildiziga tushardi.
      const res = await fetch(rtdbUrl(c.dbUrl, `${c.root}/story_replies`), {
        method: "POST", // push — kalitni Firebase o'zi beradi
        headers: authHeaders(token, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          storyId: storyId,
          ringKey: ringKey,
          ringTitle: ringTitle,
          heading: heading,
          uid: uid,
          name: name,
          username: username,
          text: text,
          createdAt: Date.now(),
          imported: false,
        }),
      });
      saved = res.ok;
    } catch (_) {
      saved = false;
    }
  }

  // ---- 2) Adminga Telegram xabari
  const who = username
    ? `<a href="https://t.me/${escHtml(username)}">${escHtml(name)}</a>`
    : `<a href="tg://user?id=${uid}">${escHtml(name)}</a>`;

  const where = ringTitle
    ? `📖 Bo'lim: <b>${escHtml(ringTitle)}</b>\n`
    : "";
  const what = heading ? `🏷 Story: <b>${escHtml(heading)}</b>\n` : "";

  const adminText =
    "💬 <b>Story'ga javob</b>\n\n" +
    where +
    what +
    `🆔 Story ID: <code>${escHtml(storyId)}</code>\n` +
    `👤 ${who}\n\n` +
    `<blockquote>${escHtml(text)}</blockquote>`;

  const notified = await notifyAdmins(env, c, adminText);

  /* Hech qayerga yetib bormasa — mijozga ROSTINI aytamiz. Aks holda u
     "yubordim" deb o'ylab kutib o'tiradi. */
  if (!saved && !notified) {
    return json({ ok: false, error: "Xabar yuborilmadi — keyinroq urinib ko'ring" }, 502);
  }
  return json({ ok: true, saved: saved, notified: notified });
}

/** Qisqa, barqaror hash — idempotent kalitlar uchun. */
function shortHash(text) {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

// ---------------------------------------------------------------------
//  Buyurtma kodi. Idempotent kalit berilsa — DETERMINISTIK (bir xil
//  kalitdan bir xil kod), aks holda vaqt asosida.
// ---------------------------------------------------------------------
function orderCode(uid, clientKey) {
  const seed = clientKey || String(Date.now());
  let hash = 5381;
  const text = `${uid}:${seed}`;
  for (let i = 0; i < text.length; i++) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // I,O,0,1 yo'q — chalkashmasin
  let out = "";
  let n = hash;
  for (let i = 0; i < 6; i++) {
    out += chars[n % chars.length];
    n = Math.floor(n / chars.length);
  }
  return "ZM-" + out;
}

/** Mijoz havolasi: username bo'lsa t.me, bo'lmasa tg://user. */
function userLink(uid, name, username) {
  const label = escHtml(name || "Mijoz");
  return username
    ? `<a href="https://t.me/${escHtml(username)}">${label}</a>`
    : `<a href="tg://user?id=${Number(uid) || 0}">${label}</a>`;
}

/** Adminlarga bir xil xabar va holat tugmalari. Kamida bittasiga yetsa — true. */
async function sendToAdmins(env, c, text, keyboard) {
  if (!env.BOT_TOKEN || !c.admins.length) return false;
  let anyOk = false;
  for (const chatId of c.admins) {
    const ok = await sendMessage(env, chatId, text, keyboard ? { reply_markup: keyboard } : undefined);
    anyOk = anyOk || ok;
  }
  return anyOk;
}

async function notifyOrder(env, c, order, key) {
  if (!env.BOT_TOKEN || !c.admins.length) return false;

  const itemLines = itemsOf(order.items)
    .map(
      (i) =>
        // Razmer nom bilan yonma-yon: admin buyurtmani o'qib darhol
        // to'g'ri razmerni javonda topadi (qayta qo'ng'iroq kerak emas).
        `• ${escHtml(i.name)}${i.size ? ` <b>[${escHtml(i.size)}]</b>` : ""}` +
        ` × ${i.qty} = ${fmtPrice(i.price * i.qty)}`
    )
    .join("\n");

  const meta = [];
  if (order.delivery_info) meta.push(`🚚 ${escHtml(order.delivery_info)}`);
  if (order.payment_method) meta.push(`💳 To'lov: <b>${escHtml(order.payment_method)}</b>`);

  /* «Mijoz ID» qatori ATAYLAB: admin shu xabarga «Reply» qilsa javob
     to'g'ridan mijozga boradi (bot mijoz↔admin yozishmasi). */
  const adminText =
    "🔔 <b>Yangi buyurtma</b>\n\n" +
    `🆔 <code>${escHtml(order.code)}</code>\n` +
    `👤 ${userLink(order.uid, order.customer_name, order.username)}\n` +
    `📞 ${escHtml(order.phone)}\n` +
    `📍 ${escHtml(order.address)}\n` +
    (meta.length ? meta.join("\n") + "\n" : "") +
    "\n" +
    itemLines +
    `\n\n💰 Jami: <b>${fmtPrice(order.total)}</b>\n` +
    `👤 Mijoz ID: <code>${Number(order.uid) || 0}</code>\n\n` +
    "<i>↩️ Mijozga yozish uchun shu xabarga «Reply» qiling.</i>";

  const anyOk = await sendToAdmins(env, c, adminText, key ? statusKeyboard("order", key, "pending", "new") : null);

  // Mijozga tasdiq — holatni kuzatish tugmasi bilan
  await sendMessage(
    env,
    String(order.uid),
    "✅ <b>Buyurtmangiz qabul qilindi!</b>\n\n" +
      `🆔 <code>${escHtml(order.code)}</code>\n` +
      itemLines +
      `\n\n💰 Jami: <b>${fmtPrice(order.total)}</b>\n` +
      `📍 ${escHtml(order.address)}\n\n` +
      "Operator tez orada bog'lanadi. Holat o'zgarishi shu yerga keladi 🔔",
    { reply_markup: { inline_keyboard: [[{ text: "📦 Buyurtmani kuzatish", web_app: { url: appUrl(env, "orders") } }]] } }
  );

  return anyOk;
}

/** Bi-LED o'rnatish buyurtmasi — adminga (tugmalar bilan) va mijozga. */
async function notifyBiled(env, c, token, key, rec, user) {
  const parts = biledParts(rec).map(escHtml);
  const name = rec.name || [user && user.first_name, user && user.last_name].filter(Boolean).join(" ");
  const adminText =
    "🔥 <b>Yangi Bi-LED buyurtma</b>\n\n" +
    `🆔 <code>${escHtml(rec.code || biledCode(key, rec))}</code>\n` +
    `👤 ${userLink(rec.uid, name, user && user.username)}\n` +
    `📞 ${escHtml(rec.phone || "")}\n` +
    `🚗 ${escHtml(rec.car_name || "")}\n` +
    `💡 ${parts.join(" · ")}\n` +
    (rec.comment ? `💬 ${escHtml(rec.comment)}\n` : "") +
    `\n💰 Jami: <b>${fmtPrice(rec.total)}</b>\n` +
    `👤 Mijoz ID: <code>${Number(rec.uid) || 0}</code>\n\n` +
    "<i>↩️ Mijozga yozish uchun shu xabarga «Reply» qiling.</i>";
  const ok = await sendToAdmins(env, c, adminText, statusKeyboard("biled", key, "pending", "new"));
  if (ok) await rtdbPatch(c.dbUrl, `${c.root}/biled_orders/${key}`, { notified_admin: true }, token).catch(() => {});
  await sendMessage(
    env,
    String(rec.uid),
    "✅ <b>Bi-LED buyurtmangiz qabul qilindi!</b>\n\n" +
      `🆔 <code>${escHtml(rec.code || biledCode(key, rec))}</code>\n` +
      `🚗 ${escHtml(rec.car_name || "")}\n💡 ${parts.join(" · ")}\n` +
      `💰 Taxminiy narx: <b>${fmtPrice(rec.total)}</b>\n\n` +
      "Usta tez orada bog'lanib, o'rnatish vaqtini kelishadi 🔧\n" +
      `🛡 O'rnatish topshirilgach ${escHtml(rec.warranty || "1 yil")}lik kafolat shu botda boshlanadi.`,
    { reply_markup: { inline_keyboard: [[{ text: "📦 Buyurtmani kuzatish", web_app: { url: appUrl(env, "biled") } }]] } }
  );
  return ok;
}

/** Navbat — adminga (tugmalar bilan) va mijozga. */
async function notifyBooking(env, c, token, key, rec, user) {
  const when = `${fmtDayIso(rec.date)} · ${escHtml(rec.time || "")}`;
  const adminText =
    "🗓 <b>Yangi navbat</b>\n\n" +
    `🔧 ${escHtml(rec.service_name || "Xizmat")}\n` +
    (rec.car_name ? `🚗 ${escHtml(rec.car_name)}\n` : "") +
    (rec.details ? `🎨 ${escHtml(rec.details)}\n` : "") +
    `📅 ${when}\n` +
    `👤 ${userLink(rec.uid, rec.name, user && user.username)}\n` +
    `📞 ${escHtml(rec.phone || "")}\n` +
    (rec.price ? `💰 ${fmtPrice(rec.price)}\n` : "") +
    (rec.deposit_amount
      ? `💳 Zalog: <b>${fmtPrice(rec.deposit_amount)}</b> — <a href="${escHtml(rec.deposit_receipt || "")}">chekni ko'rish</a>\n` +
        "<i>Chekni tekshirib «✅ Tasdiqlash» ni bosing.</i>\n"
      : "") +
    `👤 Mijoz ID: <code>${Number(rec.uid) || 0}</code>\n\n` +
    "<i>↩️ Mijozga yozish uchun shu xabarga «Reply» qiling.</i>";
  const ok = await sendToAdmins(env, c, adminText, statusKeyboard("booking", key, "pending", "new"));
  if (ok) await rtdbPatch(c.dbUrl, `${c.root}/bookings/${key}`, { notified_admin: true }, token).catch(() => {});
  await sendMessage(
    env,
    String(rec.uid),
    "✅ <b>Navbat so'rovingiz qabul qilindi!</b>\n\n" +
      `🔧 ${escHtml(rec.service_name || "Xizmat")}\n` +
      (rec.car_name ? `🚗 ${escHtml(rec.car_name)}\n` : "") +
      `📅 ${when}\n` +
      (rec.details ? `🎨 ${escHtml(rec.details)}\n` : "") +
      (rec.price ? `💰 ${fmtPrice(rec.price)}\n` : "") +
      (rec.deposit_amount ? `💳 Zalog cheki yuborildi: ${fmtPrice(rec.deposit_amount)}\n` : "") +
      "\n" +
      (rec.deposit_amount
        ? "Usta chekni tekshirib navbatni tasdiqlagach shu yerga xabar keladi 🔔"
        : "Usta vaqtni tasdiqlagach shu yerga xabar keladi 🔔"),
    { reply_markup: { inline_keyboard: [[{ text: "🗓 Navbatlarim", web_app: { url: appUrl(env, "bookings") } }]] } }
  );
  return ok;
}

/** Bi-LED buyurtma kodi: yozuvdagi `code`, bo'lmasa kalitdan (eski yozuvlar). */
function biledCode(key, row) {
  if (row && row.code) return String(row.code);
  const k = String(key || "");
  return k.startsWith("bl_") ? "BL-" + shortHash(k).toUpperCase() : "#" + (row && row.id != null ? row.id : k);
}

/** `extra` — `reply_markup`, `reply_parameters` va h.k. (ixtiyoriy). */
async function sendMessage(env, chatId, text, extra) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...(extra || {}),
      }),
    });
    const data = await res.json();
    return !!(data && data.ok);
  } catch (_) {
    return false;
  }
}

// =====================================================================
//  GET /media?id=<file_id> — Telegram fayl proksisi
//
//  Telegram `file_id` ni faqat bot tokeni bilan ochish mumkin. Render
//  o'chganda `/api/media/...` ishlamaydi va ilovada BARCHA rasmlar
//  yo'qoladi. Bu endpoint shu muammoni hal qiladi: token faqat Worker
//  ichida qoladi, `file_path` har so'rovda qayta olinadi (link
//  eskirmaydi), `Range` uzatiladi (video suriladi).
// =====================================================================
async function handleMedia(request, env) {
  const mediaCors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Content-Type",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Faqat GET", { status: 405, headers: mediaCors });
  }
  if (!env.BOT_TOKEN) {
    return new Response("BOT_TOKEN sozlanmagan", { status: 500, headers: mediaCors });
  }

  const fileId = new URL(request.url).searchParams.get("id");
  if (!fileId) return new Response("?id= yo'q", { status: 400, headers: mediaCors });

  const gfRes = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`
  );
  const gf = await gfRes.json();
  if (!gf || !gf.ok || !gf.result || !gf.result.file_path) {
    return new Response("Fayl topilmadi", { status: 404, headers: mediaCors });
  }
  const filePath = gf.result.file_path;

  const range = request.headers.get("Range");
  const upstream = await fetch(
    `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${filePath}`,
    { method: request.method, headers: range ? { Range: range } : {} }
  );

  const headers = new Headers(mediaCors);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "public, max-age=86400");
  const ct = upstream.headers.get("Content-Type");
  headers.set("Content-Type", ct && ct !== "application/octet-stream" ? ct : guessMime(filePath));
  for (const name of ["Content-Length", "Content-Range"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

function guessMime(p) {
  const ext = (p.split(".").pop() || "").toLowerCase();
  return (
    {
      mp4: "video/mp4",
      mov: "video/quicktime",
      webm: "video/webm",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      gif: "image/gif",
    }[ext] || "application/octet-stream"
  );
}

// =====================================================================
//  Telegram initData tekshiruvi
//    secretKey = HMAC_SHA256(key="WebAppData", msg=botToken)
//    hash      = HMAC_SHA256(key=secretKey,   msg=sorted("k=v") joined LF)
// =====================================================================
async function verifyInitData(initData, env) {
  if (!env.BOT_TOKEN) return { ok: false, error: "BOT_TOKEN sozlanmagan" };
  if (!initData || typeof initData !== "string") return { ok: false, error: "initData yo'q" };

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, error: "hash yo'q" };
  params.delete("hash");

  const pairs = [];
  for (const [k, v] of params) pairs.push(`${k}=${v}`);
  pairs.sort();
  const dataCheckString = pairs.join(String.fromCharCode(10));

  const enc = new TextEncoder();
  const secretKey = await hmac(enc.encode("WebAppData"), enc.encode(env.BOT_TOKEN));
  const computed = toHex(await hmac(secretKey, enc.encode(dataCheckString)));

  if (!constantTimeEqual(computed, hash)) return { ok: false, error: "imzo mos kelmadi" };

  const { maxAge } = cfg(env);
  const authDate = parseInt(params.get("auth_date") || "0", 10);
  const now = Math.floor(Date.now() / 1000);
  if (!authDate || now - authDate > maxAge) return { ok: false, error: "initData eskirgan" };

  let user;
  try {
    user = JSON.parse(params.get("user") || "null");
  } catch (_) {
    user = null;
  }
  if (!user || !user.id) return { ok: false, error: "user yo'q" };

  // ⛔ Admin bloklagan mijoz — hech qanday imzolangan amalni bajara olmaydi
  if (await isBlockedUid(String(user.id), env)) {
    return { ok: false, error: "blocked", blocked: true, status: 403 };
  }

  return { ok: true, user };
}

// =====================================================================
//  ⛔ BLOKLANGAN MIJOZLAR (Avto_A1 modeli)
//
//  Admin «Mijozlar» oynasida bloklasa `{root}/blocked_users/{uid}` yoziladi
//  (`/admin/block`). Har bir imzolangan so'rov `verifyInitData` orqali
//  o'tadi, ya'ni buyurtma, navbat, profil va /me — hammasi rad etiladi.
//  Adminlar hech qachon bloklanmaydi. 30 soniyalik kesh; baza javob
//  bermasa «fail-open» (hamma mijoz to'xtab qolmasin).
// =====================================================================
const blockedCache = new Map();

async function isBlockedUid(uid, env) {
  const c = cfg(env);
  if (!/^\d+$/.test(uid) || c.admins.includes(uid) || !c.dbUrl) return false;
  const now = Date.now();
  const hit = blockedCache.get(uid);
  if (hit && hit.exp > now) return hit.v;
  let v;
  try {
    const token = await accessToken(env);
    v = !!(await rtdbGet(c.dbUrl, `${c.root}/blocked_users/${uid}`, token));
  } catch (_) {
    return false;
  }
  if (blockedCache.size > 5000) blockedCache.clear();
  blockedCache.set(uid, { v, exp: now + 30000 });
  return v;
}

/** `uid` — maqsad mijoz (raqam), admin emas. */
function targetUid(value, c) {
  const uid = clean(value, 24);
  if (!/^[1-9]\d{0,19}$/.test(uid)) return { error: json({ ok: false, error: "uid noto'g'ri" }, 400) };
  return { uid, isAdmin: c.admins.includes(uid) };
}

// ---------------------------------------------------------------------
//  POST /admin/block — { uid, block: true|false, name?, phone? }
// ---------------------------------------------------------------------
async function handleAdminBlock(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  const { c, body, uid: by } = gate;
  const t = targetUid(body.uid, c);
  if (t.error) return t.error;
  const block = body.block === true;
  if (block && t.isAdmin) return json({ ok: false, error: "admin", message: "Adminni bloklab bo'lmaydi" }, 400);
  const token = await accessToken(env);
  const path = `${c.root}/blocked_users/${t.uid}`;
  const res = block
    ? await rtdbPut(c.dbUrl, path, {
        name: clean(body.name, 80),
        phone: clean(body.phone, 30),
        at: Date.now(),
        by: String(by),
      }, token)
    : await rtdbDelete(c.dbUrl, path, token);
  await ensureOk(res, "Saqlanmadi");
  blockedCache.delete(t.uid);
  return json({ ok: true, uid: t.uid, blocked: block });
}

// ---------------------------------------------------------------------
//  POST /admin/vip — { uid, vip: true|false } — qo'lda VIP (`crm_vip/{uid}`)
//  Alohida tugun: bot `users/{uid}/profile` ni to'liq qayta yozadi va
//  profil ichidagi belgi o'chib ketardi.
// ---------------------------------------------------------------------
async function handleAdminVip(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  const { c, body, uid: by } = gate;
  const t = targetUid(body.uid, c);
  if (t.error) return t.error;
  const vip = body.vip === true;
  const token = await accessToken(env);
  const path = `${c.root}/crm_vip/${t.uid}`;
  const res = vip
    ? await rtdbPut(c.dbUrl, path, { at: Date.now(), by: String(by) }, token)
    : await rtdbDelete(c.dbUrl, path, token);
  await ensureOk(res, "Saqlanmadi");
  return json({ ok: true, uid: t.uid, vip });
}

// ---------------------------------------------------------------------
//  POST /admin/message — { uid, text } — bot orqali mijozga xabar
// ---------------------------------------------------------------------
async function handleAdminMessage(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  const { c, body } = gate;
  const t = targetUid(body.uid, c);
  if (t.error) return t.error;
  const text = String(body.text == null ? "" : body.text).trim();
  if (text.length < 2 || text.length > 900) {
    return json({ ok: false, error: "text", message: "Xabar 2–900 belgi bo'lsin" }, 400);
  }
  const ok = await sendMessage(env, t.uid, "💬 <b>Uzbrovv</b>\n\n" + escHtml(text));
  if (!ok) {
    return json({ ok: false, error: "telegram", message: "Yuborilmadi — mijoz botni bloklagan bo'lishi mumkin" }, 502);
  }
  return json({ ok: true });
}

function constantTimeEqual(a, b) {
  a = String(a);
  b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmac(keyBytes, msgBytes) {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", key, msgBytes);
}

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// =====================================================================
//  Firebase: custom token va access token
// =====================================================================
async function createCustomToken(uid, env) {
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
    {
      iss: env.FIREBASE_CLIENT_EMAIL,
      sub: env.FIREBASE_CLIENT_EMAIL,
      aud:
        "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
      iat: now,
      exp: now + 3600,
      uid,
    },
    env
  );
}

// Access token KESHLANADI. Avto_A1 da har so'rovda RSA imzo + Google'ga
// murojaat qilinardi — bu keraksiz kechikish va kvota sarfi.
let _tokenCache = { value: null, exp: 0 };

/**
 * @param force  Keshni CHETLAB O'TIB, yangi token oladi.
 *
 *  Nega kerak: kesh modul darajasida turadi va bir soat yashaydi. Shu
 *  sababli `/health?deep=1` keshdagi ESKI (ishlaydigan) tokenni qaytarib,
 *  kalit buzuq bo'lsa ham «hammasi joyida» deb ko'rsatardi — ya'ni tashxis
 *  yolg'on gapirardi. Kalit almashtirilgan holatda ham xuddi shu muammo
 *  bo'lardi: Worker bir soatgacha eski tokendan foydalanib turardi.
 */
async function accessToken(env, force) {
  const now = Math.floor(Date.now() / 1000);
  if (!force && _tokenCache.value && _tokenCache.exp - 60 > now) return _tokenCache.value;

  const jwt = await signJwt(
    {
      iss: env.FIREBASE_CLIENT_EMAIL,
      // DIQQAT — IKKI scope ham SHART, bo'shliq bilan ajratiladi.
      //
      // `userinfo.email` tushib qolsa Google tokenni MUAMMOSIZ beradi
      // (ya'ni bu bosqichda xato ko'rinmaydi), lekin RTDB o'sha token bilan
      // kelgan har qanday so'rovni 401 bilan rad etadi. Xato kalitda emas,
      // aynan shu yerda bo'lgani uchun uni topish qiyin edi.
      scope:
        "https://www.googleapis.com/auth/userinfo.email" +
        " https://www.googleapis.com/auth/firebase.database",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    },
    env
  );

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:
      "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=" +
      encodeURIComponent(jwt),
  });
  const data = await res.json();
  if (!data || !data.access_token) {
    throw new Error("access_token olinmadi: " + JSON.stringify(data).slice(0, 200));
  }
  _tokenCache = { value: data.access_token, exp: now + (data.expires_in || 3600) };
  return data.access_token;
}

async function signJwt(payload, env) {
  if (!env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    throw new Error("FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY sozlanmagan");
  }
  const enc = new TextEncoder();
  const head = b64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const input = `${head}.${body}`;
  const key = await importPrivateKey(env.FIREBASE_PRIVATE_KEY);
  const sig = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, enc.encode(input));
  return `${input}.${b64url(new Uint8Array(sig))}`;
}

async function importPrivateKey(pem) {
  // Cloudflare panelida private_key ko'pincha "\n" matni sifatida saqlanadi —
  // uni haqiqiy yangi qatorga aylantiramiz.
  const clean = String(pem)
    .split(String.fromCharCode(92) + "n")
    .join(String.fromCharCode(10))
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  return crypto.subtle.importKey(
    "pkcs8",
    b64bytes(clean),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

function b64url(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64bytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// =====================================================================
//  RTDB REST — token SARLAVHADA (URL'da emas: loglarga tushmasin)
// =====================================================================
function rtdbUrl(dbUrl, path) {
  return `${dbUrl}/${String(path).replace(/^\/+/, "")}.json`;
}

function authHeaders(token, extra) {
  return { Authorization: `Bearer ${token}`, ...(extra || {}) };
}

async function rtdbGet(dbUrl, path, token) {
  const res = await fetch(rtdbUrl(dbUrl, path), { headers: authHeaders(token) });
  if (!res.ok) return null;
  return res.json();
}

function rtdbPut(dbUrl, path, value, token) {
  return fetch(rtdbUrl(dbUrl, path), {
    method: "PUT",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify(value),
  });
}

function rtdbPatch(dbUrl, path, value, token) {
  return fetch(rtdbUrl(dbUrl, path), {
    method: "PATCH",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify(value),
  });
}

function rtdbDelete(dbUrl, path, token) {
  return fetch(rtdbUrl(dbUrl, path), {
    method: "DELETE",
    headers: authHeaders(token),
  });
}

async function ensureOk(res, message) {
  if (res.ok) return res;
  const text = await res.text().catch(() => "");
  throw new Error(`${message} (${res.status}): ${text.slice(0, 200)}`);
}

async function rtdbGetStrict(dbUrl, path, token) {
  const res = await fetch(rtdbUrl(dbUrl, path), { headers: authHeaders(token) });
  await ensureOk(res, "Firebase o'qilmadi");
  return res.json();
}

async function rtdbGetEtag(dbUrl, path, token) {
  const res = await fetch(rtdbUrl(dbUrl, path), {
    headers: authHeaders(token, { "X-Firebase-ETag": "true" }),
  });
  await ensureOk(res, "Firebase CAS o'qilmadi");
  return { value: await res.json(), etag: res.headers.get("ETag") || "null_etag" };
}

function rtdbPutIfMatch(dbUrl, path, value, token, etag) {
  return fetch(rtdbUrl(dbUrl, path), {
    method: "PUT",
    headers: authHeaders(token, {
      "Content-Type": "application/json",
      "If-Match": etag || "null_etag",
    }),
    body: JSON.stringify(value),
  });
}

async function rtdbCreate(dbUrl, path, value, token) {
  const put = await rtdbPutIfMatch(dbUrl, path, value, token, "null_etag");
  if (put.ok) return { created: true, value };
  if (put.status !== 412) await ensureOk(put, "Firebase claim yaratilmadi");
  const current = await rtdbGetStrict(dbUrl, path, token);
  return { created: false, value: current };
}

async function casPatchObject(dbUrl, path, token, mutate) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const snap = await rtdbGetEtag(dbUrl, path, token);
    const next = mutate(snap.value && typeof snap.value === "object" ? snap.value : {});
    const put = await rtdbPutIfMatch(dbUrl, path, next, token, snap.etag);
    if (put.status === 412) continue;
    await ensureOk(put, "Firebase CAS yozilmadi");
    return next;
  }
  throw new Error("Firebase yozuvi band — qayta urinib ko'ring");
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// =====================================================================
//  Yordamchilar
// =====================================================================
async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : {};
  } catch (_) {
    return {};
  }
}

function clean(value, max) {
  return String(value == null ? "" : value)
    .trim()
    .slice(0, max || 200);
}

/** `utils/helpers.py:normalize_phone` bilan bir xil mantiq: +998XXXXXXXXX */
function normalizePhone(raw) {
  const digits = String(raw == null ? "" : raw).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 9) return "+998" + digits;
  if (digits.length === 12 && digits.startsWith("998")) return "+" + digits;
  if (digits.length === 13 && digits.startsWith("0998")) return "+" + digits.slice(1);
  return null;
}

/** `utils/helpers.py:fmt_price` bilan bir xil: 120000 -> "120 000 so'm" */
function fmtPrice(value) {
  const n = Math.round(Number(value) || 0);
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " so'm";
}

function escHtml(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// =====================================================================
//  TELEGRAM BOT — WEBHOOK (2.0.0)
//
//  NEGA BOT ENDI SHU YERDA
//  Render bepul tarifi pul so'ray boshladi. Botga alohida server kerak
//  emas: Telegram har xabarni shu Worker'ga (webhook) yuboradi. Worker
//  uxlamaydi, bepul (kuniga 100 000 so'rov) va karta talab qilmaydi.
//
//  ULASH: kod Cloudflare'ga qo'yilgach Mini App bir marta ochilsa (yoki
//  brauzerda `/setup`) webhook O'ZI o'rnatiladi. Python bot (bot.py) endi
//  shart emas — u ishga tushsa ham Worker webhook'ini o'chirmaydi.
//
//  Bot nimalarni qiladi:
//    • /start — salomlashish, menyu, raqamni ulashish (bir marta);
//    • 📦 buyurtmalar holati, 🛡 kafolat (qolgan muddat), ☎ aloqa;
//    • adminga yangi buyurtma/Bi-LED/navbat — HOLAT TUGMALARI bilan;
//    • mijoz yozgan xabar adminga boradi, admin «Reply» qilsa — mijozga.
// =====================================================================

const BOT_APP_URL = "https://anvarjonaxtamov70.github.io/Uzbrovv/";
const BOT_DEFAULT_PHONE = "+998 95 370 74 71";
const BOT_DEFAULT_TG = "Mehroj088";

function botConf(env) {
  const app = clean(env.MINI_APP_URL, 300);
  return {
    app: /^https:\/\//.test(app) ? app : BOT_APP_URL,
    name: clean(env.SHOP_NAME, 40) || "Uzbrovv",
    phone: clean(env.SHOP_PHONE, 40) || BOT_DEFAULT_PHONE,
    telegram: clean(env.SHOP_TELEGRAM || env.PAY_ADMIN_USERNAME, 40).replace(/^@+/, "") || BOT_DEFAULT_TG,
    city: clean(env.DELIVERY_CITY, 60) || "Samarqand",
  };
}

/** Mini App manzili; `page` — ochilganda darhol ko'rsatiladigan bo'lim. */
function appUrl(env, page) {
  const base = botConf(env).app;
  if (!page) return base;
  return base + (base.indexOf("?") === -1 ? "?" : "&") + "p=" + encodeURIComponent(page);
}

/** Render `/api/config` o'rnini bosuvchi sozlamalar (faqat imzolangan /me da). */
async function workerConfig(env, c, token) {
  const b = botConf(env);
  // 2.4.0 — karta admin paneldan (`private/payment`), bo'lmasa secret
  const pay = await paymentConfig(env, c, token);
  return {
    currency: clean(env.CURRENCY, 12) || "so'm",
    pay_card_number: pay.card_number,
    pay_card_holder: pay.card_holder,
    pay_admin_username: clean(env.PAY_ADMIN_USERNAME || env.SHOP_TELEGRAM, 40).replace(/^@+/, "") || b.telegram,
    shop_phone: b.phone,
    delivery_city: b.city,
    // 2.4.0 — Shogird AI Worker'da: kalit bo'lsa yoqiq
    ai_enabled: !!env.GROQ_API_KEY,
  };
}

async function tgCall(env, method, payload) {
  if (!env.BOT_TOKEN) return { ok: false, description: "BOT_TOKEN sozlanmagan" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
    const data = await res.json().catch(() => null);
    return data && typeof data === "object" ? data : { ok: false, description: "bo'sh javob" };
  } catch (error) {
    return { ok: false, description: String(error).slice(0, 200) };
  }
}

/** Webhook siri — BOT_TOKEN dan hosil qilinadi (alohida sozlash shart emas).
 *  Telegram uni har so'rovda sarlavhada yuboradi; begona so'rov o'tmaydi. */
async function webhookSecret(env) {
  const own = clean(env.WEBHOOK_SECRET, 256).replace(/[^A-Za-z0-9_-]/g, "");
  if (own.length >= 16) return own;
  return (await sha256Hex("uzbrovv-webhook:" + String(env.BOT_TOKEN || ""))).slice(0, 48);
}

const BOT_COMMANDS = [
  { command: "start", description: "Bosh menyu" },
  { command: "app", description: "Do'konni ochish" },
  { command: "buyurtmalarim", description: "Buyurtmalarim holati" },
  { command: "kafolat", description: "Tovar kafolati — qolgan muddat" },
  { command: "aloqa", description: "Biz bilan aloqa" },
  { command: "id", description: "Telegram ID" },
];
const ADMIN_COMMANDS = [{ command: "admin", description: "Boshqaruv: yangi buyurtmalar" }];

let _hookOkUntil = 0;
let _hookBusy = null;

/** Fonda (javobni kechiktirmasdan) bot ulanganini tekshiradi. */
function keepWebhook(ctx, env, origin) {
  if (!ctx || typeof ctx.waitUntil !== "function") return;
  if (!env.BOT_TOKEN || String(env.BOT_WEBHOOK || "").trim().toLowerCase() === "off") return;
  if (Date.now() < _hookOkUntil) return;
  ctx.waitUntil(ensureWebhook(env, origin));
}

async function ensureWebhook(env, origin) {
  if (_hookBusy) return _hookBusy;
  _hookBusy = (async () => {
    const info = await tgCall(env, "getWebhookInfo", {});
    if (!info.ok) {
      _hookOkUntil = Date.now() + 60 * 1000;
      return;
    }
    if ((info.result || {}).url === `${origin}/tg`) {
      _hookOkUntil = Date.now() + 30 * 60 * 1000;
      return;
    }
    const out = await setupBot(env, origin);
    _hookOkUntil = Date.now() + (out.webhook && out.webhook.ok ? 30 * 60 * 1000 : 60 * 1000);
  })()
    .catch((error) => {
      console.error("[bot] webhook tekshirilmadi:", error);
      _hookOkUntil = Date.now() + 60 * 1000;
    })
    .finally(() => {
      _hookBusy = null;
    });
  return _hookBusy;
}

async function setupBot(env, origin) {
  const c = cfg(env);
  const out = {};
  out.webhook = await tgCall(env, "setWebhook", {
    url: `${origin}/tg`,
    secret_token: await webhookSecret(env),
    allowed_updates: ["message", "callback_query"],
    max_connections: 40,
  });
  out.commands = await tgCall(env, "setMyCommands", { commands: BOT_COMMANDS });
  out.admin_commands = 0;
  for (const id of c.admins) {
    const r = await tgCall(env, "setMyCommands", {
      commands: BOT_COMMANDS.concat(ADMIN_COMMANDS),
      scope: { type: "chat", chat_id: Number(id) },
    });
    if (r.ok) out.admin_commands++;
  }
  out.menu = await tgCall(env, "setChatMenuButton", {
    menu_button: { type: "web_app", text: "Do'kon", web_app: { url: botConf(env).app } },
  });
  return out;
}

/** GET /setup — botni shu Worker'ga ulaydi. Takror ochilsa zarari yo'q. */
async function handleBotSetup(request, env) {
  if (!env.BOT_TOKEN) return json({ ok: false, error: "BOT_TOKEN sozlanmagan" }, 500);
  const origin = new URL(request.url).origin;
  const out = await setupBot(env, origin);
  const ok = !!(out.webhook && out.webhook.ok);
  _hookOkUntil = ok ? Date.now() + 30 * 60 * 1000 : 0;
  const [info, me] = await Promise.all([tgCall(env, "getWebhookInfo", {}), tgCall(env, "getMe", {})]);
  const r = info.result || {};
  return json(
    {
      ok,
      message: ok
        ? `✅ Bot ulandi: @${(me.result && me.result.username) || "bot"} — Telegram'da /start yuboring.`
        : "❌ Ulanmadi: " + ((out.webhook && out.webhook.description) || "noma'lum xato"),
      webhook: { url: r.url || "", pending: r.pending_update_count || 0, last_error: r.last_error_message || null },
      commands: !!(out.commands && out.commands.ok),
      admin_commands: out.admin_commands,
      menu_button: !!(out.menu && out.menu.ok),
      version: VERSION,
    },
    ok ? 200 : 502
  );
}

/** POST /tg — Telegram yangilanishi. Javob DARHOL qaytadi, ish fonda. */
async function handleTelegramWebhook(request, env, ctx) {
  if (request.method !== "POST") return new Response("ok");
  if (!env.BOT_TOKEN) return new Response("BOT_TOKEN yo'q", { status: 500 });
  const got = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
  if (!got || !constantTimeEqual(got, await webhookSecret(env))) {
    return new Response("forbidden", { status: 401 });
  }
  const update = await readJson(request);
  const origin = new URL(request.url).origin;
  const job = processUpdate(update, env, origin).catch((error) => console.error("[bot] update:", error));
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(job);
  else await job;
  return new Response("ok");
}

/* Eski (Python) bot klaviaturasidagi yozuvlar ham shu yerda tanilad —
   mijozning chatida eski tugmalar qolgan bo'lsa ular ishlayveradi. */
const BOT_TEXT_ROUTES = {
  "do'konni ochish": "app",
  "do'kon": "app",
  dokon: "app",
  savatcha: "app",
  "do'konga o'tish": "app",
  buyurtmalarim: "buyurtmalarim",
  "mening navbatlarim": "buyurtmalarim",
  navbatlarim: "buyurtmalarim",
  kafolatim: "kafolat",
  kafolat: "kafolat",
  "tovar kafolati": "kafolat",
  aloqa: "aloqa",
  "biz bilan aloqa": "aloqa",
  "admin panel": "admin",
  boshqaruv: "admin",
  "navbat olish": "navbat",
  keyinroq: "later",
  "bekor qilish": "later",
  menyu: "menu",
  "bosh menyu": "menu",
};

function normBtn(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[‘’ʼʻ`´]/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function processUpdate(update, env, origin) {
  if (!update || typeof update !== "object") return;
  if (update.callback_query) return botCallback(update.callback_query, env);

  const msg = update.message;
  if (!msg || !msg.from || !msg.chat || msg.chat.type !== "private" || msg.from.is_bot) return;
  const c = cfg(env);
  const uid = String(msg.from.id);
  const admin = c.admins.includes(uid);
  // ⛔ Bloklangan mijozga bot javob bermaydi (Mini App'dagi kabi)
  if (!admin && (await isBlockedUid(uid, env))) return;

  try {
    if (msg.contact) return await botContact(msg, env, c);
    const text = typeof msg.text === "string" ? msg.text.trim() : "";

    if (text.startsWith("/")) {
      const [raw, ...rest] = text.split(/\s+/);
      const cmd = raw.slice(1).split("@")[0].toLowerCase();
      return await botCommand(cmd, rest.join(" ").trim(), msg, env, c, admin);
    }
    const route = text ? BOT_TEXT_ROUTES[normBtn(text)] : null;
    if (route) return await botCommand(route, "", msg, env, c, admin);

    // Admin mijoz xabariga (yoki buyurtma xabariga) «Reply» qildi — javob mijozga
    if (admin && msg.reply_to_message) {
      const target = relayTarget(msg.reply_to_message);
      if (target) return await botAdminReply(msg, target, env);
    }
    if (admin) return await botAdminHint(uid, env);
    return await botRelayToAdmins(msg, env, c);
  } catch (error) {
    console.error("[bot] xabar ishlanmadi:", error);
    await sendMessage(env, uid, "⚠️ Vaqtinchalik xatolik — birozdan keyin qayta urinib ko'ring.");
  }
}

async function botCommand(cmd, arg, msg, env, c, admin) {
  const uid = String(msg.from.id);
  switch (cmd) {
    case "start":
      return botStart(msg, env, c, admin, arg);
    case "app":
    case "dokon":
    case "shop":
    case "savatcha":
      return botOpenApp(uid, env);
    case "menu":
    case "help":
    case "yordam":
      return botMenu(uid, env, admin);
    case "buyurtmalarim":
    case "buyurtma":
    case "orders":
    case "navbatlarim":
      return botOrders(uid, env, c);
    case "kafolat":
    case "kafolatim":
    case "warranty":
      return botWarranty(uid, env, c);
    case "aloqa":
    case "contact":
      return botContactInfo(uid, env);
    case "navbat":
      return botOpenApp(uid, env, "services", "🗓 Xizmat va qulay vaqtni tanlang — 3 qadamda navbat olasiz 👇");
    case "id":
      return sendMessage(
        env,
        uid,
        `🆔 Telegram ID: <code>${uid}</code>` + (admin ? "\n👑 Siz adminsiz." : "")
      );
    case "admin":
      return admin
        ? botAdmin(uid, env, c)
        : sendMessage(env, uid, `⛔ Bu bo'lim faqat adminlar uchun.\n🆔 ID: <code>${uid}</code>`);
    case "katalog":
    case "stories":
    case "adminlar":
    case "firebase":
    case "ai":
      if (admin) {
        return sendMessage(env, uid, "⚙ Bu amallar endi Mini App «Boshqaruv» panelida — bir bosishda 👇", {
          reply_markup: { inline_keyboard: [[{ text: "⚙ Boshqaruv paneli", web_app: { url: appUrl(env, "admin") } }]] },
        });
      }
      return botMenu(uid, env, false, "Bunday buyruq yo'q. Quyidagilardan birini tanlang 👇");
    case "later":
      await sendMessage(env, uid, "Mayli 🙂 Raqamni keyin ham ulashishingiz mumkin.", {
        reply_markup: { remove_keyboard: true },
      });
      return botMenu(uid, env, admin);
    default:
      return botMenu(uid, env, admin, "Bunday buyruq yo'q. Quyidagilardan birini tanlang 👇");
  }
}

function menuKeyboard(env, admin) {
  const rows = [
    [{ text: "🛍 Do'konni ochish", web_app: { url: appUrl(env) } }],
    [
      { text: "📦 Buyurtmalarim", callback_data: "m|orders" },
      { text: "🛡 Kafolatim", callback_data: "m|kafolat" },
    ],
    [
      { text: "🗓 Navbat olish", web_app: { url: appUrl(env, "services") } },
      { text: "☎ Aloqa", callback_data: "m|aloqa" },
    ],
  ];
  if (admin) rows.push([{ text: "⚙ Boshqaruv paneli", web_app: { url: appUrl(env, "admin") } }]);
  return { inline_keyboard: rows };
}

function contactKeyboard() {
  return {
    keyboard: [[{ text: "📱 Raqamni ulashish", request_contact: true }], [{ text: "Keyinroq" }]],
    resize_keyboard: true,
    one_time_keyboard: true,
    input_field_placeholder: "Raqamni ulashing",
  };
}

function botMenu(uid, env, admin, lead) {
  return sendMessage(env, uid, lead || "Quyidagilardan birini tanlang 👇", { reply_markup: menuKeyboard(env, admin) });
}

function botOpenApp(uid, env, page, lead) {
  const label = page === "services" ? "🗓 Xizmatni tanlash" : "🛍 Do'konni ochish";
  return sendMessage(env, uid, lead || "Do'kon bir bosishda ochiladi 👇", {
    reply_markup: { inline_keyboard: [[{ text: label, web_app: { url: appUrl(env, page) } }]] },
  });
}

/** Mijozni eslab qoladi: `users/{uid}/profile` (ism va telefon USTIDAN yozilmaydi). */
async function rememberUser(c, token, from) {
  const uid = String(from.id);
  const path = `${c.root}/users/${uid}/profile`;
  const existing = (await rtdbGet(c.dbUrl, path, token)) || {};
  const patch = {};
  const tgName = clean([from.first_name, from.last_name].filter(Boolean).join(" "), 120);
  if (!existing.uid) patch.uid = Number(uid);
  if (!existing.name && tgName) patch.name = tgName;
  const username = clean(from.username, 60);
  if (username && existing.username !== username) patch.username = username;
  if (!existing.source) patch.source = "bot";
  if (Object.keys(patch).length) {
    patch.updatedAt = { ".sv": "timestamp" };
    await rtdbPatch(c.dbUrl, path, patch, token).catch(() => {});
  }
  return { ...existing, ...patch };
}

async function botStart(msg, env, c, admin, payload) {
  const uid = String(msg.from.id);
  let profile = {};
  try {
    profile = await rememberUser(c, await accessToken(env), msg.from);
  } catch (_) {}
  const b = botConf(env);
  const first = escHtml(String(msg.from.first_name || profile.name || "").split(" ")[0] || "do'stim");
  await sendMessage(
    env,
    uid,
    `👋 Assalomu alaykum, <b>${first}</b>!\n\n` +
      `<b>${escHtml(b.name)}</b> — avtotuning: Bi-LED linzalar, lampalar, aksessuarlar va professional o'rnatish.\n\n` +
      "🛍 Do'konni oching — tanlang va buyurtma bering.\n" +
      "🔔 Buyurtma holati va 🛡 kafolat muddati shu chatga keladi.",
    { reply_markup: menuKeyboard(env, admin) }
  );
  if (!profile.phone) {
    await sendMessage(
      env,
      uid,
      "📱 Raqamingizni ulashing — buyurtma va kafolat shu raqamga bog'lanadi (bir marta).",
      { reply_markup: contactKeyboard() }
    );
  }
  const p = String(payload || "").toLowerCase();
  if (p === "kafolat" || p === "warranty") return botWarranty(uid, env, c);
  if (p === "orders" || p === "buyurtmalarim") return botOrders(uid, env, c);
}

async function botContact(msg, env, c) {
  const uid = String(msg.from.id);
  const ct = msg.contact;
  if (!ct || (ct.user_id && String(ct.user_id) !== uid)) {
    return sendMessage(env, uid, "Iltimos, o'zingizning raqamingizni «📱 Raqamni ulashish» tugmasi orqali yuboring.");
  }
  const digits = String(ct.phone_number || "").replace(/\D/g, "");
  const phone = normalizePhone(digits) || (digits ? "+" + digits.slice(0, 15) : null);
  if (!phone) return sendMessage(env, uid, "Raqam o'qilmadi — qayta urinib ko'ring.");
  const token = await accessToken(env);
  const path = `${c.root}/users/${uid}/profile`;
  const existing = (await rtdbGet(c.dbUrl, path, token)) || {};
  const name =
    existing.name ||
    clean([ct.first_name || msg.from.first_name, ct.last_name || msg.from.last_name].filter(Boolean).join(" "), 120) ||
    "Mijoz";
  const res = await rtdbPatch(
    c.dbUrl,
    path,
    {
      uid: Number(uid),
      name,
      phone,
      username: clean(msg.from.username, 60) || existing.username || "",
      source: existing.source || "bot",
      updatedAt: { ".sv": "timestamp" },
    },
    token
  );
  if (!res.ok) return sendMessage(env, uid, "⚠️ Raqam saqlanmadi — birozdan keyin qayta urinib ko'ring.");
  await sendMessage(env, uid, `✅ Rahmat! Raqamingiz saqlandi: <code>${escHtml(phone)}</code>`, {
    reply_markup: { remove_keyboard: true },
  });
  if (!existing.phone) {
    await sendToAdmins(
      env,
      c,
      `👤 <b>Yangi mijoz</b>\n${userLink(uid, name, msg.from.username)}\n📞 ${escHtml(phone)}\n👤 Mijoz ID: <code>${uid}</code>`
    );
  }
  return botMenu(uid, env, c.admins.includes(uid));
}

function botContactInfo(uid, env) {
  const b = botConf(env);
  const lines = ["☎ <b>Biz bilan aloqa</b>", ""];
  if (b.phone) lines.push(`📞 ${escHtml(b.phone)}`);
  if (b.telegram) lines.push(`✈️ @${escHtml(b.telegram)}`);
  lines.push(`📍 ${escHtml(b.city)}`, "", "💬 Savolingizni shu chatga yozing — admin shu yerda javob beradi.");
  const kb = b.telegram ? { inline_keyboard: [[{ text: "✈️ Telegramda yozish", url: `https://t.me/${b.telegram}` }]] } : undefined;
  return sendMessage(env, uid, lines.join("\n"), kb ? { reply_markup: kb } : undefined);
}

function trimText(text, max) {
  const s = String(text || "");
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

async function botOrders(uid, env, c) {
  const data = await customerData(c, await accessToken(env), uid);
  const lines = [];
  for (const o of data.orders.slice(0, 5)) {
    const names = o.items.map((i) => i.name).filter(Boolean).join(", ");
    lines.push(
      `📦 <b>${escHtml(o.code)}</b> · ${escHtml(statusName("order", o.status))}\n` +
        `<i>${escHtml(trimText(names, 70) || "Tovarlar")} — ${fmtPrice(o.total)}</i>`
    );
  }
  for (const b of data.biled.slice(0, 3)) {
    lines.push(
      `🔥 <b>${escHtml(b.code)}</b> · ${escHtml(statusName("biled", b.status))}\n` +
        `<i>${escHtml(b.car_name || "Mashina")} — ${escHtml(b.biled_name || "Bi-LED")}</i>`
    );
  }
  for (const k of data.bookings.slice(0, 3)) {
    lines.push(
      `🗓 <b>${escHtml(k.service_name)}</b> · ${escHtml(statusName("booking", k.status))}\n` +
        `<i>${fmtDayIso(k.date)} · ${escHtml(k.time)}</i>`
    );
  }
  const text = lines.length
    ? "🧾 <b>Buyurtmalaringiz</b>\n\n" + lines.join("\n\n")
    : "📭 Hozircha buyurtma yo'q.\n\nDo'kondan tanlab, birinchi buyurtmangizni bering 🛍";
  return sendMessage(env, uid, text, {
    reply_markup: {
      inline_keyboard: [[
        lines.length
          ? { text: "📦 Batafsil — ilovada", web_app: { url: appUrl(env, "orders") } }
          : { text: "🛍 Do'konni ochish", web_app: { url: appUrl(env) } },
      ]],
    },
  });
}

/** Qolgan vaqt — inson tilida: «364 kun 5 soat» / «3 soat 12 daqiqa». */
function leftText(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return d > 0 ? `${d} kun ${h} soat` : `${h} soat ${m % 60} daqiqa`;
}

async function botWarranty(uid, env, c) {
  const token = await accessToken(env);
  const list = await warrantiesFor(c, token, await customerData(c, token, uid));
  const now = Date.now();
  const out = ["🛡 <b>Tovar kafolati</b>"];
  const act = list.filter((w) => w.state === "active");
  const pen = list.filter((w) => w.state === "pending");
  const exp = list.filter((w) => w.state === "expired");
  if (!list.length) {
    out.push(
      "",
      "Hozircha kafolatli tovar yo'q.",
      "Bi-LED linza xarid qilsangiz yoki o'rnattirsangiz — 1 yillik kafolat shu yerda soniyalab sanala boshlaydi."
    );
  }
  act.forEach((w) =>
    out.push(
      "",
      `✅ <b>${escHtml(w.title)}</b>${w.qty > 1 ? " ×" + w.qty : ""}`,
      `⏳ Qoldi: <b>${leftText(w.end - now)}</b>`,
      `📅 ${fmtDate(w.start)} → ${fmtDate(w.end)} · ${escHtml(w.period)}`,
      `🔖 <code>${escHtml(w.id)}</code>`
    )
  );
  pen.forEach((w) =>
    out.push("", `⏳ <b>${escHtml(w.title)}</b> — kutilmoqda`, `<i>Topshirilgach ${escHtml(w.period)}lik kafolat boshlanadi.</i>`)
  );
  if (exp.length) out.push("", "⌛ Muddati tugagan: " + exp.map((w) => escHtml(w.title)).join(", "));
  return sendMessage(env, uid, out.join("\n"), {
    reply_markup: { inline_keyboard: [[{ text: "🛡 Kafolatni ochish", web_app: { url: appUrl(env, "kafolat") } }]] },
  });
}

/** Admin uchun qisqa holat: nechta yangi yozuv kutib turibdi. */
async function botAdmin(uid, env, c) {
  const token = await accessToken(env);
  const fresh = async (node, child, kind) => {
    try {
      const res = await fetch(
        `${c.dbUrl}/${c.root}/${node}.json?orderBy=${encodeURIComponent(JSON.stringify(child))}&limitToLast=100`,
        { headers: authHeaders(token) }
      );
      if (!res.ok) return "—";
      return entriesOf(await res.json()).filter(([, r]) => normKindStatus(kind, r.status) === "new").length;
    } catch (_) {
      return "—";
    }
  };
  const [o, b, k] = await Promise.all([
    fresh("pending_orders", "createdAt", "order"),
    fresh("biled_orders", "createdAt", "biled"),
    fresh("bookings", "$key", "booking"),
  ]);
  return sendMessage(
    env,
    uid,
    "⚙ <b>Boshqaruv</b>\n\n" +
      `🆕 Yangi buyurtma: <b>${o}</b>\n🔥 Yangi Bi-LED: <b>${b}</b>\n🗓 Kutilayotgan navbat: <b>${k}</b>\n\n` +
      "• Har yangi buyurtma shu chatga <b>holat tugmalari</b> bilan keladi.\n" +
      "• «🎉 Yetkazildi» / «✨ Topshirildi» bosilsa — mijozning 🛡 kafolati boshlanadi.\n" +
      "• Mijoz xabariga «Reply» qilsangiz — javob to'g'ridan mijozga boradi.",
    { reply_markup: { inline_keyboard: [[{ text: "⚙ Boshqaruv paneli", web_app: { url: appUrl(env, "admin") } }]] } }
  );
}

/* --------------------------------------------- mijoz ↔ admin yozishmasi */
const _relayHits = new Map();
const _ackAt = new Map();

function capMap(map, max) {
  if (map.size > max) map.clear();
}

/** Admin javob berayotgan xabardan mijoz ID'sini topadi. */
function relayTarget(reply) {
  const text = String((reply && (reply.text || reply.caption)) || "");
  const m = /Mijoz ID:\s*(\d{5,20})/.exec(text);
  return m ? m[1] : null;
}

async function botRelayToAdmins(msg, env, c) {
  const uid = String(msg.from.id);
  if (!c.admins.length) return botMenu(uid, env, false, "Quyidagilardan birini tanlang 👇");

  // Spamdan himoya: 10 daqiqada ko'pi bilan 15 ta xabar adminga o'tadi
  const now = Date.now();
  const hit = _relayHits.get(uid) || { n: 0, t: now };
  if (now - hit.t > 10 * 60 * 1000) {
    hit.n = 0;
    hit.t = now;
  }
  hit.n++;
  capMap(_relayHits, 5000);
  _relayHits.set(uid, hit);
  if (hit.n > 15) return;

  const head =
    "💬 <b>Mijozdan xabar</b>\n" +
    `👤 ${userLink(uid, [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" "), msg.from.username)}` +
    (msg.from.username ? ` (@${escHtml(msg.from.username)})` : "") +
    `\n👤 Mijoz ID: <code>${uid}</code>`;
  const foot = "\n\n<i>↩️ Javob berish uchun shu xabarga «Reply» qiling.</i>";

  let delivered = false;
  if (typeof msg.text === "string") {
    delivered = await sendToAdmins(env, c, head + `\n\n<blockquote>${escHtml(msg.text.slice(0, 3500))}</blockquote>` + foot);
  } else {
    // Rasm, video, ovoz... — asl xabar nusxasi, sarlavha bilan
    const cap = head + (msg.caption ? `\n\n<blockquote>${escHtml(msg.caption.slice(0, 700))}</blockquote>` : "") + foot;
    for (const id of c.admins) {
      const r = await tgCall(env, "copyMessage", {
        chat_id: Number(id),
        from_chat_id: msg.chat.id,
        message_id: msg.message_id,
        caption: cap,
        parse_mode: "HTML",
      });
      if (r.ok) {
        delivered = true;
        continue;
      }
      // Stiker/dumaloq video izoh olmaydi — avval sarlavha, keyin nusxa
      const h = await sendMessage(env, id, head + foot);
      const r2 = await tgCall(env, "copyMessage", { chat_id: Number(id), from_chat_id: msg.chat.id, message_id: msg.message_id });
      delivered = delivered || h || !!r2.ok;
    }
  }

  // Mijozga tasdiq — 10 daqiqada bir marta (har xabarga emas)
  if (!(Number(_ackAt.get(uid)) > now - 10 * 60 * 1000)) {
    capMap(_ackAt, 5000);
    _ackAt.set(uid, now);
    await sendMessage(
      env,
      uid,
      delivered
        ? "✅ Xabaringiz adminga yetkazildi. Javob shu chatga keladi."
        : "Xabar yetkazilmadi — iltimos, birozdan keyin qayta yozing.",
      { reply_markup: menuKeyboard(env, false) }
    );
  }
}

async function botAdminReply(msg, target, env) {
  const name = botConf(env).name;
  let ok;
  if (typeof msg.text === "string") {
    ok = await sendMessage(env, target, `💬 <b>${escHtml(name)}</b>\n\n${escHtml(msg.text.slice(0, 3800))}`);
  } else {
    ok = !!(await tgCall(env, "copyMessage", { chat_id: Number(target), from_chat_id: msg.chat.id, message_id: msg.message_id })).ok;
  }
  return sendMessage(env, msg.from.id, ok ? "✅ Javob mijozga yuborildi." : "❌ Yuborilmadi — mijoz botni bloklagan bo'lishi mumkin.", {
    reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true },
  });
}

async function botAdminHint(uid, env) {
  const key = "a:" + uid;
  const now = Date.now();
  if (Number(_ackAt.get(key)) > now - 5 * 60 * 1000) return;
  _ackAt.set(key, now);
  return sendMessage(
    env,
    uid,
    "ℹ️ Mijozga javob berish uchun uning xabariga (yoki buyurtma xabariga) «Reply» qiling.\n⚙ Holat: /admin"
  );
}

/* ---------------------------------------------------------- tugmalar */
const STATUS_NAME = {
  order: { new: "🆕 Yangi", accepted: "✅ Qabul qilindi", delivering: "🚚 Yo'lda", delivered: "🎉 Yetkazildi", cancelled: "❌ Bekor qilingan" },
  biled: { new: "🆕 Yangi", accepted: "✅ Qabul qilindi", in_work: "🔧 Ishda", done: "✨ Topshirildi", cancelled: "❌ Bekor qilingan" },
  booking: { new: "⏳ Kutilmoqda", confirmed: "✅ Tasdiqlangan", done: "✔️ Bajarilgan", cancelled: "❌ Bekor qilingan" },
};
const STATUS_BTN = {
  order: { accepted: "✅ Qabul qilish", delivering: "🚚 Yo'lga chiqdi", delivered: "🎉 Yetkazildi", cancelled: "❌ Bekor" },
  biled: { accepted: "✅ Qabul qilish", in_work: "🔧 Ish boshlandi", done: "✨ Topshirildi", cancelled: "❌ Bekor" },
  booking: { confirmed: "✅ Tasdiqlash", done: "✔️ Bajarildi", cancelled: "❌ Bekor" },
};
const KIND_CODE = { o: "order", b: "biled", k: "booking" };
const KIND_LETTER = { order: "o", biled: "b", booking: "k" };
const ST_CODE = { a: "accepted", d: "delivering", v: "delivered", w: "in_work", n: "done", c: "confirmed", x: "cancelled" };
const ST_LETTER = Object.fromEntries(Object.entries(ST_CODE).map(([k, v]) => [v, k]));

function statusName(kind, status) {
  return (STATUS_NAME[kind] || {})[status] || String(status || "");
}

/** Admin xabari ostidagi tugmalar: joriy holat + keyingi qadamlar.
 *  callback_data: `s|<tur>|<manba>|<kalit>|<holat>` (≤ 64 bayt). */
function statusKeyboard(kind, key, source, status) {
  const rows = [[{ text: "Holat: " + statusName(kind, status), callback_data: "noop" }]];
  const next = (ALLOWED_STATUS_TRANSITIONS[kind] || {})[status] || [];
  const src = source === "db" ? "d" : "p";
  const btns = next.map((st) => ({
    text: (STATUS_BTN[kind] || {})[st] || st,
    callback_data: `s|${KIND_LETTER[kind]}|${src}|${key}|${ST_LETTER[st]}`,
  }));
  if (!btns.length || btns.some((b) => new TextEncoder().encode(b.callback_data).length > 64)) {
    return { inline_keyboard: rows };
  }
  rows.push(btns);
  return { inline_keyboard: rows };
}

/** Yangi format va eski Python bot tugmalari (`adm:ordst:12:accepted`). */
function parseStatusCallback(data) {
  let m = /^s\|([obk])\|([dp])\|([A-Za-z0-9_-]{1,80})\|([adwvncx])$/.exec(data);
  if (m) return { kind: KIND_CODE[m[1]], source: m[2] === "d" ? "db" : "pending", key: m[3], status: ST_CODE[m[4]] };
  m = /^adm:(ordst|bilst|bkst):(\d{1,12}):([a-z_]{3,12})$/.exec(data);
  if (m) {
    const kind = m[1] === "ordst" ? "order" : m[1] === "bilst" ? "biled" : "booking";
    return { kind, source: kind === "order" ? "db" : "pending", key: m[2], status: m[3] };
  }
  return null;
}

async function botCallback(cq, env) {
  const data = String(cq.data || "");
  const uid = String((cq.from && cq.from.id) || "");
  const c = cfg(env);
  const admin = c.admins.includes(uid);
  const answer = (text, alert) =>
    tgCall(env, "answerCallbackQuery", {
      callback_query_id: cq.id,
      text: text ? String(text).slice(0, 190) : undefined,
      show_alert: !!alert,
    });

  try {
    if (data === "noop") return await answer();
    if (data.startsWith("m|")) {
      await answer();
      if (!admin && (await isBlockedUid(uid, env))) return;
      const what = data.slice(2);
      if (what === "orders") return await botOrders(uid, env, c);
      if (what === "kafolat") return await botWarranty(uid, env, c);
      if (what === "aloqa") return await botContactInfo(uid, env);
      return await botMenu(uid, env, admin);
    }

    const parsed = parseStatusCallback(data);
    if (!parsed) return await answer("Bu tugma eskirgan — /start ni bosing");
    if (!admin) return await answer("⛔ Faqat admin uchun", true);

    const res = await applyStatusChange(env, c, await accessToken(env), { ...parsed, by: uid });
    const msg = cq.message;
    if (res.error) {
      // Boshqa admin allaqachon o'zgartirgan bo'lsa — tugmalarni haqiqiy holatga keltiramiz
      if (res.error.current && msg) {
        await tgCall(env, "editMessageReplyMarkup", {
          chat_id: msg.chat.id,
          message_id: msg.message_id,
          reply_markup: statusKeyboard(parsed.kind, parsed.key, parsed.source, res.error.current),
        });
      }
      return await answer(res.error.message || "Bajarilmadi", true);
    }
    if (msg) {
      await tgCall(env, "editMessageReplyMarkup", {
        chat_id: msg.chat.id,
        message_id: msg.message_id,
        reply_markup: statusKeyboard(parsed.kind, parsed.key, parsed.source, res.status),
      });
    }
    const warrantyNote = isWarrantyStart(parsed.kind, res.status) ? " · 🛡 kafolat boshlandi" : "";
    return await answer(res.repeated ? "Holat allaqachon shu" : statusName(parsed.kind, res.status) + warrantyNote);
  } catch (error) {
    console.error("[bot] tugma:", error);
    return answer("⚠️ Xatolik — qayta urinib ko'ring", true);
  }
}

// =====================================================================
//  MIJOZ MA'LUMOTLARI — /me va bot uchun BITTA manba
//
//  Do'kon buyurtmalari ikki nusxada bo'lishi mumkin: Worker yozuvi
//  (`pending_orders`) va eski botning SQLite nusxasi (`orders/{id}`).
//  Ular `sqlite_id` orqali birlashtiriladi, holat esa eng ilg'ori olinadi.
// =====================================================================
async function queryByChild(c, token, node, child, value, limit) {
  const eq = typeof value === "number" ? String(value) : JSON.stringify(String(value));
  const url =
    `${c.dbUrl}/${c.root}/${node}.json?orderBy=${encodeURIComponent(JSON.stringify(child))}` +
    `&equalTo=${encodeURIComponent(eq)}` +
    (limit ? `&limitToLast=${limit}` : "");
  const res = await fetch(url, { headers: authHeaders(token) });
  if (!res.ok) {
    const error = new Error(`${node} so'rovi: ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

let _dbOrdersCache = { at: 0, rows: null };

/** Mijozning eski (SQLite nusxasidagi) buyurtmalari. `orders` da uid indeksi
 *  bo'lmasa — oxirgi 300 tasi o'qilib, xotirada saralanadi (60 s kesh). */
async function userDbOrders(c, token, uid) {
  try {
    return entriesOf(await queryByChild(c, token, "orders", "uid", Number(uid), 50));
  } catch (error) {
    if (!error || error.status !== 400) throw error;
  }
  if (!_dbOrdersCache.rows || Date.now() - _dbOrdersCache.at > 60 * 1000) {
    const res = await fetch(
      `${c.dbUrl}/${c.root}/orders.json?orderBy=${encodeURIComponent('"$key"')}&limitToLast=300`,
      { headers: authHeaders(token) }
    );
    if (!res.ok) return [];
    _dbOrdersCache = { at: Date.now(), rows: entriesOf(await res.json()) };
  }
  return _dbOrdersCache.rows.filter(([, r]) => Number(r.uid) === Number(uid));
}

async function customerData(c, token, uid) {
  const n = Number(uid);
  const [pendingNode, biledNode, bookingNode, dbRows] = await Promise.all([
    queryByChild(c, token, "pending_orders", "uid", n, 50).catch(() => null),
    queryByChild(c, token, "biled_orders", "uid", n, 30).catch(() => null),
    queryByChild(c, token, "bookings", "uid", n, 30).catch(() => null),
    userDbOrders(c, token, n).catch(() => []),
  ]);

  const dbById = new Map();
  for (const [k, r] of dbRows) dbById.set(String(r.id != null ? r.id : k), [k, r]);

  const orders = [];
  for (const [key, row] of entriesOf(pendingNode)) {
    if (row.status === "processing" || row.status === "failed") continue;
    const twin = row.sqlite_id ? dbById.get(String(row.sqlite_id)) : null;
    if (twin) dbById.delete(String(row.sqlite_id));
    orders.push(customerOrderView(key, "pending", row, twin ? twin[1] : null));
  }
  for (const [key, row] of dbById.values()) orders.push(customerOrderView(key, "db", row, null));
  orders.sort((a, b) => b.createdAt - a.createdAt);

  const live = ([, r]) => r.status !== "processing" && r.status !== "failed";
  const biled = entriesOf(biledNode).filter(live).map(([k, r]) => customerBiledView(k, r));
  biled.sort((a, b) => b.createdAt - a.createdAt);
  const bookings = entriesOf(bookingNode).filter(live).map(([k, r]) => customerBookingView(k, r));
  bookings.sort((a, b) => b.createdAt - a.createdAt);

  return { orders, biled, bookings };
}

function customerOrderView(key, source, row, twin) {
  const t = twin || {};
  const total = Number(row.total || t.total || 0);
  const id = row.id != null ? row.id : key;
  const rawItems = row.items && typeof row.items === "object" && Object.keys(row.items).length ? row.items : t.items;
  return {
    key: String(key),
    source,
    code: row.code || (source === "db" ? "#" + id : String(key)),
    sqlite_id: row.sqlite_id || (source === "db" ? id : null),
    total,
    total_label: fmtPrice(total),
    status: mergedOrderStatus(row.status, twin ? t.status : null),
    status_at: Number(row.status_at || t.status_at || 0) || null,
    warranty_from: Number(row.warranty_from || t.warranty_from || 0) || null,
    address: row.address || t.address || "",
    delivery_info: row.delivery_info || row.deliveryInfo || t.deliveryInfo || "",
    payment_method: row.payment_method || row.paymentMethod || t.paymentMethod || "",
    items: itemsOf(rawItems),
    createdAt: Number(row.createdAt || t.createdAt || 0) || 0,
  };
}

function customerBiledView(key, row) {
  const total = Number(row.total || 0);
  const parts = biledParts(row);
  return {
    key: String(key),
    id: row.id != null ? row.id : String(key),
    code: biledCode(key, row),
    car_name: row.car_name || row.car || "",
    biled_name: row.biled_name || row.biled || "",
    biled_id: row.biled_id != null ? row.biled_id : null,
    shroud_name: row.shroud_name || row.shroud || "",
    color_name: row.color_name || row.color || "",
    glass: !!row.glass,
    housing: !!row.housing,
    warranty: row.warranty || null,
    summary: parts.join(" · "),
    comment: row.comment || "",
    total,
    total_label: fmtPrice(total),
    status: normKindStatus("biled", row.status),
    status_at: Number(row.status_at || 0) || null,
    warranty_from: Number(row.warranty_from || 0) || null,
    createdAt: Number(row.createdAt || 0) || 0,
  };
}

function customerBookingView(key, row) {
  const status = normKindStatus("booking", row.status);
  return {
    key: String(key),
    id: String(key),
    service_name: row.service_name || row.service || "Xizmat",
    date: row.date || "",
    time: row.time || "",
    price: Number(row.price || 0) || 0,
    car_name: row.car_name || "",
    details: row.details || "",
    deposit_amount: Number(row.deposit_amount || 0) || 0,
    deposit_status: row.deposit_status || "",
    warranty: row.warranty || null,
    warranty_from: Number(row.warranty_from || 0) || null,
    status_at: Number(row.status_at || 0) || null,
    status,
    createdAt: Number(row.createdAt || 0) || 0,
    can_cancel: (status === "new" || status === "confirmed") && !!row.date && row.date >= tashkentToday(),
  };
}

/** POST /booking-cancel — mijoz O'Z navbatini bekor qiladi (Render'siz). */
async function handleBookingCancel(request, env) {
  const c = cfg(env);
  if (!c.dbUrl) return json({ ok: false, error: "FIREBASE_DB_URL sozlanmagan" }, 500);
  const body = await readJson(request);
  const verified = await verifyInitData(body.initData, env);
  if (!verified.ok) return json({ ok: false, error: verified.error, blocked: !!verified.blocked }, verified.status || 401);
  const uid = String(verified.user.id);
  const key = clean(body.key, 120);
  if (!key || !/^[A-Za-z0-9_-]+$/.test(key)) {
    return json({ ok: false, error: "bad_key", message: "Navbat raqami noto'g'ri" }, 400);
  }
  const token = await accessToken(env);
  const row = await rtdbGet(c.dbUrl, `${c.root}/bookings/${key}`, token);
  // Faqat O'Z navbati — uid imzodan olinadi, mijoz yuborgan qiymatga ishonilmaydi
  if (!row || String(row.uid) !== uid) return json({ ok: false, error: "not_found", message: "Navbat topilmadi" }, 404);
  const view = customerBookingView(key, row);
  if (!view.can_cancel) {
    return json({ ok: false, error: "not_cancellable", message: "Bu navbatni endi bekor qilib bo'lmaydi" }, 409);
  }
  const out = await cancelBookingAtomic(c, token, key, Number(uid));
  if (out.error) {
    const { http, ...rest } = out.error;
    return json({ ok: false, ...rest, error: rest.code }, http || 409);
  }
  if (!out.repeated) {
    await sendToAdmins(
      env,
      c,
      "❌ <b>Mijoz navbatni bekor qildi</b>\n\n" +
        `🔧 ${escHtml(view.service_name)}\n📅 ${fmtDayIso(view.date)} · ${escHtml(view.time)}\n` +
        `👤 ${userLink(uid, row.name || verified.user.first_name, verified.user.username)}\n📞 ${escHtml(row.phone || "")}`
    ).catch(() => {});
  }
  return json({ ok: true, repeated: !!out.repeated });
}

// =====================================================================
//  🛡 KAFOLAT — qachon boshlanadi va qancha davom etadi
//
//  • Bi-LED linza (do'kon tovari, turkumi «BI-led...») va Bi-LED O'RNATISH
//    buyurtmasi — 1 YIL (yoki admin tovarga yozgan muddat: «6 oy», «2 yil»).
//  • Boshqa tovar — faqat admin kafolat yozgan bo'lsa (masalan «1 yil»).
//  • Hisob tovar MIJOZGA TOPSHIRILGAN lahzadan boshlanadi:
//      do'kon buyurtmasi → «Yetkazildi», Bi-LED o'rnatish → «Topshirildi».
//    Shu lahza `warranty_from` ga yoziladi va boshqa o'zgarmaydi.
//    Undan oldin kafolat «kutilmoqda» bo'lib turadi.
//  • Bekor qilingan buyurtma kafolat bermaydi.
//
//  Shu mantiq `docs/js/app.js` da (`wrBuild`) AYNAN takrorlangan — eski
//  Worker turgan paytda ham Mini App kafolatni ko'rsata olsin.
// =====================================================================
const WARRANTY_BILED_MONTHS = 12;

/** «1 yil», «12 oy», «6 oylik», «14 kun», «2 hafta» → {months} yoki {days}. */
function wParse(text) {
  const s = String(text || "").toLowerCase().replace(",", ".").trim();
  if (!s) return null;
  const num = (re) => {
    const m = re.exec(s);
    return m ? parseFloat(m[1]) : null;
  };
  let n = num(/(\d+(?:\.\d+)?)\s*-?\s*(?:yil|year|йил|год|лет)/);
  if (n != null && n > 0) return { months: Math.round(n * 12) };
  n = num(/(\d+(?:\.\d+)?)\s*-?\s*(?:oy|month|ой|мес)/);
  if (n != null && n > 0) return { months: Math.round(n) };
  n = num(/(\d+)\s*-?\s*(?:hafta|week|ҳафта|недел)/);
  if (n != null && n > 0) return { days: n * 7 };
  n = num(/(\d+)\s*-?\s*(?:kun|day|кун|дн|ден)/);
  if (n != null && n > 0) return { days: n };
  if (/bir\s*yil/.test(s)) return { months: 12 };
  if (/yarim\s*yil/.test(s)) return { months: 6 };
  if (/^\d{1,2}$/.test(s) && Number(s) > 0) return { months: Number(s) };
  return null;
}

/** Bi-LED linzami? Avval turkum, turkum yo'q bo'lsa — nom (maska/lenta emas). */
function wIsBiled(name, cat) {
  const c = String(cat || "").toLowerCase();
  if (c) return /bi[\s-]?led|bi[\s-]?lens|linza|линз/.test(c);
  const n = String(name || "").toLowerCase();
  if (/mas+ka|mask|ochki|lenta|germet|rgb|chexol|lampa|лампа/.test(n)) return false;
  return /bi[\s-]?led|bi[\s-]?lens|linza|линз/.test(n);
}

function wAddPeriod(start, p) {
  if (p.months) {
    const d = new Date(start);
    const day = d.getUTCDate();
    d.setUTCMonth(d.getUTCMonth() + p.months);
    if (d.getUTCDate() < day) d.setUTCDate(0); // 31-yanvar + 1 oy → 28/29-fevral
    return d.getTime();
  }
  return start + (p.days || 0) * 86400000;
}

function wLabel(p) {
  if (p.months) return p.months % 12 === 0 ? `${p.months / 12} yil` : `${p.months} oy`;
  return p.days >= 7 && p.days % 7 === 0 ? `${p.days / 7} hafta` : `${p.days} kun`;
}

function productCategoryName(product, categories) {
  if (!product) return "";
  if (product.categoryName) return String(product.categoryName);
  if (product.category) return String(product.category);
  if (product.category_id != null && categories && typeof categories === "object") {
    const cat = catalogRowById(categories, product.category_id);
    if (cat && cat.name) return String(cat.name);
  }
  return "";
}

function wStartOf(o) {
  return Number(o.warranty_from) || Number(o.status_at) || Number(o.createdAt) || null;
}

function wRecord(x, now) {
  const start = x.start ? Number(x.start) : null;
  const end = start ? wAddPeriod(start, x.period) : null;
  return {
    id: x.id,
    kind: x.kind,
    title: x.title,
    sub: x.sub,
    qty: x.qty,
    size: x.size,
    months: x.period.months || 0,
    days: x.period.days || 0,
    period: wLabel(x.period),
    start,
    end,
    created: x.created || 0,
    state: !start ? "pending" : end > now ? "active" : "expired",
    order_code: x.order_code,
    order_kind: x.order_kind,
    order_status: x.order_status,
  };
}

function buildWarranties(input) {
  const now = Number(input.now) || Date.now();
  const out = [];
  for (const o of input.orders || []) {
    const st = normStatus(o.status);
    if (st === "cancelled") continue;
    (Array.isArray(o.items) ? o.items : []).forEach((it, idx) => {
      const p = it.product_id != null ? catalogRowById(input.products, it.product_id) : null;
      const name = clean(it.name || (p && p.name) || "Tovar", 120);
      const cat = it.cat || productCategoryName(p, input.categories);
      const biled = wIsBiled(name, cat);
      const period = wParse(it.warranty || (p && p.warranty)) || (biled ? { months: WARRANTY_BILED_MONTHS } : null);
      if (!period) return;
      out.push(
        wRecord(
          {
            id: "KF-" + String(o.code || o.key || "").replace(/^ZM-/, "").replace(/^#/, "") + "-" + (idx + 1),
            kind: biled ? "biled" : "product",
            title: name,
            sub: biled ? "Bi-LED linza" : clean(cat, 60) || "Do'kon tovari",
            qty: Number(it.qty) || 1,
            size: it.size || null,
            period,
            start: st === "delivered" ? wStartOf(o) : null,
            created: Number(o.createdAt) || 0,
            order_code: o.code || "",
            order_kind: "order",
            order_status: st,
          },
          now
        )
      );
    });
  }
  for (const b of input.biled || []) {
    const st = normKindStatus("biled", b.status);
    if (st === "cancelled") continue;
    if (NO_WARRANTY_RE.test(String(b.warranty || ""))) continue; // admin «kafolatsiz» qo'ygan
    const t = b.biled_id != null ? catalogRowById(input.biledTypes, b.biled_id) : null;
    const period = wParse(b.warranty || (t && t.warranty)) || { months: WARRANTY_BILED_MONTHS };
    out.push(
      wRecord(
        {
          id: "KF-" + String(b.code || b.key || "").replace(/^#/, "").replace(/-/g, ""),
          kind: "install",
          title: b.biled_name ? clean(b.biled_name, 120) : "Bi-LED linza o'rnatish",
          sub: b.car_name ? "O'rnatish · " + clean(b.car_name, 60) : "Bi-LED o'rnatish",
          qty: 1,
          size: null,
          period,
          start: st === "done" ? wStartOf(b) : null,
          created: Number(b.createdAt) || 0,
          order_code: b.code || "",
          order_kind: "biled",
          order_status: st,
        },
        now
      )
    );
  }
  // 2.3.0 — xizmatlar (navbat): muddat admin/xizmatdan, «Bajarildi» dan boshlanadi
  for (const b of input.bookings || []) {
    const st = normKindStatus("booking", b.status);
    if (st === "cancelled") continue;
    const period = wParse(b.warranty);
    if (!period) continue;
    const code = "NV-" + String(b.key || b.id || "").slice(-6).toUpperCase();
    out.push(
      wRecord(
        {
          id: "KF-" + code.replace(/-/g, ""),
          kind: "service",
          title: clean(b.service_name || "Xizmat", 120),
          sub: [b.details ? clean(b.details, 80) : "", b.car_name ? clean(b.car_name, 60) : ""].filter(Boolean).join(" · ") || "Xizmat",
          qty: 1,
          size: null,
          period,
          start: st === "done" ? wStartOf(b) : null,
          created: Number(b.createdAt) || 0,
          order_code: code,
          order_kind: "booking",
          order_status: st,
        },
        now
      )
    );
  }
  // Tartib: faol (eng oz qolgani tepada) → kutilmoqda → muddati tugagan
  const rank = { active: 0, pending: 1, expired: 2 };
  out.sort(
    (a, b) =>
      rank[a.state] - rank[b.state] ||
      (a.state === "active" ? a.end - b.end : (b.start || b.created) - (a.start || a.created))
  );
  return out;
}

const _nodeCache = new Map();
/** Katalog tugunlari (ochiq ma'lumot) — 60 soniya keshlanadi. */
async function cachedNode(c, token, path) {
  const hit = _nodeCache.get(path);
  if (hit && Date.now() - hit.at < 60 * 1000) return hit.v;
  const v = await rtdbGet(c.dbUrl, `${c.root}/${path}`, token).catch(() => null);
  _nodeCache.set(path, { at: Date.now(), v });
  return v;
}

async function warrantiesFor(c, token, data) {
  const [products, categories, biledTypes] = await Promise.all([
    cachedNode(c, token, "catalog/products"),
    cachedNode(c, token, "catalog/categories"),
    cachedNode(c, token, "catalog/biled_types"),
  ]);
  return buildWarranties({
    orders: (data && data.orders) || [],
    biled: (data && data.biled) || [],
    bookings: (data && data.bookings) || [],
    products: products || {},
    categories: categories || {},
    biledTypes: biledTypes || {},
    now: Date.now(),
  });
}

/** Sana — Toshkent vaqti bilan: 24.10.2027 */
function fmtDate(ms) {
  if (!ms) return "—";
  const d = new Date(Number(ms) + 5 * 3600 * 1000);
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;
}

/** "2026-10-24" → "24.10.2026" */
function fmtDayIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : escHtml(String(iso || ""));
}
