import { useEffect, useState } from "react";
import { friendlyError } from "@haunt/core";
import type { DesktopCallSettings } from "@haunt/browser/storage";
import type { Call } from "@haunt/browser/media/call";

export function DesktopCallBridge({
  call,
  onError,
  onLeave,
}: {
  call?: Call;
  onError: (error: string) => void;
  onLeave: () => void;
}) {
  const [settings, setSettings] = useState<DesktopCallSettings>();
  useEffect(() => {
    const bridge = window.hauntDesktop?.calls;
    if (!bridge) return;
    const off = bridge.subscribe((event) => {
      if (event.state) setSettings(event.state);
      if (!call || call.snapshot.status === "ended") return;
      let task: Promise<unknown> | undefined;
      if (event.action === "mute")
        task = call.setState({ muted: !call.snapshot.state.muted });
      if (event.action === "deafen")
        task = call.setState({ deafened: !call.snapshot.state.deafened });
      if (event.action === "stop-screen" && !call.snapshot.state.screen_off)
        task = call.toggleVideo("screen");
      if (event.action === "leave") task = call.end().then(onLeave);
      void task?.catch((error) => onError(friendlyError(error)));
    });
    void bridge
      .settings()
      .then(setSettings)
      .catch((error) => onError(friendlyError(error)));
    let previous = "";
    const update = () => {
      const value = {
        active: !!call && call.snapshot.status !== "ended",
        muted: call?.snapshot.state.muted ?? true,
        deafened: call?.snapshot.state.deafened ?? false,
        sharing: !!call && !call.snapshot.state.screen_off,
      };
      const key = JSON.stringify(value);
      if (key === previous) return;
      previous = key;
      void bridge.state(value).catch((error) => onError(friendlyError(error)));
    };
    update();
    const offCall = call?.subscribe(update);
    return () => {
      off();
      offCall?.();
    };
  }, [call]);
  useEffect(() => {
    if (!call || !settings) return;
    call.setPushToTalk(settings.ptt, settings.pressed);
    if (!settings.ptt || settings.native) return;
    const key = (event: KeyboardEvent) => {
      if (event.code !== "F9") return;
      event.preventDefault();
      call.setPushToTalk(true, event.type === "keydown");
    };
    const release = () => call.setPushToTalk(true, false);
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", key);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", key);
      window.removeEventListener("blur", release);
      release();
    };
  }, [call, settings]);
  return (
    <>
      {settings?.error && (
        <p className="desktop-call-notice error" role="alert">
          {settings.error}
        </p>
      )}
      {settings?.ptt && call && call.snapshot.status !== "ended" && (
        <p className="desktop-call-notice" role="status">
          Push to talk · Hold {settings.trigger}
        </p>
      )}
    </>
  );
}

export function DesktopCallControls() {
  const bridge = window.hauntDesktop!.calls!;
  const [settings, setSettings] = useState<DesktopCallSettings>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    void bridge
      .settings()
      .then(setSettings)
      .catch((error) => setError(friendlyError(error)));
    return bridge.subscribe((event) => {
      if (event.state) setSettings(event.state);
    });
  }, []);
  const configure = async (
    patch: Partial<Pick<DesktopCallSettings, "shortcuts" | "ptt">>,
  ) => {
    if (!settings) return;
    setBusy(true);
    setError("");
    try {
      setSettings(
        await bridge.settings({
          shortcuts: settings.shortcuts,
          ptt: settings.ptt,
          ...patch,
        }),
      );
    } catch (error) {
      setError(friendlyError(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="form">
      <h3>Desktop call controls</h3>
      {(error || settings?.error) && (
        <p role="alert" className="error">
          {error || settings?.error}
        </p>
      )}
      <label className="setting-toggle">
        Global mute and deafen shortcuts
        <input
          type="checkbox"
          disabled={busy || !settings}
          checked={settings?.shortcuts ?? false}
          onChange={(event) =>
            void configure({ shortcuts: event.target.checked })
          }
        />
      </label>
      <p className="muted">
        {window.hauntDesktop?.platform === "darwin" ? "⌘" : "Ctrl"}+Shift+M
        toggles the microphone.{" "}
        {window.hauntDesktop?.platform === "darwin" ? "⌘" : "Ctrl"}+Shift+D
        toggles deafen. Call actions are also available in the tray.
      </p>
      <label className="setting-toggle">
        {settings?.native
          ? "Global push to talk"
          : "Push to talk while Haunt is focused"}
        <input
          type="checkbox"
          disabled={busy || !settings}
          checked={settings?.ptt ?? false}
          onChange={(event) => void configure({ ptt: event.target.checked })}
        />
      </label>
      <p className="muted">
        Hold {settings?.trigger || "F9"} to transmit an unmuted microphone.
        Releasing it leaves screen and camera audio playing.
      </p>
      {busy && <p role="status">Configuring desktop shortcuts…</p>}
    </section>
  );
}
