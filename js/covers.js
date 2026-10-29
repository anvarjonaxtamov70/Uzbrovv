/* ==========================================================================
   UZBROVV — CHEXOL VIZUALI (rul va o'rindiq)

   Ikki SVG chizma — mijoz oynasi ham, admin paneli ham AYNAN shuni
   ishlatadi, ya'ni admin dizaynni qanday bo'yasa, mijoz ham shunday ko'radi.

     ZimmerCovers.wheel({color, thread, texture})  -> SVG matni
         Rul: chexol tikiladigan gardish (rim) material rangida va
         teksturasida, ichki va tashqi chok — ip rangida.
         texture: leather | perforated | alcantara | carbon | fabric

     ZimmerCovers.seat({zones, thread, pick})      -> SVG matni
         O'rindiq 20 qismga bo'lingan (SEAT_ZONES). `zones` = {z1: "#rrggbb"}.
         `pick` — admin muharririda tanlangan qism (ramka bilan ajraladi).
         Har qism `data-zone="zN"` — bosilganda qaysi qism ekani ma'lum.
   ========================================================================== */
window.ZimmerCovers = (function () {
  "use strict";

  const HEX = /^#[0-9a-f]{6}$/i;
  const safe = (v, d) => (HEX.test(String(v || "")) ? String(v) : d);
  let uid = 0;

  const TEXTURES = [
    ["leather", "Teri"],
    ["perforated", "Perforatsiyali teri"],
    ["alcantara", "Alkantara"],
    ["carbon", "Karbon"],
    ["fabric", "Mato"],
  ];

  /* --------------------------------------------------------------- RUL */
  function wheel(o) {
    const opt = o || {};
    const id = "zw" + ++uid;
    const color = safe(opt.color, "#2b2b2e");
    const thread = safe(opt.thread, "#d9d9d9");
    const tex = String(opt.texture || "leather");
    const pattern = {
      leather: `<pattern id="${id}p" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r=".7" fill="#000" opacity=".25"/><circle cx="5.5" cy="5" r=".55" fill="#fff" opacity=".08"/></pattern>`,
      perforated: `<pattern id="${id}p" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1.15" fill="#000" opacity=".55"/></pattern>`,
      alcantara: `<filter id="${id}n"><feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="2" seed="4"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .55 0"/></filter><pattern id="${id}p" width="400" height="400" patternUnits="userSpaceOnUse"><rect width="400" height="400" filter="url(#${id}n)"/></pattern>`,
      carbon: `<pattern id="${id}p" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="8" fill="#fff" opacity=".07"/><rect x="4" width="4" height="8" fill="#000" opacity=".25"/><rect y="4" width="8" height="1" fill="#000" opacity=".2"/></pattern>`,
      fabric: `<pattern id="${id}p" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M0 0L5 5M5 0L0 5" stroke="#000" stroke-width=".7" opacity=".28"/></pattern>`,
    }[tex] || "";
    const matte = tex === "alcantara" || tex === "fabric";
    return (
      '<svg class="cv-wheel" viewBox="0 0 400 400" role="img" aria-label="Rul chexoli ko\'rinishi">' +
      "<defs>" +
      `<radialGradient id="${id}hub" cx="45%" cy="38%" r="70%"><stop offset="0" stop-color="#3a3c42"/><stop offset=".6" stop-color="#1a1b1f"/><stop offset="1" stop-color="#0c0c0e"/></radialGradient>` +
      `<linearGradient id="${id}spk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#34363c"/><stop offset="1" stop-color="#141518"/></linearGradient>` +
      `<linearGradient id="${id}hi" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="${matte ? 0.22 : 0.45}"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></linearGradient>` +
      `<radialGradient id="${id}sh" cx="50%" cy="50%" r="50%"><stop offset=".78" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></radialGradient>` +
      pattern +
      "</defs>" +
      // soya
      '<ellipse cx="200" cy="372" rx="150" ry="14" fill="#000" opacity=".35"/>' +
      // spitsalar (pastda gardish ostida)
      `<path d="M58 214 C 100 200 140 196 168 206 L 168 236 C 140 240 100 246 62 250 Z" fill="url(#${id}spk)"/>` +
      `<path d="M342 214 C 300 200 260 196 232 206 L 232 236 C 260 240 300 246 338 250 Z" fill="url(#${id}spk)"/>` +
      `<path d="M178 252 L 222 252 L 236 346 L 164 346 Z" fill="url(#${id}spk)"/>` +
      // markaz (airbag)
      `<rect x="138" y="160" width="124" height="104" rx="38" fill="url(#${id}hub)" stroke="#000" stroke-opacity=".5"/>` +
      '<rect x="150" y="172" width="100" height="80" rx="30" fill="none" stroke="#fff" stroke-opacity=".06"/>' +
      '<text x="200" y="217" text-anchor="middle" font-family="-apple-system,Roboto,sans-serif" font-size="13" font-weight="800" letter-spacing="3" fill="#fff" fill-opacity=".55">UZBROVV</text>' +
      // GARDISH — chexol shu yerga tikiladi
      `<circle cx="200" cy="200" r="166" fill="none" stroke="${color}" stroke-width="40"/>` +
      (pattern ? `<circle cx="200" cy="200" r="166" fill="none" stroke="url(#${id}p)" stroke-width="40"/>` : "") +
      `<circle cx="200" cy="200" r="166" fill="none" stroke="url(#${id}hi)" stroke-width="40"/>` +
      `<circle cx="200" cy="200" r="166" fill="none" stroke="url(#${id}sh)" stroke-width="40"/>` +
      // choklar
      `<circle cx="200" cy="200" r="150" fill="none" stroke="${thread}" stroke-width="2.6" stroke-dasharray="7 5" stroke-linecap="round" opacity=".95"/>` +
      `<circle cx="200" cy="200" r="182" fill="none" stroke="${thread}" stroke-width="2.2" stroke-dasharray="7 5" stroke-linecap="round" opacity=".8"/>` +
      // tepadagi markaz belgisi (12 soat) — ip rangida
      `<rect x="194" y="14" width="12" height="40" rx="3" fill="${thread}" opacity=".9"/>` +
      "</svg>"
    );
  }

  /* ----------------------------------------------------------- O'RINDIQ
     Old ko'rinish (simmetrik). Qism tartibi admin muharriridagi ro'yxat
     bilan bir xil — `SEAT_ZONES[i].id`. */
  const SEAT_ZONES = [
    { id: "z1", name: "Bosh tayanch — chet", d: "M96 18 Q96 8 112 8 H188 Q204 8 204 18 V62 Q204 74 190 74 H110 Q96 74 96 62 Z" },
    { id: "z2", name: "Bosh tayanch — markaz", d: "M116 22 H184 Q190 22 190 28 V54 Q190 60 184 60 H116 Q110 60 110 54 V28 Q110 22 116 22 Z" },
    { id: "z3", name: "Suyanchiq — tepa", d: "M112 92 H188 L184 116 H116 Z" },
    { id: "z4", name: "Chap yelka", d: "M58 112 Q60 92 86 90 H112 L116 116 L98 120 L64 124 Z" },
    { id: "z5", name: "O'ng yelka", d: "M242 112 Q240 92 214 90 H188 L184 116 L202 120 L236 124 Z" },
    { id: "z6", name: "Suyanchiq — chap bolster", d: "M64 124 L98 120 L100 248 L70 252 Q62 200 64 124 Z" },
    { id: "z7", name: "Suyanchiq — o'ng bolster", d: "M236 124 L202 120 L200 248 L230 252 Q238 200 236 124 Z" },
    { id: "z8", name: "Markaz — yuqori", d: "M98 120 L116 116 H184 L202 120 V164 H98 Z" },
    { id: "z9", name: "Markaz — o'rta", d: "M98 164 H202 V208 H98 Z" },
    { id: "z10", name: "Markaz — pastki", d: "M98 208 H202 V240 H98 Z" },
    { id: "z11", name: "Bel qismi", d: "M70 252 L100 248 V240 H200 V248 L230 252 L228 270 H72 Z" },
    { id: "z12", name: "O'tirg'ich — chap bolster", d: "M72 282 L104 284 L94 372 L52 374 Q56 320 72 282 Z" },
    { id: "z13", name: "O'tirg'ich — o'ng bolster", d: "M228 282 L196 284 L206 372 L248 374 Q244 320 228 282 Z" },
    { id: "z14", name: "O'tirg'ich — markaz orqa", d: "M104 284 H196 L199 324 H101 Z" },
    { id: "z15", name: "O'tirg'ich — markaz old", d: "M101 324 H199 L206 372 H94 Z" },
    { id: "z16", name: "O'tirg'ich — old cheti", d: "M50 378 H250 Q252 398 236 402 H64 Q48 398 50 378 Z" },
    { id: "z17", name: "Suyanchiq — chap yon", d: "M64 124 Q50 128 48 150 L52 252 Q56 262 70 266 Q62 200 64 124 Z" },
    { id: "z18", name: "Suyanchiq — o'ng yon", d: "M236 124 Q250 128 252 150 L248 252 Q244 262 230 266 Q238 200 236 124 Z" },
    { id: "z19", name: "O'tirg'ich — chap yon", d: "M72 282 Q52 286 44 330 L40 370 Q42 378 52 374 Q56 320 72 282 Z" },
    { id: "z20", name: "O'tirg'ich — o'ng yon", d: "M228 282 Q248 286 256 330 L260 370 Q258 378 248 374 Q244 320 228 282 Z" },
  ];
  const CENTER = ["z2", "z8", "z9", "z10", "z14", "z15"];
  const DEFAULT_ZONE = "#1c1c1f";

  function seat(o) {
    const opt = o || {};
    const id = "zs" + ++uid;
    const zones = opt.zones || {};
    const thread = safe(opt.thread, "#c9c9c9");
    const pick = opt.pick || "";
    const paths = SEAT_ZONES.map(
      (z) =>
        `<path class="cv-z${pick === z.id ? " is-pick" : ""}" data-zone="${z.id}" d="${z.d}" fill="${safe(zones[z.id], DEFAULT_ZONE)}"><title>${z.name}</title></path>`
    ).join("");
    const perf = CENTER.map((zid) => {
      const z = SEAT_ZONES.find((x) => x.id === zid);
      return `<path d="${z.d}" fill="url(#${id}perf)" pointer-events="none"/>`;
    }).join("");
    // choklar: markaz va bolster chegaralari, gorizontal bo'linmalar
    const seams = [
      "M98 120 V248", "M202 120 V248", "M98 164 H202", "M98 208 H202",
      "M104 284 L94 372", "M196 284 L206 372", "M101 324 H199",
      "M116 22 H184", "M110 60 H190", "M116 116 H184", "M100 248 H200",
    ]
      .map((d) => `<path d="${d}" fill="none" stroke="${thread}" stroke-width="1.6" stroke-dasharray="4 3" stroke-linecap="round" pointer-events="none"/>`)
      .join("");
    return (
      '<svg class="cv-seat" viewBox="0 0 300 420" role="img" aria-label="O\'rindiq chexoli ko\'rinishi">' +
      "<defs>" +
      `<pattern id="${id}perf" width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="2.5" cy="2.5" r=".8" fill="#000" opacity=".35"/></pattern>` +
      `<linearGradient id="${id}lt" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".38"/></linearGradient>` +
      `<clipPath id="${id}clip">${SEAT_ZONES.map((z) => `<path d="${z.d}"/>`).join("")}</clipPath>` +
      "</defs>" +
      '<ellipse cx="150" cy="410" rx="120" ry="8" fill="#000" opacity=".4"/>' +
      // bosh tayanch ustunlari va o'rindiq ramkasi
      '<rect x="124" y="72" width="8" height="22" rx="3" fill="#8e939b"/><rect x="168" y="72" width="8" height="22" rx="3" fill="#8e939b"/>' +
      '<path d="M64 266 H236 L232 284 H68 Z" fill="#0d0d0f"/>' +
      paths +
      perf +
      `<rect x="0" y="0" width="300" height="420" fill="url(#${id}lt)" clip-path="url(#${id}clip)" pointer-events="none"/>` +
      seams +
      // qism chegaralari (yengil soya)
      SEAT_ZONES.map((z) => `<path d="${z.d}" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="1" pointer-events="none"/>`).join("") +
      (pick
        ? `<path d="${(SEAT_ZONES.find((z) => z.id === pick) || {}).d || ""}" fill="none" stroke="#fff" stroke-width="2.4" stroke-dasharray="5 3" pointer-events="none" class="cv-pick"/>`
        : "") +
      "</svg>"
    );
  }

  return { wheel: wheel, seat: seat, SEAT_ZONES: SEAT_ZONES, TEXTURES: TEXTURES, DEFAULT_ZONE: DEFAULT_ZONE };
})();
