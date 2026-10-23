export function initMotion(gsap, ScrollTrigger) {
  const media = gsap.matchMedia();
  media.add("(prefers-reduced-motion: no-preference)", () => createMotion(gsap, ScrollTrigger));
}

function createMotion(gsap, ScrollTrigger) {
  const hero = document.querySelector(".hero-section");
  const header = document.querySelector(".site-header");
  const heroLines = [...document.querySelectorAll(".hero-title .title-line")];
  const heroNavItems = [...document.querySelectorAll(".desktop-nav > *, .brand-lockup")];
  const heroCopyItems = [...document.querySelectorAll(".hero-support, .hero-actions")];
  const motif = document.querySelector(".hero-motif");
  const workWindow = document.querySelector(".hero-work");
  const heroNoteWindow = document.querySelector(".hero-note-window");
  const heroNoteImage = heroNoteWindow?.querySelector("img");
  const cleanups = [];

  if (!hero || !motif || !workWindow || !heroNoteWindow) return;

  const clearWillChange = (targets) => gsap.set(targets, { clearProps: "willChange" });
  const setActiveWillChange = (targets, active) => {
    if (active) gsap.set(targets, { willChange: "transform,opacity" });
    else clearWillChange(targets);
  };

  ScrollTrigger.create({
    trigger: hero,
    start: "bottom top",
    onEnter: () => header?.classList.add("is-scrolled"),
    onEnterBack: () => header?.classList.add("is-scrolled"),
    onLeaveBack: () => header?.classList.remove("is-scrolled"),
  });

  gsap.set(heroNavItems, { y: -10, autoAlpha: 0, willChange: "transform,opacity" });
  gsap.set(heroLines, { yPercent: 110, willChange: "transform" });
  gsap.set(heroCopyItems, { y: 18, autoAlpha: 0, willChange: "transform,opacity" });

  const intro = gsap.timeline({ defaults: { overwrite: "auto" } });
  intro.to(heroNavItems, {
    y: 0,
    autoAlpha: 1,
    duration: 0.52,
    stagger: 0.035,
    ease: "power3.out",
    onComplete: () => clearWillChange(heroNavItems),
  }, 0);
  intro.to(heroLines, {
    yPercent: 0,
    duration: 0.76,
    stagger: 0.09,
    ease: "expo.out",
    onComplete: () => clearWillChange(heroLines),
  }, 0.08);
  intro.to(heroCopyItems, {
    y: 0,
    autoAlpha: 1,
    duration: 0.64,
    stagger: 0.12,
    ease: "power3.out",
    onComplete: () => clearWillChange(heroCopyItems),
  }, 0.48);
  intro.fromTo(motif, {
    x: 80,
    scale: 0.92,
    rotation: -13,
    autoAlpha: 0,
    willChange: "transform,opacity",
  }, {
    x: 0,
    scale: 1,
    rotation: -8,
    autoAlpha: 1,
    duration: 1.1,
    ease: "expo.out",
    onComplete: () => clearWillChange(motif),
  }, 0.14);
  intro.fromTo(workWindow, {
    y: 60,
    autoAlpha: 0,
    willChange: "transform,opacity",
  }, {
    y: 0,
    autoAlpha: 1,
    duration: 0.78,
    ease: "expo.out",
    onComplete: () => clearWillChange(workWindow),
  }, 0.25);
  intro.fromTo(heroNoteWindow, {
    y: -30,
    autoAlpha: 0,
    willChange: "transform,opacity",
  }, {
    y: 0,
    autoAlpha: 1,
    duration: 0.72,
    ease: "back.out(1.3)",
    onComplete: () => clearWillChange(heroNoteWindow),
  }, 0.66);

  const floatTween = gsap.to(heroNoteImage, {
    y: -4,
    duration: 3,
    repeat: -1,
    yoyo: true,
    ease: "sine.inOut",
    paused: true,
  });
  const floatTrigger = ScrollTrigger.create({
    trigger: hero,
    start: "top bottom",
    end: "bottom top",
    onEnter: () => {
      gsap.set(heroNoteImage, { willChange: "transform" });
      floatTween.play();
    },
    onEnterBack: () => {
      gsap.set(heroNoteImage, { willChange: "transform" });
      floatTween.play();
    },
    onLeave: () => {
      floatTween.pause();
      gsap.set(heroNoteImage, { clearProps: "willChange" });
    },
    onLeaveBack: () => {
      floatTween.pause();
      gsap.set(heroNoteImage, { clearProps: "willChange" });
    },
  });
  cleanups.push(() => {
    floatTween.kill();
    floatTrigger.kill();
  });

  const parallax = [
    { target: motif, yPercent: 10 },
    { target: workWindow, yPercent: -7 },
    { target: heroNoteWindow, yPercent: 14 },
  ];
  for (const { target, yPercent } of parallax) {
    gsap.to(target, {
      yPercent,
      ease: "none",
      scrollTrigger: {
        trigger: hero,
        start: "top top",
        end: "bottom top",
        scrub: 0.8,
        onToggle: (self) => setActiveWillChange(target, self.isActive),
      },
    });
  }
  gsap.to(hero.querySelector(".hero-copy"), {
    y: -20,
    autoAlpha: 0.76,
    ease: "none",
    scrollTrigger: { trigger: hero, start: "top top", end: "bottom top", scrub: 0.8 },
  });

  const problem = document.querySelector("#problem");
  const statement = document.querySelector(".problem-statement");
  const counter = document.querySelector("#file-counter");
  const fileIcon = document.querySelector(".file-icon");
  if (problem && statement && counter) {
    const words = wrapWords(statement);
    const statementTween = gsap.fromTo(words, { opacity: 0.15 }, {
      opacity: 1,
      duration: 0.28,
      stagger: 0.045,
      ease: "none",
      scrollTrigger: {
        trigger: problem,
        start: "top 74%",
        end: "bottom 24%",
        scrub: true,
        onToggle: (self) => setActiveWillChange(words, self.isActive),
      },
    });
    cleanups.push(() => statementTween.scrollTrigger?.kill());

    const count = { value: 1 };
    counter.textContent = "1";
    counter.setAttribute("aria-label", "1");
    gsap.to(count, {
      value: 429,
      ease: "none",
      scrollTrigger: {
        trigger: problem,
        start: "top 72%",
        end: "bottom 30%",
        scrub: 0.65,
        onUpdate: (self) => {
          const value = String(Math.round(1 + 428 * self.progress));
          if (counter.textContent !== value) {
            counter.textContent = value;
            counter.setAttribute("aria-label", value);
          }
        },
      },
    });

    if (fileIcon) {
      gsap.fromTo(fileIcon, { rotation: -12, y: 8, willChange: "transform" }, {
        rotation: 0,
        y: 0,
        duration: 0.72,
        ease: "power3.out",
        clearProps: "willChange",
        scrollTrigger: { trigger: problem, start: "top 72%", once: true },
      });
    }
  }

  const revealBatch = (selector, distance = 24, scale = 1) => {
    ScrollTrigger.batch(selector, {
      start: "top 86%",
      batchInterval: 0.08,
      batchMax: 8,
      once: true,
      onEnter: (elements) => gsap.fromTo(elements, {
        y: distance,
        scale,
        autoAlpha: 0,
        willChange: "transform,opacity",
      }, {
        y: 0,
        scale: 1,
        autoAlpha: 1,
        duration: 0.72,
        stagger: 0.075,
        ease: "power3.out",
        overwrite: "auto",
        onComplete: () => clearWillChange(elements),
      }),
    });
  };
  revealBatch("[data-reveal]");
  revealBatch("[data-theme-card]", 30, 0.97);

  const fadeSection = document.querySelector(".fade-section");
  const fullCapture = document.querySelector("[data-fade-full]");
  const mutedCapture = document.querySelector("[data-fade-muted]");
  if (fadeSection && fullCapture && mutedCapture) {
    const fade = gsap.timeline({
      scrollTrigger: {
        trigger: fadeSection,
        start: "top 76%",
        end: "center 40%",
        scrub: 0.7,
      },
    });
    fade.fromTo(fullCapture, { autoAlpha: 1 }, { autoAlpha: 0, ease: "none" }, 0);
    fade.fromTo(mutedCapture, { autoAlpha: 0 }, { autoAlpha: 1, ease: "none" }, 0);
  }

  const windowStage = document.querySelector(".window-stage");
  const listWindow = document.querySelector(".window-list");
  const noteWindow = document.querySelector("[data-note-window]");
  if (windowStage && listWindow && noteWindow) {
    gsap.fromTo(listWindow, { x: -40, autoAlpha: 0, willChange: "transform,opacity" }, {
      x: 0,
      autoAlpha: 1,
      duration: 0.78,
      ease: "power3.out",
      clearProps: "willChange",
      scrollTrigger: { trigger: windowStage, start: "top 78%", once: true },
    });
    gsap.fromTo(noteWindow, { x: 40, autoAlpha: 0, willChange: "transform,opacity" }, {
      x: 0,
      autoAlpha: 1,
      duration: 0.78,
      ease: "power3.out",
      clearProps: "willChange",
      scrollTrigger: { trigger: windowStage, start: "top 78%", once: true },
    });
    initNoteCycle(gsap, ScrollTrigger, noteWindow, windowStage, cleanups);
  }

  const taskArt = document.querySelector("[data-task-art]");
  const taskCapture = document.querySelector(".tasks-capture");
  if (taskArt && taskCapture) {
    const taskReveal = () => {
      gsap.set(taskCapture, { clipPath: "inset(0 100% 0 0)", willChange: "clip-path" });
      taskCapture.loading = "eager";
      const revealWhenReady = () => gsap.to(taskCapture, {
        clipPath: "inset(0 0 0 0)",
        duration: 0.62,
        ease: "power3.inOut",
        clearProps: "willChange",
      });
      if (taskCapture.decode) taskCapture.decode().then(revealWhenReady).catch(() => gsap.set(taskCapture, { clearProps: "clipPath,willChange" }));
      else revealWhenReady();
    };
    ScrollTrigger.create({ trigger: taskArt, start: "top 78%", once: true, onEnter: taskReveal });
    gsap.to(taskCapture, {
      yPercent: -3,
      ease: "none",
      scrollTrigger: { trigger: taskArt, start: "top bottom", end: "bottom top", scrub: 0.8 },
    });
  }

  const themeSection = document.querySelector(".themes-section");
  if (themeSection) {
    for (const [selector, x] of [[".theme-row-first", -40], [".theme-row-second", 40]]) {
      const row = document.querySelector(selector);
      if (!row) continue;
      gsap.to(row, {
        x,
        ease: "none",
        scrollTrigger: {
          trigger: themeSection,
          start: "top bottom",
          end: "bottom top",
          scrub: 0.8,
          onToggle: (self) => setActiveWillChange(row, self.isActive),
        },
      });
    }
  }

  const cta = document.querySelector(".cta-section");
  const ctaHeading = document.querySelector("[data-cta-heading]");
  if (cta && ctaHeading) {
    const lines = [...ctaHeading.querySelectorAll(".title-line")];
    gsap.fromTo(lines, { yPercent: 110, willChange: "transform" }, {
      yPercent: 0,
      duration: 0.78,
      stagger: 0.09,
      ease: "expo.out",
      clearProps: "willChange",
      scrollTrigger: { trigger: ctaHeading, start: "top 82%", once: true },
    });
    const ctaKeys = [...cta.querySelectorAll(".cta-step .keycap-row kbd")];
    const downloadButton = cta.querySelector(".cta-actions .button");
    let played = false;
    ScrollTrigger.create({
      trigger: cta,
      start: "top 76%",
      once: true,
      onEnter: () => {
        if (played) return;
        played = true;
        const sequence = gsap.timeline();
        ctaKeys.forEach((key, index) => {
          sequence.to(key, { y: 2, scale: 0.94, duration: 0.12, yoyo: true, repeat: 1, ease: "power2.inOut" }, index * 0.16);
        });
        if (downloadButton) {
          sequence.to(downloadButton, { y: -3, duration: 0.22, yoyo: true, repeat: 1, ease: "power2.inOut" }, ">+0.24");
        }
      },
    });
  }

  const footerWordmark = document.querySelector(".footer-wordmark");
  if (footerWordmark) {
    const letters = splitWordmark(footerWordmark);
    gsap.fromTo(letters, { y: 24, autoAlpha: 0, willChange: "transform,opacity" }, {
      y: 0,
      autoAlpha: 1,
      duration: 0.68,
      stagger: 0.025,
      ease: "power3.out",
      onComplete: () => clearWillChange(letters),
      scrollTrigger: { trigger: footerWordmark, start: "top 82%", once: true },
    });
  }

  const onVisibilityChange = () => {
    document.dispatchEvent(new CustomEvent("banana-notes-visibility", { detail: { hidden: document.hidden } }));
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  cleanups.push(() => document.removeEventListener("visibilitychange", onVisibilityChange));

  ScrollTrigger.refresh();
  return () => {
    for (const cleanup of cleanups) cleanup();
    const counter = document.querySelector("#file-counter");
    if (counter) {
      counter.textContent = "429";
      counter.setAttribute("aria-label", "429");
    }
    const noteWindow = document.querySelector("[data-note-window]");
    noteWindow?.removeAttribute("data-animated");
    for (const page of noteWindow?.querySelectorAll(".note-page") ?? []) {
      page.hidden = false;
      page.setAttribute("aria-hidden", "false");
      page.classList.toggle("is-current", page === noteWindow.querySelector(".note-page"));
    }
    for (const page of document.querySelectorAll(".note-page")) {
      page.style.removeProperty("transform");
      page.style.removeProperty("opacity");
      page.style.removeProperty("visibility");
    }
    if (header) header.classList.toggle("is-scrolled", window.scrollY > hero.offsetHeight);
  };
}

function wrapWords(element) {
  const words = element.textContent.trim().split(/\s+/);
  const fragment = document.createDocumentFragment();
  const spans = [];
  words.forEach((word, index) => {
    const span = document.createElement("span");
    span.className = "problem-word";
    span.textContent = word;
    spans.push(span);
    fragment.append(span);
    if (index < words.length - 1) fragment.append(document.createTextNode(" "));
  });
  element.replaceChildren(fragment);
  return spans;
}

function splitWordmark(element) {
  const letters = [];
  for (const word of element.children) {
    const text = word.textContent;
    word.replaceChildren(...[...text].map((character) => {
      const letter = document.createElement("span");
      letter.className = "footer-letter";
      letter.textContent = character;
      letters.push(letter);
      return letter;
    }));
  }
  return letters;
}

function initNoteCycle(gsap, ScrollTrigger, noteWindow, trigger, cleanups) {
  const pages = [...noteWindow.querySelectorAll(".note-page")];
  const nextKey = document.querySelector("[data-next-key]");
  if (pages.length < 2) return;

  noteWindow.dataset.animated = "true";
  let currentIndex = 0;
  let isVisible = false;
  let transition = null;
  let advanceCall = null;

  pages.forEach((page, index) => {
    page.hidden = index !== currentIndex;
    page.setAttribute("aria-hidden", String(index !== currentIndex));
    page.classList.toggle("is-current", index === currentIndex);
  });

  const advance = () => {
    const nextIndex = (currentIndex + 1) % pages.length;
    const outgoing = pages[currentIndex];
    const incoming = pages[nextIndex];
    incoming.hidden = false;
    incoming.setAttribute("aria-hidden", "false");
    incoming.classList.add("is-current");
    outgoing.classList.remove("is-current");
    gsap.set(incoming, { x: 26, autoAlpha: 0, willChange: "transform,opacity" });
    transition?.kill();
    transition = gsap.timeline({
      onComplete: () => {
        outgoing.hidden = true;
        outgoing.setAttribute("aria-hidden", "true");
        gsap.set([outgoing, incoming], { clearProps: "willChange" });
        currentIndex = nextIndex;
        transition = null;
      },
    });
    transition.to(outgoing, { x: -26, autoAlpha: 0, duration: 0.38, ease: "power2.inOut" }, 0);
    transition.to(incoming, { x: 0, autoAlpha: 1, duration: 0.38, ease: "power2.inOut" }, 0);
    if (nextKey) {
      transition.fromTo(nextKey, { y: 0, scale: 1 }, { y: 2, scale: 0.94, duration: 0.12, repeat: 1, yoyo: true, ease: "power2.inOut" }, 0);
    }
  };

  const planNext = () => {
    if (!isVisible || document.hidden || advanceCall) return;
    advanceCall = gsap.delayedCall(2.6, () => {
      advanceCall = null;
      advance();
      planNext();
    });
  };
  const pause = () => {
    advanceCall?.pause();
    transition?.pause();
  };
  const resume = () => {
    advanceCall?.resume();
    transition?.resume();
    if (!advanceCall) planNext();
  };
  const onVisibility = (event) => {
    if (event.detail.hidden) pause();
    else if (isVisible) resume();
  };
  document.addEventListener("banana-notes-visibility", onVisibility);
  cleanups.push(() => {
    advanceCall?.kill();
    transition?.kill();
    document.removeEventListener("banana-notes-visibility", onVisibility);
    noteWindow.removeAttribute("data-animated");
    pages.forEach((page, index) => {
      page.hidden = false;
      page.setAttribute("aria-hidden", "false");
      page.classList.toggle("is-current", index === 0);
      page.style.removeProperty("transform");
      page.style.removeProperty("opacity");
      page.style.removeProperty("visibility");
    });
  });

  const noteTrigger = ScrollTrigger.create({
    trigger,
    start: "top 82%",
    end: "bottom 18%",
    onEnter: () => {
      pages.forEach((page) => { page.loading = "eager"; });
      pages[currentIndex].decode?.().catch(() => {});
      isVisible = true;
      planNext();
    },
    onEnterBack: () => {
      pages.forEach((page) => { page.loading = "eager"; });
      pages[currentIndex].decode?.().catch(() => {});
      isVisible = true;
      planNext();
    },
    onLeave: () => { isVisible = false; pause(); },
    onLeaveBack: () => { isVisible = false; pause(); },
  });
  cleanups.push(() => noteTrigger.kill());
}
