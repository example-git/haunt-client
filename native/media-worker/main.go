// media-worker publishes pre-encoded desktop media. It has no credentials, HTTP
// endpoint, capture devices, or server discovery: Electron owns its private pipes
// and the renderer carries SDP over the existing authenticated gateway.
package main

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/pion/interceptor"
	"github.com/pion/rtcp"
	"github.com/pion/rtp"
	"github.com/pion/rtp/codecs"
	"github.com/pion/sdp/v3"
	"github.com/pion/webrtc/v4"
)

var purposes = []string{"audio", "camera", "screen", "camera_audio", "screen_audio"}

type trackConfig struct {
	Purpose string   `json:"purpose"`
	FMTP    string   `json:"fmtp,omitempty"`
	Layers  []string `json:"layers,omitempty"`
}
type command struct {
	Type   string                    `json:"type"`
	Tracks []trackConfig             `json:"tracks"`
	ICE    []webrtc.ICEServer        `json:"ice"`
	Relay  bool                      `json:"relay"`
	SDP    webrtc.SessionDescription `json:"sdp"`
}
type output struct {
	mu     sync.Mutex
	writer io.Writer
}

func (o *output) send(v any) {
	o.mu.Lock()
	defer o.mu.Unlock()
	_ = json.NewEncoder(o.writer).Encode(v)
}

type mediaTrack struct {
	local     *webrtc.TrackLocalStaticRTP
	sender    *webrtc.RTPSender
	payloader rtp.Payloader
	clock     uint64
	sequence  uint16
	video     bool
	ready     bool
	first     uint64
	last      uint64
}
type publisher struct {
	pc        *webrtc.PeerConnection
	tracks    map[byte]*mediaTrack
	connected atomic.Bool
}

