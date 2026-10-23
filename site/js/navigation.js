export function initNavigation() {
  const button = document.querySelector(".menu-toggle");
  const navigation = document.querySelector("#mobile-navigation");
  if (!button || !navigation) return;

  const setOpen = (isOpen) => {
    button.setAttribute("aria-expanded", String(isOpen));
    button.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
    navigation.classList.toggle("is-open", isOpen);
  };

  button.addEventListener("click", () => {
    setOpen(button.getAttribute("aria-expanded") !== "true");
  });

  navigation.addEventListener("click", (event) => {
    if (event.target.closest("a")) setOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || button.getAttribute("aria-expanded") !== "true") return;
    setOpen(false);
    button.focus();
  });

  window.matchMedia("(min-width: 768px)").addEventListener("change", () => setOpen(false));
}
