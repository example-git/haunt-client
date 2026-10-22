/** Capture the chosen input, without silently substituting another microphone. */
export async function openMicrophone(device: string, automaticGain: boolean) {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // Device identity is required; format preferences may be resampled by
        // MicrophoneCapture and must never outweigh the user's input selection.
        deviceId: device ? { exact: device } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        sampleRate: { ideal: 48000 },
        channelCount: { ideal: 1 },
        autoGainControl: automaticGain,
      },
      video: false,
    });
  } catch (error) {
    if (
      device &&
      error instanceof DOMException &&
      (error.name === "NotFoundError" || error.name === "OverconstrainedError")
    )
      throw Error(
        "The selected microphone is unavailable. Reconnect it or choose another input in Devices.",
        { cause: error },
      );
    throw error;
  }
  const track = stream.getAudioTracks()[0];
  if (!track || (device && track.getSettings().deviceId !== device)) {
    stream.getTracks().forEach((track) => track.stop());
    throw Error(
      "Could not capture the selected microphone. Choose another input in Devices.",
    );
  }
  return stream;
}