func newPublisher(c command, out *output) (*publisher, error) {
	if len(c.Tracks) == 0 || len(c.Tracks) > len(purposes) || len(c.ICE) > 8 {
		return nil, errors.New("invalid publisher configuration")
	}
	m := &webrtc.MediaEngine{}
	// Register only the actual codecs. SwiftCapture uses constrained baseline,
	// and its SPS supplies the actual level (e.g. 1080p60 needs level 4.2).
	if err := m.RegisterCodec(webrtc.RTPCodecParameters{RTPCodecCapability: webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeOpus, ClockRate: 48000, Channels: 2, SDPFmtpLine: "minptime=10;useinbandfec=1;stereo=1;maxaveragebitrate=510000;maxplaybackrate=48000"}, PayloadType: 111}, webrtc.RTPCodecTypeAudio); err != nil {
		return nil, err
	}
	if err := m.RegisterCodec(webrtc.RTPCodecParameters{RTPCodecCapability: webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeH264, ClockRate: 90000, SDPFmtpLine: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e02a", RTCPFeedback: []webrtc.RTCPFeedback{{Type: "nack"}, {Type: "nack", Parameter: "pli"}, {Type: "ccm", Parameter: "fir"}}}, PayloadType: 102}, webrtc.RTPCodecTypeVideo); err != nil {
		return nil, err
	}
	r := &interceptor.Registry{}
	for _, uri := range []string{sdp.SDESMidURI, sdp.SDESRTPStreamIDURI, sdp.SDESRepairRTPStreamIDURI} {
		if err := m.RegisterHeaderExtension(webrtc.RTPHeaderExtensionCapability{URI: uri}, webrtc.RTPCodecTypeVideo); err != nil {
			return nil, err
		}
	}
	if err := webrtc.RegisterDefaultInterceptors(m, r); err != nil {
		return nil, err
	}
	settings := webrtc.SettingEngine{}
	settings.SetIncludeLoopbackCandidate(true)
	configuration := webrtc.Configuration{ICEServers: c.ICE, BundlePolicy: webrtc.BundlePolicyMaxBundle}
	if c.Relay {
		configuration.ICETransportPolicy = webrtc.ICETransportPolicyRelay
	}
	pc, err := webrtc.NewAPI(webrtc.WithMediaEngine(m), webrtc.WithInterceptorRegistry(r), webrtc.WithSettingEngine(settings)).NewPeerConnection(configuration)
	if err != nil {
		return nil, err
	}
	p := &publisher{pc: pc, tracks: map[byte]*mediaTrack{}}
	ok := false
	defer func() {
		if !ok {
			pc.Close()
		}
	}()
	for _, config := range c.Tracks {
		index := -1
		for i, purpose := range purposes {
			if purpose == config.Purpose {
				index = i
			}
		}
		if index < 0 || p.tracks[byte(index)] != nil {
			return nil, errors.New("invalid or duplicate track")
		}
		video := index == 1 || index == 2
		codec := webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeOpus, ClockRate: 48000, Channels: 2, SDPFmtpLine: "minptime=10;useinbandfec=1;stereo=1;maxaveragebitrate=510000;maxplaybackrate=48000"}
		var payloader rtp.Payloader = &codecs.OpusPayloader{}
		if video {
			if len(config.FMTP) > 256 {
				return nil, errors.New("invalid video format")
			}
			codec = webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeH264, ClockRate: 90000, SDPFmtpLine: config.FMTP, RTCPFeedback: []webrtc.RTCPFeedback{{Type: "nack"}, {Type: "nack", Parameter: "pli"}, {Type: "ccm", Parameter: "fir"}}}
			payloader = &codecs.H264Payloader{}
		}
		layers := config.Layers
		if len(layers) == 0 {
			layers = []string{""}
		}
		if len(layers) > 3 || (len(config.Layers) > 0 && (!video || layers[0] != "h")) {
			return nil, errors.New("invalid video layers")
		}
		var sender *webrtc.RTPSender
		for layerIndex, rid := range layers {
			slot := 0
			switch rid {
			case "", "h":
			case "m":
				slot = 16
			case "l":
				slot = 32
			default:
				return nil, errors.New("invalid layer ID")
			}
			if p.tracks[byte(index+slot)] != nil {
				return nil, errors.New("duplicate layer")
			}
			local, err := webrtc.NewTrackLocalStaticRTP(codec, config.Purpose, "haunt-native", webrtc.WithRTPStreamID(rid))
			if err != nil {
				return nil, err
			}
			if layerIndex == 0 {
				sender, err = pc.AddTrack(local)
			} else {
				err = sender.AddEncoding(local)
			}
			if err != nil {
				return nil, err
			}
			if video {
				payloader = &codecs.H264Payloader{}
			}
			p.tracks[byte(index+slot)] = &mediaTrack{local: local, sender: sender, payloader: payloader, clock: uint64(codec.ClockRate), video: video}
			go func(sender *webrtc.RTPSender, purpose, rid string, primary bool) {
				for {
					var packets []rtcp.Packet
					var err error
					if primary {
						packets, _, err = sender.ReadRTCP()
					} else {
						packets, _, err = sender.ReadSimulcastRTCP(rid)
					}
					if err != nil {
						return
					}
					for _, packet := range packets {
						switch packet.(type) {
						case *rtcp.PictureLossIndication, *rtcp.FullIntraRequest:
							out.send(map[string]any{"type": "keyframe", "purpose": purpose, "layer": rid})
						}
					}
				}
			}(sender, config.Purpose, rid, layerIndex == 0)
		}
	}
	pc.OnConnectionStateChange(func(s webrtc.PeerConnectionState) {
		p.connected.Store(s == webrtc.PeerConnectionStateConnected)
		out.send(map[string]any{"type": "state", "state": s.String()})
	})
	ok = true
	return p, nil
}

func (p *publisher) offer() (webrtc.SessionDescription, error) {
	offer, err := p.pc.CreateOffer(nil)
	if err != nil {
		return offer, err
	}
	gathered := webrtc.GatheringCompletePromise(p.pc)
	if err = p.pc.SetLocalDescription(offer); err != nil {
		return offer, err
	}
	select {
	case <-gathered:
		return *p.pc.LocalDescription(), nil
	case <-time.After(10 * time.Second):
		return offer, errors.New("native ICE gathering timed out")
	}
}

