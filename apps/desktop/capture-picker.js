const root = document.querySelector("#sources");
window.capturePicker.ready(({ sources, allowAudio, audioLabel }) => {
  document.querySelector("#audio-option").hidden = !allowAudio;
  document.querySelector("#audio-label").textContent = audioLabel;
  for (const kind of ["screen", "window"]) {
    const items = sources.filter((s) => s.kind === kind);
    if (!items.length) continue;
    const title = document.createElement("h2");
    title.textContent = kind === "screen" ? "Screens" : "Windows";
    const grid = document.createElement("div");
    grid.className = "grid";
    for (const source of items) {
      const button = document.createElement("button");
      button.className = "source";
      button.dataset.kind = kind;
      if (source.thumbnail) {
        const img = document.createElement("img");
        img.src = source.thumbnail;
        img.alt = "";
        button.append(img);
      } else {
        button.classList.add("native-source");
      }
      const label = document.createElement("span");
      label.textContent = source.name;
      button.title = source.name;
      button.append(label);
      button.onclick = () =>
        window.capturePicker.choose(
          source.index,
          document.querySelector("#audio").checked,
        );
      grid.append(button);
    }
    root.append(title, grid);
  }
  root.querySelector("button")?.focus();
});
document.querySelector("#cancel").onclick = () => window.capturePicker.cancel();
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") window.capturePicker.cancel();
});
