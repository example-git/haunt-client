export interface NativeVideoConfig {
  codec: string;
  width: number;
  height: number;
  fps: number;
  fmtp: string;
}
export interface NativeEvent {
  id: string;
  kind: "video-config" | "audio-config" | "video" | "audio" | "error";
  config?: NativeVideoConfig & { sampleRate?: number };
  data?: Uint8Array | Float32Array;
  key?: boolean;
  timestamp?: number;
  message?: string;
}
export interface NativeDevice {
  id: string;
  label: string;
}
export interface NativeBridge {
  nativeCaptureAvailable: boolean;
  nativeDevices(
    requestPermission?: boolean,
  ): Promise<{ cameras: NativeDevice[]; audio: NativeDevice[] }>;
  nativeStart(request: {
    id: string;
    purpose: "camera" | "screen";
    device?: string;
    deviceLabel?: string;
    audioDevice?: string;
    audioLabel?: string;
    audio: boolean;
  }): Promise<{ id: string; video: NativeVideoConfig; audio: boolean } | null>;
  nativeStop(id: string): Promise<void>;
  onNativeEvent(callback: (event: NativeEvent) => void): () => void;
  nativeOffer(request: {
    id: string;
    tracks: { purpose: string; capture?: string }[];
    ice: RTCIceServer[];
    relay: boolean;
  }): Promise<{ sdp: RTCSessionDescriptionInit }>;
  nativeAnswer(id: string, sdp: RTCSessionDescriptionInit): Promise<void>;
  nativeAudio(
    id: string,
    purpose: string,
    data: Uint8Array,
    timestamp: number,
  ): void;
  nativeClosePublisher(id: string): Promise<void>;
}
