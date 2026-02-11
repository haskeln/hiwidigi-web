(() => {
  const nav = document.querySelector(".nav");
  if (!nav) return;

  const brand = nav.querySelector(".nav__brand");
  if (brand) {
    brand.setAttribute("href", "./index.html");
    brand.innerHTML = `
      <span class="nav__brand-mark" aria-hidden="true">
        <img class="nav__brand-img" src="./hiwi-logo.png" alt="" loading="eager" decoding="async" />
      </span>
      <span class="nav__brand-word">Hiwi</span>
    `;
  }

  const links = nav.querySelector(".nav__links");
  if (links) {
    links.innerHTML = `
      <a href="./core.html">Hiwi Core</a>
      <a href="./huxen.html">HUXEN</a>
      <a href="./himl.html">HIML</a>
      <a href="./core.html#api">API</a>
      <a href="./core.html#demo">Live Demo</a>
      <a href="./index.html#waitlist" class="nav__cta">Join waitlist</a>
    `;
  }

  const update = () => {
    nav.classList.toggle("nav--scrolled", window.scrollY > 12);
  };

  update();
  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
})();
