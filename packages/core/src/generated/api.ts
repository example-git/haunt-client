// Generated from static/api/openapi.json. Do not edit.

export type V4SDPType = "offer" | "answer" | "pranswer" | "rollback";

export interface APIContract {
  paths: {
    "/api/v1/admin/appeals": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationListAppeals;
      put?: never;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/admin/appeals/{id}/review": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put?: never;
      post: OperationReviewAppeal;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/admin/audio-plugins": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put?: never;
      post: OperationInstallAudioPlugin;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/admin/audio-plugins/default": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put: OperationSetDefaultAudioPlugin;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/admin/audio-plugins/repository": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put?: never;
      post: OperationInstallAudioPluginRepository;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/admin/audio-plugins/{id}": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put?: never;
      post?: never;
      delete: OperationRemoveAudioPlugin;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/admin/audit": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationAuditLog;
      put?: never;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/admin/bans": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationListBans;
      put?: never;
      post: OperationBanNetwork;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/admin/bans/{id}/revoke": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put?: never;
      post: OperationRevokeBan;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/admin/maintenance": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put?: never;
      post: OperationMaintenance;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/admin/members/{id}": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put: OperationDisableMember;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/admin/members/{id}/ips": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationMemberIPs;
      put?: never;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/admin/members/{id}/moderate": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put?: never;
      post: OperationModerateMember;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/admin/members/{id}/password": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put: OperationResetMemberPassword;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/admin/members/{id}/password-reset": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put?: never;
      post: OperationIssueTemporaryPassword;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/admin/server-extensions/{id}": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationGetServerExtension;
      put: OperationSaveServerExtension;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/admin/server-extensions/{id}/test": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put?: never;
      post: OperationTestServerExtension;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/admin/stats": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationGetStats;
      put?: never;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/admin/storage": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationListStorage;
      put?: never;
      post: OperationRegisterStorage;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/admin/storage/active": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put: OperationActivateStorage;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/admin/storage/{id}": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put?: never;
      post?: never;
      delete: OperationRemoveStorage;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/admin/storage/{id}/check": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put?: never;
      post: OperationCheckStorage;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/admin/storage/{id}/credentials": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put: OperationRotateStorageCredentials;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/attachments/{id}": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationDownloadAttachment;
      put?: never;
      post?: never;
      delete: OperationDeleteAttachment;
      options?: never;
      head: OperationHeadAttachment;
      patch?: never;
      trace?: never;
    };
    "/api/v1/attachments/{id}/metadata": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationGetAttachmentMetadata;
      put?: never;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/audio-plugins": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationListAudioPlugins;
      put?: never;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/audio-plugins/{digest}/files/{name}": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationDownloadAudioPlugin;
      put?: never;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/auth/ban/appeal": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put?: never;
      post: OperationAppealBan;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/auth/ban/status": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put?: never;
      post: OperationBanStatus;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/auth/login": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put?: never;
      post: OperationLogin;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/auth/logout": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put?: never;
      post: OperationLogout;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/auth/register": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put?: never;
      post: OperationRegister;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/categories": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationListCategories;
      put?: never;
      post: OperationCreateCategory;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/categories/{id}": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put: OperationUpdateCategory;
      post?: never;
      delete: OperationDeleteCategory;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/categories/{id}/permissions": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationGetCategoryPermissions;
      put?: never;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/categories/{id}/permissions/{role}": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put: OperationSetCategoryPermissions;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/channels": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationListChannels;
      put?: never;
      post: OperationCreateChannel;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/channels/{id}": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationGetChannel;
      put: OperationUpdateChannel;
      post?: never;
      delete: OperationDeleteChannel;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/channels/{id}/menu": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationGetChannelMenu;
      put?: never;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/channels/{id}/permissions": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationGetChannelPermissions;
      put?: never;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/channels/{id}/permissions/{role}": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put: OperationSetChannelPermissions;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/client-updates/haunt-updates.json": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationClientUpdateManifest;
      put?: never;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/client-updates/installers": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationClientInstallers;
      put?: never;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/client-updates/{version}/{name}": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationClientUpdateFile;
      put?: never;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/conversations": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationListConversations;
      put?: never;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/conversations/{id}/attachments": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put?: never;
      post: OperationUploadAttachment;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/conversations/{id}/encryption": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationDmEncryptionBundle;
      put?: never;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/conversations/{id}/encryption/events": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationDmEncryptionEvents;
      put?: never;
      post: OperationCommitDMEncryption;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/conversations/{id}/messages": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationGetHistory;
      put?: never;
      post: OperationCreateMessage;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/conversations/{id}/messages/{message}": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put: OperationEditMessage;
      post?: never;
      delete: OperationDeleteMessage;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/conversations/{id}/messages/{message}/embeds": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationGetMessageEmbeds;
      put?: never;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/conversations/{id}/messages/{message}/embeds/image": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationGetEmbedImage;
      put?: never;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/conversations/{id}/read": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put: OperationMarkConversationRead;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/dms": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put?: never;
      post: OperationCreateDM;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/emojis": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationListEmojis;
      put?: never;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/emojis/{id}": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put?: never;
      post?: never;
      delete: OperationDeleteEmoji;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/emojis/{id}/image": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationGetEmojiImage;
      put?: never;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/emojis/{name}": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put: OperationSaveEmoji;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/events": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationEvents;
      put?: never;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/instance": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationInstance;
      put?: never;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/instance/banner": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationGetBanner;
      put: OperationUploadBanner;
      post?: never;
      delete: OperationDeleteBanner;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/instance/configuration": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationGetConfiguration;
      put: OperationSaveConfiguration;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/instance/icon": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationGetIcon;
      put: OperationUploadIcon;
      post?: never;
      delete: OperationDeleteIcon;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/instance/settings": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put: OperationUpdateInstance;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/invites": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationListInvites;
      put?: never;
      post: OperationCreateInvite;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/invites/{id}": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put?: never;
      post?: never;
      delete: OperationRevokeInvite;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/me": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationMe;
      put?: never;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/me/avatar": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put: OperationUploadAvatar;
      post?: never;
      delete: OperationDeleteAvatar;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/me/dm-devices": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put?: never;
      post: OperationRegisterDMDevice;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/me/dm-devices/{device}/packages": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationOwnDMKeyPackages;
      put: OperationPublishDMKeyPackages;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/me/dm-storage": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationDmStorage;
      put?: never;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/me/dm-storage/purge": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put?: never;
      post: OperationPurgeDMUploads;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/me/password": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put: OperationChangePassword;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/me/profile": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put: OperationUpdateProfile;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/me/session": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put: OperationRememberSession;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/media": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationMedia;
      put?: never;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/members": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationListMembers;
      put?: never;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/members/{id}/roles": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put: OperationAssignRoles;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/menus/server": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationGetServerMenu;
      put?: never;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/read-state": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationListReadState;
      put?: never;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/roles": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationListRoles;
      put?: never;
      post: OperationCreateRole;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/roles/{id}": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put: OperationUpdateRole;
      post?: never;
      delete: OperationDeleteRole;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/server-extensions": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationListServerExtensions;
      put?: never;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/server-extensions/{id}/speech": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put?: never;
      post: OperationServerExtensionSpeech;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/sessions": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationListSessions;
      put?: never;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/sessions/restore": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put?: never;
      post: OperationRestoreSession;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/sessions/{id}": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put?: never;
      post?: never;
      delete: OperationRevokeSession;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/users": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationListUsers;
      put?: never;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/users/{id}": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationGetUser;
      put?: never;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/users/{id}/avatar": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationGetAvatar;
      put?: never;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/voice/{id}": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationGetVoiceRoom;
      put?: never;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/voice/{id}/admissions": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get?: never;
      put?: never;
      post: OperationAdmitVoice;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/api/v1/voice/{id}/ice": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationGetICE;
      put?: never;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/healthz": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationHealth;
      put?: never;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
    "/readyz": {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      get: OperationReadiness;
      put?: never;
      post?: never;
      delete?: never;
      options?: never;
      head?: never;
      patch?: never;
      trace?: never;
    };
  };
  components: {
    schemas: {
      AttachmentsAttachment: AttachmentsAttachment;
      AttachmentsDMPurge: AttachmentsDMPurge;
      AttachmentsDMUsage: AttachmentsDMUsage;
      AudiopluginABI: AudiopluginABI;
      AudiopluginDiagnostic: AudiopluginDiagnostic;
      AudiopluginField: AudiopluginField;
      AudiopluginFile: AudiopluginFile;
      AudiopluginLegacyPreferences: AudiopluginLegacyPreferences;
      AudiopluginManifest: AudiopluginManifest;
      AudiopluginPlugin: AudiopluginPlugin;
      AudiopluginPreferences: AudiopluginPreferences;
      AudiopluginRepositoryInstall: AudiopluginRepositoryInstall;
      AudiopluginVariant: AudiopluginVariant;
      BlobstoreConfiguration: BlobstoreConfiguration;
      BlobstoreCredentials: BlobstoreCredentials;
      BlobstoreProvider: BlobstoreProvider;
      BlobstoreRegisterRequest: BlobstoreRegisterRequest;
      ChatConversation: ChatConversation;
      ChatDMCryptoBundle: ChatDMCryptoBundle;
      ChatDMCryptoCommit: ChatDMCryptoCommit;
      ChatDMCryptoEvent: ChatDMCryptoEvent;
      ChatDMCryptoEvents: ChatDMCryptoEvents;
      ChatDMDevice: ChatDMDevice;
      ChatDMKeyPackage: ChatDMKeyPackage;
      ChatDMKeyPackages: ChatDMKeyPackages;
      ChatEvent: ChatEvent;
      ChatHistory: ChatHistory;
      ChatMessage: ChatMessage;
      ChatReadPage: ChatReadPage;
      ChatReadState: ChatReadState;
      ChatRegisterDMDevice: ChatRegisterDMDevice;
      ConfigDMPolicy: ConfigDMPolicy;
      ConfigICEServer: ConfigICEServer;
      ConfigPolicy: ConfigPolicy;
      ConfigRuntimeSettings: ConfigRuntimeSettings;
      EmbedsPreview: EmbedsPreview;
      HttpapiActivateStorageRequest: HttpapiActivateStorageRequest;
      HttpapiAppealsResponse: HttpapiAppealsResponse;
      HttpapiArtResponse: HttpapiArtResponse;
      HttpapiAssignRolesRequest: HttpapiAssignRolesRequest;
      HttpapiAudioPluginsResponse: HttpapiAudioPluginsResponse;
      HttpapiAuditResponse: HttpapiAuditResponse;
      HttpapiAuthenticationInfo: HttpapiAuthenticationInfo;
      HttpapiBanAppealRequest: HttpapiBanAppealRequest;
      HttpapiBanNetworkRequest: HttpapiBanNetworkRequest;
      HttpapiBanTicketRequest: HttpapiBanTicketRequest;
      HttpapiBansResponse: HttpapiBansResponse;
      HttpapiCategoriesResponse: HttpapiCategoriesResponse;
      HttpapiChangePasswordRequest: HttpapiChangePasswordRequest;
      HttpapiChannelsResponse: HttpapiChannelsResponse;
      HttpapiClientInstallers: HttpapiClientInstallers;
      HttpapiClientUpdateEnvelope: HttpapiClientUpdateEnvelope;
      HttpapiClientUpdateSource: HttpapiClientUpdateSource;
      HttpapiConfigurationResponse: HttpapiConfigurationResponse;
      HttpapiConversationsResponse: HttpapiConversationsResponse;
      HttpapiCreateDMRequest: HttpapiCreateDMRequest;
      HttpapiCreateInviteRequest: HttpapiCreateInviteRequest;
      HttpapiCreateMessageRequest: HttpapiCreateMessageRequest;
      HttpapiCredentialsRequest: HttpapiCredentialsRequest;
      HttpapiDMPurgeRequest: HttpapiDMPurgeRequest;
      HttpapiDisableMemberRequest: HttpapiDisableMemberRequest;
      HttpapiEditMessageRequest: HttpapiEditMessageRequest;
      HttpapiEmbedsResponse: HttpapiEmbedsResponse;
      HttpapiEmojisResponse: HttpapiEmojisResponse;
      HttpapiErrorResponse: HttpapiErrorResponse;
      HttpapiEventCommand: HttpapiEventCommand;
      HttpapiExtensionSpeechRequest: HttpapiExtensionSpeechRequest;
      HttpapiIceResponse: HttpapiIceResponse;
      HttpapiInstanceResponse: HttpapiInstanceResponse;
      HttpapiInvitesResponse: HttpapiInvitesResponse;
      HttpapiMarkReadRequest: HttpapiMarkReadRequest;
      HttpapiMediaAuthenticateCommand: HttpapiMediaAuthenticateCommand;
      HttpapiMediaCommand: HttpapiMediaCommand;
      HttpapiMemberIPsResponse: HttpapiMemberIPsResponse;
      HttpapiMembersResponse: HttpapiMembersResponse;
      HttpapiMenuCommand: HttpapiMenuCommand;
      HttpapiMenuField: HttpapiMenuField;
      HttpapiMenuForm: HttpapiMenuForm;
      HttpapiMenuManifest: HttpapiMenuManifest;
      HttpapiMenuOption: HttpapiMenuOption;
      HttpapiMenuPage: HttpapiMenuPage;
      HttpapiModerateMemberRequest: HttpapiModerateMemberRequest;
      HttpapiModerationReasonRequest: HttpapiModerationReasonRequest;
      HttpapiOverridesResponse: HttpapiOverridesResponse;
      HttpapiParticipantsResponse: HttpapiParticipantsResponse;
      HttpapiRememberSessionRequest: HttpapiRememberSessionRequest;
      HttpapiResetPasswordRequest: HttpapiResetPasswordRequest;
      HttpapiRestoreSessionRequest: HttpapiRestoreSessionRequest;
      HttpapiRolesResponse: HttpapiRolesResponse;
      HttpapiSaveCategoryRequest: HttpapiSaveCategoryRequest;
      HttpapiSaveChannelRequest: HttpapiSaveChannelRequest;
      HttpapiSaveCommunityRequest: HttpapiSaveCommunityRequest;
      HttpapiSaveConfigurationRequest: HttpapiSaveConfigurationRequest;
      HttpapiSaveRoleRequest: HttpapiSaveRoleRequest;
      HttpapiServerExtensionsResponse: HttpapiServerExtensionsResponse;
      HttpapiSessionsResponse: HttpapiSessionsResponse;
      HttpapiSetPermissionsRequest: HttpapiSetPermissionsRequest;
      HttpapiStatsResponse: HttpapiStatsResponse;
      HttpapiStatusResponse: HttpapiStatusResponse;
      HttpapiStorageProvidersResponse: HttpapiStorageProvidersResponse;
      HttpapiTemporaryPasswordRequest: HttpapiTemporaryPasswordRequest;
      HttpapiUnavailableResponse: HttpapiUnavailableResponse;
      HttpapiUsersResponse: HttpapiUsersResponse;
      IdentityAppeal: IdentityAppeal;
      IdentityAuditEntry: IdentityAuditEntry;
      IdentityBan: IdentityBan;
      IdentityBanStatus: IdentityBanStatus;
      IdentityCategory: IdentityCategory;
      IdentityChannel: IdentityChannel;
      IdentityCommunitySettings: IdentityCommunitySettings;
      IdentityDisplayRole: IdentityDisplayRole2;
      IdentityEmoji: IdentityEmoji;
      IdentityInvite: IdentityInvite;
      IdentityLogin: IdentityLogin;
      IdentityMember: IdentityMember;
      IdentityMemberIP: IdentityMemberIP;
      IdentityOverride: IdentityOverride;
      IdentityPrincipal: IdentityPrincipal;
      IdentityProfileSettingsRequest: IdentityProfileSettingsRequest;
      IdentityRole: IdentityRole;
      IdentityRuntimeConfiguration: IdentityRuntimeConfiguration;
      IdentitySession: IdentitySession;
      IdentityTemporaryPassword: IdentityTemporaryPassword;
      IdentityUser: IdentityUser;
      ServerextensionConfiguration: ServerextensionConfiguration;
      ServerextensionExtension: ServerextensionExtension;
      ServerextensionSaveRequest: ServerextensionSaveRequest;
      ServerextensionSpeechRequest: ServerextensionSpeechRequest;
      V4ICECandidateInit: V4ICECandidateInit;
      V4RTPCodecCapability: V4RTPCodecCapability;
      V4SDPType: V4SDPType;
      V4SessionDescription: V4SessionDescription;
      VoiceAdmission: VoiceAdmission;
      VoiceEncodedTrack: VoiceEncodedTrack;
      VoicePresenceMember: VoicePresenceMember;
      VoiceSnapshot: VoiceSnapshot;
      VoiceState: VoiceState;
      VoiceTrack: VoiceTrack;
    };
  };
  operations: {
    listAppeals: OperationListAppeals;
    reviewAppeal: OperationReviewAppeal;
    installAudioPlugin: OperationInstallAudioPlugin;
    setDefaultAudioPlugin: OperationSetDefaultAudioPlugin;
    installAudioPluginRepository: OperationInstallAudioPluginRepository;
    removeAudioPlugin: OperationRemoveAudioPlugin;
    auditLog: OperationAuditLog;
    listBans: OperationListBans;
    banNetwork: OperationBanNetwork;
    revokeBan: OperationRevokeBan;
    maintenance: OperationMaintenance;
    disableMember: OperationDisableMember;
    memberIPs: OperationMemberIPs;
    moderateMember: OperationModerateMember;
    resetMemberPassword: OperationResetMemberPassword;
    issueTemporaryPassword: OperationIssueTemporaryPassword;
    getServerExtension: OperationGetServerExtension;
    saveServerExtension: OperationSaveServerExtension;
    testServerExtension: OperationTestServerExtension;
    getStats: OperationGetStats;
    listStorage: OperationListStorage;
    registerStorage: OperationRegisterStorage;
    activateStorage: OperationActivateStorage;
    removeStorage: OperationRemoveStorage;
    checkStorage: OperationCheckStorage;
    rotateStorageCredentials: OperationRotateStorageCredentials;
    downloadAttachment: OperationDownloadAttachment;
    deleteAttachment: OperationDeleteAttachment;
    headAttachment: OperationHeadAttachment;
    getAttachmentMetadata: OperationGetAttachmentMetadata;
    listAudioPlugins: OperationListAudioPlugins;
    downloadAudioPlugin: OperationDownloadAudioPlugin;
    appealBan: OperationAppealBan;
    banStatus: OperationBanStatus;
    login: OperationLogin;
    logout: OperationLogout;
    register: OperationRegister;
    listCategories: OperationListCategories;
    createCategory: OperationCreateCategory;
    updateCategory: OperationUpdateCategory;
    deleteCategory: OperationDeleteCategory;
    getCategoryPermissions: OperationGetCategoryPermissions;
    setCategoryPermissions: OperationSetCategoryPermissions;
    listChannels: OperationListChannels;
    createChannel: OperationCreateChannel;
    getChannel: OperationGetChannel;
    updateChannel: OperationUpdateChannel;
    deleteChannel: OperationDeleteChannel;
    getChannelMenu: OperationGetChannelMenu;
    getChannelPermissions: OperationGetChannelPermissions;
    setChannelPermissions: OperationSetChannelPermissions;
    clientUpdateManifest: OperationClientUpdateManifest;
    clientInstallers: OperationClientInstallers;
    clientUpdateFile: OperationClientUpdateFile;
    listConversations: OperationListConversations;
    uploadAttachment: OperationUploadAttachment;
    dmEncryptionBundle: OperationDmEncryptionBundle;
    dmEncryptionEvents: OperationDmEncryptionEvents;
    commitDMEncryption: OperationCommitDMEncryption;
    getHistory: OperationGetHistory;
    createMessage: OperationCreateMessage;
    editMessage: OperationEditMessage;
    deleteMessage: OperationDeleteMessage;
    getMessageEmbeds: OperationGetMessageEmbeds;
    getEmbedImage: OperationGetEmbedImage;
    markConversationRead: OperationMarkConversationRead;
    createDM: OperationCreateDM;
    listEmojis: OperationListEmojis;
    deleteEmoji: OperationDeleteEmoji;
    getEmojiImage: OperationGetEmojiImage;
    saveEmoji: OperationSaveEmoji;
    events: OperationEvents;
    instance: OperationInstance;
    get_banner: OperationGetBanner;
    upload_banner: OperationUploadBanner;
    delete_banner: OperationDeleteBanner;
    getConfiguration: OperationGetConfiguration;
    saveConfiguration: OperationSaveConfiguration;
    get_icon: OperationGetIcon;
    upload_icon: OperationUploadIcon;
    delete_icon: OperationDeleteIcon;
    updateInstance: OperationUpdateInstance;
    listInvites: OperationListInvites;
    createInvite: OperationCreateInvite;
    revokeInvite: OperationRevokeInvite;
    me: OperationMe;
    upload_avatar: OperationUploadAvatar;
    delete_avatar: OperationDeleteAvatar;
    registerDMDevice: OperationRegisterDMDevice;
    ownDMKeyPackages: OperationOwnDMKeyPackages;
    publishDMKeyPackages: OperationPublishDMKeyPackages;
    dmStorage: OperationDmStorage;
    purgeDMUploads: OperationPurgeDMUploads;
    changePassword: OperationChangePassword;
    updateProfile: OperationUpdateProfile;
    rememberSession: OperationRememberSession;
    media: OperationMedia;
    listMembers: OperationListMembers;
    assignRoles: OperationAssignRoles;
    getServerMenu: OperationGetServerMenu;
    listReadState: OperationListReadState;
    listRoles: OperationListRoles;
    createRole: OperationCreateRole;
    updateRole: OperationUpdateRole;
    deleteRole: OperationDeleteRole;
    listServerExtensions: OperationListServerExtensions;
    serverExtensionSpeech: OperationServerExtensionSpeech;
    listSessions: OperationListSessions;
    restoreSession: OperationRestoreSession;
    revokeSession: OperationRevokeSession;
    listUsers: OperationListUsers;
    getUser: OperationGetUser;
    get_avatar: OperationGetAvatar;
    getVoiceRoom: OperationGetVoiceRoom;
    admitVoice: OperationAdmitVoice;
    getICE: OperationGetICE;
    health: OperationHealth;
    readiness: OperationReadiness;
  };
}
export interface OperationListAppeals {
  parameters: {
    query?: {
      /**
       * Exclusive UUID cursor; up to 100 results.
       */
      after?: string;
    };
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiAppealsResponse;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiAppealsResponse {
  appeals: IdentityAppeal[] | null;
}
export interface IdentityAppeal {
  ban_id: string;
  body: string;
  created_at: string;
  id: string;
  reviewed_at: null | string;
}
export interface HttpapiErrorResponse {
  appeal_ticket?: string;
  ban_type?: string;
  error: string;
  request_id?: string;
}
export interface OperationReviewAppeal {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "204": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationInstallAudioPlugin {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/octet-stream": string;
    };
  };
  responses: {
    "201": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": AudiopluginPlugin;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface AudiopluginPlugin {
  bytes: number;
  digest: string;
  files: AudiopluginFile[] | null;
  manifest: AudiopluginManifest;
}
export interface AudiopluginFile {
  bytes: number;
  name: string;
  sha256: string;
}
export interface AudiopluginManifest {
  abi: AudiopluginABI;
  default_variant: string;
  description: string;
  diagnostics?: AudiopluginDiagnostic[];
  fields: AudiopluginField[] | null;
  id: string;
  legacy_preferences?: AudiopluginLegacyPreferences;
  name: string;
  variants: AudiopluginVariant[] | null;
  version: number;
}
export interface AudiopluginABI {
  create: string;
  frame_samples: number;
  initialize?: string;
  input: string;
  output: string;
  process: string;
  process_controls?: string[];
  reset?: string;
}
export interface AudiopluginDiagnostic {
  export: string;
  key: string;
  label: string;
  variants?: string[];
}
export interface AudiopluginField {
  default: number;
  export?: string;
  help?: string;
  key: string;
  label: string;
  max: number;
  min: number;
  scale: number;
  step: number;
  type: string;
  variants?: string[];
}
export interface AudiopluginLegacyPreferences {
  fields?: {
    [k: string]: string;
  } | null;
  variant_key?: string;
}
export interface AudiopluginVariant {
  description?: string;
  file: string;
  id: string;
  label: string;
}
export interface OperationSetDefaultAudioPlugin {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": AudiopluginPreferences;
    };
  };
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": AudiopluginPreferences;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface AudiopluginPreferences {
  id: string;
  values: {
    [k: string]: number;
  } | null;
  variant: string;
}
export interface OperationInstallAudioPluginRepository {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": AudiopluginRepositoryInstall;
    };
  };
  responses: {
    "201": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": AudiopluginPlugin;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface AudiopluginRepositoryInstall {
  commit: string;
  repository: string;
  sha256: string;
}
export interface OperationRemoveAudioPlugin {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "204": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationAuditLog {
  parameters: {
    query?: {
      /**
       * Exclusive audit ID cursor; newest 100 entries by default.
       */
      before?: number;
    };
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiAuditResponse;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiAuditResponse {
  entries: IdentityAuditEntry[] | null;
}
export interface IdentityAuditEntry {
  action: string;
  actor_id: null | string;
  created_at: string;
  id: number;
  ip: null | string;
  reason: string;
  target_id: string;
}
export interface OperationListBans {
  parameters: {
    query?: {
      /**
       * Exclusive UUID cursor; up to 100 results.
       */
      after?: string;
    };
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiBansResponse;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiBansResponse {
  bans: IdentityBan[] | null;
}
export interface IdentityBan {
  created_at: string;
  created_by: string;
  id: string;
  network: null | string;
  reason: string;
  revoked_at: null | string;
  user_id: null | string;
}
export interface OperationBanNetwork {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": HttpapiBanNetworkRequest;
    };
  };
  responses: {
    "201": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": IdentityBan;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiBanNetworkRequest {
  /**
   * IPv4 or IPv6 address or CIDR range; normalized by the service.
   */
  network: string;
  reason: string;
}
export interface OperationRevokeBan {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": HttpapiModerationReasonRequest;
    };
  };
  responses: {
    "204": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiModerationReasonRequest {
  reason: string;
}
export interface OperationMaintenance {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "204": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationDisableMember {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": HttpapiDisableMemberRequest;
    };
  };
  responses: {
    "204": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiDisableMemberRequest {
  disabled: boolean;
}
export interface OperationMemberIPs {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiMemberIPsResponse;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiMemberIPsResponse {
  ips: IdentityMemberIP[] | null;
}
export interface IdentityMemberIP {
  first_seen: string;
  ip: string;
  last_seen: string;
}
export interface OperationModerateMember {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": HttpapiModerateMemberRequest;
    };
  };
  responses: {
    "204": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiModerateMemberRequest {
  action: "kick" | "ban" | "restore" | "delete";
  reason: string;
}
export interface OperationResetMemberPassword {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": HttpapiResetPasswordRequest;
    };
  };
  responses: {
    "204": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiResetPasswordRequest {
  /**
   * At most 1024 UTF-8 bytes.
   */
  new_password: string;
}
export interface OperationIssueTemporaryPassword {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": HttpapiTemporaryPasswordRequest;
    };
  };
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": IdentityTemporaryPassword;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiTemporaryPasswordRequest {
  reason: string;
}
export interface IdentityTemporaryPassword {
  /**
   * Shown once. Share privately; the member must replace it before server access.
   */
  temporary_password: string;
}
export interface OperationGetServerExtension {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": ServerextensionConfiguration;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface ServerextensionConfiguration {
  category: "tts";
  configured: boolean;
  enabled: boolean;
  endpoint: string;
  id: string;
  name: string;
  revision: number;
}
export interface OperationSaveServerExtension {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": ServerextensionSaveRequest;
    };
  };
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": ServerextensionConfiguration;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface ServerextensionSaveRequest {
  clear_token?: boolean;
  enabled: boolean;
  endpoint: string;
  revision: number;
  /**
   * Write-only TikTok sessionid. Omit or leave blank to keep the saved token.
   */
  session_token?: string;
}
export interface OperationTestServerExtension {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": ServerextensionSpeechRequest;
    };
  };
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/octet-stream": string;
      };
    };
    "206": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/octet-stream": string;
      };
    };
    "416": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface ServerextensionSpeechRequest {
  text: string;
  voice: string;
}
export interface OperationGetStats {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiStatsResponse;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiStatsResponse {
  cloudflare_turn: {
    [k: string]: unknown;
  } | null;
  events: {
    [k: string]: unknown;
  } | null;
  media: {
    [k: string]: unknown;
  } | null;
  policy: ConfigPolicy;
  pool: {
    [k: string]: unknown;
  } | null;
  relay: {
    [k: string]: unknown;
  } | null;
  storage: {
    [k: string]: unknown;
  } | null;
  storage_lock: {
    [k: string]: unknown;
  } | null;
}
export interface ConfigPolicy {
  attachment_max_bytes: number;
  attachment_retention_days: number;
  dm?: ConfigDMPolicy;
  image_max_bytes: number;
  text_max_bytes: number;
  text_retention_days: number;
  video_max_bytes: number;
}
export interface ConfigDMPolicy {
  download_bytes_per_day: number;
  image_max_bytes: number;
  image_retention_days: number;
  images_enabled: boolean;
  storage_bytes: number;
  text_max_bytes: number;
  text_retention_days: number;
  upload_bytes_per_day: number;
  user_storage_bytes: number;
  version: number;
}
export interface OperationListStorage {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiStorageProvidersResponse;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiStorageProvidersResponse {
  default_active: boolean;
  default_attachments: number;
  default_bytes: number;
  providers: BlobstoreProvider[] | null;
}
export interface BlobstoreProvider {
  active: boolean;
  attachments: number;
  bytes: number;
  configuration: BlobstoreConfiguration;
  has_credentials: boolean;
  id: string;
  name: string;
}
export interface BlobstoreConfiguration {
  bucket?: string;
  /**
   * Empty uses AWS S3. Custom endpoints may use HTTP for trusted LAN services.
   */
  endpoint?: string;
  kind: "local" | "s3";
  path?: string;
  path_style: boolean;
  prefix?: string;
  region?: string;
}
export interface OperationRegisterStorage {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": BlobstoreRegisterRequest;
    };
  };
  responses: {
    "201": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": BlobstoreProvider;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface BlobstoreRegisterRequest {
  configuration: BlobstoreConfiguration;
  credentials?: BlobstoreCredentials;
  name: string;
}
export interface BlobstoreCredentials {
  access_key: string;
  secret_key: string;
  session_token?: string;
}
export interface OperationActivateStorage {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": HttpapiActivateStorageRequest;
    };
  };
  responses: {
    "204": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiActivateStorageRequest {
  /**
   * Provider UUID, or an empty string to use the built-in local storage.
   */
  provider_id: null | string;
}
export interface OperationRemoveStorage {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "204": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationCheckStorage {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "204": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationRotateStorageCredentials {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": BlobstoreCredentials;
    };
  };
  responses: {
    "204": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationDownloadAttachment {
  parameters: {
    query?: never;
    header?: {
      /**
       * Optional HTTP byte range, for example bytes=0-1023.
       */
      Range?: string;
    };
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/octet-stream": string;
      };
    };
    "206": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/octet-stream": string;
      };
    };
    "416": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationDeleteAttachment {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "204": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationHeadAttachment {
  parameters: {
    query?: never;
    header?: {
      /**
       * Optional HTTP byte range, for example bytes=0-1023.
       */
      Range?: string;
    };
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationGetAttachmentMetadata {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": AttachmentsAttachment;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface AttachmentsAttachment {
  bytes: number;
  content_type: string;
  conversation_id: string;
  encrypted: boolean;
  expires_at: null | string;
  filename: string;
  id: string;
  is_dm: boolean;
  user_id: string;
}
export interface OperationListAudioPlugins {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiAudioPluginsResponse;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiAudioPluginsResponse {
  default: AudiopluginPreferences;
  max_package_bytes: number;
  plugins: AudiopluginPlugin[] | null;
}
export interface OperationDownloadAudioPlugin {
  parameters: {
    query?: never;
    header?: never;
    path: {
      digest: string;
      name: string;
    };
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/octet-stream": string;
      };
    };
    "206": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/octet-stream": string;
      };
    };
    "416": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationAppealBan {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": HttpapiBanAppealRequest;
    };
  };
  responses: {
    "204": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiBanAppealRequest {
  appeal_ticket: string;
  /**
   * Plain text only, no URLs or attachments. One submission per ban per rolling 30 days.
   */
  body: string;
}
export interface OperationBanStatus {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": HttpapiBanTicketRequest;
    };
  };
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": IdentityBanStatus;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiBanTicketRequest {
  appeal_ticket: string;
}
export interface IdentityBanStatus {
  active: boolean;
  ban_type: string;
  next_appeal_at: null | string;
  reason: string;
}
export interface OperationLogin {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": HttpapiCredentialsRequest;
    };
  };
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": IdentityLogin;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiCredentialsRequest {
  device_name: string;
  /**
   * Required for registration; unused on login.
   */
  invitation?: string;
  /**
   * Registration requires at least 8 characters; at most 1024 UTF-8 bytes.
   */
  password: string;
  /**
   * Keep this device signed in until revocation, with no calendar expiry. Defaults to false.
   */
  remember?: boolean;
  username: string;
}
export interface IdentityLogin {
  instance_id: string;
  /**
   * Temporary password session: may only change the password or log out; expires after 15 minutes even when remember is true.
   */
  password_change_required?: boolean;
  session: IdentitySession;
  token: string;
  token_type: string;
  user: IdentityUser;
}
export interface IdentitySession {
  created_at: string;
  device_name: string;
  /**
   * Null for a remembered device; otherwise the session's expiry in UTC. All sessions can be revoked.
   */
  expires_at: null | string;
  id: string;
}
export interface IdentityUser {
  accent_color?: string;
  avatar_version?: string;
  bio?: string;
  created_at: string;
  display_name?: string;
  display_role?: IdentityDisplayRole;
  id: string;
  is_owner: boolean;
  username: string;
}
/**
 * Highest-ranked role enabled for member-list sections; display metadata only. Absent when no role is enabled.
 */
