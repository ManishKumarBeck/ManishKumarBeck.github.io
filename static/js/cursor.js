/* Cursor layer: a hidden dot field that heats up under the pointer, a reticle
   that locks onto interactive elements, and a pulse on click or tap.
   Runs on one rAF loop that stops when nothing is moving. Skipped entirely for
   reduced-motion users; touch devices get the tap pulse only. */
(() => {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;

  const GRID = 28;            // Matches the hero dot grid in main.css
  const REACH = 140;          // Pointer radius that heats dots, in px
  const PUSH = 7;             // Max dot displacement away from the pointer
  const COOL = 0.945;         // Heat kept per frame
  const WAVE_MAX = 300;
  const WAVE_SPEED = 8;
  const SIGNAL = "#f0b45a";
  const BLUE = "#7f9fc6";

  const canvas = document.createElement("canvas");
  canvas.className = "field";
  canvas.setAttribute("aria-hidden", "true");
  document.body.prepend(canvas);
  const ctx = canvas.getContext("2d");

  let width = 0;
  let height = 0;
  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    width = innerWidth;
    height = innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  addEventListener("resize", resize, { passive: true });

  /* Shared loop */
  const heat = new Map();     // "col,row" -> 0..1, in page coordinates
  const waves = [];
  let running = false;
  let px = -1e4;              // Pointer, viewport coordinates
  let py = -1e4;
  let ex = px;                // Eased pointer
  let ey = py;
  let hot = false;            // Pointer moved recently
  let hotTimer = 0;

  const warm = (col, row, amount) => {
    const key = `${col},${row}`;
    if ((heat.get(key) || 0) < amount) heat.set(key, amount);
  };

  const heatAround = (cx, cy, reach, strength, inner = 0) => {
    const minCol = Math.floor((cx - reach) / GRID);
    const maxCol = Math.ceil((cx + reach) / GRID);
    const minRow = Math.floor((cy - reach) / GRID);
    const maxRow = Math.ceil((cy + reach) / GRID);
    for (let col = minCol; col <= maxCol; col++) {
      for (let row = minRow; row <= maxRow; row++) {
        const dist = Math.hypot(col * GRID + 14 - cx, row * GRID + 14 - cy);
        if (dist > reach || dist < inner) continue;
        warm(col, row, strength * (1 - (dist - inner) / (reach - inner)));
      }
    }
  };

  const drawField = () => {
    ctx.clearRect(0, 0, width, height);
    const top = scrollY;
    for (const [key, value] of heat) {
      const next = value * COOL;
      if (next < 0.03) heat.delete(key);
      else heat.set(key, next);

      const [col, row] = key.split(",").map(Number);
      let x = col * GRID + 14;
      let y = row * GRID + 14 - top;
      if (y < -8 || y > height + 8) continue;

      const dx = x - ex;
      const dy = y - ey;
      const dist = Math.hypot(dx, dy) || 1;
      if (dist < REACH) {
        const shove = (1 - dist / REACH) * PUSH;
        x += (dx / dist) * shove;
        y += (dy / dist) * shove;
      }
      ctx.globalAlpha = Math.min(1, value * 1.1);
      ctx.fillStyle = value > 0.5 ? SIGNAL : BLUE;
      ctx.beginPath();
      ctx.arc(x, y, 1 + value * 1.7, 0, 6.283);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  const tick = () => {
    ex += (px - ex) * 0.2;
    ey += (py - ey) * 0.2;
    if (hot) heatAround(ex, ey + scrollY, REACH, 0.95);

    for (let i = waves.length - 1; i >= 0; i--) {
      const wave = waves[i];
      wave.r += WAVE_SPEED;
      if (wave.r > WAVE_MAX) {
        waves.splice(i, 1);
        continue;
      }
      heatAround(wave.x, wave.y, wave.r + 20, 1 - wave.r / WAVE_MAX, Math.max(0, wave.r - 20));
    }

    drawField();
    const moving = reticle ? reticle.step() : false;

    if (heat.size || waves.length || hot || moving) {
      requestAnimationFrame(tick);
    } else {
      running = false;
      ctx.clearRect(0, 0, width, height);
    }
  };

  const wake = () => {
    if (running) return;
    running = true;
    requestAnimationFrame(tick);
  };

  /* Reticle */
  const TARGETS = "a, button, summary, .chip--shown";

  const describe = (el) => {
    if (el.matches(".chip--shown")) return "in a public project";
    if (el.matches("[data-copy]")) return "copy";
    if (el.matches('[role="tab"]')) return "view";
    if (el.matches("summary")) return "expand";
    if (el.matches(".tile")) return "preview";
    const href = el.getAttribute("href") || "";
    if (href.startsWith("mailto:")) return "email";
    if (href.startsWith("tel:")) return "call";
    if (el.target === "_blank") return "external";
    return href.includes("#") ? "jump" : "open";
  };

  const createReticle = () => {
    const root = document.createElement("div");
    root.className = "probe";
    root.setAttribute("aria-hidden", "true");
    root.innerHTML = "<i></i><i></i><i></i><i></i><b></b>";
    document.body.append(root);

    const ticks = [...root.querySelectorAll("i")].map((el, index) => ({
      el,
      sx: index === 0 || index === 3 ? -1 : 1,   // Corner direction
      sy: index < 2 ? -1 : 1,
      x: 0,
      y: 0,
    }));
    const label = root.querySelector("b");
    let locked = null;
    let press = 0;
    let lx = 0;
    let ly = 0;

    return {
      lock(el) {
        if (el === locked) return;
        locked = el;
        root.classList.toggle("is-locked", Boolean(el));
        if (el) label.textContent = describe(el);
        wake();
      },
      press() {
        press = 1;
        wake();
      },
      show(on) {
        root.classList.toggle("is-on", on);
      },
      jump(x, y) {
        ticks.forEach((tick) => {
          tick.x = x;
          tick.y = y;
        });
      },
      step() {
        if (locked && !locked.isConnected) this.lock(null);
        const box = locked && locked.getBoundingClientRect();
        const ease = locked ? 0.26 : 0.34;
        const gap = 5 - press * 3;
        let moved = 0;

        ticks.forEach((tick) => {
          const tx = box ? (tick.sx < 0 ? box.left : box.right) + tick.sx * gap : px + tick.sx * (9 - press * 4);
          const ty = box ? (tick.sy < 0 ? box.top : box.bottom) + tick.sy * gap : py + tick.sy * (9 - press * 4);
          const dx = tx - tick.x;
          const dy = ty - tick.y;
          tick.x += dx * ease;
          tick.y += dy * ease;
          moved += Math.abs(dx) + Math.abs(dy);
          tick.el.style.transform = `translate3d(${tick.x}px, ${tick.y}px, 0)`;
        });

        if (box) {
          const tx = Math.min(Math.max(8, box.left - gap), width - label.offsetWidth - 8);
          const below = box.bottom + 10 + 24 < height;
          const ty = below ? box.bottom + 10 : box.top - 32;
          lx += (tx - lx) * 0.3;
          ly += (ty - ly) * 0.3;
          label.style.transform = `translate3d(${lx}px, ${ly}px, 0)`;
        } else {
          lx = px;
          ly = py;
        }

        press *= 0.82;
        if (press < 0.01) press = 0;
        return moved > 0.2 || press > 0;
      },
    };
  };

  const reticle = fine ? createReticle() : null;

  /* Input */
  if (fine) {
    let seen = false;
    let probing = false;

    const heatUp = () => {
      hot = true;
      clearTimeout(hotTimer);
      hotTimer = setTimeout(() => (hot = false), 90);
      wake();
    };

    /* Scrolling moves the page under a still pointer: browsers report no
       pointer events for that, so re-check what is beneath it once per frame. */
    const probe = () => {
      probing = false;
      if (seen) reticle.lock(document.elementFromPoint(px, py)?.closest(TARGETS) || null);
    };

    addEventListener(
      "pointermove",
      (event) => {
        px = event.clientX;
        py = event.clientY;
        if (!seen) {
          seen = true;
          ex = px;
          ey = py;
          reticle.jump(px, py);
          reticle.show(true);
        }
        heatUp();
      },
      { passive: true }
    );

    document.addEventListener("pointerover", (event) => {
      reticle.lock(event.target.closest?.(TARGETS) || null);
    });
    document.documentElement.addEventListener("pointerleave", () => {
      seen = false;
      reticle.show(false);
      reticle.lock(null);
    });
    addEventListener(
      "scroll",
      () => {
        if (!seen) return wake();
        heatUp();
        if (!probing) {
          probing = true;
          requestAnimationFrame(probe);
        }
      },
      { passive: true }
    );
  }

  addEventListener(
    "pointerdown",
    (event) => {
      waves.push({ x: event.clientX, y: event.clientY + scrollY, r: 0 });
      if (reticle) reticle.press();
      wake();
    },
    { passive: true }
  );
})();
