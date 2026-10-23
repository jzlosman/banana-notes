import { initNavigation } from "./navigation.js";
import { initMotion } from "./motion.js";

document.documentElement.classList.add("has-js");
initNavigation();

const gsap = window.gsap;
const ScrollTrigger = window.ScrollTrigger;

if (gsap && ScrollTrigger) {
  gsap.registerPlugin(ScrollTrigger);
  document.fonts.ready.then(() => initMotion(gsap, ScrollTrigger));
}