export interface IdentityDisplayRole {
  id: string;
  name: string;
  position: number;
}
export interface OperationLogout {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "204": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationRegister {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": HttpapiCredentialsRequest & {
        invitation: string;
        password?: string;
      };
    };
  };
  responses: {
    "201": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": IdentityLogin;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationListCategories {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiCategoriesResponse;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiCategoriesResponse {
  categories: IdentityCategory[] | null;
}
export interface IdentityCategory {
  id: string;
  name: string;
}
export interface OperationCreateCategory {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": HttpapiSaveCategoryRequest;
    };
  };
  responses: {
    "201": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": IdentityCategory;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiSaveCategoryRequest {
  name: string;
}
export interface OperationUpdateCategory {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": HttpapiSaveCategoryRequest;
    };
  };
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": IdentityCategory;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationDeleteCategory {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "204": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationGetCategoryPermissions {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiOverridesResponse;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiOverridesResponse {
  overrides: IdentityOverride[] | null;
}
export interface IdentityOverride {
  allow: number;
  deny: number;
  role_id: string;
}
export interface OperationSetCategoryPermissions {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
      role: string;
    };
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": HttpapiSetPermissionsRequest;
    };
  };
  responses: {
    "204": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiSetPermissionsRequest {
  allow: number;
  deny: number;
}
export interface OperationListChannels {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiChannelsResponse;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiChannelsResponse {
  channels: IdentityChannel[] | null;
}
export interface IdentityChannel {
  category_id: null | string;
  icon?: string;
  id: string;
  kind: string;
  name: string;
  permissions?: number;
  topic?: string;
}
export interface OperationCreateChannel {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": HttpapiSaveChannelRequest;
    };
  };
  responses: {
    "201": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": IdentityChannel;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiSaveChannelRequest {
  category_id?: null | string;
  /**
   * Built-in SVG icon key; empty restores the default for the channel kind. Omission preserves the current icon.
   */
  icon?:
    | null
    | (
        | ""
        | "hash"
        | "headphones"
        | "message-circle"
        | "megaphone"
        | "volume-2"
        | "mic"
        | "music"
        | "radio"
        | "gamepad-2"
        | "monitor"
        | "video"
        | "camera"
        | "image"
        | "film"
        | "code"
        | "terminal"
        | "book-open"
        | "graduation-cap"
        | "coffee"
        | "users"
        | "calendar"
        | "star"
        | "heart"
        | "shield"
        | "wrench"
      );
  kind: "text" | "voice";
  name: string;
  topic?: null | string;
}
export interface OperationGetChannel {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": IdentityChannel;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationUpdateChannel {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": HttpapiSaveChannelRequest;
    };
  };
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": IdentityChannel;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationDeleteChannel {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "204": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationGetChannelMenu {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiMenuManifest;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiMenuManifest {
  pages: HttpapiMenuPage[] | null;
  version: number;
}
export interface HttpapiMenuPage {
  action?: HttpapiMenuCommand;
  builtin?: string;
  context_label?: string;
  form?: HttpapiMenuForm;
  id: string;
  label: string;
}
export interface HttpapiMenuCommand {
  confirmation: string;
  confirmation_label?: string;
  confirmation_value?: string;
  dangerous?: boolean;
  method: "POST" | "PUT" | "DELETE";
  path: string;
  submit_label?: string;
  success_message?: string;
}
export interface HttpapiMenuForm {
  carry_fields?: string[];
  description?: string;
  fields: HttpapiMenuField[] | null;
  load_path: string;
  method: "PUT" | "POST";
  save_path: string;
  submit_label: string;
  success_message?: string;
}
export interface HttpapiMenuField {
  help?: string;
  label: string;
  max?: null | number;
  max_length?: number;
  min?: null | number;
  options?: HttpapiMenuOption[];
  path: string;
  required?: boolean;
  scale?: number;
  step?: null | number;
  type: "text" | "textarea" | "password" | "number" | "toggle" | "select";
}
export interface HttpapiMenuOption {
  label: string;
  value: string;
}
export interface OperationGetChannelPermissions {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiOverridesResponse;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationSetChannelPermissions {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
      role: string;
    };
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": HttpapiSetPermissionsRequest;
    };
  };
  responses: {
    "204": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationClientUpdateManifest {
  parameters: {
    query: {
      /**
       * Installed desktop version.
       */
      version: string;
      /**
       * win32-x64, linux-x64, linux-arm64 or darwin-arm64.
       */
      target: string;
    };
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiClientUpdateEnvelope;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiClientUpdateEnvelope {
  payload: string;
  schema: number;
  signature: string;
}
export interface OperationClientInstallers {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiClientInstallers;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiClientInstallers {
  available: string[] | null;
  manifest: HttpapiClientUpdateEnvelope;
}
export interface OperationClientUpdateFile {
  parameters: {
    query?: never;
    header?: never;
    path: {
      version: string;
      name: string;
    };
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/octet-stream": string;
      };
    };
    "206": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/octet-stream": string;
      };
    };
    "416": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationListConversations {
  parameters: {
    query?: {
      /**
       * Exclusive UUID cursor; up to 100 results.
       */
      after?: string;
    };
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiConversationsResponse;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiConversationsResponse {
  conversations: ChatConversation[] | null;
}
export interface ChatConversation {
  id: string;
  kind: string;
  members?: string[];
}
export interface OperationUploadAttachment {
  parameters: {
    query: {
      /**
       * Set to 1 for an encrypted DM image; required for DM uploads.
       */
      encrypted?: string;
      /**
       * Exact byte count; enforce the installation's advertised limits.
       */
      size: number;
      filename: string;
    };
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/octet-stream": string;
    };
  };
  responses: {
    "201": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": AttachmentsAttachment;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationDmEncryptionBundle {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": ChatDMCryptoBundle;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface ChatDMCryptoBundle {
  devices: ChatDMDevice[] | null;
  members: string[] | null;
  packages: ChatDMKeyPackage[] | null;
  revision: number;
}
export interface ChatDMDevice {
  credential: string;
  id: string;
  public_key: string;
  revoked: boolean;
  user_id: string;
}
export interface ChatDMKeyPackage {
  data: string;
  device_id: string;
  id: string;
}
export interface OperationDmEncryptionEvents {
  parameters: {
    query?: {
      after?: number;
    };
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": ChatDMCryptoEvents;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface ChatDMCryptoEvents {
  events: ChatDMCryptoEvent[] | null;
}
export interface ChatDMCryptoEvent {
  actor: string;
  commit: string;
  devices: string[] | null;
  request_id: string;
  revision: number;
  welcome?: string;
}
export interface OperationCommitDMEncryption {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": ChatDMCryptoCommit;
    };
  };
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": ChatDMCryptoEvent;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface ChatDMCryptoCommit {
  actor: string;
  commit: string;
  devices: string[] | null;
  expected_revision: number;
  packages: string[] | null;
  request_id: string;
  welcome?: string;
}
export interface OperationGetHistory {
  parameters: {
    query?: {
      /**
       * Exclusive conversation sequence; zero starts at the oldest retained message. Pages are ascending by sequence.
       */
      after?: number;
      limit?: number;
    };
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": ChatHistory;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface ChatHistory {
  event_cursor: number;
  gap: boolean;
  last_seq: number;
  messages: ChatMessage[] | null;
  pruned_through: number;
}
export interface ChatMessage {
  attachment_ids: string[] | null;
  author_id: string;
  body: string;
  conversation_id: string;
  created_at: string;
  deleted: boolean;
  edited_at?: null | string;
  id: string;
  mention_user_ids?: string[];
  reply_to_id?: null | string;
  request_id: string;
  seq: number;
}
export interface OperationCreateMessage {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": HttpapiCreateMessageRequest;
    };
  };
  responses: {
    "201": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": ChatMessage;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiCreateMessageRequest {
  /**
   * @maxItems 8
   */
  attachment_ids?: string[] | null;
  /**
   * Nonblank body or at least one attachment. UTF-8 bytes are bounded by installation policy (at most 64 KiB).
   */
  body?: string;
  /**
   * Message in the same conversation to reference as a reply.
   */
  reply_to_id?: string;
  request_id: string;
}
export interface OperationEditMessage {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
      message: string;
    };
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": HttpapiEditMessageRequest;
    };
  };
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": ChatMessage;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiEditMessageRequest {
  body?: string;
}
export interface OperationDeleteMessage {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
      message: string;
    };
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": ChatMessage;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationGetMessageEmbeds {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
      message: string;
    };
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiEmbedsResponse;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiEmbedsResponse {
  embeds: EmbedsPreview[] | null;
}
export interface EmbedsPreview {
  author_name?: string;
  description?: string;
  image: boolean;
  image_alt?: string;
  index: number;
  kind: string;
  published_at?: string;
  site_name?: string;
  theme_color?: string;
  title?: string;
  url: string;
  youtube_id?: string;
}
export interface OperationGetEmbedImage {
  parameters: {
    query: {
      index: number;
    };
    header?: never;
    path: {
      id: string;
      message: string;
    };
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/octet-stream": string;
      };
    };
    "206": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/octet-stream": string;
      };
    };
    "416": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationMarkConversationRead {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": HttpapiMarkReadRequest;
    };
  };
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": ChatReadState;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiMarkReadRequest {
  seq?: number;
}
export interface ChatReadState {
  conversation_id: string;
  event_cursor: number;
  kind: string;
  last_seq: number;
  mention_count: number;
  read_seq: number;
  unread_count: number;
}
export interface OperationCreateDM {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": HttpapiCreateDMRequest;
    };
  };
  responses: {
    "201": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": ChatConversation;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiCreateDMRequest {
  /**
   * Other participant UUIDs; the current user is added automatically.
   *
   * @minItems 1
   * @maxItems 15
   */
  members: [string, ...string[]] | null;
}
export interface OperationListEmojis {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiEmojisResponse;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiEmojisResponse {
  emojis: IdentityEmoji[] | null;
}
export interface IdentityEmoji {
  animated: boolean;
  id: string;
  name: string;
  version: string;
}
export interface OperationDeleteEmoji {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "204": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationGetEmojiImage {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/octet-stream": string;
      };
    };
    "206": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/octet-stream": string;
      };
    };
    "416": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationSaveEmoji {
  parameters: {
    query?: never;
    header?: never;
    path: {
      name: string;
    };
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/octet-stream": string;
    };
  };
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": IdentityEmoji;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationEvents {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "101": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationInstance {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiInstanceResponse;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiInstanceResponse {
  accent_color?: string;
  api_version: string;
  authentication: HttpapiAuthenticationInfo;
  banner_version?: string;
  capabilities: string[] | null;
  client_updates?: HttpapiClientUpdateSource;
  description?: string;
  icon_version?: string;
  instance_id: string;
  limits: ConfigPolicy;
  media_transport: string;
  name: string;
  public_url: string;
}
export interface HttpapiAuthenticationInfo {
  registration: string;
  scheme: string;
  session_days: number;
}
export interface HttpapiClientUpdateSource {
  authenticated?: boolean;
  installers?: boolean;
  manifest_url?: string;
}
export interface OperationGetBanner {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/octet-stream": string;
      };
    };
    "206": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/octet-stream": string;
      };
    };
    "416": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationUploadBanner {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/octet-stream": string;
    };
  };
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiArtResponse;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiArtResponse {
  version: string;
}
export interface OperationDeleteBanner {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "204": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationGetConfiguration {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiConfigurationResponse;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiConfigurationResponse {
  attachment_reserved_bytes: number;
  revision: number;
  settings: ConfigRuntimeSettings;
}
export interface ConfigRuntimeSettings {
  limits: ConfigPolicy;
  media_max_peers: number;
  media_room_limit: number;
  registration_enabled: boolean;
  session_days: number;
}
export interface OperationSaveConfiguration {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": HttpapiSaveConfigurationRequest;
    };
  };
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": IdentityRuntimeConfiguration;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiSaveConfigurationRequest {
  revision: null | number;
  settings: ConfigRuntimeSettings;
}
export interface IdentityRuntimeConfiguration {
  revision: number;
  settings: ConfigRuntimeSettings;
}
export interface OperationGetIcon {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/octet-stream": string;
      };
    };
    "206": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/octet-stream": string;
      };
    };
    "416": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationUploadIcon {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/octet-stream": string;
    };
  };
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiArtResponse;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationDeleteIcon {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "204": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationUpdateInstance {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": HttpapiSaveCommunityRequest;
    };
  };
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": IdentityCommunitySettings;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiSaveCommunityRequest {
  accent_color: string;
  description?: string;
  name: string;
}
export interface IdentityCommunitySettings {
  accent_color: string;
  banner_version?: string;
  description: string;
  icon_version?: string;
  name: string;
}
export interface OperationListInvites {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiInvitesResponse;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiInvitesResponse {
  invites: IdentityInvite[] | null;
}
export interface IdentityInvite {
  created_at: string;
  created_by: string;
  expires_at: string;
  id: string;
  remaining_uses: number;
  token?: string;
}
export interface OperationCreateInvite {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": HttpapiCreateInviteRequest;
    };
  };
  responses: {
    "201": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": IdentityInvite;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiCreateInviteRequest {
  expires_in_hours: number;
  uses: number;
}
export interface OperationRevokeInvite {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "204": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationMe {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": IdentityPrincipal;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface IdentityPrincipal {
  permissions: number;
  role_position: number;
  session_id: string;
  user: IdentityUser;
}
export interface OperationUploadAvatar {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/octet-stream": string;
    };
  };
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiArtResponse;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationDeleteAvatar {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "204": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationRegisterDMDevice {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": ChatRegisterDMDevice;
    };
  };
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": ChatDMDevice;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface ChatRegisterDMDevice {
  id: string;
  public_key: string;
  signature: string;
}
export interface OperationOwnDMKeyPackages {
  parameters: {
    query?: never;
    header?: never;
    path: {
      device: string;
    };
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": ChatDMKeyPackages;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface ChatDMKeyPackages {
  packages: ChatDMKeyPackage[] | null;
}
export interface OperationPublishDMKeyPackages {
  parameters: {
    query?: never;
    header?: never;
    path: {
      device: string;
    };
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": ChatDMKeyPackages;
    };
  };
  responses: {
    "204": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationDmStorage {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": AttachmentsDMUsage;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface AttachmentsDMUsage {
  downloaded_today: number;
  limit_bytes: number;
  policy: ConfigDMPolicy;
  uploaded_today: number;
  uploads: number;
  used_bytes: number;
}
export interface OperationPurgeDMUploads {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": HttpapiDMPurgeRequest;
    };
  };
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": AttachmentsDMPurge;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiDMPurgeRequest {
  before: string;
  confirm?: boolean;
}
export interface AttachmentsDMPurge {
  before: string;
  bytes: number;
  files: number;
}
export interface OperationChangePassword {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": HttpapiChangePasswordRequest;
    };
  };
  responses: {
    "204": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiChangePasswordRequest {
  current_password: string;
  /**
   * At most 1024 UTF-8 bytes.
   */
  new_password: string;
}
export interface OperationUpdateProfile {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": IdentityProfileSettingsRequest;
    };
  };
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": IdentityUser;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface IdentityProfileSettingsRequest {
  accent_color: string;
  bio?: string;
  display_name?: string;
}
export interface OperationRememberSession {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": HttpapiRememberSessionRequest;
    };
  };
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": IdentitySession;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiRememberSessionRequest {
  remember: boolean;
}
export interface OperationMedia {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "101": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationListMembers {
  parameters: {
    query?: {
      /**
       * Exclusive UUID cursor; up to 100 results.
       */
      after?: string;
    };
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiMembersResponse;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiMembersResponse {
  members: IdentityMember[] | null;
}
export interface IdentityMember {
  accent_color?: string;
  avatar_version?: string;
  banned: boolean;
  bio?: string;
  created_at: string;
  deleted: boolean;
  disabled: boolean;
  display_name?: string;
  display_role?: IdentityDisplayRole1;
  id: string;
  is_owner: boolean;
  kicked: boolean;
  role_ids: string[] | null;
  role_position: number;
  username: string;
}
/**
 * Highest-ranked role enabled for member-list sections; display metadata only. Absent when no role is enabled.
 */
export interface IdentityDisplayRole1 {
  id: string;
  name: string;
  position: number;
}
export interface OperationAssignRoles {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": HttpapiAssignRolesRequest;
    };
  };
  responses: {
    "204": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiAssignRolesRequest {
  /**
   * Complete replacement; an empty array removes assigned nondefault roles.
   */
  role_ids: string[];
}
export interface OperationGetServerMenu {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiMenuManifest;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationListReadState {
  parameters: {
    query?: {
      /**
       * Exclusive UUID cursor; up to 100 results.
       */
      after?: string;
    };
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": ChatReadPage;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface ChatReadPage {
  next?: string;
  states: ChatReadState[] | null;
}
export interface OperationListRoles {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiRolesResponse;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiRolesResponse {
  roles: IdentityRole[] | null;
}
export interface IdentityRole {
  /**
   * Show online members in a separate member-list section. Disabled by default.
   */
  display_separately: boolean;
  id: string;
  is_default: boolean;
  name: string;
  permissions: number;
  position: number;
}
export interface OperationCreateRole {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": HttpapiSaveRoleRequest;
    };
  };
  responses: {
    "201": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": IdentityRole;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiSaveRoleRequest {
  /**
   * Show online members separately in the member list. Defaults to false for new roles; omission preserves existing settings.
   */
  display_separately?: null | boolean;
  name: string;
  permissions: number;
  /**
   * Role rank; default role is zero. Delegates can only manage lower-ranked roles and members.
   */
  position?: null | number;
}
export interface OperationUpdateRole {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": HttpapiSaveRoleRequest;
    };
  };
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": IdentityRole;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationDeleteRole {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "204": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationListServerExtensions {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiServerExtensionsResponse;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiServerExtensionsResponse {
  extensions: ServerextensionExtension[] | null;
}
export interface ServerextensionExtension {
  category: "tts";
  configured: boolean;
  enabled: boolean;
  id: string;
  name: string;
}
export interface OperationServerExtensionSpeech {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": HttpapiExtensionSpeechRequest;
    };
  };
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/octet-stream": string;
      };
    };
    "206": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/octet-stream": string;
      };
    };
    "416": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiExtensionSpeechRequest {
  room_id?: string;
  text: string;
  voice: string;
}
export interface OperationListSessions {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiSessionsResponse;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiSessionsResponse {
  sessions: IdentitySession[] | null;
}
export interface OperationRestoreSession {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody: {
    content: {
      "application/json": HttpapiRestoreSessionRequest;
    };
  };
  responses: {
    "201": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": IdentityLogin;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiRestoreSessionRequest {
  device_name: string;
}
export interface OperationRevokeSession {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "204": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationListUsers {
  parameters: {
    query?: {
      /**
       * Exclusive UUID cursor; up to 100 results.
       */
      after?: string;
    };
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiUsersResponse;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiUsersResponse {
  users: IdentityUser[] | null;
}
export interface OperationGetUser {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": IdentityUser;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationGetAvatar {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/octet-stream": string;
      };
    };
    "206": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/octet-stream": string;
      };
    };
    "416": {
      headers: {
        [k: string]: unknown;
      };
      content?: never;
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface OperationGetVoiceRoom {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiParticipantsResponse;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiParticipantsResponse {
  participants: VoiceSnapshot[] | null;
}
export interface VoiceSnapshot {
  encoded_tracks?: VoiceEncodedTrack[];
  joined_at: string;
  participant_id: string;
  state: VoiceState;
  tracks: VoiceTrack[] | null;
  user_id: string;
}
export interface VoiceEncodedTrack {
  channels?: number;
  codec?: string;
  description?: string;
  height?: number;
  purpose?: string;
  revision?: number;
  sample_rate?: number;
  width?: number;
}
export interface VoiceState {
  camera_off: boolean;
  deafened: boolean;
  muted: boolean;
  screen_off: boolean;
}
export interface VoiceTrack {
  codec: V4RTPCodecCapability;
  purpose: string;
  track_id: string;
}
export interface V4RTPCodecCapability {
  Channels: number;
  ClockRate: number;
  MimeType: string;
  RTCPFeedback:
    | {
        Parameter?: string;
        Type?: string;
      }[]
    | null;
  SDPFmtpLine: string;
}
export interface OperationAdmitVoice {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "201": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": VoiceAdmission;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface VoiceAdmission {
  admission_id: string;
  expires_at: string;
  ice_expires_at?: null | string;
  ice_servers: ConfigICEServer[] | null;
  ice_transport_policy?: string;
  media_path?: string;
  room_id: string;
  transport: string;
}
export interface ConfigICEServer {
  credential?: string;
  urls: string[] | null;
  username?: string;
}
export interface OperationGetICE {
  parameters: {
    query?: never;
    header?: never;
    path: {
      id: string;
    };
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiIceResponse;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiIceResponse {
  expires_at: null | string;
  ice_servers: ConfigICEServer[] | null;
  ice_transport_policy: string;
}
export interface OperationHealth {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiStatusResponse;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiStatusResponse {
  check?: string;
  status: string;
}
export interface OperationReadiness {
  parameters: {
    query?: never;
    header?: never;
    path?: never;
    cookie?: never;
  };
  requestBody?: never;
  responses: {
    "200": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiStatusResponse;
      };
    };
    "503": {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiUnavailableResponse;
      };
    };
    default: {
      headers: {
        [k: string]: unknown;
      };
      content: {
        "application/json": HttpapiErrorResponse;
      };
    };
  };
}
export interface HttpapiUnavailableResponse {
  dependency: string;
  status: string;
}
export interface ChatEvent {
  conversation_id: string;
  data: unknown;
  id: number;
  type: string;
}
export interface HttpapiEventCommand {
  admission_id?: string;
  after_event?: null | number;
  candidate?: V4ICECandidateInit;
  conversations?: string[];
  enabled?: null | boolean;
  peer_id?: string;
  publisher_id?: string;
  sdp?: V4SessionDescription;
  state?: VoiceState;
  token?: string;
  tracks?: {
    [k: string]: string;
  };
  type?: string;
}
export interface V4ICECandidateInit {
  candidate?: string;
  sdpMLineIndex?: null | number;
  sdpMid?: null | string;
  usernameFragment?: null | string;
}
export interface V4SessionDescription {
  sdp?: string;
  type?: V4SDPType;
}
export interface HttpapiMediaAuthenticateCommand {
  participant_id: string;
  token: string;
  type: "authenticate";
}
export interface HttpapiMediaCommand {
  publisher_id?: string;
  purpose?: string;
  tracks?: VoiceEncodedTrack[];
  type: "configure" | "keyframe";
}
export interface IdentityDisplayRole2 {
  id: string;
  name: string;
  position: number;
}
export interface VoicePresenceMember {
  joined_at: string;
  participant_id: string;
  state: VoiceState;
  user_id: string;
}

type HTTPMethod = "get" | "put" | "post" | "delete" | "options" | "head" | "patch" | "trace";
type HTTPOperation<T> = T extends { responses: infer R }
  ? Omit<T, "responses"> & { responses: { [K in keyof R as K extends `${infer Status extends number}` ? Status : K]: R[K] } }
  : T;
type GeneratedComponents = APIContract["components"];
export interface components extends GeneratedComponents { responses: never; parameters: never; requestBodies: never; headers: never; pathItems: never }
export type webhooks = Record<string, never>;
export type $defs = Record<string, never>;
type GeneratedOperations = { [ID in keyof APIContract["operations"]]: HTTPOperation<APIContract["operations"][ID]> };
export interface operations extends GeneratedOperations {}
type GeneratedPaths = { [Path in keyof APIContract["paths"]]: { [Method in keyof APIContract["paths"][Path]]: Method extends HTTPMethod ? HTTPOperation<APIContract["paths"][Path][Method]> : APIContract["paths"][Path][Method] } };
export interface paths extends GeneratedPaths {}
