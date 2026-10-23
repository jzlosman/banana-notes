const root = document.documentElement;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
root.classList.add("has-js");
if (navigator.maxTouchPoints > 0 || window.matchMedia("(hover: none)").matches) {
  root.classList.add("touch-device");
}

const liveNote = document.querySelector("#live-note");
const liveEditor = document.querySelector("#live-note-editor");
const liveRender = document.querySelector("#live-note-render");
const livePin = document.querySelector(".live-pin");
const liveClose = document.querySelector(".live-close");
const defaultNote = "# Try it\n[ ] Type a thought\n[ ] Click the page behind me";
const liveStorageKey = "banana-notes-marketing-live-note";
let liveNoteCounted = false;
let liveOpener = null;
let fadeTimer = 0;
let dragState = null;

function readSavedNote() {
  try {
    return localStorage.getItem(liveStorageKey) ?? defaultNote;
  } catch {
    return defaultNote;
  }
}

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function renderInlineMarkdown(value) {
  return escapeHtml(value).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function renderNoteMarkdown(markdown) {
  const lines = markdown.split("\n");
  liveRender.innerHTML = lines.map((line, index) => {
    if (line.startsWith("# ")) return `<h3>${renderInlineMarkdown(line.slice(2))}</h3>`;
    const task = line.match(/^\[([ xX])\]\s?(.*)$/);
    if (task) {
      const checked = task[1].toLowerCase() === "x" ? " checked" : "";
      return `<label><input type="checkbox" data-line="${index}"${checked}><span>${renderInlineMarkdown(task[2])}</span></label>`;
    }
    if (!line.trim()) return '<p aria-hidden="true">&nbsp;</p>';
    return `<p>${renderInlineMarkdown(line)}</p>`;
  }).join("");
}

function saveLiveNote() {
  try {
    localStorage.setItem(liveStorageKey, liveEditor.value);
    document.querySelector("#live-note-status").textContent = "Saved in this browser.";
  } catch {
    document.querySelector("#live-note-status").textContent = "Storage is unavailable; this note will not persist.";
  }
}

liveEditor.value = readSavedNote();
renderNoteMarkdown(liveEditor.value);
liveEditor.addEventListener("input", () => {
  renderNoteMarkdown(liveEditor.value);
  saveLiveNote();
});
liveRender.addEventListener("change", (event) => {
  const checkbox = event.target.closest('input[type="checkbox"][data-line]');
  if (!checkbox) return;
  const lines = liveEditor.value.split("\n");
  const index = Number(checkbox.dataset.line);
  const task = lines[index]?.match(/^\[([ xX])\](\s?.*)$/);
  if (!task) return;
  lines[index] = `[${checkbox.checked ? "x" : " "}]${task[2]}`;
  liveEditor.value = lines.join("\n");
  renderNoteMarkdown(liveEditor.value);
  saveLiveNote();
});

function clearFadeTimer() {
  window.clearTimeout(fadeTimer);
  fadeTimer = 0;
}

function makeLiveNoteSolid() {
  clearFadeTimer();
  liveNote.classList.remove("is-faded");
}

function scheduleFade() {
  clearFadeTimer();
  if (liveNote.hidden || liveNote.classList.contains("is-pinned")) return;
  fadeTimer = window.setTimeout(() => liveNote.classList.add("is-faded"), 500);
}

function openLiveNote(trigger = document.activeElement) {
  clearFadeTimer();
  if (!liveNoteCounted) {
    liveNoteCounted = true;
    try {
      window.goatcounter?.count?.({ path: "try-live-note", title: "Opened the live note", event: true });
    } catch {
      // Analytics must not interrupt the local demo.
    }
  }
  liveOpener = trigger instanceof HTMLElement ? trigger : null;
  liveNote.hidden = false;
  liveNote.setAttribute("aria-hidden", "false");
  liveNote.classList.remove("is-faded");
  liveEditor.focus({ preventScroll: true });
  liveEditor.setSelectionRange(liveEditor.value.length, liveEditor.value.length);
}

function closeLiveNote() {
  clearFadeTimer();
  if (liveNote.hidden) return;
  liveNote.hidden = true;
  liveNote.setAttribute("aria-hidden", "true");
  if (liveOpener?.isConnected && typeof liveOpener.focus === "function") {
    liveOpener.focus({ preventScroll: true });
  }
}

for (const trigger of document.querySelectorAll("[data-open-live-note]")) {
  trigger.addEventListener("click", () => openLiveNote(trigger));
}
liveClose.addEventListener("click", closeLiveNote);
livePin.addEventListener("click", () => {
  const pinned = livePin.getAttribute("aria-pressed") !== "true";
  livePin.setAttribute("aria-pressed", String(pinned));
  livePin.setAttribute("aria-label", pinned ? "Unpin note" : "Pin note");
  livePin.title = pinned ? "Unpin note" : "Pin note";
  liveNote.classList.toggle("is-pinned", pinned);
  if (pinned) makeLiveNoteSolid();
});
liveNote.addEventListener("pointerdown", makeLiveNoteSolid);
liveNote.addEventListener("focusin", makeLiveNoteSolid);
document.addEventListener("pointerdown", (event) => {
  if (!liveNote.hidden && !liveNote.contains(event.target)) scheduleFade();
});
document.addEventListener("focusin", (event) => {
  if (!liveNote.hidden && !liveNote.contains(event.target)) scheduleFade();
});

const dragHandle = liveNote.querySelector("[data-drag-handle]");
dragHandle.addEventListener("pointerdown", (event) => {
  if (event.target.closest("button")) return;
  const rect = liveNote.getBoundingClientRect();
  dragState = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
  dragHandle.setPointerCapture(event.pointerId);
  event.preventDefault();
});
dragHandle.addEventListener("pointermove", (event) => {
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  const left = Math.max(8, Math.min(window.innerWidth - liveNote.offsetWidth - 8, event.clientX - dragState.offsetX));
  const top = Math.max(8, Math.min(window.innerHeight - liveNote.offsetHeight - 8, event.clientY - dragState.offsetY));
  liveNote.style.left = `${left}px`;
  liveNote.style.top = `${top}px`;
  liveNote.style.right = "auto";
  liveNote.style.bottom = "auto";
});
function finishDrag(event) {
  if (dragState?.pointerId === event.pointerId) dragState = null;
}
dragHandle.addEventListener("pointerup", finishDrag);
dragHandle.addEventListener("pointercancel", finishDrag);

const noteThemes = [
  { id: "banana-light", name: "Banana Light", image: "img/note-light.png" },
  { id: "nord", name: "Nord", image: "img/theme-nord.png" },
  { id: "catppuccin-latte", name: "Catppuccin Latte", image: "img/theme-catppuccin-latte.png" },
  { id: "rose-pine-dawn", name: "Rosé Pine Dawn", image: "img/theme-rose-pine-dawn.png" },
];
let currentThemeIndex = 0;
const heroNote = document.querySelector(".hero-note");

function applyTheme(theme) {
  liveNote.dataset.theme = theme.id;
  heroNote.src = theme.image;
  heroNote.alt = `Banana Notes in the ${theme.name} theme, showing a launch day checklist`;
}

function toggleFeature(button) {
  const isOn = button.getAttribute("aria-checked") === "true";
  const nextOn = !isOn;
  button.setAttribute("aria-checked", String(nextOn));
  button.closest(".feature-band").classList.toggle("is-on", nextOn);
  if (button.dataset.featureSwitch === "themes" && nextOn) {
    currentThemeIndex = (currentThemeIndex + 1) % noteThemes.length;
    applyTheme(noteThemes[currentThemeIndex]);
  }
}
for (const button of document.querySelectorAll("[data-feature-switch]")) {
  button.addEventListener("click", () => toggleFeature(button));
}

const menuToggle = document.querySelector(".menu-toggle");
const mobileNav = document.querySelector("#mobile-navigation");
function setMenuOpen(isOpen) {
  menuToggle.setAttribute("aria-expanded", String(isOpen));
  menuToggle.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
  mobileNav.classList.toggle("is-open", isOpen);
}
menuToggle.addEventListener("click", () => setMenuOpen(menuToggle.getAttribute("aria-expanded") !== "true"));
mobileNav.addEventListener("click", (event) => {
  if (event.target.closest("a")) setMenuOpen(false);
});

const fadeSection = document.querySelector("#fade");
const opacitySlider = document.querySelector("#opacity-slider");
const opacityOutput = document.querySelector("#opacity-value");
const opacityFill = document.querySelector("#opacity-fill");
const fadeNote = document.querySelector(".fade-note");
let opacityTouched = false;

function setOpacity(value, { manual = false } = {}) {
  const opacity = Math.max(5, Math.min(100, Math.round(Number(value))));
  opacitySlider.value = String(opacity);
  opacityOutput.value = `${opacity}%`;
  opacityOutput.textContent = `${opacity}%`;
  opacityFill.style.transform = `scaleX(${opacity / 100})`;
  fadeNote.style.opacity = String(opacity / 100);
  if (manual) opacityTouched = true;
}
opacitySlider.addEventListener("input", () => setOpacity(opacitySlider.value, { manual: true }));
setOpacity(reducedMotion.matches ? 40 : opacitySlider.value);

const notes = [
  { id: "launch", title: "Launch day checklist", tags: ["launch"], text: "Clear the small blockers first; leave room for the unexpected. Morning: Review the release notes. Check the welcome flow on a clean install. Confirm support links. Afternoon: Publish the announcement. Watch the first session metrics." },
  { id: "standup", title: "Standup — Tue", tags: ["launch"], text: "Fix the pricing typo. Confirm the welcome flow. Ship the docs after Priya signs off. Waiting on the final build." },
  { id: "priya", title: "Call with Priya", tags: ["launch"], text: "budget: 18k approve by Fri Send the deck Ask about annual" },
  { id: "pricing", title: "Pricing ideas", tags: ["launch"], text: "Annual plan: 15% off. Keep the monthly price simple. Decide on annual plan. Update the pricing page." },
  { id: "groceries", title: "Groceries", tags: [], text: "Eggs Coffee Bananas Oat milk Market" },
  { id: "overstory", title: "Book notes: The Overstory", tags: [], text: "Some stories take the long way around. Trees make time visible. Pay attention to the roots, not just the canopy." },
  { id: "retry", title: "Retry logic", tags: [], text: "const retry = async run Promise error attempt" },
];
const meaningGroups = [
  { terms: ["money", "cost", "budget", "price", "pricing", "spend", "dollars", "expensive"], ids: ["priya", "pricing"] },
  { terms: ["ship", "release", "launch", "deploy"], ids: ["launch", "standup"] },
  { terms: ["food", "shopping", "groceries", "grocery", "market"], ids: ["groceries"] },
  { terms: ["book", "reading", "read", "overstory"], ids: ["overstory"] },
  { terms: ["bug", "error", "retry", "failure", "logic"], ids: ["retry"] },
];
const noteCards = [...document.querySelectorAll(".deck-note")];
const deckIndicator = document.querySelector("#deck-indicator");
const filterCount = document.querySelector("#filter-count");
let launchFilter = false;
let currentNoteId = "launch";
let deckAnimation = 0;
let deckIsVisible = false;

function visibleNotes() {
  return launchFilter ? notes.filter((note) => note.tags.includes("launch")) : notes;
}

function renderDeck({ animate = false } = {}) {
  const visible = visibleNotes();
  let targetIndex = visible.findIndex((note) => note.id === currentNoteId);
  if (targetIndex < 0) targetIndex = 0;
  currentNoteId = visible[targetIndex].id;
  const currentCard = noteCards.find((card) => card.dataset.noteId === currentNoteId);
  for (const card of noteCards) {
    if (card === currentCard) {
      card.hidden = false;
      card.classList.remove("is-current", "turning-out");
      if (animate) {
        card.classList.add("turning-in");
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => card.classList.remove("turning-in")));
      } else {
        card.classList.remove("turning-in");
      }
    } else {
      card.classList.remove("is-current", "turning-in");
      if (animate && card.dataset.noteId === renderDeck.previousId) {
        card.classList.add("turning-out");
        const leavingCard = card;
        const animationAtStart = deckAnimation;
        window.setTimeout(() => {
          if (animationAtStart === deckAnimation && currentNoteId !== leavingCard.dataset.noteId) {
            leavingCard.hidden = true;
            leavingCard.classList.remove("turning-out");
          }
        }, 280);
      } else {
        card.hidden = true;
        card.classList.remove("turning-out");
      }
    }
  }
  currentCard?.classList.add("is-current");
  const indexInAll = notes.findIndex((note) => note.id === currentNoteId) + 1;
  deckIndicator.textContent = `${targetIndex + 1} / ${visible.length}`;
  filterCount.textContent = `${visible.length} notes`;
  for (const card of noteCards) {
    const index = visible.findIndex((note) => note.id === card.dataset.noteId);
    const counter = card.querySelector(".deck-counter");
    if (counter) counter.textContent = index >= 0 ? `${index + 1} / ${visible.length}` : `${notes.findIndex((note) => note.id === card.dataset.noteId) + 1} / ${notes.length}`;
  }
  renderDeck.previousId = currentNoteId;
  return indexInAll;
}
renderDeck.previousId = "launch";

