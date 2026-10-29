/* ==========================================================================
   UZBROVV — CHEK KO'RUVCHI (iOS 26 «Rasmlar» uslubi)

   Zalog cheki ko'pincha SKRINSHOT: juda baland (1170×2532 kabi) va mayda
   yozuvli. Umumiy rasm ko'ruvchi bunday rasmni ekranga sig'dira olmay,
   tepasi va pasti kesilib qolardi. Bu ko'ruvchi faqat shu ish uchun:

     • ochilganda rasm HAR DOIM TO'LIQ ko'rinadi (hech narsa kesilmaydi);
     • «Kenglik» — rasm ekran kengligiga yoyiladi va tepadan boshlanadi
       (skrinshotdagi summa va sana o'qiladi), barmoq bilan pastga suriladi;
     • ikki marta bosish: butun ↔ kenglik (keng rasmda — bosilgan joyga 2.5×);
     • chimchilash 1× … 6×, barmoqlar orasidagi nuqta joyida qoladi;
     • kattalashtirilmaganda pastga surilsa yopiladi (fon xiralashib boradi);
     • kompyuterda: g'ildirak — kattalashtirish, Esc — yopish;
     • o'ngda ingichka ko'rsatkich — uzun rasmning qaysi qismi ko'rinayotgani;
     • pastda amallar (masalan «✅ Tasdiqlash») — chekni ko'rib, shu yerdan.

   Faqat `transform` va `opacity` o'zgaradi — telefon qizimaydi.

   API:
     ZimmerReceipt.open({ url, title, sub, actions:[{label, primary, danger, run}] })
     ZimmerReceipt.close()
     ZimmerReceipt.isOpen()
   ========================================================================== */
