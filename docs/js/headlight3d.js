/* ==========================================================================
   UZBROVV — 3D FARA (Bi-LED Studio)

   Konfiguratorning jonli 3D ko'rinishi. three.js (`docs/vendor/three.min.js`,
   faqat kerakli qismlar) ustida procedural model: hech qanday .glb fayl yo'q,
   hamma qism kod bilan yasaladi — shuning uchun yengil va har bir tanlovga
   darhol moslashadi.

   MODEL QISMLARI
     • korpus (tashqi plastik qobiq + old ramka) — «eski» / «yangi»;
     • fara ichi (orqa devor, yon devorlar, linza va uzoq nur kosalari) —
       «xrom» (asl) yoki «qora»;
     • Bi-LED proyektor: linza (R50 / R80 / R90 — o'lcham, qoplama, lazer
       aksenti farq qiladi), linza ichidagi kesish pardasi va LED;
     • ochki (maska): oddiy yoki BMW halqa; xrom yoki qora; BMW yonadigan
       halqa — mijoz tanlagan rangda yonadi va fara ichini o'sha rangga
       bo'yaydi;
     • DRL yorug'lik yo'lagi, uzoq nur reflektori, burilish chirog'i;
     • tashqi shisha — «hozirgi» (biroz xira/sarg'ish) yoki «yangi» (tiniq).

   YORUG'LIK REJIMLARI: off · drl (gabarit) · low (yaqin) · high (uzoq).
   Yaqin/uzoq nurda linza yonadi, havoda nur konusi, polda va devorda
   haqiqiy nur izi (yaqin nurda — o'ng tomonga ko'tarilgan kesish chizig'i).

   KAMERA: front (umumiy) · lens (linza yaqindan) · side (yon) · beam (nur
   devorda). Barmoq bilan aylantirish, ikki barmoq / g'ildirak bilan
   yaqinlashtirish, ikki marta bosish — boshlang'ich holat.

   UNUMDORLIK
     • `lite` (kuchsiz Android) — pixelRatio 1.25 gacha, antialias yo'q,
       shisha/linza «transmission» o'rniga arzon shaffoflik;
     • ko'rinmayotganda (`pause`) kadr chizilmaydi;
     • 4 soniya tegilmasa kadr tezligi yarmiga tushadi.

   API (app.js shu orqali ishlaydi):
     ZimmerHeadlight3D.supported()            -> bool (WebGL bormi)
     ZimmerHeadlight3D.create(host, {lite})   -> studio
       studio.set(cfg)    cfg = {lens, inner, ring, finish, glow, glass, housing}
       studio.light(mode) "off" | "drl" | "low" | "high"
       studio.view(name)  "front" | "lens" | "side" | "beam"
       studio.intro()     kirish animatsiyasi (kamera + yorug'lik yonishi)
       studio.pause() / studio.resume() / studio.dispose()
   ========================================================================== */

