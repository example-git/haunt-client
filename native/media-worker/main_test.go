package main

import (
	"bytes"
	"encoding/binary"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/pion/sdp/v3"
	"github.com/pion/webrtc/v4"
)

func mediaFrame(purpose byte, key bool, timestamp uint64, data []byte) []byte {
	frame := make([]byte, 14+len(data))
	binary.BigEndian.PutUint32(frame, uint32(10+len(data)))
	frame[4] = purpose
	if key {
		frame[5] = 1
	}
	binary.BigEndian.PutUint64(frame[6:], timestamp)
	copy(frame[14:], data)
	return frame
}

func TestNativePublisherRTC(t *testing.T) {
	t.Run("single", func(t *testing.T) { testNativePublisherRTC(t, false) })
	t.Run("layered", func(t *testing.T) { testNativePublisherRTC(t, true) })
}
func testNativePublisherRTC(t *testing.T, layered bool) {
	var layers []string
	if layered {
		layers = []string{"h", "m", "l"}
	}
	p, err := newPublisher(command{Tracks: []trackConfig{{Purpose: "audio"}, {Purpose: "camera", FMTP: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e02a", Layers: layers}, {Purpose: "screen", FMTP: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e02a", Layers: layers}, {Purpose: "camera_audio"}, {Purpose: "screen_audio"}}}, &output{writer: io.Discard})
	if err != nil {
		t.Fatal(err)
	}
	defer p.pc.Close()
	offer, err := p.offer()
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(offer.SDP, "VP8") || !strings.Contains(offer.SDP, "maxaveragebitrate=510000") {
		t.Fatal("incorrect native codec offer")
	}
	settings := webrtc.SettingEngine{}
	settings.SetIncludeLoopbackCandidate(true)
	media := &webrtc.MediaEngine{}
	if err := media.RegisterDefaultCodecs(); err != nil {
		t.Fatal(err)
	}
	for _, uri := range []string{sdp.SDESMidURI, sdp.SDESRTPStreamIDURI} {
		if err := media.RegisterHeaderExtension(webrtc.RTPHeaderExtensionCapability{URI: uri}, webrtc.RTPCodecTypeVideo); err != nil {
			t.Fatal(err)
		}
	}
	receiver, err := webrtc.NewAPI(webrtc.WithMediaEngine(media), webrtc.WithSettingEngine(settings)).NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer receiver.Close()
	type received struct {
		id        string
		timestamp uint32
		data      []byte
	}
	packets := make(chan received, 32)
	receiver.OnTrack(func(track *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		for {
			packet, _, err := track.ReadRTP()
			if err != nil {
				return
			}
			packets <- received{track.ID() + track.RID(), packet.Timestamp, packet.Payload}
		}
	})
	if err = receiver.SetRemoteDescription(offer); err != nil {
		t.Fatal(err)
	}
	answer, err := receiver.CreateAnswer(nil)
	if err != nil {
		t.Fatal(err)
	}
	gather := webrtc.GatheringCompletePromise(receiver)
	if err = receiver.SetLocalDescription(answer); err != nil {
		t.Fatal(err)
	}
	select {
	case <-gather:
	case <-time.After(10 * time.Second):
		t.Fatal("receiver ICE timeout")
	}
	if err = p.pc.SetRemoteDescription(*receiver.LocalDescription()); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for !p.connected.Load() && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if !p.connected.Load() {
		t.Fatal("publisher did not connect")
	}
	var input bytes.Buffer
	// Deltas before the first keyframe must not leak; all five tracks remain
	// separate, with a camera timestamp gap preserved instead of sped up.
	input.Write(mediaFrame(1, false, 0, []byte{0, 0, 0, 1, 0x41, 1}))
	for i, track := range p.tracks {
		data := []byte{0xf8, 0xff, 0xfe} // valid Opus silence
		if track.video {
			data = []byte{0, 0, 0, 1, 0x65, 0x88, 0x80}
		}
		input.Write(mediaFrame(byte(i), true, 1_000_000, data))
		input.Write(mediaFrame(byte(i), true, 1_100_000, data))
	}
	if err := p.media(&input); err != io.EOF {
		t.Fatal(err)
	}
	seen := map[string][]uint32{}
	for i := 0; i < len(p.tracks)*2; i++ {
		select {
		case packet := <-packets:
			seen[packet.id] = append(seen[packet.id], packet.timestamp)
			if len(packet.data) == 0 || packet.data[0] == 0x41 {
				t.Fatal("unexpected native RTP payload")
			}
		case <-time.After(5 * time.Second):
			t.Fatalf("missing track packets: %v", seen)
		}
	}
	for _, track := range p.tracks {
		purpose := track.local.ID() + track.local.RID()
		delta := uint32(4800)
		if track.video {
			delta = 9000
		}
		if got := seen[purpose]; len(got) != 2 || got[1]-got[0] != delta {
			t.Fatalf("bad RTP clock for %s: %v", purpose, got)
		}
	}
}

func TestNativeMalformedAndShutdown(t *testing.T) {
	p := &publisher{tracks: map[byte]*mediaTrack{}}
	for _, frame := range [][]byte{mediaFrame(9, true, 0, []byte{1}), {0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}} {
		if err := p.media(bytes.NewReader(frame)); err == nil {
			t.Fatal("malformed media accepted")
		}
	}
	if err := run(strings.NewReader("{\"type\":\"answer\"}\n"), bytes.NewReader(nil), io.Discard); err == nil {
		t.Fatal("answer before initialization accepted")
	}
	if err := run(strings.NewReader(""), bytes.NewReader(nil), io.Discard); err != nil {
		t.Fatal(err)
	}
	if _, err := newPublisher(command{Tracks: []trackConfig{{Purpose: "camera"}, {Purpose: "camera"}}}, &output{writer: io.Discard}); err == nil {
		t.Fatal("duplicate track accepted")
	}
}
