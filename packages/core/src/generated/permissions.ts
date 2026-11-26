// Generated from the server role permission catalog. Do not edit.
export const legacyChannelMask = 786439;
export const Permission = {
  "Administrator": 32768,
  "ViewChannel": 1,
  "SendMessages": 2,
  "ConnectVoice": 4,
  "UseAI": 262144,
  "SwitchAIPreset": 524288,
  "CreateInvites": 8,
  "ManageChannels": 16,
  "ManageServer": 32,
  "ManageRoles": 64,
  "KickMembers": 128,
  "BanMembers": 256,
  "MuteMembers": 65536,
  "DeafenMembers": 131072,
  "DeleteMembers": 512,
  "ViewAuditLog": 1024,
  "ViewMemberIPs": 2048,
  "ManageMessages": 4096,
  "ResetPasswords": 8192,
  "ManageConfiguration": 16384
} as const;
export const rolePermissions: ReadonlyArray<{ bit: number; label: string; kinds: readonly string[] }> = [
  {
    "bit": 32768,
    "label": "Administrator",
    "kinds": []
  },
  {
    "bit": 1,
    "label": "View channels",
    "kinds": [
      "text",
      "voice",
      "ai"
    ]
  },
  {
    "bit": 2,
    "label": "Send messages",
    "kinds": [
      "text",
      "voice",
      "ai"
    ]
  },
  {
    "bit": 4,
    "label": "Join voice channels",
    "kinds": [
      "voice"
    ]
  },
  {
    "bit": 262144,
    "label": "Request AI responses",
    "kinds": [
      "ai"
    ]
  },
  {
    "bit": 524288,
    "label": "Switch AI presets",
    "kinds": [
      "ai"
    ]
  },
  {
    "bit": 8,
    "label": "Create invitations",
    "kinds": []
  },
  {
    "bit": 16,
    "label": "Manage channels",
    "kinds": [
      "text",
      "voice",
      "ai"
    ]
  },
  {
    "bit": 32,
    "label": "Manage server appearance & emojis",
    "kinds": []
  },
  {
    "bit": 64,
    "label": "Manage lower-ranked roles",
    "kinds": []
  },
  {
    "bit": 128,
    "label": "Kick members",
    "kinds": []
  },
  {
    "bit": 256,
    "label": "Ban members & review appeals",
    "kinds": []
  },
  {
    "bit": 65536,
    "label": "Mute members",
    "kinds": [
      "voice"
    ]
  },
  {
    "bit": 131072,
    "label": "Deafen members",
    "kinds": [
      "voice"
    ]
  },
  {
    "bit": 512,
    "label": "Delete accounts",
    "kinds": []
  },
  {
    "bit": 1024,
    "label": "View audit log",
    "kinds": []
  },
  {
    "bit": 2048,
    "label": "View member IPs & manage IP bans",
    "kinds": []
  },
  {
    "bit": 4096,
    "label": "Delete channel messages",
    "kinds": [
      "text",
      "voice",
      "ai"
    ]
  },
  {
    "bit": 8192,
    "label": "Reset member passwords",
    "kinds": []
  },
  {
    "bit": 16384,
    "label": "Manage configuration, storage & extensions",
    "kinds": []
  }
];