window.ZimmerHeadlight3D = (function () {
  "use strict";

  /* ------------------------------------------------------------ yordamchi */
  function supported() {
    try {
      if (!window.WebGLRenderingContext) return false;
      const c = document.createElement("canvas");
      return !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch (_) {
      return false;
    }
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  /** Kadr tezligidan qat'i nazar bir xil «yumshoq» yaqinlashish. */
  const damp = (cur, target, k, dt) => cur + (target - cur) * (1 - Math.exp(-k * dt));

  /** Linzaning ko'rinishi — kod bo'yicha (admin narx/nomni o'zgartiradi,
   *  ko'rinish esa shu yerda). Noma'lum kod — R80 ko'rinishi. */
  const LENS_LOOK = {
    r50: { radius: 3.15, dome: 1.45, coat: 0, kelvin: 5000, power: 0.85, laser: false, rim: 0.2 },
    r80: { radius: 3.8, dome: 1.9, coat: 0.75, kelvin: 5500, power: 1.0, laser: false, rim: 0.24 },
    r90: { radius: 3.8, dome: 1.5, coat: 1.0, kelvin: 6000, power: 1.25, laser: true, rim: 0.26 },
  };
  function lensLook(code, size) {
    const base = LENS_LOOK[String(code || "").toLowerCase()] || LENS_LOOK.r80;
    const look = Object.assign({}, base);
    /* Admin o'lchamni yozgan bo'lsa («2.5"», «3.0"») — radius shundan.
       1 dyuym = 2.54 sm, model sm da. */
    const inch = parseFloat(String(size || "").replace(",", "."));
    if (inch >= 1.8 && inch <= 3.6) look.radius = (inch * 2.54) / 2;
    return look;
  }

  /** LED rangi: 5000K iliqroq oq, 6000K sovuqroq oq. */
  function kelvinColor(THREE, k) {
    const t = clamp(((k || 5500) - 4300) / 2000, 0, 1);
    const warm = new THREE.Color("#fff1dc");
    const cool = new THREE.Color("#e3eeff");
    return warm.lerp(cool, t);
  }

  /* ----------------------------------------------------- canvas teksturalar */
  function canvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }

  function radialTex(THREE, stops) {
    const c = canvas(256, 256);
    const g = c.getContext("2d");
    const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    stops.forEach(([at, col]) => grd.addColorStop(at, col));
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function glowTex(THREE) {
    return radialTex(THREE, [
      [0, "rgba(255,255,255,1)"],
      [0.12, "rgba(255,255,255,0.85)"],
      [0.32, "rgba(255,255,255,0.32)"],
      [0.6, "rgba(255,255,255,0.08)"],
      [1, "rgba(255,255,255,0)"],
    ]);
  }

  function ringGlowTex(THREE) {
    return radialTex(THREE, [
      [0, "rgba(255,255,255,0)"],
      [0.42, "rgba(255,255,255,0.0)"],
      [0.6, "rgba(255,255,255,0.55)"],
      [0.67, "rgba(255,255,255,1)"],
      [0.74, "rgba(255,255,255,0.55)"],
      [0.88, "rgba(255,255,255,0.12)"],
      [1, "rgba(255,255,255,0)"],
    ]);
  }

  /** Kontakt soya — pol ustida yumshoq qora dog'. */
  function shadowTex(THREE) {
    return radialTex(THREE, [
      [0, "rgba(0,0,0,0.85)"],
      [0.45, "rgba(0,0,0,0.5)"],
      [1, "rgba(0,0,0,0)"],
    ]);
  }

  /** Linza ichi: reflektor halqalari, kesish pardasi va LED chipi. */
  function lensInsideTex(THREE, laser) {
    const S = 512;
    const c = canvas(S, S);
    const g = c.getContext("2d");
    const R = S / 2;
    g.fillStyle = "#07080a";
    g.fillRect(0, 0, S, S);
    // reflektordagi konsentrik aks — xrom kosaning ichki ko'rinishi
    for (let i = 0; i < 14; i++) {
      const r = R * (0.98 - i * 0.065);
      const grd = g.createRadialGradient(R * 0.92, R * 0.8, r * 0.2, R, R, r);
      const l = 30 + (i % 2) * 8 + (i < 3 ? 16 : 0);
      grd.addColorStop(0, `rgba(${l + 60},${l + 64},${l + 72},0.55)`);
      grd.addColorStop(1, `rgba(${l},${l + 3},${l + 8},0.6)`);
      g.beginPath();
      g.arc(R, R, r, 0, Math.PI * 2);
      g.fillStyle = grd;
      g.fill();
    }
    // kesish pardasi (shield): pastki yarim — qorong'i, chegarasi zinapoya
    g.fillStyle = "rgba(8,9,11,0.55)";
    g.beginPath();
    g.moveTo(0, R + 18);
    g.lineTo(R + 6, R + 18);
    g.lineTo(R + 40, R - 4);
    g.lineTo(S, R - 4);
    g.lineTo(S, S);
    g.lineTo(0, S);
    g.closePath();
    g.fill();
    g.strokeStyle = "rgba(190,198,210,0.28)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, R + 18);
    g.lineTo(R + 6, R + 18);
    g.lineTo(R + 40, R - 4);
    g.lineTo(S, R - 4);
    g.stroke();
    // LED chipi
    g.fillStyle = "#c9b98a";
    g.fillRect(R - 26, R - 52, 52, 18);
    g.fillStyle = "#fff6d8";
    g.fillRect(R - 20, R - 49, 40, 12);
    if (laser) {
      // R90: ko'k «lazer» halqa va nuqta
      g.strokeStyle = "rgba(60,130,255,0.7)";
      g.lineWidth = 5;
      g.beginPath();
      g.arc(R, R, R * 0.36, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = "rgba(80,150,255,1)";
      g.beginPath();
      g.arc(R, R + 2, 12, 0, Math.PI * 2);
      g.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /** Yongan linzaning yorug'lik xaritasi (emissive). */
  function lensGlowTex(THREE, laser) {
    const S = 512;
    const c = canvas(S, S);
    const g = c.getContext("2d");
    const R = S / 2;
    const grd = g.createRadialGradient(R, R * 0.92, 0, R, R, R);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.35, "rgba(235,240,255,0.95)");
    grd.addColorStop(0.75, "rgba(170,185,210,0.75)");
    grd.addColorStop(1, "rgba(90,100,120,0.5)");
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
    if (laser) {
      g.strokeStyle = "rgba(90,150,255,1)";
      g.lineWidth = 12;
      g.beginPath();
      g.arc(R, R, R * 0.36, 0, Math.PI * 2);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /** Nur izi devorda: yaqin nur (assimetrik kesish) va uzoq nur. */
  function beamPatternTex(THREE, kind) {
    const W = 1024;
    const H = 512;
    const c = canvas(W, H);
    const g = c.getContext("2d");
    g.fillStyle = "#000";
    g.fillRect(0, 0, W, H);
    if ("filter" in g) g.filter = "blur(7px)";
    if (kind === "low") {
      g.save();
      g.beginPath();
      g.moveTo(0, H * 0.47);
      g.lineTo(W * 0.52, H * 0.47);
      g.lineTo(W * 0.6, H * 0.35);
      g.lineTo(W, H * 0.35);
      g.lineTo(W, H);
      g.lineTo(0, H);
      g.closePath();
      g.clip();
      let grd = g.createRadialGradient(W * 0.55, H * 0.5, 0, W * 0.55, H * 0.55, W * 0.52);
      grd.addColorStop(0, "rgba(255,255,255,0.95)");
      grd.addColorStop(0.25, "rgba(255,255,255,0.6)");
      grd.addColorStop(0.6, "rgba(255,255,255,0.18)");
      grd.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grd;
      g.fillRect(0, 0, W, H);
      // issiq nuqta — kesish chizig'idan biroz pastda, o'ngroqda
      grd = g.createRadialGradient(W * 0.57, H * 0.52, 0, W * 0.57, H * 0.52, W * 0.16);
      grd.addColorStop(0, "rgba(255,255,255,1)");
      grd.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grd;
      g.fillRect(0, 0, W, H);
      g.restore();
    } else {
      let grd = g.createRadialGradient(W * 0.5, H * 0.42, 0, W * 0.5, H * 0.45, W * 0.55);
      grd.addColorStop(0, "rgba(255,255,255,1)");
      grd.addColorStop(0.18, "rgba(255,255,255,0.85)");
      grd.addColorStop(0.5, "rgba(255,255,255,0.3)");
      grd.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grd;
      g.fillRect(0, 0, W, H);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /** Poldagi yorug'lik «yelpig'ichi» (fara oldida). */
  function floorPoolTex(THREE) {
    const W = 512;
    const H = 512;
    const c = canvas(W, H);
    const g = c.getContext("2d");
    g.fillStyle = "#000";
    g.fillRect(0, 0, W, H);
    if ("filter" in g) g.filter = "blur(10px)";
    g.beginPath();
    g.moveTo(W * 0.46, H);
    g.lineTo(W * 0.54, H);
    g.lineTo(W * 0.98, 0);
    g.lineTo(W * 0.02, 0);
    g.closePath();
    const grd = g.createLinearGradient(0, H, 0, 0);
    grd.addColorStop(0, "rgba(255,255,255,0.95)");
    grd.addColorStop(0.35, "rgba(255,255,255,0.5)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /** Nur konusi bo'yicha alfa (cho'qqida yorug', uzoqda so'nadi). */
  function coneTex(THREE) {
    const c = canvas(8, 256);
    const g = c.getContext("2d");
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, "rgba(255,255,255,0.9)");
    grd.addColorStop(0.25, "rgba(255,255,255,0.35)");
    grd.addColorStop(0.7, "rgba(255,255,255,0.06)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 8, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /** Eski shisha: sarg'ish xiralik, mayda dog'lar va tirnalishlar. */
  function hazeTex(THREE) {
    const W = 1024;
    const H = 440;
    const c = canvas(W, H);
    const g = c.getContext("2d");
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, "rgb(236,214,150)");
    grd.addColorStop(0.55, "rgb(222,196,128)");
    grd.addColorStop(1, "rgb(200,170,104)");
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 1600; i++) {
      const a = 0.05 + rnd() * 0.12;
      g.fillStyle = rnd() > 0.5 ? `rgba(255,250,235,${a})` : `rgba(120,96,50,${a})`;
      const r = 1 + rnd() * 5;
      g.beginPath();
      g.arc(rnd() * W, rnd() * H, r, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = "rgba(255,255,245,0.16)";
    g.lineWidth = 1.2;
    for (let i = 0; i < 70; i++) {
      const x = rnd() * W;
      const y = rnd() * H;
      const l = 30 + rnd() * 160;
      const a = -0.5 + rnd();
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /** Shisha ustidan o'tadigan yaltiroq chiziq (yangi shisha tanlanganda). */
  function sweepTex(THREE) {
    const c = canvas(512, 8);
    const g = c.getContext("2d");
    const grd = g.createLinearGradient(0, 0, 512, 0);
    grd.addColorStop(0, "rgba(255,255,255,0)");
    grd.addColorStop(0.44, "rgba(255,255,255,0)");
    grd.addColorStop(0.5, "rgba(255,255,255,1)");
    grd.addColorStop(0.56, "rgba(255,255,255,0)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 512, 8);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function textTex(THREE, text, opts) {
    const o = opts || {};
    const c = canvas(o.w || 512, o.h || 96);
    const g = c.getContext("2d");
    g.clearRect(0, 0, c.width, c.height);
    g.font = `${o.weight || 700} ${o.size || 54}px -apple-system, "SF Pro Display", Roboto, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = o.color || "rgba(255,255,255,0.8)";
    if (g.letterSpacing !== undefined) g.letterSpacing = (o.spacing || 10) + "px";
    g.fillText(text, c.width / 2, c.height / 2 + 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /* --------------------------------------------------------------- shakl */

  /** Faraning old ochilishi (sm). Chap — panjara tomoni (proyektor shu
   *  yerda), o'ng — qanot tomoni (uchi yuqoriga va orqaga egiladi). */
  function outlineShape(THREE) {
    const s = new THREE.Shape();
    s.moveTo(-31, -8);
    s.bezierCurveTo(-18, -11.2, 0, -9.6, 14, -5.6); // pastki chet — qanotga ko'tariladi
    s.bezierCurveTo(22, -3.3, 29, 0.6, 34.5, 6.2); // uchli qanot tomoni
    s.bezierCurveTo(35.5, 7.6, 34.5, 8.9, 31.5, 9.1);
    s.bezierCurveTo(16, 10.4, -12, 11.6, -26, 11.2); // tepa chet
    s.bezierCurveTo(-30.5, 11, -32.2, 9, -32.4, 5);
    s.bezierCurveTo(-32.6, 0, -32.2, -5.6, -31, -8); // panjara tomoni
    return s;
  }

  /** Shisha sirti: markazi bo'rtiq, qanot tomoni orqaga «o'raladi». */
  function glassZ(x, y) {
    const nx = x / 36;
    const ny = y / 15;
    const wrap = Math.max(0, x - 10);
    return 2.4 * (1 - nx * nx) + 0.8 * (1 - ny * ny) - wrap * wrap * 0.006;
  }

  const CENTER = { x: 1, y: 1.4 };
  const BACK_Z = -13;

  function scaled(p, k) {
    return { x: CENTER.x + (p.x - CENTER.x) * k, y: CENTER.y + (p.y - CENTER.y) * k };
  }

  /** Ikki halqa (old va orqa) orasidagi devor — indeksli to'rt burchaklar. */
  function ringStrip(THREE, front, back) {
    const n = front.length;
    const pos = new Float32Array(n * 2 * 3);
    const uv = new Float32Array(n * 2 * 2);
    for (let i = 0; i < n; i++) {
      pos.set([front[i].x, front[i].y, front[i].z], i * 6);
      pos.set([back[i].x, back[i].y, back[i].z], i * 6 + 3);
      uv.set([i / (n - 1), 1, i / (n - 1), 0], i * 4);
    }
    const idx = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  /** Aylanma jism (Lathe) — o'qi +Z ga qaratilgan. */
  function lathe(THREE, pts, seg) {
    const geo = new THREE.LatheGeometry(
      pts.map((p) => new THREE.Vector2(p[0], p[1])),
      seg || 72
    );
    geo.rotateX(Math.PI / 2);
    return geo;
  }

  /* ============================================================== STUDIYA */
  function create(host, options) {
    const THREE = window.THREE;
    if (!THREE) throw new Error("three.js yuklanmagan");
    const opts = options || {};
    const lite = !!opts.lite;

    /* ---------------------------------------------------------- renderer */
    const renderer = new THREE.WebGLRenderer({
      antialias: !lite,
      alpha: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: !!opts.preserve,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lite ? 1.25 : 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(0x000000, 0);
    const cnv = renderer.domElement;
    cnv.className = "h3d-canvas";
    host.appendChild(cnv);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 900);

    /* ------------------------------------------- studiya muhiti (aks) */
    const accent = new THREE.Color(opts.accent || "#f5b335");
    (function buildEnv() {
      const env = new THREE.Scene();
      const room = new THREE.Mesh(
        new THREE.SphereGeometry(60, 32, 16),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.052, 0.06), side: THREE.BackSide })
      );
      env.add(room);
      const box = (w, h, x, y, z, rx, ry, col) => {
        const m = new THREE.Mesh(
          new THREE.PlaneGeometry(w, h),
          new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide })
        );
        m.position.set(x, y, z);
        m.rotation.set(rx || 0, ry || 0, 0);
        env.add(m);
      };
      box(46, 16, 0, 34, 6, Math.PI / 2, 0, new THREE.Color(6, 6, 6.2)); // tepa softboks
      box(8, 46, 40, 6, 10, 0, -Math.PI / 2, new THREE.Color(3.6, 3.6, 3.8)); // o'ng chiziq
      box(7, 40, -40, 4, 14, 0, Math.PI / 2, new THREE.Color(2, 2.2, 2.8)); // chap (sovuq)
      box(60, 9, 0, -16, 42, -0.3, 0, new THREE.Color(0.5, 0.48, 0.45)); // pastki qaytish
      box(3, 30, 22, 10, 40, 0, 0, new THREE.Color(4, 4, 4)); // old ingichka chiziqlar
      box(3, 30, 8, 10, 42, 0, 0, new THREE.Color(3, 3, 3));
      box(50, 2.5, 0, 22, 40, 0, 0, new THREE.Color(3.2, 3.2, 3.3));
      box(20, 6, 18, 26, -44, 0.5, 0, accent.clone().multiplyScalar(0.9)); // brend aksenti
      box(14, 14, -26, 18, 38, 0, 0.6, new THREE.Color(2.4, 2.4, 2.5)); // old chap
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(env, 0.035).texture;
      pmrem.dispose();
      env.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    })();

    scene.add(new THREE.HemisphereLight(0xdfe4ee, 0x080808, 0.22));
    const key = new THREE.DirectionalLight(0xffffff, 1.25);
    key.position.set(30, 40, 50);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fb8ff, 0.7);
    rim.position.set(-40, 20, -30);
    scene.add(rim);

    /* ------------------------------------------------------------ guruhlar */
    const rig = new THREE.Group(); // foydalanuvchi aylantiradi
    const lamp = new THREE.Group(); // faraning o'zi
    rig.add(lamp);
    scene.add(rig);

    /* ---------------------------------------------------------- materiallar */
    const disposables = [];
    const keep = (x) => (disposables.push(x), x);

    const M = {
      // fara ichi (orqa devor, yon devorlar, kosalar) — rangi tanlovga qarab
      inner: keep(new THREE.MeshStandardMaterial({ color: 0xeef1f5, metalness: 1, roughness: 0.14, side: THREE.DoubleSide })),
      // korpus — tashqi plastik
      shell: keep(new THREE.MeshPhysicalMaterial({ color: 0x111214, metalness: 0, roughness: 0.36, clearcoat: 0.5, clearcoatRoughness: 0.3 })),
      // ochki (maska) — xrom yoki qora
      shroud: keep(new THREE.MeshPhysicalMaterial({ color: 0xf2f4f7, metalness: 1, roughness: 0.07, clearcoat: 0.3 })),
      chrome: keep(new THREE.MeshStandardMaterial({ color: 0xf0f2f5, metalness: 1, roughness: 0.08 })),
      barrel: keep(new THREE.MeshStandardMaterial({ color: 0x24262b, metalness: 0.75, roughness: 0.38 })),
      ring: keep(new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: 0.32, transmission: 0, emissive: 0x000000, emissiveIntensity: 1, clearcoat: 0.6 })),
      drl: keep(new THREE.MeshStandardMaterial({ color: 0xd9e0ea, metalness: 0, roughness: 0.35, emissive: 0xffffff, emissiveIntensity: 0 })),
      amber: keep(
        new THREE.MeshPhysicalMaterial({
          color: 0xff8f12,
          metalness: 0.1,
          roughness: 0.22,
          clearcoat: 1,
          transmission: lite ? 0 : 0.35,
          thickness: 1,
          emissive: 0xff7a00,
          emissiveIntensity: 0.05,
        })
      ),
      bulb: keep(new THREE.MeshStandardMaterial({ color: 0xf6f3ea, metalness: 0, roughness: 0.15, emissive: 0xfff0c8, emissiveIntensity: 0 })),
    };

    /* Fara ichi rangi uchun nishonlar (yumshoq o'tish bilan qo'llanadi). */
    const INNER = {
      chrome: { color: new THREE.Color(0xeef1f5), metal: 1, rough: 0.14 },
      black: { color: new THREE.Color(0x0d0e10), metal: 0.25, rough: 0.42 },
    };
    const FINISH = {
      chrome: { color: new THREE.Color(0xf2f4f7), metal: 1, rough: 0.07, cc: 0.3 },
      black: { color: new THREE.Color(0x0a0a0b), metal: 0.35, rough: 0.2, cc: 1 },
    };
    const SHELL = {
      fresh: { color: new THREE.Color(0x101113), rough: 0.32, cc: 0.65 },
      old: { color: new THREE.Color(0x2e2f31), rough: 0.88, cc: 0 },
    };

    /* ============================================================ KORPUS */
    const shape = outlineShape(THREE);
    const N = 220;
    const outline = shape.getSpacedPoints(N).map((p) => ({ x: p.x, y: p.y }));

    // ichki devor: shisha chetidan orqa devorgacha
    const front = outline.map((p) => ({ x: p.x, y: p.y, z: glassZ(p.x, p.y) - 0.3 }));
    const back = outline.map((p) => {
      const q = scaled(p, 0.84);
      return { x: q.x, y: q.y, z: BACK_Z };
    });
    lamp.add(new THREE.Mesh(keep(ringStrip(THREE, front, back)), M.inner));

    // orqa devor
    const backShape = new THREE.Shape(outline.map((p) => {
      const q = scaled(p, 0.84);
      return new THREE.Vector2(q.x, q.y);
    }));
    const backGeo = keep(new THREE.ShapeGeometry(backShape, 24));
    const backMesh = new THREE.Mesh(backGeo, M.inner);
    backMesh.position.z = BACK_Z;
    lamp.add(backMesh);

    // tashqi qobiq (korpus) — yon tomondan ko'rinadi
    const shellFront = outline.map((p) => {
      const q = scaled(p, 1.025);
      return { x: q.x, y: q.y, z: glassZ(p.x, p.y) - 0.45 };
    });
    const shellBack = outline.map((p) => {
      const q = scaled(p, 0.8);
      return { x: q.x, y: q.y, z: -20 };
    });
    lamp.add(new THREE.Mesh(keep(ringStrip(THREE, shellFront, shellBack)), M.shell));
    const capShape = new THREE.Shape(outline.map((p) => {
      const q = scaled(p, 0.8);
      return new THREE.Vector2(q.x, q.y);
    }));
    const cap = new THREE.Mesh(keep(new THREE.ShapeGeometry(capShape, 12)), M.shell);
    cap.position.z = -20;
    cap.rotation.y = Math.PI;
    cap.position.x = 2 * CENTER.x;
    lamp.add(cap);
    // orqadagi lampa qopqoqlari va mahkamlash quloqlari
    [[-17, 1.2, 3.4], [4, 0.6, 2.8]].forEach(([x, y, r]) => {
      const m = new THREE.Mesh(keep(new THREE.CylinderGeometry(r, r, 3.2, 40)), M.shell);
      m.rotation.x = Math.PI / 2;
      m.position.set(x, y, -21.4);
      lamp.add(m);
    });
    [[-31, 8], [30, 6], [-8, -12.2]].forEach(([x, y]) => {
      const m = new THREE.Mesh(keep(new THREE.BoxGeometry(4.2, 2.4, 1)), M.shell);
      m.position.set(x, y, -12);
      lamp.add(m);
    });

    // old ramka — shisha chetini o'rab turadigan plastik lab
    const lipCurve = new THREE.CatmullRomCurve3(
      outline.slice(0, -1).map((p) => {
        const q = scaled(p, 1.01);
        return new THREE.Vector3(q.x, q.y, glassZ(p.x, p.y) - 0.15);
      }),
      true
    );
    lamp.add(new THREE.Mesh(keep(new THREE.TubeGeometry(lipCurve, 320, 0.42, 10, true)), M.shell));

    /* ============================================== UZOQ NUR REFLEKTORI
       Qirrali (free-form) xrom kosa: kam segmentli Lathe har qirrada
       studiya chirog'ini alohida aks ettiradi — haqiqiy reflektor kabi.
       Lampochka old tomondan xrom qalpoq bilan yopilgan. */
    const HB = { x: 5.5, y: 0.9 };
    const hbZ = glassZ(HB.x, HB.y) - 3.4;
    const hbBowl = new THREE.Mesh(
      keep(lathe(THREE, [[0.8, -6.2], [2.2, -5.8], [3.8, -4.7], [5.1, -3.1], [6.1, -1.4], [6.6, 0]], 14)),
      M.inner
    );
    hbBowl.position.set(HB.x, HB.y, hbZ);
    hbBowl.rotation.z = Math.PI / 14;
    lamp.add(hbBowl);
    const hbRim = new THREE.Mesh(keep(new THREE.TorusGeometry(6.65, 0.18, 10, 72)), M.inner);
    hbRim.position.set(HB.x, HB.y, hbZ);
    lamp.add(hbRim);
    const bulb = new THREE.Mesh(keep(new THREE.SphereGeometry(0.8, 24, 16)), M.bulb);
    bulb.scale.set(1, 1, 1.7);
    bulb.position.set(HB.x, HB.y, hbZ - 3.2);
    lamp.add(bulb);
    const shield = new THREE.Mesh(
      keep(new THREE.SphereGeometry(1.25, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2)),
      M.chrome
    );
    shield.rotation.x = Math.PI / 2;
    shield.position.set(HB.x, HB.y, hbZ - 1.9);
    lamp.add(shield);

    /* ============================================== BURILISH CHIROG'I
       Qanot tomonidagi ingichka qahrabo chiziq — pastki chetga parallel. */
    const TS = { x: 25.2, y: 2.2 };
    const tsZ = glassZ(TS.x, TS.y) - 1.5;
    const turn = new THREE.Mesh(keep(new THREE.BoxGeometry(10.5, 1.5, 0.9)), M.amber);
    turn.position.set(TS.x, TS.y, tsZ);
    turn.rotation.set(0, 0.3, 0.5);
    lamp.add(turn);
    const turnBack = new THREE.Mesh(keep(new THREE.BoxGeometry(11.4, 2.6, 0.4)), M.inner);
    turnBack.position.set(TS.x, TS.y, tsZ - 0.9);
    turnBack.rotation.copy(turn.rotation);
    lamp.add(turnBack);

    /* ======================================================== DRL «QOSH»
       Tepa chet bo'ylab, ichkariroqda yuradigan yorug'lik yo'lagi.
       Nuqtalar konturning o'zidan olinadi — shakl o'zgarsa ham mos. */
    const drlPts = outline
      .filter((p) => p.y > CENTER.y + 4.5 && p.x > -29.5 && p.x < 31)
      .sort((a, b) => a.x - b.x)
      .filter((p, i, arr) => i % 3 === 0 || i === arr.length - 1)
      .map((p) => {
        const dx = CENTER.x - p.x;
        const dy = CENTER.y - p.y;
        const l = Math.hypot(dx, dy) || 1;
        const x = p.x + (dx / l) * 1.9;
        const y = p.y + (dy / l) * 1.9;
        return new THREE.Vector3(x, y, glassZ(x, y) - 1.1);
      });
    const drlCurve = new THREE.CatmullRomCurve3(drlPts);
    lamp.add(new THREE.Mesh(keep(new THREE.TubeGeometry(drlCurve, 180, 0.3, 10, false)), M.drl));

    /* ============================================ BI-LED PROYEKTOR (dinamik) */
    const PJ = { x: -16.8, y: 1.4 };
    const pjFront = glassZ(PJ.x, PJ.y) - 3.0; // linza oldi
    let pj = null; // joriy proyektor guruhi
    let pjParts = {}; // linza ichi, halqa va h.k.

    // proyektor kosasi (o'zgarmaydi) — fara ichi rangida
    const pod = new THREE.Mesh(
      keep(lathe(THREE, [[4.4, -7.2], [5.6, -6.4], [7.2, -4.2], [8.3, -1.8], [8.9, 0]], 72)),
      M.inner
    );
    pod.position.set(PJ.x, PJ.y, pjFront - 1.2);
    lamp.add(pod);

    const T = {
      glow: keep(glowTex(THREE)),
      ringGlow: keep(ringGlowTex(THREE)),
      shadow: keep(shadowTex(THREE)),
      cone: keep(coneTex(THREE)),
      low: keep(beamPatternTex(THREE, "low")),
      high: keep(beamPatternTex(THREE, "high")),
      pool: keep(floorPoolTex(THREE)),
      haze: keep(hazeTex(THREE)),
      sweep: keep(sweepTex(THREE)),
    };

    function disposeTree(obj) {
      obj.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && o.userData.ownMat) {
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
            if (m.map) m.map.dispose();
            if (m.emissiveMap) m.emissiveMap.dispose();
            m.dispose();
          });
        }
      });
    }

    function buildProjector(cfg) {
      const look = lensLook(cfg.lens, cfg.size);
      const R = look.radius;
      const g = new THREE.Group();
      g.position.set(PJ.x, PJ.y, pjFront);

      // tana (barrel) — linza orqasida
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.93, R * 1.02, 6.2, 48, 1, true), M.barrel);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.z = -look.dome - 3.1;
      g.add(barrel);

      // linza ichi: reflektor, parda, LED — yonganda emissive
      const insideMat = new THREE.MeshStandardMaterial({
        map: lensInsideTex(THREE, look.laser),
        emissiveMap: lensGlowTex(THREE, look.laser),
        emissive: 0xffffff,
        emissiveIntensity: 0,
        metalness: 0.6,
        roughness: 0.32,
      });
      const inside = new THREE.Mesh(new THREE.CircleGeometry(R * 0.985, 64), insideMat);
      inside.userData.ownMat = true;
      inside.position.z = -look.dome - 0.35;
      g.add(inside);

      // linza — bo'rtiq shisha (plano-qavariq)
      const dome = [];
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        const r = R * Math.sin((t * Math.PI) / 2);
        dome.push([Math.max(0.001, r), look.dome * Math.pow(Math.cos((t * Math.PI) / 2), 0.9) - look.dome]);
      }
      const lensMat = lite
        ? new THREE.MeshPhysicalMaterial({
            color: 0xffffff,
            metalness: 0,
            roughness: 0.02,
            transparent: true,
            opacity: 0.22,
            clearcoat: 1,
            iridescence: look.coat,
            iridescenceIOR: 1.7,
            iridescenceThicknessRange: [160, 420],
            envMapIntensity: 1.8,
            depthWrite: false,
          })
        : new THREE.MeshPhysicalMaterial({
            color: 0xffffff,
            metalness: 0,
            roughness: 0.0,
            transmission: 1,
            thickness: 1.6,
            ior: 1.52,
            clearcoat: 1,
            clearcoatRoughness: 0,
            iridescence: look.coat,
            iridescenceIOR: 1.7,
            iridescenceThicknessRange: [160, 420],
            specularIntensity: 1,
            envMapIntensity: 1.7,
          });
      const lens = new THREE.Mesh(lathe(THREE, dome, 64), lensMat);
      lens.userData.ownMat = true;
      g.add(lens);

      // linza ushlagich halqasi
      const holder = new THREE.Mesh(new THREE.TorusGeometry(R + 0.12, look.rim, 14, 80), M.shroud);
      holder.position.z = -look.dome + 0.05;
      g.add(holder);

      // ---- ochki (maska): karnaysimon ichki yuza
      const rIn = R + 0.3;
      const rOut = R * 2.05 + 0.4;
      const shroud = new THREE.Mesh(
        lathe(
          THREE,
          [
            [rIn, -look.dome + 0.35],
            [rIn + 0.45, -look.dome - 0.1],
            [rIn + 1.5, -look.dome - 1.1],
            [rIn + 2.9, -look.dome - 2.2],
            [rOut, -look.dome - 3.2],
            [rOut + 0.35, -look.dome - 3.7],
          ],
          96
        ),
        M.shroud
      );
      g.add(shroud);
      const lip = new THREE.Mesh(new THREE.TorusGeometry(rIn + 0.05, 0.2, 12, 96), M.shroud);
      lip.position.z = -look.dome + 0.35;
      g.add(lip);

      // ---- BMW halqasi
      let ring = null;
      let ringGlow = null;
      if (cfg.ring === "bmw" || cfg.ring === "glow") {
        const rr = R + 1.55;
        ring = new THREE.Mesh(
          new THREE.TorusGeometry(rr, 0.46, 20, 120),
          cfg.ring === "glow" ? M.ring : M.shroud
        );
        ring.position.z = -look.dome - 0.75;
        g.add(ring);
        // halqa ostidagi nozik ichki chiziq
        const seat = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.62, 10, 120), M.barrel);
        seat.scale.z = 0.4;
        seat.position.z = -look.dome - 1.05;
        g.add(seat);
        if (cfg.ring === "glow") {
          ringGlow = new THREE.Sprite(
            new THREE.SpriteMaterial({
              map: T.ringGlow,
              color: 0xffffff,
              transparent: true,
              opacity: 0,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            })
          );
          ringGlow.userData.ownMat = true;
          ringGlow.material.map = T.ringGlow; // umumiy tekstura — dispose qilinmaydi
          const s = rr * 3.25;
          ringGlow.scale.set(s, s, 1);
          ringGlow.position.z = -look.dome - 0.3;
          g.add(ringGlow);
        }
      }

      // R90: lazer korona — linza atrofida nozik ko'k chiziq
      let corona = null;
      if (look.laser) {
        corona = new THREE.Mesh(
          new THREE.TorusGeometry(R * 0.36, 0.07, 8, 64),
          new THREE.MeshBasicMaterial({ color: 0x3d7bff, transparent: true, opacity: 0.55 })
        );
        corona.userData.ownMat = true;
        corona.position.z = -look.dome - 0.3;
        g.add(corona);
      }

      // linza yorqinligi (bloom o'rniga yumshoq sprite)
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: T.glow,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      glow.userData.ownMat = true;
      glow.position.z = 0.6;
      g.add(glow);

      // tanlov o'zgarganda «sakrab» chiqishi uchun
      g.scale.setScalar(0.9);
      return { group: g, look, inside, insideMat, lens, ring, ringGlow, glow, corona };
    }

    /* ======================================================== SHISHA */
    const GW = 72;
    const GH = 30;
    const glassGeo = keep(new THREE.PlaneGeometry(GW, GH, 120, 52));
    (function bend() {
      const p = glassGeo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const y = p.getY(i) + CENTER.y;
        p.setY(i, y);
        p.setZ(i, glassZ(x, y));
      }
      p.needsUpdate = true;
      glassGeo.computeVertexNormals();
    })();
    // shisha shakli (alfa xarita) — konturdan tashqari qism ko'rinmaydi
    const maskTex = keep(
      (function () {
        const W = 1024;
        const H = Math.round((W * GH) / GW);
        const c = canvas(W, H);
        const g = c.getContext("2d");
        g.fillStyle = "#000";
        g.fillRect(0, 0, W, H);
        g.fillStyle = "#fff";
        g.beginPath();
        outline.forEach((p, i) => {
          const u = ((p.x + GW / 2) / GW) * W;
          const v = (1 - (p.y - CENTER.y + GH / 2) / GH) * H;
          if (i) g.lineTo(u, v);
          else g.moveTo(u, v);
        });
        g.closePath();
        g.fill();
        return new THREE.CanvasTexture(c);
      })()
    );
    const glassTint = keep(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: T.haze,
        alphaMap: maskTex,
        transparent: true,
        opacity: 0.05,
        roughness: 0.6,
        metalness: 0,
        depthWrite: false,
      })
    );
    const glassSpec = keep(
      new THREE.MeshPhysicalMaterial({
        color: 0x000000,
        alphaMap: maskTex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        roughness: 0.03,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.02,
        envMapIntensity: 2.4,
        depthWrite: false,
      })
    );
    const sweepMat = keep(
      new THREE.MeshBasicMaterial({
        map: T.sweep,
        alphaMap: maskTex,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    T.sweep.center.set(0.5, 0.5);
    T.sweep.rotation = -0.5;
    const glassA = new THREE.Mesh(glassGeo, glassTint);
    const glassB = new THREE.Mesh(glassGeo, glassSpec);
    const glassC = new THREE.Mesh(glassGeo, sweepMat);
    glassA.renderOrder = 5;
    glassB.renderOrder = 6;
    glassC.renderOrder = 7;
    lamp.add(glassA, glassB, glassC);

    /* =================================================== ICHKI YORUG'LIK */
    const innerLight = new THREE.PointLight(0xffffff, 0, 46, 1.6);
    innerLight.position.set(PJ.x + 2, PJ.y + 1, pjFront - 0.5);
    lamp.add(innerLight);
    const ringLight = new THREE.PointLight(0xffffff, 0, 24, 1.6);
    ringLight.position.set(PJ.x, PJ.y, pjFront - 0.6);
    lamp.add(ringLight);
    const drlLight = new THREE.PointLight(0xffffff, 0, 30, 1.5);
    drlLight.position.set(-4, -6.5, -1);
    lamp.add(drlLight);

    // DRL bo'ylab yorqinlik
    const drlGlows = [];
    for (let i = 0; i < 9; i++) {
      const s = new THREE.Sprite(
        keep(
          new THREE.SpriteMaterial({
            map: T.glow,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          })
        )
      );
      const p = drlCurve.getPoint(i / 8);
      s.position.set(p.x, p.y, p.z + 0.4);
      s.scale.set(7, 4.2, 1);
      lamp.add(s);
      drlGlows.push(s);
    }
    const bulbGlow = new THREE.Sprite(
      keep(new THREE.SpriteMaterial({ map: T.glow, color: 0xfff0d0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
    );
    bulbGlow.position.set(HB.x, HB.y, hbZ + 1);
    bulbGlow.scale.set(16, 16, 1);
    lamp.add(bulbGlow);

    /* ==================================================== NUR KONUSI */
    const coneMat = keep(
      new THREE.MeshBasicMaterial({
        map: T.cone,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    const CONE_L = 110;
    const coneGeo = keep(new THREE.ConeGeometry(30, CONE_L, 48, 1, true));
    coneGeo.translate(0, -CONE_L / 2, 0); // cho'qqi koordinata boshida
    coneGeo.rotateX(-Math.PI / 2); // -Y -> +Z (oldinga)
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.set(PJ.x, PJ.y, pjFront + 0.4);
    cone.renderOrder = 8;
    lamp.add(cone);

    /* ====================================================== POL VA DEVOR */
    const FLOOR_Y = -15.5;
    /* Pol chetlari fonga silliq singib ketadi (studiyadagi «cheksiz» fon). */
    T.floorFade = keep(
      radialTex(THREE, [
        [0, "rgba(255,255,255,1)"],
        [0.2, "rgba(255,255,255,0.75)"],
        [0.5, "rgba(255,255,255,0.22)"],
        [1, "rgba(255,255,255,0)"],
      ])
    );
    const floor = new THREE.Mesh(
      keep(new THREE.PlaneGeometry(420, 420)),
      keep(
        new THREE.MeshStandardMaterial({
          color: 0x0b0b0d,
          metalness: 0.1,
          roughness: 0.78,
          envMapIntensity: 0.18,
          alphaMap: T.floorFade,
          transparent: true,
          depthWrite: false,
        })
      )
    );
    floor.position.z = 30;
    floor.renderOrder = -1;
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y;
    scene.add(floor);
    const shadow = new THREE.Mesh(
      keep(new THREE.PlaneGeometry(90, 46)),
      keep(new THREE.MeshBasicMaterial({ map: T.shadow, transparent: true, depthWrite: false }))
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(1, FLOOR_Y + 0.05, -6);
    scene.add(shadow);
    const pool = new THREE.Mesh(
      keep(new THREE.PlaneGeometry(150, 150)),
      keep(new THREE.MeshBasicMaterial({ map: T.pool, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(PJ.x + 8, FLOOR_Y + 0.08, 78);
    scene.add(pool);

    const WALL_Z = 120;
    const wall = new THREE.Mesh(
      keep(new THREE.PlaneGeometry(520, 240)),
      keep(
        new THREE.MeshStandardMaterial({
          color: 0x0d0e11,
          metalness: 0,
          roughness: 1,
          envMapIntensity: 0,
          transparent: true,
          opacity: 0,
        })
      )
    );
    wall.position.set(0, FLOOR_Y + 120, WALL_Z);
    wall.renderOrder = -2;
    wall.rotation.y = Math.PI;
    scene.add(wall);
    const wallLowMat = keep(new THREE.MeshBasicMaterial({ map: T.low, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    const wallHighMat = keep(new THREE.MeshBasicMaterial({ map: T.high, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    const patGeo = keep(new THREE.PlaneGeometry(116, 58));
    const wallLow = new THREE.Mesh(patGeo, wallLowMat);
    const wallHigh = new THREE.Mesh(patGeo, wallHighMat);
    [wallLow, wallHigh].forEach((m) => {
      m.position.set(PJ.x, PJ.y - 4, WALL_Z - 0.3);
      /* Devor haydovchi tomondan ko'riladi: π burilish teksturaning o'ng
         chetini haydovchining O'NG tomoniga qo'yadi — yaqin nurning
         ko'tarilgan qismi (o'ng yo'l chekkasi) to'g'ri tomonda. */
      m.rotation.y = Math.PI;
      m.renderOrder = 2;
      scene.add(m);
    });
    // devorga yozuv — «KESISH CHIZIG'I»
    const tagMat = keep(
      new THREE.MeshBasicMaterial({
        map: keep(textTex(THREE, "UZBROVV · BI-LED TEST", { w: 1024, h: 96, size: 44, color: "rgba(255,255,255,0.22)" })),
        transparent: true,
        depthWrite: false,
      })
    );
    const tag = new THREE.Mesh(keep(new THREE.PlaneGeometry(84, 8)), tagMat);
    tag.position.set(PJ.x, FLOOR_Y + 42, WALL_Z - 0.4);
    tag.rotation.y = Math.PI;
    scene.add(tag);

    // fara ichidagi gravyura
    const engr = new THREE.Mesh(
      keep(new THREE.PlaneGeometry(13, 2.4)),
      keep(
        new THREE.MeshStandardMaterial({
          map: keep(textTex(THREE, "UZBROVV", { size: 58, color: "rgba(255,255,255,0.9)", spacing: 14 })),
          transparent: true,
          metalness: 0.9,
          roughness: 0.25,
          opacity: 0.55,
          depthWrite: false,
        })
      )
    );
    engr.position.set(16.5, -5.2, BACK_Z + 0.2 + 3.5);
    engr.rotation.y = 0.1;
    lamp.add(engr);

    /* ================================================= HOLAT VA ANIMATSIYA */
    const st = {
      cfg: { lens: "r80", inner: "chrome", ring: "plain", finish: "chrome", glow: "#59b7ff", glass: false, housing: false },
      mode: "off",
      view: "front",
      lv: { drl: 0, low: 0, high: 0, ring: 0, glass: 0, housing: 0, sweep: -1, pop: 1, flash: 0, wall: 0 },
      ringColor: new THREE.Color("#59b7ff"),
      ringTarget: new THREE.Color("#59b7ff"),
      beamColor: new THREE.Color("#f4f8ff"),
      yaw: 0,
      pitch: 0,
      vyaw: 0,
      vpitch: 0,
      zoom: 1,
      zoomT: 1,
      camPos: new THREE.Vector3(30, 2, 260),
      camAt: new THREE.Vector3(0, 0, -4),
      camPosT: new THREE.Vector3(),
      camAtT: new THREE.Vector3(),
      lastTouch: 0,
      running: false,
      raf: 0,
      last: 0,
      t: 0,
      ready: false,
      skip: false,
      haze: 0, // 0..1 — oksidlangan (sarg'aygan) shisha, polirovka ko'rinishi uchun
    };

    const VIEWS = {
      // [nishon nuqta, yo'nalish (normallashtiriladi), masofa koeffitsienti]
      front: { at: [0.5, 0.2, -3], dir: [0.28, 0.13, 1], fit: 1 },
      lens: { at: [PJ.x, PJ.y, pjFront - 1], dir: [0.32, 0.12, 1], fit: 0.36 },
      side: { at: [1, 0, -6], dir: [1, 0.22, 0.42], fit: 1.1 },
      beam: { at: [PJ.x, 6, 95], dir: [0.04, 0.32, -1], fit: 1 },
    };

    function fitDistance() {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      const aspect = w / h;
      const vf = THREE.MathUtils.degToRad(camera.fov) / 2;
      const needW = 70;
      const needH = 34;
      return Math.max(needH / 2 / Math.tan(vf), needW / 2 / (Math.tan(vf) * aspect)) * 1.08;
    }

    function aimView(name, instant) {
      const v = VIEWS[name] || VIEWS.front;
      st.view = VIEWS[name] ? name : "front";
      const dist = fitDistance() * v.fit * st.zoomT;
      const dir = new THREE.Vector3().fromArray(v.dir).normalize();
      st.camAtT.fromArray(v.at);
      st.camPosT.copy(st.camAtT).addScaledVector(dir, name === "beam" ? 260 * st.zoomT : dist);
      if (instant) {
        st.camPos.copy(st.camPosT);
        st.camAt.copy(st.camAtT);
      }
    }

    function applyMaterialTargets(dt) {
      const k = 1 - Math.exp(-7 * dt);
      const inn = INNER[st.cfg.inner] || INNER.chrome;
      M.inner.color.lerp(inn.color, k);
      M.inner.metalness = damp(M.inner.metalness, inn.metal, 7, dt);
      M.inner.roughness = damp(M.inner.roughness, inn.rough, 7, dt);
      const fin = FINISH[st.cfg.finish] || FINISH.chrome;
      M.shroud.color.lerp(fin.color, k);
      M.shroud.metalness = damp(M.shroud.metalness, fin.metal, 7, dt);
      M.shroud.roughness = damp(M.shroud.roughness, fin.rough, 7, dt);
      M.shroud.clearcoat = damp(M.shroud.clearcoat, fin.cc, 7, dt);
      const h = st.lv.housing;
      M.shell.color.copy(SHELL.old.color).lerp(SHELL.fresh.color, h);
      M.shell.roughness = SHELL.old.rough + (SHELL.fresh.rough - SHELL.old.rough) * h;
      M.shell.clearcoat = SHELL.old.cc + (SHELL.fresh.cc - SHELL.old.cc) * h;
    }

    function applyLights() {
      const lv = st.lv;
      const look = pjParts.look || LENS_LOOK.r80;
      const pw = look.power;
      const beam = st.beamColor;
      const lowHigh = lv.low * 0.8 + lv.high * 0.45;
      // linza
      if (pjParts.insideMat) {
        pjParts.insideMat.emissive.copy(beam);
        pjParts.insideMat.emissiveIntensity = (lv.low * 2.2 + lv.high * 1.3) * pw + lv.flash * 2;
      }
      if (pjParts.glow) {
        pjParts.glow.material.color.copy(beam);
        pjParts.glow.material.opacity = clamp(lowHigh * 0.75 * pw + lv.flash * 0.5, 0, 1);
        const s = look.radius * (2.9 + lv.high * 1.7) * (0.9 + pw * 0.12);
        pjParts.glow.scale.set(s, s, 1);
      }
      if (pjParts.corona) pjParts.corona.material.opacity = 0.45 + (lv.low + lv.high) * 0.55;
      innerLight.color.copy(beam);
      innerLight.intensity = (lv.low * 340 + lv.high * 260) * pw;
      // nur konusi
      coneMat.color.copy(beam);
      coneMat.opacity = clamp((lv.low * 0.13 + lv.high * 0.12) * pw, 0, 0.4);
      cone.scale.set(0.78 + lv.high * 0.42, 0.42 + lv.high * 0.5, 1);
      cone.rotation.x = 0.045 * (1 - lv.high);
      // pol va devor
      pool.material.color.copy(beam);
      pool.material.opacity = clamp((lv.low * 0.32 + lv.high * 0.24) * pw, 0, 0.6);
      pool.scale.set(0.85 + lv.high * 0.3, 1, 0.8 + lv.high * 0.55);
      wallLowMat.color.copy(beam);
      wallHighMat.color.copy(beam);
      wall.material.opacity = st.lv.wall;
      wall.visible = st.lv.wall > 0.01;
      wallLowMat.opacity = clamp(lv.low * (1 - lv.high) * pw * 0.85, 0, 0.95) * st.lv.wall;
      wallHighMat.opacity = clamp(lv.high * pw * 0.62, 0, 0.8) * st.lv.wall;
      tagMat.opacity = st.lv.wall;
      // DRL
      M.drl.emissiveIntensity = lv.drl * 3.2;
      drlGlows.forEach((s) => (s.material.opacity = lv.drl * 0.42));
      drlLight.intensity = lv.drl * 70;
      // uzoq nur lampochkasi
      M.bulb.emissiveIntensity = lv.high * 6;
      bulbGlow.material.opacity = lv.high * 0.8;
      // BMW yonadigan halqa
      const ringOn = lv.ring;
      M.ring.color.copy(st.ringColor).lerp(new THREE.Color(0xffffff), 0.35 * (1 - ringOn));
      M.ring.emissive.copy(st.ringColor);
      M.ring.emissiveIntensity = 0.08 + ringOn * 3.4;
      if (pjParts.ringGlow) {
        pjParts.ringGlow.material.color.copy(st.ringColor);
        pjParts.ringGlow.material.opacity = ringOn * 0.95;
      }
      ringLight.color.copy(st.ringColor);
      ringLight.intensity = ringOn * 55;
      // shisha: 0 — hozirgi (xira), 1 — yangi (tiniq)
      const gl = st.lv.glass;
      const hz = st.haze;
      // hz — kuchli oksidlanish: sarg'ish-sutsimon qatlam ichki qismlarni yopadi
      glassTint.opacity = (0.12 * (1 - gl) + 0.025 * gl) * (1 - hz) + 0.58 * hz;
      glassTint.color.setRGB(1, 1 - 0.12 * hz, 1 - 0.45 * hz);
      glassTint.map = gl > 0.985 && hz < 0.01 ? null : T.haze;
      glassTint.needsUpdate = glassTint.userData.hadMap !== !!glassTint.map;
      glassTint.userData.hadMap = !!glassTint.map;
      glassSpec.roughness = (0.32 * (1 - gl) + 0.03 * gl) * (1 - hz) + 0.6 * hz;
      glassSpec.envMapIntensity = (1.1 + gl * 1.4) * (1 - hz * 0.6);
      if (hz > 0 && pjParts.glow) {
        // xira shisha nurni sochadi: dog' kattaroq, lekin xiraroq
        pjParts.glow.scale.multiplyScalar(1 + hz * 0.9);
        pjParts.glow.material.opacity *= 1 - hz * 0.3;
      }
      // yaltiroq chiziq
      if (st.lv.sweep > -1) {
        T.sweep.offset.x = st.lv.sweep;
        sweepMat.opacity = 0.75 * Math.sin(clamp((st.lv.sweep + 1) / 2, 0, 1) * Math.PI);
      } else {
        sweepMat.opacity = 0;
      }
    }

    function rebuildProjector() {
      if (pj) {
        lamp.remove(pj);
        disposeTree(pj);
      }
      pjParts = buildProjector(st.cfg);
      pj = pjParts.group;
      lamp.add(pj);
      st.lv.pop = 0.9;
      st.lv.flash = 1;
      st.beamColor.copy(kelvinColor(THREE, pjParts.look.kelvin));
    }

    /* ---------------------------------------------------------- kadr */
    function frame(now) {
      if (!st.running) return;
      st.raf = requestAnimationFrame(frame);
      const idle = now - st.lastTouch > 4000;
      // tinch holatda kadr tezligi yarmi (batareya)
      if (idle && (lite || st.skip)) {
        st.skip = !st.skip;
        if (st.skip) return;
      }
      const dt = Math.min(0.05, st.last ? (now - st.last) / 1000 : 0.016);
      st.last = now;
      st.t += dt;
      const lv = st.lv;
      const m = st.mode;
      lv.drl = damp(lv.drl, m === "off" ? 0 : 1, 6, dt);
      lv.low = damp(lv.low, m === "low" || m === "high" ? 1 : 0, 5, dt);
      lv.high = damp(lv.high, m === "high" ? 1 : 0, 5, dt);
      lv.ring = damp(lv.ring, st.cfg.ring === "glow" && m !== "off" ? 1 : 0, 5, dt);
      lv.glass = damp(lv.glass, st.cfg.glass ? 1 : 0, 2.6, dt);
      lv.housing = damp(lv.housing, st.cfg.housing ? 1 : 0, 3, dt);
      lv.pop = damp(lv.pop, 1, 9, dt);
      lv.wall = damp(lv.wall, st.view === "beam" ? 1 : 0, 4, dt);
      lv.flash = damp(lv.flash, 0, 3.5, dt);
      if (lv.sweep > -1) {
        lv.sweep -= dt * 1.25;
        if (lv.sweep < -0.75) lv.sweep = -1;
      }
      st.ringColor.lerp(st.ringTarget, 1 - Math.exp(-8 * dt));
      if (pj) pj.scale.setScalar(lv.pop);

      // aylantirish inersiyasi va tinch tebranish
      if (!st.dragging) {
        st.yaw += st.vyaw;
        st.pitch += st.vpitch;
        st.vyaw *= 0.92;
        st.vpitch *= 0.92;
        if (idle && st.view !== "beam") {
          st.yaw = damp(st.yaw, Math.sin(st.t * 0.35) * 0.16, 0.8, dt);
          st.pitch = damp(st.pitch, Math.sin(st.t * 0.27) * 0.04, 0.8, dt);
        }
      }
      st.yaw = clamp(st.yaw, -1.05, 1.05);
      st.pitch = clamp(st.pitch, -0.4, 0.45);
      rig.rotation.set(st.pitch, st.yaw, 0);
      lamp.position.y = Math.sin(st.t * 1.1) * 0.12;

      // kamera
      st.zoom = damp(st.zoom, st.zoomT, 8, dt);
      st.camPos.lerp(st.camPosT, 1 - Math.exp(-3.2 * dt));
      st.camAt.lerp(st.camAtT, 1 - Math.exp(-3.6 * dt));
      camera.position.copy(st.camPos);
      camera.lookAt(st.camAt);

      applyMaterialTargets(dt);
      applyLights();
      renderer.render(scene, camera);
      if (!st.ready) {
        st.ready = true;
        if (opts.onReady) opts.onReady();
      }
    }

    /* ---------------------------------------------------------- o'lcham */
    function resize() {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      renderer.setSize(w, h, false);
      cnv.style.width = w + "px";
      cnv.style.height = h + "px";
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      aimView(st.view);
    }
    let ro = null;
    if (window.ResizeObserver) {
      ro = new ResizeObserver(() => resize());
      ro.observe(host);
    } else {
      window.addEventListener("resize", resize);
    }

    /* ---------------------------------------------------- barmoq bilan */
    const pointers = new Map();
    let pinch0 = 0;
    let zoom0 = 1;
    let lastTap = 0;
    cnv.style.touchAction = "none";
    function onDown(e) {
      cnv.setPointerCapture && cnv.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      st.lastTouch = performance.now();
      st.dragging = true;
      st.vyaw = 0;
      st.vpitch = 0;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
        zoom0 = st.zoomT;
      } else {
        const now = performance.now();
        if (now - lastTap < 300) reset();
        lastTap = now;
      }
    }
    function onMove(e) {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      st.lastTouch = performance.now();
      if (pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch0 > 0) {
          st.zoomT = clamp(zoom0 * (pinch0 / d), 0.55, 1.5);
          aimView(st.view);
        }
        return;
      }
      st.yaw += dx * 0.0065;
      st.pitch += dy * 0.004;
      st.vyaw = dx * 0.0065;
      st.vpitch = dy * 0.004;
      if (opts.onInteract) opts.onInteract();
    }
    function onUp(e) {
      pointers.delete(e.pointerId);
      if (!pointers.size) st.dragging = false;
      if (pointers.size < 2) pinch0 = 0;
    }
    function onWheel(e) {
      e.preventDefault();
      st.lastTouch = performance.now();
      st.zoomT = clamp(st.zoomT * (e.deltaY > 0 ? 1.08 : 0.92), 0.55, 1.5);
      aimView(st.view);
    }
    cnv.addEventListener("pointerdown", onDown);
    cnv.addEventListener("pointermove", onMove);
    cnv.addEventListener("pointerup", onUp);
    cnv.addEventListener("pointercancel", onUp);
    cnv.addEventListener("wheel", onWheel, { passive: false });

    function onLost(e) {
      e.preventDefault();
      pause();
      if (opts.onLost) opts.onLost();
    }
    cnv.addEventListener("webglcontextlost", onLost);

    function reset() {
      st.yaw = 0;
      st.pitch = 0;
      st.vyaw = 0;
      st.vpitch = 0;
      st.zoomT = 1;
      aimView(st.view);
    }

    /* ------------------------------------------------------------- API */
    function set(cfg) {
      const prev = st.cfg;
      const next = Object.assign({}, prev, cfg || {});
      const rebuild =
        !pj ||
        next.lens !== prev.lens ||
        next.size !== prev.size ||
        next.ring !== prev.ring;
      st.cfg = next;
      if (next.glow) {
        try {
          st.ringTarget.set(next.glow);
        } catch (_) {}
      }
      if (rebuild) rebuildProjector();
      if (!!next.glass !== !!prev.glass && next.glass) st.lv.sweep = 1;
      if (!!next.housing !== !!prev.housing && next.housing) st.lv.sweep = 1;
      st.lastTouch = performance.now();
    }

    function light(mode) {
      st.mode = ["off", "drl", "low", "high"].includes(mode) ? mode : "off";
      if (st.mode !== "off") st.lv.flash = Math.max(st.lv.flash, 0.4);
      st.lastTouch = performance.now();
    }

    function view(name) {
      st.yaw = 0;
      st.pitch = 0;
      st.vyaw = 0;
      st.vpitch = 0;
      st.zoomT = 1;
      aimView(name);
      st.lastTouch = performance.now();
    }

    /** Kirish: kamera uzoqdan suzib keladi, keyin DRL va yaqin nur yonadi. */
    function intro(done) {
      aimView("front", true);
      const dir = st.camPos.clone().sub(st.camAt).normalize();
      st.camPos.copy(st.camAt).addScaledVector(dir, fitDistance() * 2.1).add(new THREE.Vector3(-30, -8, 0));
      st.mode = "off";
      st.yaw = -0.5;
      setTimeout(() => light("drl"), 1100);
      setTimeout(() => {
        light("low");
        if (done) done();
      }, 1900);
    }

    function start() {
      if (st.running) return;
      st.running = true;
      st.last = 0;
      st.raf = requestAnimationFrame(frame);
    }
    function pause() {
      st.running = false;
      cancelAnimationFrame(st.raf);
    }
    function dispose() {
      pause();
      cnv.removeEventListener("webglcontextlost", onLost);
      if (ro) ro.disconnect();
      else window.removeEventListener("resize", resize);
      if (pj) disposeTree(pj);
      disposables.forEach((d) => d && d.dispose && d.dispose());
      if (scene.environment) scene.environment.dispose();
      renderer.dispose();
      // WebGL kontekstini darhol bo'shatamiz (brauzerda ularning soni cheklangan)
      try {
        renderer.forceContextLoss();
      } catch (_) {}
      if (cnv.parentNode) cnv.parentNode.removeChild(cnv);
    }

    /** Bitta kadrni darhol chizib, rasm (data URL) qaytaradi — animatsiyasiz.
     *  Polirovka «oldin/keyin» surgichi shu bilan ikki holatni oladi:
     *    snapshot({cfg, mode, view, haze, yaw, pitch, zoom}). */
    function snapshot(o) {
      const opt = o || {};
      pause();
      set(opt.cfg || {});
      st.mode = ["off", "drl", "low", "high"].includes(opt.mode) ? opt.mode : "off";
      st.haze = clamp(Number(opt.haze) || 0, 0, 1);
      const lv = st.lv;
      const on = st.mode !== "off";
      lv.drl = on ? 1 : 0;
      lv.low = st.mode === "low" || st.mode === "high" ? 1 : 0;
      lv.high = st.mode === "high" ? 1 : 0;
      lv.ring = st.cfg.ring === "glow" && on ? 1 : 0;
      lv.glass = st.cfg.glass ? 1 : 0;
      lv.housing = st.cfg.housing ? 1 : 0;
      lv.pop = 1;
      lv.flash = 0;
      lv.sweep = -1;
      lv.wall = opt.view === "beam" ? 1 : 0;
      if (pj) pj.scale.setScalar(1);
      st.ringColor.copy(st.ringTarget);
      st.yaw = Number(opt.yaw) || 0;
      st.pitch = Number(opt.pitch) || 0;
      rig.rotation.set(st.pitch, st.yaw, 0);
      lamp.position.y = 0;
      st.zoomT = st.zoom = Number(opt.zoom) || 1;
      aimView(opt.view || "front", true);
      camera.position.copy(st.camPos);
      camera.lookAt(st.camAt);
      applyMaterialTargets(10);
      applyLights();
      renderer.render(scene, camera);
      return cnv.toDataURL(opt.type || "image/png");
    }

    rebuildProjector();
    resize();
    aimView("front", true);
    start();

    return {
      set: set,
      light: light,
      view: view,
      intro: intro,
      reset: reset,
      pause: pause,
      resume: start,
      resize: resize,
      dispose: dispose,
      snapshot: snapshot,
      get mode() {
        return st.mode;
      },
      get currentView() {
        return st.view;
      },
      _debug: { renderer, scene, camera, st },
    };
  }

  return { supported: supported, create: create, LENS_LOOK: LENS_LOOK };
})();