function moveDeck(amount) {
  const visible = visibleNotes();
  if (visible.length < 2) return;
  const currentIndex = visible.findIndex((note) => note.id === currentNoteId);
  const nextIndex = (currentIndex + amount + visible.length) % visible.length;
  renderDeck.previousId = currentNoteId;
  currentNoteId = visible[nextIndex].id;
  deckAnimation += 1;
  renderDeck({ animate: true });
}
for (const button of document.querySelectorAll("[data-deck-step]")) {
  button.addEventListener("click", () => moveDeck(Number(button.dataset.deckStep)));
}

function setLaunchFilter(next) {
  launchFilter = next;
  for (const trigger of document.querySelectorAll("[data-filter-launch]")) {
    trigger.setAttribute("aria-pressed", String(launchFilter));
    const close = trigger.querySelector("span");
    if (close) close.textContent = launchFilter ? "×" : "";
  }
  renderDeck();
}
for (const trigger of document.querySelectorAll("[data-filter-launch]")) {
  trigger.addEventListener("click", () => setLaunchFilter(!launchFilter));
}

const searchInput = document.querySelector("#note-search");
const searchResults = document.querySelector("#search-results");
const stopWords = new Set(["what", "did", "say", "about", "the", "and", "for", "with", "from", "that", "this", "was", "were", "are", "you", "your"]);
function searchForNotes(query) {
  const terms = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const meaningfulTerms = terms.filter((term) => !stopWords.has(term));
  const byMeaning = new Set();
  for (const group of meaningGroups) {
    if (meaningfulTerms.some((term) => group.terms.some((meaning) => meaning.includes(term) || term.includes(meaning)))) {
      for (const id of group.ids) byMeaning.add(id);
    }
  }
  const textMatches = new Set();
  for (const note of notes) {
    const content = `${note.title} ${note.text}`.toLowerCase();
    if (meaningfulTerms.some((term) => content.includes(term))) textMatches.add(note.id);
  }
  const matches = [];
  for (const note of notes) {
    if (byMeaning.has(note.id)) matches.push({ note, reason: "by meaning" });
    else if (textMatches.has(note.id)) matches.push({ note, reason: "matches text" });
  }
  return matches;
}
function drawSearchResults() {
  const matches = searchForNotes(searchInput.value);
  searchResults.replaceChildren();
  if (!matches.length) {
    const empty = document.createElement("li");
    empty.className = "empty-results";
    empty.textContent = searchInput.value.trim() ? "No notes found." : "Type a word to search your notes.";
    searchResults.append(empty);
    return;
  }
  for (const { note, reason } of matches) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.selectNote = note.id;
    const details = document.createElement("span");
    const title = document.createElement("strong");
    const snippet = document.createElement("small");
    const label = document.createElement("em");
    title.textContent = note.title;
    snippet.textContent = note.text.split(/[.!?\n]/)[0].slice(0, 54);
    label.textContent = reason;
    details.append(title, snippet);
    button.append(details, label);
    item.append(button);
    searchResults.append(item);
  }
}
searchInput.addEventListener("input", drawSearchResults);
searchResults.addEventListener("click", (event) => {
  const button = event.target.closest("[data-select-note]");
  if (!button) return;
  const note = notes.find((item) => item.id === button.dataset.selectNote);
  if (!note) return;
  if (launchFilter && !note.tags.includes("launch")) setLaunchFilter(false);
  currentNoteId = note.id;
  renderDeck();
  document.querySelector("#deck-pages").scrollIntoView({ block: "center", behavior: reducedMotion.matches ? "auto" : "smooth" });
});
drawSearchResults();

