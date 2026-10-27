const root = document.querySelector("#sources");
window.capturePicker.ready(
  ({
    sources,
    allowAudio,
    audioLabel,
    audioOutputs,
    audioError,
    linuxNative,
  }) => {
    document.querySelector("#audio-option").hidden = !allowAudio;
    document.querySelector("#audio").checked = allowAudio;
    document.querySelector("#audio-label").textContent = audioLabel;
    const output = document.querySelector("#audio-output");
    const share = document.querySelector("#share");
    let selection;
    const update = () => {
      output.disabled = !document.querySelector("#audio").checked;
      share.disabled =
        !selection ||
        (document.querySelector("#audio").checked && !output.value);
    };
    share.hidden = !linuxNative;
    share.onclick = () =>
      window.capturePicker.choose(
        selection.index,
        document.querySelector("#audio").checked,
        output.value,
      );
    if (audioOutputs?.length) {
      output.hidden = false;
      if (linuxNative) {
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "Choose an audio app";
        output.append(placeholder);
      }
      for (const item of audioOutputs) {
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent =
          linuxNative && item.kind === "output"
            ? `Entire output — ${item.label}`
            : item.label;
        option.selected = item.default;
        output.append(option);
      }
      document.querySelector("#audio").onchange = update;
      output.onchange = update;
    }
    if (audioError) {
      const error = document.querySelector("#audio-error");
      error.hidden = false;
      error.textContent = audioError;
    }
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
        button.onclick = () => {
          if (linuxNative) {
            selection = source;
            for (const other of root.querySelectorAll("button"))
              other.setAttribute("aria-pressed", String(other === button));
            output.value =
              kind === "screen"
                ? ((
                    audioOutputs?.find(
                      (item) => item.kind === "output" && item.default,
                    ) ?? audioOutputs?.find((item) => item.kind === "output")
                  )?.id ?? "")
                : (source.audioId ?? "");
            update();
            return;
          }
          window.capturePicker.choose(
            source.index,
            document.querySelector("#audio").checked,
            output.value,
          );
        };
        grid.append(button);
      }
      root.append(title, grid);
    }
    root.querySelector("button")?.focus();
  },
);
document.querySelector("#cancel").onclick = () => window.capturePicker.cancel();
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") window.capturePicker.cancel();
});