// Private framed FD: length:u32, purpose:u8, key:u8, timestamp-us:u64,
// then one complete H.264 Annex-B access unit or Opus packet. Bounded before
// allocating; each stream has its own clock and RTP sequence.
func (p *publisher) media(reader io.Reader) error {
	var header [14]byte
	for {
		if _, err := io.ReadFull(reader, header[:]); err != nil {
			return err
		}
		n := binary.BigEndian.Uint32(header[:4])
		if n < 10 || n > 4*1024*1024+10 {
			return errors.New("invalid media frame size")
		}
		track := p.tracks[header[4]]
		if track == nil {
			return errors.New("unknown media track")
		}
		data := make([]byte, int(n)-10)
		if _, err := io.ReadFull(reader, data); err != nil {
			return err
		}
		pts := binary.BigEndian.Uint64(header[6:14])
		if !p.connected.Load() {
			track.ready = false
			continue
		}
		if !track.ready {
			if track.video && header[5] != 1 {
				continue
			}
			track.ready = true
			track.first = pts
		}
		if pts < track.first || pts < track.last {
			continue
		}
		track.last = pts
		timestamp := uint32((pts - track.first) * track.clock / 1_000_000)
		payloads := track.payloader.Payload(1180, data)
		for i, payload := range payloads {
			track.sequence++
			packet := &rtp.Packet{Header: rtp.Header{Version: 2, SequenceNumber: track.sequence, Timestamp: timestamp, Marker: i == len(payloads)-1}, Payload: payload}
			if rid := track.local.RID(); rid != "" {
				mid := ""
				for _, transceiver := range p.pc.GetTransceivers() {
					if transceiver.Sender() == track.sender {
						mid = transceiver.Mid()
						break
					}
				}
				midSet, ridSet := false, false
				for _, extension := range track.sender.GetParameters().HeaderExtensions {
					value := ""
					switch extension.URI {
					case sdp.SDESMidURI:
						value = mid
						midSet = true
					case sdp.SDESRTPStreamIDURI:
						value = rid
						ridSet = true
					}
					if value != "" {
						if err := packet.SetExtension(uint8(extension.ID), []byte(value)); err != nil {
							return err
						}
					}
				}
				if mid == "" || !midSet || !ridSet {
					return errors.New("native video layers require negotiated MID and RID extensions")
				}
			}
			if err := track.local.WriteRTP(packet); err != nil {
				return err
			}
		}
	}
}

func run(input io.Reader, media io.Reader, writer io.Writer, lower ...io.Reader) error {
	out := &output{writer: writer}
	scanner := bufio.NewScanner(input)
	scanner.Buffer(make([]byte, 4096), 128*1024)
	var p *publisher
	answered := false
	defer func() {
		if p != nil {
			p.pc.Close()
		}
	}()
	for scanner.Scan() {
		var c command
		if err := json.Unmarshal(scanner.Bytes(), &c); err != nil {
			return err
		}
		switch c.Type {
		case "offer":
			if p != nil {
				return errors.New("publisher already initialized")
			}
			var err error
			p, err = newPublisher(c, out)
			if err != nil {
				return err
			}
			sdp, err := p.offer()
			if err != nil {
				return err
			}
			out.send(map[string]any{"type": "offer", "sdp": sdp})
		case "answer":
			if p == nil || answered {
				return errors.New("publisher not initialized")
			}
			if err := p.pc.SetRemoteDescription(c.SDP); err != nil {
				return err
			}
			out.send(map[string]any{"type": "answer"})
			answered = true
			go func() {
				if err := p.media(media); err != nil && !errors.Is(err, io.EOF) {
					out.send(map[string]any{"type": "error", "message": err.Error()})
				}
			}()
			if len(lower) > 0 {
				go func() {
					if err := p.media(lower[0]); err != nil && !errors.Is(err, io.EOF) {
						out.send(map[string]any{"type": "error", "message": err.Error()})
					}
				}()
			}
		case "close":
			return nil
		default:
			return errors.New("unknown command")
		}
	}
	return scanner.Err()
}
func main() {
	fd := os.NewFile(3, "media")
	defer fd.Close()
	lower := os.NewFile(4, "lower-video")
	defer lower.Close()
	if err := run(os.Stdin, fd, os.Stdout, lower); err != nil {
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"type": "error", "message": err.Error()})
		fmt.Fprintln(os.Stderr, "Media publisher stopped:", err)
		os.Exit(1)
	}
}
