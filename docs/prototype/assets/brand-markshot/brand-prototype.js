const wordmarks = {
  a: "assets/brand-markshot/wordmark-a.png",
  b: "assets/brand-markshot/wordmark-b.png",
  c: "assets/brand-markshot/wordmark-c.png",
  d: "assets/brand-markshot/wordmark-d.png",
};

function applyWordmark(key) {
  const normalized = wordmarks[key] ? key : "a";
  document.querySelectorAll("[data-logo]").forEach((image) => {
    image.src = wordmarks[normalized];
    image.alt = `MarkShot 文字标识 ${normalized.toUpperCase()}`;
  });
  document.querySelectorAll("[data-logo-button]").forEach((button) => {
    button.classList.toggle("active", button.dataset.logoButton === normalized);
  });
  const url = new URL(window.location.href);
  url.searchParams.set("logo", normalized);
  history.replaceState(null, "", url);
}

document.querySelectorAll("[data-logo-button]").forEach((button) => {
  button.addEventListener("click", () => applyWordmark(button.dataset.logoButton));
});

applyWordmark(
  new URL(window.location.href).searchParams.get("logo")
    || document.body.dataset.defaultLogo
    || "a",
);
