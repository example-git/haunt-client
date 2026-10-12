// Generated from static/api/websocket.json. Do not edit.
export const protocol = {
  "format": "chatxo-websocket-v1",
  "events": {
    "account_feed": "Use events.watch when events.account_feed is advertised. Persist events.checkpoint only after applying preceding events. Initial/reconnect read positions come from paginated GET /api/v1/read-state. read.state contains changed readState objects; compare event_cursor and read_seq to reject stale snapshots. directory.changed invalidates directory/permission/emoji metadata, coalesce refreshes; read.sync requests a fresh read-state snapshot. These state hints are ephemeral and reconstructible, while message events are replayable. Advance read positions only through the highest message actually displayed in a focused conversation. Replays restore counts silently, not old notification sounds.",
    "client_messages": {
      "authenticate": {
        "optional": [
          "after_event"
        ],
        "reply": "ready",
        "required": [
          "type",
          "token"
        ]
      },
      "events.watch": {
        "description": "Watch every currently accessible conversation, including new channels and DMs, without a subscription-count limit. Replaces explicit subscriptions. Replay durable message/history events from after_event; omitted cursor starts at the connection head. Committed PostgreSQL notifications wake bounded account workers; idle fallback runs every five seconds.",
        "optional": [
          "after_event"
        ],
        "reply": "events.watching",
        "required": [
          "type"
        ]
      },
      "media.ice": {
        "description": "Use the current peer_id from media.answer; stale peer generations are rejected.",
        "reply": "media.ice.accepted",
        "required": [
          "type",
          "peer_id",
          "candidate"
        ]
      },
      "media.join": {
        "description": "Consume a device-scoped single-use admission within one minute. At most one room participant per event socket.",
        "reply": "media.joined",
        "required": [
          "type",
          "admission_id"
        ]
      },
      "media.leave": {
        "reply": "media.left",
        "required": [
          "type"
        ]
      },
      "media.publish": {
        "description": "WebRTC only. SDP offer and purpose-to-track-ID map. Purposes: audio (microphone), camera, screen, camera_audio, screen_audio. Replaces prior publishing peer and invalidates its receiver subscriptions.",
        "reply": "media.answer",
        "required": [
          "type",
          "sdp",
          "tracks"
        ]
      },
      "media.state": {
        "description": "Replace all muted, deafened, camera_off and screen_off booleans. muted affects microphone only; deafened blocks all incoming audio. camera_off and screen_off block both video and associated source audio.",
        "reply": "media.state.accepted",
        "required": [
          "type",
          "state"
        ]
      },
      "media.subscribe": {
        "description": "WebRTC only. Receiver offer must support publisher codecs. Only publishers in the same room are accessible.",
        "reply": "media.answer",
        "required": [
          "type",
          "publisher_id",
          "sdp"
        ]
      },
      "presence.watch": {
        "description": "When presence.online is advertised, enable (default) or disable online-user snapshots. Online means at least one authenticated event socket on this installation, including background devices; it does not imply voice participation. Initial subscribe/resume sends a full presence.snapshot; subsequent snapshots are sent only when users first connect or finally disconnect, coalesced by the existing gateway worker. No polling or durable replay. Clear client status to unknown when disconnected.",
        "optional": [
          "enabled"
        ],
        "reply": "presence.watching",
        "required": [
          "type"
        ]
      },
      "subscribe": {
        "description": "Replace up to 64 authorized conversation subscriptions. Use HTTP history event_cursor for synchronization.",
        "optional": [
          "after_event"
        ],
        "reply": "subscribed",
        "required": [
          "type",
          "conversations"
        ]
      },
      "voice.watch": {
        "description": "Enable (default) or disable changed voice.presence snapshots. Only watch from a foreground UI that displays rosters. Presence is ephemeral; resume sends a fresh snapshot. Each member includes joined_at, an RFC3339 UTC timestamp fixed at admission to the room. Display elapsed time locally; do not poll for timers.",
        "optional": [
          "enabled"
        ],
        "reply": "voice.watching",
        "required": [
          "type"
        ]
      }
    },
    "command_schema": {
      "$ref": "#/components/schemas/HttpapiEventCommand"
    },
    "durable_events": {
      "data": "Message object for created/updated/deleted; {pruned_through: sequence} for history.pruned. For dm.keys_changed the data is {revision}; for dm.devices_changed it is {user}. Refresh the DM encryption endpoints without incrementing unread counts. Monotonic global event IDs can skip inaccessible events. A gap requires HTTP history refresh.",
      "schema": {
        "$ref": "#/components/schemas/ChatEvent"
      },
      "types": [
        "message.created",
        "message.updated",
        "message.deleted",
        "history.pruned",
        "dm.keys_changed",
        "dm.devices_changed"
      ]
    },
    "max_input_bytes": 131072,
    "path": "/api/v1/events",
    "reconnect": "On sync.required in account-feed mode refresh the directory and read-state snapshot, load the visible conversation history, then events.watch from the supplied event_cursor. Legacy explicit subscriptions refresh their HTTP histories and resubscribe from the earliest returned event_cursor. On media.reconnect_required obtain a new admission, leave/rejoin, republish and recreate subscriptions before expires_at; credentials are separate from session validity. Serialise signaling commands and process asynchronous events while awaiting replies.",
    "server_messages": {
      "directory.changed": [
        "type"
      ],
      "error": [
        "type",
        "error"
      ],
      "events.checkpoint": [
        "type",
        "event_cursor"
      ],
      "events.watching": [
        "type",
        "event_cursor"
      ],
      "media.answer": [
        "type",
        "peer_id",
        "sdp",
        "publisher_id (receiver answers only)"
      ],
      "media.ice.accepted": [
        "type"
      ],
      "media.joined": [
        "type",
        "participant"
      ],
      "media.left": [
        "type"
      ],
      "media.participant.joined": [
        "type",
        "room_id",
        "participant"
      ],
      "media.participant.left": [
        "type",
        "participant_id"
      ],
      "media.participant.state": [
        "type",
        "participant"
      ],
      "media.reconnect_required": [
        "type",
        "reason",
        "expires_at"
      ],
      "media.revoked": [
        "type"
      ],
      "media.state.accepted": [
        "type"
      ],
      "media.tracks": [
        "type",
        "participant"
      ],
      "presence.snapshot": [
        "type",
        "online_user_ids (complete unique array, at most 512 user IDs; absent users are offline)"
      ],
      "presence.watching": [
        "type"
      ],
      "read.state": [
        "type",
        "states"
      ],
      "read.sync": [
        "type"
      ],
      "ready": [
        "type",
        "instance_id",
        "event_cursor"
      ],
      "subscribed": [
        "type",
        "conversations"
      ],
      "subscription.revoked": [
        "type",
        "conversation_id"
      ],
      "sync.required": [
        "type",
        "event_cursor"
      ],
      "voice.presence": [
        "type",
        "rooms"
      ],
      "voice.watching": [
        "type"
      ]
    }
  },
  "media": {
    "authenticate_schema": {
      "$ref": "#/components/schemas/HttpapiMediaAuthenticateCommand"
    },
    "binary": {
      "byte_order": "big-endian",
      "fields": [
        {
          "bytes": 1,
          "name": "version",
          "offset": 0,
          "value": 1
        },
        {
          "bytes": 1,
          "name": "purpose",
          "offset": 1,
          "values": {
            "audio": 0,
            "camera": 1,
            "camera_audio": 3,
            "screen": 2,
            "screen_audio": 4
          }
        },
        {
          "bytes": 1,
          "name": "flags",
          "offset": 2,
          "values": {
            "delta": 0,
            "key": 1
          }
        },
        {
          "bytes": 1,
          "name": "reserved",
          "offset": 3,
          "value": 0
        },
        {
          "bytes": 4,
          "description": "Server-issued track revision",
          "name": "revision",
          "offset": 4
        },
        {
          "bytes": 8,
          "maximum": 9007199254740991,
          "name": "timestamp_us",
          "offset": 8
        },
        {
          "bytes": 4,
          "maximum": 10000000,
          "name": "duration_us",
          "offset": 16
        },
        {
          "bytes": 4,
          "description": "Per-track contiguous sequence; uint32 wrap allowed. First value is arbitrary.",
          "name": "sequence",
          "offset": 20
        },
        {
          "description": "One nonempty encoded elementary chunk; no container, RTP or SDP.",
          "name": "payload",
          "offset": 24
        }
      ],
      "input_header_bytes": 24,
      "max_audio_input_bytes": 65536,
      "max_input_bytes": 524288,
      "output_header_bytes": 40,
      "output_prefix": "16 raw UUID bytes identifying the authenticated publisher; followed by the unchanged input header and encoded chunk"
    },
    "client_messages": {
      "authenticate": {
        "description": "participant_id must belong to this device session's joined event socket. One media socket per participant.",
        "reply": "ready",
        "required": [
          "type",
          "token",
          "participant_id"
        ]
      },
      "configure": {
        "description": "Replace up to five streams: microphone audio, camera video, screen video, camera audio and screen audio. Empty tracks stops publication. Server assigns a new revision; use it for all chunks. description is base64 decoder configuration. Codec is an ASCII WebCodecs identifier, not a fixed whitelist.",
        "reply": "tracks",
        "required": [
          "type",
          "tracks"
        ]
      },
      "keyframe": {
        "description": "Ask a camera/screen publisher for a keyframe. Server coalesces requests to at most one per second per source track.",
        "required": [
          "type",
          "publisher_id",
          "purpose"
        ]
      }
    },
    "command_schema": {
      "$ref": "#/components/schemas/HttpapiMediaCommand"
    },
    "enabled_when": "Admission transport is websocket",
    "limits": {
      "configure_per_second": 1,
      "inbound_bytes_per_second": 8388608,
      "inbound_frames_per_second": 600,
      "outbound_bytes": 2097152,
      "outbound_frames": 64
    },
    "path": "/api/v1/media",
    "protocol": "chatxo-encoded-v1",
    "recovery": "Late receivers wait for a video keyframe. Obey keyframe requests. On media socket loss, reattach to the still-active participant, configure again and use the new revision. When the event socket is lost, obtain a new admission and participant first. Queue overflow closes a slow receiver. Clients need bitrate/backpressure control, audio scheduling and timestamp synchronization; the server never decodes media.",
    "server_messages": {
      "keyframe": [
        "type",
        "purpose"
      ],
      "ready": [
        "type",
        "protocol"
      ],
      "tracks": [
        "type",
        "participant_id",
        "tracks"
      ]
    },
    "track_schema": {
      "$ref": "#/components/schemas/VoiceEncodedTrack"
    }
  }
} as const;
