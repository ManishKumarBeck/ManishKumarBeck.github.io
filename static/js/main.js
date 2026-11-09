/* Progressive enhancement only: the site is complete without this file. */
(() => {
  const root = document.documentElement;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const canHover = matchMedia("(hover: hover) and (pointer: fine)").matches;

  /* Navigation */
  const nav = document.querySelector("[data-nav]");
  const toggle = document.querySelector("[data-nav-toggle]");

  const setMenu = (open) => {
    toggle.setAttribute("aria-expanded", String(open));
    nav.classList.toggle("is-open", open);
    root.classList.toggle("menu-open", open);
  };

  toggle.addEventListener("click", () => setMenu(toggle.getAttribute("aria-expanded") !== "true"));
  nav.addEventListener("click", (event) => {
    if (event.target.closest("#site-nav a")) setMenu(false);
  });
  addEventListener("keydown", (event) => {
    if (event.key === "Escape" && nav.classList.contains("is-open")) {
      setMenu(false);
      toggle.focus();
    }
  });
  matchMedia("(min-width: 821px)").addEventListener("change", () => setMenu(false));

  const onScroll = () => nav.classList.toggle("is-stuck", scrollY > 12);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* Highlight the section currently in view */
  const links = new Map();
  document.querySelectorAll("#site-nav a").forEach((link) => {
    const id = new URL(link.href).hash.slice(1);
    const section = id && location.pathname === new URL(link.href).pathname && document.getElementById(id);
    if (section) links.set(section, link);
  });
  if (links.size && "IntersectionObserver" in window) {
    const spy = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const link = links.get(entry.target);
          if (entry.isIntersecting) link.setAttribute("aria-current", "true");
          else link.removeAttribute("aria-current");
        });
      },
      { rootMargin: "-45% 0px -50% 0px" }
    );
    links.forEach((_, section) => spy.observe(section));
  }

  /* Scroll reveal */
  const revealed = document.querySelectorAll("[data-reveal]");
  if (reduced || !("IntersectionObserver" in window)) {
    revealed.forEach((el) => el.classList.add("is-in"));
  } else {
    const reveal = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-in");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.05 }
    );
    revealed.forEach((el) => reveal.observe(el));
  }

  /* Pointer-tracked highlight on cards */
  if (canHover && !reduced) {
    document.querySelectorAll("[data-spot]").forEach((card) => {
      card.addEventListener("pointermove", (event) => {
        const box = card.getBoundingClientRect();
        card.style.setProperty("--x", `${event.clientX - box.left}px`);
        card.style.setProperty("--y", `${event.clientY - box.top}px`);
      });
    });
  }

  /* Hero trace: replays while on screen, and scrubs under the pointer */
  const trace = document.querySelector("[data-trace]");
  if (trace && !reduced) {
    const RUN = 5200;
    const PAUSE = 2400;
    let timer = 0;
    let scrubbing = false;
    let visible = false;
    const play = () => {
      trace.classList.remove("is-running");
      void trace.offsetWidth;
      trace.classList.add("is-running");
      timer = setTimeout(play, RUN + PAUSE);
    };
    const watch = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      clearTimeout(timer);
      if (visible && !scrubbing) play();
    });
    trace.classList.add("is-animated");
    watch.observe(trace);

    if (canHover) {
      const spans = [...trace.querySelectorAll(".span")].map((el) => ({
        el,
        bar: el.querySelector(".span__bar"),
        start: parseFloat(el.style.getPropertyValue("--s")),
        size: parseFloat(el.style.getPropertyValue("--w")),
      }));
      const track = trace.querySelector(".span__track");
      const rows = trace.querySelector(".trace__rows");
      const head = document.createElement("span");
      head.className = "trace__head";
      head.setAttribute("aria-hidden", "true");
      trace.append(head);

      trace.addEventListener("pointermove", (event) => {
        const box = track.getBoundingClientRect();
        const panel = trace.getBoundingClientRect();
        const at = Math.min(100, Math.max(0, ((event.clientX - box.left) / box.width) * 100));
        if (!scrubbing) {
          scrubbing = true;
          clearTimeout(timer);
          trace.classList.remove("is-running");
          trace.classList.add("is-scrubbing");
          const list = rows.getBoundingClientRect();
          head.style.top = `${list.top - panel.top}px`;
          head.style.height = `${list.height}px`;
        }
        head.style.transform = `translateX(${box.left - panel.left + (at / 100) * box.width}px)`;
        spans.forEach(({ el, bar, start, size }) => {
          const fill = Math.min(1, Math.max(0, (at - start) / size));
          bar.style.transform = `scaleX(${fill})`;
          el.classList.toggle("is-lit", at >= start);
        });
        trace.classList.toggle("is-done", at >= 99);
      });

      trace.addEventListener("pointerleave", () => {
        scrubbing = false;
        trace.classList.remove("is-scrubbing", "is-done");
        spans.forEach(({ el, bar }) => {
          bar.style.transform = "";
          el.classList.remove("is-lit");
        });
        if (visible) play();
      });
    }
  }

  /* Screenshot tabs */
  document.querySelectorAll("[data-tabs]").forEach((group) => {
    const tabs = [...group.querySelectorAll('[role="tab"]')];
    const select = (tab, focus) => {
      tabs.forEach((item) => {
        const active = item === tab;
        item.setAttribute("aria-selected", String(active));
        item.tabIndex = active ? 0 : -1;
        document.getElementById(item.getAttribute("aria-controls")).hidden = !active;
      });
      if (focus) tab.focus();
    };
    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => select(tab));
      tab.addEventListener("keydown", (event) => {
        const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
        if (!step) return;
        event.preventDefault();
        select(tabs[(index + step + tabs.length) % tabs.length], true);
      });
    });
  });

  /* Project tiles: a muted preview clip, fetched only on first hover */
  if (canHover && !reduced) {
    document.querySelectorAll("[data-preview]").forEach((tile) => {
      let video;
      const start = () => {
        if (!video) {
          video = Object.assign(document.createElement("video"), {
            src: tile.dataset.preview,
            muted: true,
            loop: true,
            playsInline: true,
          });
          video.setAttribute("aria-hidden", "true");
          video.addEventListener("playing", () => tile.classList.add("is-playing"));
          tile.querySelector(".tile__media").append(video);
        }
        video.play().catch(() => {});
      };
      const stop = () => {
        tile.classList.remove("is-playing");
        if (video) video.pause();
      };
      tile.addEventListener("pointerenter", start);
      tile.addEventListener("pointerleave", stop);
      tile.addEventListener("focus", start);
      tile.addEventListener("blur", stop);
    });
  }

  /* Clips on project pages play only while visible */
  const clips = document.querySelectorAll("video[data-autoplay]");
  if (reduced) {
    clips.forEach((video) => (video.controls = true));
  } else if (clips.length) {
    const player = new IntersectionObserver(
      (entries) => {
        entries.forEach(({ target, isIntersecting }) => {
          if (isIntersecting) target.play().catch(() => (target.controls = true));
          else target.pause();
        });
      },
      { threshold: 0.35 }
    );
    clips.forEach((video) => {
      video.addEventListener("waiting", () => video.parentElement.classList.add("is-loading"));
      video.addEventListener("playing", () => video.parentElement.classList.remove("is-loading"));
      player.observe(video);
    });
  }

  /* Fade images in once loaded */
  document.querySelectorAll("img").forEach((img) => {
    if (img.complete) return;
    img.classList.add("is-pending");
    const done = () => img.classList.remove("is-pending");
    img.addEventListener("load", done, { once: true });
    img.addEventListener("error", done, { once: true });
  });

  /* Copy email */
  const toast = document.querySelector("[data-toast]");
  let toastTimer = 0;
  const say = (message) => {
    toast.textContent = message;
    toast.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-on"), 2400);
  };
  document.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        say("Email address copied");
      } catch {
        say(button.dataset.copy);
      }
    });
  });
})();