function isTextEntry(target) {
  return target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select, [role='textbox']"));
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!liveNote.hidden) {
      event.preventDefault();
      closeLiveNote();
      return;
    }
    if (menuToggle.getAttribute("aria-expanded") === "true") {
      setMenuOpen(false);
      menuToggle.focus();
      return;
    }
  }
  if (event.ctrlKey && event.shiftKey && (event.code === "Space" || event.key === " ")) {
    event.preventDefault();
    if (liveNote.hidden) openLiveNote(); else closeLiveNote();
    return;
  }
  if (!deckIsVisible || isTextEntry(event.target)) return;
  const modifier = event.metaKey || event.ctrlKey;
  if (event.key === "ArrowRight" || (modifier && event.key === "]")) {
    event.preventDefault();
    moveDeck(1);
  } else if (event.key === "ArrowLeft" || (modifier && event.key === "[")) {
    event.preventDefault();
    moveDeck(-1);
  }
});

const tagsSection = document.querySelector("#tags");
const tagSliders = [...document.querySelectorAll("#tag-stage-slider, #tag-stage-slider-mobile")];
const tagFill = document.querySelector("#tag-range-fill");
const tagHeading = document.querySelector("#tags-heading");
const tagDescription = document.querySelector("#tags-description");
const stageCopy = [
  { heading: "First, jot tasks anywhere.", description: "Put the next thing to do in whichever note is open." },
  { heading: "Then tag them #launch.", description: "Give related tasks the same tag." },
  { heading: "Click the tag.", description: "One click brings the related tasks together." },
  { heading: "Every task,\nin one list.", description: "Tasks end up scattered across a week of notes. Tag the ones that belong together, click the tag, and they're all here. Tick one off and the original note updates too." },
];
let activeStage = 4;
let stageManuallySet = false;
function setTagStage(stage, { fromScroll = false } = {}) {
  const safeStage = Math.max(1, Math.min(4, Math.round(stage)));
  activeStage = safeStage;
  tagsSection.dataset.stage = String(safeStage);
  if (tagHeading) tagHeading.innerHTML = stageCopy[safeStage - 1].heading.replace("\n", "<br>");
  if (tagDescription) tagDescription.textContent = stageCopy[safeStage - 1].description;
  for (const slider of tagSliders) slider.value = String(safeStage);
  const fill = (safeStage - 1) / 3;
  if (tagFill) tagFill.style.transform = `scaleX(${fill})`;
  for (const label of document.querySelectorAll("[data-stage-label]")) {
    label.classList.toggle("active", Number(label.dataset.stageLabel) === safeStage);
    if (Number(label.dataset.stageLabel) === safeStage) label.setAttribute("aria-current", "step"); else label.removeAttribute("aria-current");
  }
  for (const [index, article] of [...document.querySelectorAll(".tags-mobile-sequence article")].entries()) {
    article.classList.toggle("is-current", index + 1 === safeStage);
  }
  if (!fromScroll) stageManuallySet = true;
}
function scrollToTagStage(stage) {
  setTagStage(stage);
  if (reducedMotion.matches || window.innerWidth < 768) return;
  const sectionTop = tagsSection.getBoundingClientRect().top + window.scrollY;
  const distance = Math.max(0, tagsSection.offsetHeight - window.innerHeight);
  window.scrollTo({ top: sectionTop + distance * ((stage - 1) / 3), behavior: "auto" });
}
for (const slider of tagSliders) {
  slider.addEventListener("input", () => scrollToTagStage(Number(slider.value)));
}
setTagStage(4, { fromScroll: true });

