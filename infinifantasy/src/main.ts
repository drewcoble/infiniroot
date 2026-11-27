// Progressive enhancement only - the page is complete without this.
document.documentElement.classList.add("js");

const year = document.getElementById("year");
if (year) year.textContent = String(new Date().getFullYear());

// The HTML links the production apps (draft.infinifantasy.com, ...). Anywhere other than the
// production landing page - landing-dev, Vercel previews, local dev - point them at the matching
// dev deployments (draft-dev.infinifantasy.com, ...) instead.
const PROD_HOSTS = ["infinifantasy.com", "www.infinifantasy.com"];
if (!PROD_HOSTS.includes(location.hostname)) {
  for (const link of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const url = new URL(link.href);
    const match = /^([a-z]+)\.infinifantasy\.com$/.exec(url.hostname);
    if (!match || match[1] === "www") continue;
    url.hostname = `${match[1]}-dev.infinifantasy.com`;
    link.href = url.toString();
  }
}

// Nav picks up its glass background once the page scrolls under it.
const nav = document.querySelector<HTMLElement>(".nav");
const onScroll = () => nav?.classList.toggle("scrolled", window.scrollY > 8);
onScroll();
window.addEventListener("scroll", onScroll, { passive: true });

// Fade sections in as they enter, staggering siblings that reveal together.
const revealed = document.querySelectorAll<HTMLElement>(".reveal");
const observer = new IntersectionObserver(
  (entries) => {
    let i = 0;
    for (const entry of entries) {
      // Anything scrolled past (fast flings, anchor jumps) reveals too, so nothing stays hidden.
      if (!entry.isIntersecting && entry.boundingClientRect.top > 0) continue;
      const el = entry.target as HTMLElement;
      el.style.setProperty("--i", String(i++));
      el.classList.add("in");
      observer.unobserve(el);
    }
  },
  { rootMargin: "0px 0px -8% 0px" },
);
revealed.forEach((el) => observer.observe(el));

// A radio group of buttons (role="radio"): click to pick, arrow keys to move the pick. `onSelect`
// runs for the starting pick too, so the page matches it from the start.
function radioGroup(
  buttons: HTMLButtonElement[],
  selectedClass: string,
  onSelect: (button: HTMLButtonElement) => void,
  start = buttons[0],
) {
  const select = (button: HTMLButtonElement) => {
    for (const other of buttons) {
      const on = other === button;
      other.classList.toggle(selectedClass, on);
      other.setAttribute("aria-checked", String(on));
      other.tabIndex = on ? 0 : -1;
    }
    onSelect(button);
  };
  buttons.forEach((button, index) => {
    button.addEventListener("click", () => select(button));
    button.addEventListener("keydown", (event) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      if (!step) return;
      event.preventDefault();
      const next = buttons[(index + step + buttons.length) % buttons.length];
      if (!next) return;
      select(next);
      next.focus();
    });
  });
  if (start) select(start);
}

// Chart switches (the infinileague page's player card): each button shows the panel with the
// matching data-chart-panel in the same card.
for (const group of document.querySelectorAll<HTMLElement>("[data-chart-switch]")) {
  const card = group.parentElement;
  radioGroup(
    [...group.querySelectorAll<HTMLButtonElement>("button[data-chart]")],
    "gm-segment-selected",
    (button) => {
      for (const panel of card?.querySelectorAll<HTMLElement>("[data-chart-panel]") ?? []) {
        panel.hidden = panel.dataset.chartPanel !== button.dataset.chart;
      }
    },
  );
}

// Draft type switch (the infinidraft page): sets <html data-format>, which hides the other
// format's data-only sections (see styles.css), and keeps the pick in the URL as ?type=snake.
for (const group of document.querySelectorAll<HTMLElement>("[data-format-switch]")) {
  const buttons = [...group.querySelectorAll<HTMLButtonElement>("button[data-format]")];
  const seeInside = document.querySelector<HTMLAnchorElement>("[data-see-inside]");
  const fromUrl = new URLSearchParams(location.search).get("type");
  radioGroup(
    buttons,
    "on",
    (button) => {
      const format = button.dataset.format ?? "auction";
      document.documentElement.dataset.format = format;
      if (seeInside) seeInside.hash = format === "snake" ? "#snake-values" : "#values";
      const url = new URL(location.href);
      if (format === "auction") url.searchParams.delete("type");
      else url.searchParams.set("type", format);
      history.replaceState(null, "", url);
    },
    buttons.find((button) => button.dataset.format === fromUrl),
  );
}