window.ZimmerReceipt = (function () {
  "use strict";

  const MAX = 6;
  let root = null;
  let img = null;
  let stage = null;
  let bar = null;
  let thumb = null;
  const st = {
    url: "",
    natW: 0,
    natH: 0,
    bw: 0, // «butun» holatdagi o'lcham (panellar orasiga sig'gan)
    bh: 0,
    W: 0, // ekran (sahna) o'lchami — sahna DOIM to'liq ekran
    H: 0,
    fitTop: 0, // tepadagi panel ostidan …
    fitBot: 0, // … pastdagi panel ustigacha — «butun» rasm shu oraliqda
    cy: 0, // rasm markazi (y) — «butun» holatda
    zoomBot: 0, // kattalashtirilganda rasm pasti shu yerda to'xtaydi (asboblar paneli ustida)
    zoomed: false,
    s: 1,
    x: 0,
    y: 0,
    ptrs: new Map(),
    pinch: null,
    pan: null,
    downAt: 0,
    lastTap: 0,
    lastTapX: 0,
    lastTapY: 0,
    moved: false,
    dismissY: 0,
    actions: [],
    onKey: null,
    onResize: null,
  };

  const esc = (v) =>
    String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const haptic = (k) => {
    try {
      const a = window.ZIMMER_APP;
      if (a && a.haptic) a.haptic(k);
    } catch (_) {}
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function build() {
    root = document.createElement("div");
    root.className = "rv hidden";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.innerHTML =
      '<div class="rv-amb" aria-hidden="true"></div>' +
      '<div class="rv-stage"><img class="rv-img" alt="" draggable="false"></div>' +
      '<div class="rv-load"><span class="rv-spin" aria-hidden="true"></span><b>Chek yuklanmoqda</b></div>' +
      '<div class="rv-err hidden"><b>Rasm ochilmadi</b><small>Internetni tekshirib qayta urinib ko\'ring</small>' +
      '<button type="button" class="rv-pill" data-rv="retry">Qayta urinish</button></div>' +
      '<i class="rv-scroll" aria-hidden="true"><em></em></i>' +
      '<header class="rv-top">' +
      '<button type="button" class="rv-ib" data-rv="close" aria-label="Yopish"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg></button>' +
      '<div class="rv-title"><b></b><small></small></div>' +
      '<button type="button" class="rv-ib" data-rv="orig" aria-label="Asl rasmni ochish"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4.5h5.5V10M19.5 4.5 11 13M10 6H6.5A2 2 0 0 0 4.5 8v9.5a2 2 0 0 0 2 2H16a2 2 0 0 0 2-2V14"/></svg></button>' +
      "</header>" +
      '<footer class="rv-bot">' +
      '<div class="rv-tools">' +
      '<div class="rv-seg" role="radiogroup" aria-label="Ko\'rinish">' +
      '<button type="button" role="radio" data-rv="fit">Butun</button>' +
      '<button type="button" role="radio" data-rv="width">Kenglik</button>' +
      "</div>" +
      '<span class="rv-zoom" aria-live="polite">100%</span>' +
      "</div>" +
      '<div class="rv-acts"></div>' +
      '<p class="rv-hint">Ikki marta bosing yoki chimchilang · pastga suring — yopiladi</p>' +
      "</footer>";
    document.body.appendChild(root);
    img = root.querySelector(".rv-img");
    stage = root.querySelector(".rv-stage");
    bar = root.querySelector(".rv-scroll");
    thumb = bar.querySelector("em");

    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-rv]");
      if (!b) return;
      const k = b.dataset.rv;
      if (k === "close") return close();
      if (k === "fit") return setMode("fit", true);
      if (k === "width") return setMode("width", true);
      if (k === "retry") return load(st.url);
      if (k === "orig") return openOriginal();
      if (k === "act") {
        const a = st.actions[Number(b.dataset.i)];
        if (a && a.run) {
          haptic("medium");
          close();
          setTimeout(() => a.run(), 220);
        }
      }
    });

    stage.addEventListener("pointerdown", onDown);
    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerup", onUp);
    stage.addEventListener("pointercancel", onUp);
    stage.addEventListener("wheel", onWheel, { passive: false });
  }

  /* ------------------------------------------------------------ o'lcham */
  function measure() {
    const r = stage.getBoundingClientRect();
    st.W = r.width || window.innerWidth;
    st.H = r.height || window.innerHeight;
    /* «Butun» rasm panellarga TEGMASLIGI kerak: tepadagi sarlavha ostidan
       pastdagi tugmalar ustigacha bo'lgan joyni o'lchaymiz. */
    const top = root.querySelector(".rv-top").getBoundingClientRect();
    const tools = root.querySelector(".rv-tools").getBoundingClientRect();
    st.fitTop = Math.max(0, top.bottom - r.top) + 6;
    st.fitBot = Math.min(st.H, tools.top - r.top) - 10;
    if (st.fitBot - st.fitTop < 120) {
      st.fitTop = 0;
      st.fitBot = st.H;
    }
    const fitH = st.fitBot - st.fitTop;
    st.cy = st.fitTop + fitH / 2;
    if (!st.natW || !st.natH) return;
    const k = Math.min((st.W - 24) / st.natW, fitH / st.natH);
    st.bw = st.natW * k;
    st.bh = st.natH * k;
    img.style.width = st.bw + "px";
    img.style.height = st.bh + "px";
    img.style.left = (st.W - st.bw) / 2 + "px";
    img.style.top = st.cy - st.bh / 2 + "px";
  }

  /** Kenglik bo'yicha kattalik (rasm baland bo'lsa > 1). */
  const widthScale = () => (st.bw ? st.W / st.bw : 1);

  /** Surish chegaralari. Kattalashtirilganda butun ekran ishlatiladi:
   *  rasm ekrandan katta bo'lsa — chetlari ekran chetidan ichkariga
   *  kirmaydi; kichik bo'lsa — ekran ichida qoladi. */
  function limits(s) {
    const w = st.bw * s;
    const h = st.bh * s;
    const mx = Math.abs(w - st.W) / 2;
    // Pastda suzuvchi asboblar paneli turadi — rasm pasti uning ustida to'xtaydi
    const bottom = st.zoomBot > 0 ? st.zoomBot : st.H;
    let y0;
    let y1;
    if (h >= bottom) {
      y0 = bottom - st.cy - h / 2; // pastki chet panel ustida
      y1 = h / 2 - st.cy; // yuqori chet ekran tepasida
    } else {
      y0 = h / 2 - st.cy;
      y1 = st.H - st.cy - h / 2;
    }
    return { x0: w >= st.W ? -mx : 0, x1: w >= st.W ? mx : 0, y0: Math.min(y0, y1), y1: Math.max(y0, y1) };
  }

  function apply(smooth) {
    img.style.transition = smooth ? "transform 0.34s cubic-bezier(.22,.9,.24,1)" : "none";
    img.style.transform = "translate3d(" + st.x.toFixed(1) + "px," + st.y.toFixed(1) + "px,0) scale(" + st.s.toFixed(4) + ")";
    const zoomed = st.s > 1.01;
    root.classList.toggle("is-zoomed", zoomed);
    if (zoomed !== st.zoomed) {
      st.zoomed = zoomed;
      // panel holati o'zgardi (tugmalar yashirildi/ko'rindi) — o'rnini qayta o'lchaymiz
      const t = root.querySelector(".rv-tools").getBoundingClientRect();
      const r = stage.getBoundingClientRect();
      st.zoomBot = zoomed ? t.top - r.top - 8 : 0;
    }
    const z = root.querySelector(".rv-zoom");
    if (z) z.textContent = Math.round(st.s * 100) + "%";
    const w = widthScale();
    const mode = Math.abs(st.s - 1) < 0.02 ? "fit" : w > 1.05 && Math.abs(st.s - w) < 0.03 ? "width" : "";
    root.querySelectorAll(".rv-seg [data-rv]").forEach((b) => {
      const on = b.dataset.rv === mode;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-checked", String(on));
    });
    // Uzun rasm qaysi qismi ko'rinayotgani (o'ng chetda)
    const total = st.bh * st.s;
    if (total > st.H + 4) {
      const frac = st.H / total;
      const L = limits(st.s);
      const span = L.y1 - L.y0;
      const pos = span > 0 ? clamp((L.y1 - st.y) / span, 0, 1) : 0;
      const hPct = Math.max(8, frac * 100);
      bar.style.opacity = "1";
      thumb.style.height = hPct + "%";
      thumb.style.top = pos * (100 - hPct) + "%";
    } else {
      bar.style.opacity = "0";
    }
  }

  function clampPos(smooth) {
    if (st.s <= 1.001) {
      st.s = 1;
      st.x = 0;
      st.y = 0;
      return apply(smooth);
    }
    const L = limits(st.s);
    st.x = clamp(st.x, L.x0, L.x1);
    st.y = clamp(st.y, L.y0, L.y1);
    apply(smooth);
  }

  /** Nuqta (ekran koordinatasi) atrofida yangi kattalikka o'tadi. */
  function zoomAt(s2, px, py, smooth) {
    const r = stage.getBoundingClientRect();
    const cx = px - r.left - st.W / 2;
    const cy = py - r.top - st.cy;
    s2 = clamp(s2, 1, MAX);
    const k = s2 / st.s;
    st.x = cx - (cx - st.x) * k;
    st.y = cy - (cy - st.y) * k;
    st.s = s2;
    clampPos(smooth);
  }

  function setMode(mode, tap) {
    if (tap) haptic("light");
    if (mode === "width") {
      const w = widthScale();
      if (w <= 1.05) return zoomAt(2.5, st.W / 2 + stage.getBoundingClientRect().left, st.cy + stage.getBoundingClientRect().top, true);
      st.s = w;
      st.x = 0;
      st.y = limits(w).y1; // tepadan boshlanadi — skrinshotning sarlavhasi va summasi
      return apply(true);
    }
    st.s = 1;
    st.x = 0;
    st.y = 0;
    apply(true);
  }

  /* ----------------------------------------------------------- ishoralar */
  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function onDown(e) {
    if (!st.bw) return;
    stage.setPointerCapture && stage.setPointerCapture(e.pointerId);
    st.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    st.moved = false;
    st.downAt = Date.now();
    if (st.ptrs.size === 2) {
      const [a, b] = [...st.ptrs.values()];
      st.pinch = { d: dist(a, b), s: st.s, x: st.x, y: st.y, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      st.pan = null;
    } else if (st.ptrs.size === 1) {
      st.pan = { sx: e.clientX, sy: e.clientY, x: st.x, y: st.y };
    }
  }

  function onMove(e) {
    const p = st.ptrs.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (st.pinch && st.ptrs.size >= 2) {
      const [a, b] = [...st.ptrs.values()];
      const s2 = clamp(st.pinch.s * (dist(a, b) / st.pinch.d), 0.85, MAX + 0.5);
      const r = stage.getBoundingClientRect();
      const cx0 = st.pinch.mx - r.left - st.W / 2;
      const cy0 = st.pinch.my - r.top - st.cy;
      const mx = (a.x + b.x) / 2 - r.left - st.W / 2;
      const my = (a.y + b.y) / 2 - r.top - st.cy;
      const k = s2 / st.pinch.s;
      st.s = s2;
      st.x = mx - (cx0 - st.pinch.x) * k;
      st.y = my - (cy0 - st.pinch.y) * k;
      st.moved = true;
      return apply(false);
    }
    if (!st.pan) return;
    const dx = e.clientX - st.pan.sx;
    const dy = e.clientY - st.pan.sy;
    if (Math.abs(dx) + Math.abs(dy) > 6) st.moved = true;
    if (st.s > 1.01) {
      // kattalashtirilgan: chegarada «rezina» kabi qarshilik
      const L = limits(st.s);
      const rub = (v, lo, hi) => (v > hi ? hi + (v - hi) * 0.35 : v < lo ? lo + (v - lo) * 0.35 : v);
      st.x = rub(st.pan.x + dx, L.x0, L.x1);
      st.y = rub(st.pan.y + dy, L.y0, L.y1);
      return apply(false);
    }
    if (dy > 0 && Math.abs(dy) > Math.abs(dx)) {
      // pastga surish — yopishga tayyorlanadi
      st.dismissY = dy;
      img.style.transition = "none";
      img.style.transform = "translate3d(" + dx * 0.3 + "px," + dy + "px,0) scale(" + Math.max(0.82, 1 - dy / 1400) + ")";
      root.style.setProperty("--rv-a", String(Math.max(0, 1 - dy / 380)));
    }
  }

  function onUp(e) {
    const wasPinch = !!st.pinch;
    st.ptrs.delete(e.pointerId);
    if (st.ptrs.size < 2) st.pinch = null;
    if (st.ptrs.size === 1 && wasPinch) {
      const [p] = [...st.ptrs.values()];
      st.pan = { sx: p.x, sy: p.y, x: st.x, y: st.y };
      return;
    }
    if (st.ptrs.size) return;
    st.pan = null;
    if (wasPinch) {
      if (st.s < 1.02) setMode("fit");
      else {
        st.s = Math.min(st.s, MAX);
        clampPos(true);
      }
      return;
    }
    if (st.dismissY) {
      const dy = st.dismissY;
      st.dismissY = 0;
      root.style.removeProperty("--rv-a");
      if (dy > 120) return close();
      return apply(true);
    }
    if (st.s > 1.01) clampPos(true);
    // ikki marta bosish
    if (!st.moved && Date.now() - st.downAt < 280) {
      const now = Date.now();
      const near = Math.hypot(e.clientX - st.lastTapX, e.clientY - st.lastTapY) < 40;
      if (now - st.lastTap < 320 && near) {
        st.lastTap = 0;
        haptic("light");
        if (st.s > 1.02) return setMode("fit");
        const w = widthScale();
        if (w > 1.05) {
          // baland skrinshot: kenglik bo'yicha, bosilgan joy markazda qoladi
          return zoomAt(w, st.W / 2 + stage.getBoundingClientRect().left, e.clientY, true);
          // (zoomAt chegaraga moslaydi — rasm ekrandan chiqib ketmaydi)
        }
        return zoomAt(2.5, e.clientX, e.clientY, true);
      }
      st.lastTap = now;
      st.lastTapX = e.clientX;
      st.lastTapY = e.clientY;
    }
  }

  function onWheel(e) {
    if (!st.bw) return;
    e.preventDefault();
    if (e.ctrlKey || Math.abs(e.deltaY) < 40 || st.s <= 1.01) {
      zoomAt(st.s * (e.deltaY > 0 ? 0.9 : 1.1), e.clientX, e.clientY, false);
    } else {
      // kattalashtirilganda g'ildirak — pastga/tepaga surish
      st.y -= e.deltaY;
      clampPos(false);
    }
  }

  /* ------------------------------------------------------------- ochish */
  function load(url) {
    st.url = url;
    st.natW = st.natH = st.bw = st.bh = 0;
    root.classList.remove("is-ready", "is-err", "is-zoomed");
    st.zoomed = false;
    st.zoomBot = 0;
    root.querySelector(".rv-err").classList.add("hidden");
    root.querySelector(".rv-load").classList.remove("hidden");
    img.removeAttribute("src");
    const amb = root.querySelector(".rv-amb");
    amb.style.backgroundImage = 'url("' + String(url).replace(/"/g, "%22") + '")';
    const probe = new Image();
    probe.decoding = "async";
    probe.onload = () => {
      if (st.url !== url) return;
      st.natW = probe.naturalWidth || 1;
      st.natH = probe.naturalHeight || 1;
      img.src = url;
      measure();
      st.s = 1;
      st.x = 0;
      st.y = 0;
      apply(false);
      root.querySelector(".rv-load").classList.add("hidden");
      root.classList.add("is-ready");
      // «Kenglik» tugmasi faqat rasm ekranda tor ko'rinsa ma'noli
      root.classList.toggle("is-tall", widthScale() > 1.05);
    };
    probe.onerror = () => {
      if (st.url !== url) return;
      root.querySelector(".rv-load").classList.add("hidden");
      root.querySelector(".rv-err").classList.remove("hidden");
      root.classList.add("is-err");
    };
    probe.src = url;
  }

  function openOriginal() {
    haptic("light");
    try {
      const tg = window.Telegram && window.Telegram.WebApp;
      if (tg && tg.openLink) return tg.openLink(st.url);
    } catch (_) {}
    window.open(st.url, "_blank", "noopener");
  }

  function open(opts) {
    const o = opts || {};
    if (!o.url) return;
    if (!root) build();
    root.querySelector(".rv-title b").textContent = o.title || "Chek";
    root.querySelector(".rv-title small").textContent = o.sub || "";
    st.actions = Array.isArray(o.actions) ? o.actions.filter((a) => a && a.label) : [];
    const acts = root.querySelector(".rv-acts");
    acts.innerHTML = st.actions
      .map(
        (a, i) =>
          '<button type="button" class="rv-act' + (a.primary ? " is-primary" : "") + (a.danger ? " is-danger" : "") +
          '" data-rv="act" data-i="' + i + '">' + esc(a.label) + "</button>"
      )
      .join("");
    acts.classList.toggle("hidden", !st.actions.length);
    root.classList.remove("hidden", "is-out");
    document.documentElement.classList.add("rv-lock");
    st.onKey = (e) => {
      if (e.key === "Escape") close();
    };
    st.onResize = () => {
      measure();
      clampPos(false);
    };
    document.addEventListener("keydown", st.onKey);
    window.addEventListener("resize", st.onResize);
    haptic("light");
    requestAnimationFrame(() => {
      measure();
      load(o.url);
    });
  }

  function close() {
    if (!root || root.classList.contains("hidden")) return;
    root.classList.add("is-out");
    document.documentElement.classList.remove("rv-lock");
    document.removeEventListener("keydown", st.onKey);
    window.removeEventListener("resize", st.onResize);
    st.ptrs.clear();
    st.pinch = st.pan = null;
    setTimeout(() => {
      root.classList.add("hidden");
      root.classList.remove("is-out", "is-ready", "is-zoomed");
      root.style.removeProperty("--rv-a");
      img.removeAttribute("src");
    }, 240);
  }

  const isOpen = () => !!root && !root.classList.contains("hidden") && !root.classList.contains("is-out");

  return { open: open, close: close, isOpen: isOpen };
})();