const chipElements = [...document.querySelectorAll(".file-chip")];
const fileCounter = document.querySelector("#file-counter");
const heroVisual = document.querySelector(".hero-visual");
const fadeObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) {
      deckIsVisible = entry.target.id === "window" ? true : deckIsVisible;
    } else if (entry.target.id === "window") {
      deckIsVisible = false;
    }
  }
}, { threshold: 0.08 });
fadeObserver.observe(document.querySelector("#window"));

const revealObserver = new IntersectionObserver((entries, observer) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    entry.target.classList.add("is-visible");
    if (entry.target === heroVisual) entry.target.classList.add("is-visible");
    observer.unobserve(entry.target);
  }
}, { threshold: 0.08, rootMargin: "0px 0px -8% 0px" });
for (const item of document.querySelectorAll(".reveal, .hero-visual")) revealObserver.observe(item);

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
let scrollFrame = 0;
function updateScrollState() {
  scrollFrame = 0;
  const viewportCenter = window.innerHeight / 2;
  const problemRect = document.querySelector("#problem").getBoundingClientRect();
  const problemProgress = reducedMotion.matches ? 1 : clamp(((viewportCenter - problemRect.top) / Math.max(problemRect.height, 1)) * 2, 0, 1);
  const popped = Math.min(chipElements.length, Math.floor(problemProgress * (chipElements.length + 1)));
  for (const [index, chip] of chipElements.entries()) chip.classList.toggle("is-popped", reducedMotion.matches || index < popped);
  fileCounter.textContent = String(reducedMotion.matches ? 429 : 1 + Math.round(428 * problemProgress));
  fileCounter.setAttribute("aria-label", fileCounter.textContent);

  if (!opacityTouched && !reducedMotion.matches) {
    const rect = fadeSection.getBoundingClientRect();
    const progress = clamp((window.innerHeight * 0.78 - rect.top) / (Math.min(rect.height, window.innerHeight) * 0.75), 0, 1);
    if (progress > 0) setOpacity(100 - progress * 60);
  }

  if (!reducedMotion.matches && window.innerWidth >= 768) {
    const rect = tagsSection.getBoundingClientRect();
    const travel = Math.max(1, rect.height - window.innerHeight);
    const progress = clamp(-rect.top / travel, 0, 1);
    const stage = Math.min(4, Math.max(1, Math.round(progress * 3) + 1));
    if (!stageManuallySet || Math.abs(stage - activeStage) > 0) setTagStage(stage, { fromScroll: true });
    if (rect.bottom <= window.innerHeight + 2 || rect.top >= window.innerHeight) stageManuallySet = false;
  }
}
function scheduleScrollState() {
  if (scrollFrame) return;
  scrollFrame = window.requestAnimationFrame(updateScrollState);
}
window.addEventListener("scroll", scheduleScrollState, { passive: true });
window.addEventListener("resize", scheduleScrollState, { passive: true });
updateScrollState();

if (reducedMotion.matches) {
  setOpacity(40);
  setTagStage(4, { fromScroll: true });
}
reducedMotion.addEventListener?.("change", (event) => {
  if (event.matches) {
    setOpacity(40);
    setTagStage(4, { fromScroll: true });
  }
  scheduleScrollState();
});
