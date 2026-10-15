export interface paths {
    "/api/v1/admin/appeals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List ban appeals (BanMembers) */
        get: operations["listAppeals"];
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
        /** Mark an appeal reviewed without lifting its ban */
        post: operations["reviewAppeal"];
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
        /** Install a ZIP of Wasm modules and a declarative manifest, at most 50 MiB packed and unpacked (ManageConfiguration) */
        post: operations["installAudioPlugin"];
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
        /** Save default plugin, model and controls for new clients (ManageConfiguration) */
        put: operations["setDefaultAudioPlugin"];
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
        /** Install dist/haunt-plugin.zip from an HTTPS GitHub repository at a full commit ID, requiring its SHA-256 (ManageConfiguration) */
        post: operations["installAudioPluginRepository"];
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
        /** Remove an audio plugin (ManageConfiguration) */
        delete: operations["removeAudioPlugin"];
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
        /** List recent moderation and sampled access events (ViewAuditLog) */
        get: operations["auditLog"];
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
        /** List active bans (BanMembers) */
        get: operations["listBans"];
        put?: never;
        /** Ban an IP address or CIDR range (BanMembers and ViewMemberIPs) */
        post: operations["banNetwork"];
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
        /** Lift a ban with an audit reason */
        post: operations["revokeBan"];
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
        /** Run bounded maintenance (requires the corresponding server permission) */
        post: operations["maintenance"];
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
        /** Disable or enable a member (owner) */
        put: operations["disableMember"];
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
        /** Read private member IP history (ViewMemberIPs) */
        get: operations["memberIPs"];
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
        /** Kick, ban, restore or delete a lower-ranked member */
        post: operations["moderateMember"];
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
        /** Set a temporary member password, require replacement, and revoke sessions */
        put: operations["resetMemberPassword"];
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
        /** Issue a temporary password and revoke sessions (Reset passwords permission; lower-ranked members only) */
        post: operations["issueTemporaryPassword"];
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
        /** Inspect storage, pool, queue and media metrics (requires the corresponding server permission) */
        get: operations["getStats"];
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
        /** List attachment storage providers; credentials are never returned (ManageConfiguration) */
        get: operations["listStorage"];
        put?: never;
        /** Verify write/read/delete access and register private attachment storage (ManageConfiguration) */
        post: operations["registerStorage"];
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
        /** Select the provider for new uploads; existing files retain their provider (ManageConfiguration) */
        put: operations["activateStorage"];
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
        /** Remove an inactive provider with no retained files (ManageConfiguration) */
        delete: operations["removeStorage"];
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
        /** Verify provider write/read/delete access (ManageConfiguration) */
        post: operations["checkStorage"];
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
        /** Verify and replace S3 credentials (ManageConfiguration) */
        put: operations["rotateStorageCredentials"];
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
        /** Download an authorized attachment; supports Range and HEAD */
        get: operations["downloadAttachment"];
        put?: never;
        post?: never;
        /** Delete an owned attachment */
        delete: operations["deleteAttachment"];
        options?: never;
        /** Read authorized attachment headers */
        head: operations["headAttachment"];
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
        /** Get filename, size and detected content type for an authorized attachment */
        get: operations["getAttachmentMetadata"];
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
        /** List local audio plugins and integrity hashes */
        get: operations["listAudioPlugins"];
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
        /** Download an authenticated Wasm asset */
        get: operations["downloadAudioPlugin"];
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
        /** Submit one plain-text appeal per ban per rolling 30 days */
        post: operations["appealBan"];
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
        /** Read a ban using its opaque appeal ticket */
        post: operations["banStatus"];
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
        /** Create a device session */
        post: operations["login"];
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
        /** Revoke the current device session */
        post: operations["logout"];
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
        /** Register using an invitation */
        post: operations["register"];
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
        /** List visible categories */
        get: operations["listCategories"];
        put?: never;
        /** Create a category */
        post: operations["createCategory"];
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
        /** Update a category */
        put: operations["updateCategory"];
        post?: never;
        /** Delete a Category */
        delete: operations["deleteCategory"];
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
        /** Get permission overrides */
        get: operations["getCategoryPermissions"];
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
        /** Set a role's permission override */
        put: operations["setCategoryPermissions"];
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
        /** List visible channels */
        get: operations["listChannels"];
        put?: never;
        /** Create a text or voice channel */
        post: operations["createChannel"];
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
        /** Get a channel and effective permissions */
        get: operations["getChannel"];
        /** Update a channel */
        put: operations["updateChannel"];
        post?: never;
        /** Delete a Channel */
        delete: operations["deleteChannel"];
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
        /** Permission-filtered declarative channel settings and context menu */
        get: operations["getChannelMenu"];
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
        /** Get permission overrides */
        get: operations["getChannelPermissions"];
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
        /** Set a role's permission override */
        put: operations["setChannelPermissions"];
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
        /** Get the signed desktop update manifest (local distribution enabled) */
        get: operations["clientUpdateManifest"];
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
        /** List locally available desktop installers when enabled */
        get: operations["clientInstallers"];
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
        /** Download an authenticated desktop release artifact */
        get: operations["clientUpdateFile"];
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
        /** List accessible text/voice channel chats and DMs */
        get: operations["listConversations"];
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
        /** Upload raw image or video bytes */
        post: operations["uploadAttachment"];
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
        /** Get participant device credentials and unused key packages */
        get: operations["dmEncryptionBundle"];
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
        /** Read ordered MLS group commits and welcome messages */
        get: operations["dmEncryptionEvents"];
        put?: never;
        /** Compare-and-swap an MLS group revision and consume single-use key packages */
        post: operations["commitDMEncryption"];
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
        /** Read message history and recovery cursors */
        get: operations["getHistory"];
        put?: never;
        /** Commit a message with retry deduplication */
        post: operations["createMessage"];
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
        /** Edit an authored message */
        put: operations["editMessage"];
        post?: never;
        /** Tombstone an authored message */
        delete: operations["deleteMessage"];
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
        /** Fetch up to three cached public link previews for a visible retained message */
        get: operations["getMessageEmbeds"];
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
        /** Download a bounded preview image after rechecking message access */
        get: operations["getEmbedImage"];
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
        /** Advance this account's read position monotonically to the highest displayed message sequence */
        put: operations["markConversationRead"];
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
        /** Get or create a DM for a participant set */
        post: operations["createDM"];
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
        /** List this server's custom emoji catalog */
        get: operations["listEmojis"];
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
        /** Delete a custom emoji (ManageServer) */
        delete: operations["deleteEmoji"];
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
        /** Download an authenticated emoji PNG or GIF */
        get: operations["getEmojiImage"];
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
        /**
         * Create or replace a custom emoji (ManageServer)
         * @description Raw PNG/JPEG/GIF, at most 1 MiB and 256×256. Names use 2–32 lowercase letters, digits or underscores. Maximum 100 emojis per server. Replacing a name preserves its ID; metadata changes arrive through directory.changed. Use :name: in channel or DM message bodies; unknown/deleted names remain literal text.
         */
        put: operations["saveEmoji"];
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
        /**
         * Upgrade to authenticated events and signaling WebSocket
         * @description HTTP upgrade only. Authenticate in the first WebSocket text frame within five seconds; never put the token in the URL. Message schemas and binary framing are described in /websocket.json and docs/media-transports.md. Swagger Try it out does not open a WebSocket.
         */
        get: operations["events"];
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
        /** Discover installation capabilities and limits */
        get: operations["instance"];
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
        /** Download banner PNG or GIF */
        get: operations["get_banner"];
        /**
         * Upload PNG/JPEG/GIF banner; icons/banners require ManageServer
         * @description Avatars/icons: at most 2 MiB and 1024×1024. Banners: at most 4 MiB and 2048×1024. PNG/JPEG content is decoded and saved as PNG. GIFs preserve animation and may be up to 20 MiB, with the same dimensions, at most 1000 frames and 256 million decoded pixels. Art persists until replaced or removed.
         */
        put: operations["upload_banner"];
        post?: never;
        /** Remove banner; icons/banners require ManageServer */
        delete: operations["delete_banner"];
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
        /** Read live server configuration (ManageConfiguration) */
        get: operations["getConfiguration"];
        /** Persist and apply live server policies; revision prevents lost edits (ManageConfiguration) */
        put: operations["saveConfiguration"];
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
        /** Download icon PNG or GIF */
        get: operations["get_icon"];
        /**
         * Upload PNG/JPEG/GIF icon; icons/banners require ManageServer
         * @description Avatars/icons: at most 2 MiB and 1024×1024. Banners: at most 4 MiB and 2048×1024. PNG/JPEG content is decoded and saved as PNG. GIFs preserve animation and may be up to 20 MiB, with the same dimensions, at most 1000 frames and 256 million decoded pixels. Art persists until replaced or removed.
         */
        put: operations["upload_icon"];
        post?: never;
        /** Remove icon; icons/banners require ManageServer */
        delete: operations["delete_icon"];
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
        /** Update server name, description and accent color (ManageServer) */
        put: operations["updateInstance"];
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
        /** List visible invitations */
        get: operations["listInvites"];
        put?: never;
        /** Create an invitation */
        post: operations["createInvite"];
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
        /** Revoke an invitation */
        delete: operations["revokeInvite"];
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
        /** Get the current principal */
        get: operations["me"];
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
        /**
         * Upload PNG/JPEG/GIF avatar; icons/banners require ManageServer
         * @description Avatars/icons: at most 2 MiB and 1024×1024. Banners: at most 4 MiB and 2048×1024. PNG/JPEG content is decoded and saved as PNG. GIFs preserve animation and may be up to 20 MiB, with the same dimensions, at most 1000 frames and 256 million decoded pixels. Art persists until replaced or removed.
         */
        put: operations["upload_avatar"];
        post?: never;
        /** Remove avatar; icons/banners require ManageServer */
        delete: operations["delete_avatar"];
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
        /** Register an immutable MLS device credential */
        post: operations["registerDMDevice"];
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
        /** List your device’s unused public MLS key packages */
        get: operations["ownDMKeyPackages"];
        /** Publish single-use MLS key packages */
        put: operations["publishDMKeyPackages"];
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
        /** Get your DM storage and daily transfer usage */
        get: operations["dmStorage"];
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
        /** Preview or purge your older DM uploads; confirmed requests remove up to 128 files */
        post: operations["purgeDMUploads"];
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
        /** Change password and revoke existing sessions */
        put: operations["changePassword"];
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
        /** Update your display name, bio and avatar color */
        put: operations["updateProfile"];
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
        /** Remember or stop remembering the current device session */
        put: operations["rememberSession"];
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
        /**
         * Upgrade to encoded media WebSocket when configured
         * @description HTTP upgrade only. Authenticate in the first WebSocket text frame within five seconds; never put the token in the URL. Message schemas and binary framing are described in /websocket.json and docs/media-transports.md. Swagger Try it out does not open a WebSocket.
         */
        get: operations["media"];
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
        /** List members and roles (any member-management permission) */
        get: operations["listMembers"];
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
        /** Replace a member's roles (ManageRoles; lower rank only) */
        put: operations["assignRoles"];
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
        /** Permission-filtered declarative server settings and context menu */
        get: operations["getServerMenu"];
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
        /** List persistent unread and mention counts for accessible conversations */
        get: operations["listReadState"];
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
        /** List community roles */
        get: operations["listRoles"];
        put?: never;
        /** Create a role (ManageRoles; lower rank only) */
        post: operations["createRole"];
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
        /** Update a role (ManageRoles; lower rank only) */
        put: operations["updateRole"];
        post?: never;
        /** Delete a nondefault role (ManageRoles; lower rank only) */
        delete: operations["deleteRole"];
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
        /** List this account's device sessions */
        get: operations["listSessions"];
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
        /** Create an independent device session from a valid backup session without revoking it or extending its expiry */
        post: operations["restoreSession"];
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
        /** Revoke this account's device session */
        delete: operations["revokeSession"];
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
        /** List public user profiles */
        get: operations["listUsers"];
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
        /** Get one public user profile */
        get: operations["getUser"];
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
        /** Download avatar PNG or GIF */
        get: operations["get_avatar"];
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
        /** List current room participants and tracks */
        get: operations["getVoiceRoom"];
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
        /** Get a single-use room admission and automatic transport */
        post: operations["admitVoice"];
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
        /** Refresh authorized ICE credentials */
        get: operations["getICE"];
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
        /** Check process liveness */
        get: operations["health"];
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
        /** Check database and identity schema readiness */
        get: operations["readiness"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        AttachmentsAttachment: {
            /** Format: int64 */
            bytes: number;
            content_type: string;
            conversation_id: string;
            encrypted: boolean;
            /** Format: date-time */
            expires_at: null | string;
            filename: string;
            id: string;
            is_dm: boolean;
            user_id: string;
        };
        AttachmentsDMPurge: {
            /** Format: date-time */
            before: string;
            /** Format: int64 */
            bytes: number;
            /** Format: int64 */
            files: number;
        };
        AttachmentsDMUsage: {
            /** Format: int64 */
            downloaded_today: number;
            /** Format: int64 */
            limit_bytes: number;
            policy: components["schemas"]["ConfigDMPolicy"];
            /** Format: int64 */
            uploaded_today: number;
            /** Format: int64 */
            uploads: number;
            /** Format: int64 */
            used_bytes: number;
        };
        AudiopluginABI: {
            create: string;
            frame_samples: number;
            initialize?: string;
            input: string;
            output: string;
            process: string;
            process_controls?: string[];
            reset?: string;
        };
        AudiopluginDiagnostic: {
            export: string;
            key: string;
            label: string;
            variants?: string[];
        };
        AudiopluginField: {
            /** Format: double */
            default: number;
            export?: string;
            help?: string;
            key: string;
            label: string;
            /** Format: double */
            max: number;
            /** Format: double */
            min: number;
            /** Format: double */
            scale: number;
            /** Format: double */
            step: number;
            type: string;
            variants?: string[];
        };
        AudiopluginFile: {
            /** Format: int64 */
            bytes: number;
            name: string;
            sha256: string;
        };
        AudiopluginLegacyPreferences: {
            fields?: {
                [key: string]: string;
            } | null;
            variant_key?: string;
        };
        AudiopluginManifest: {
            abi: components["schemas"]["AudiopluginABI"];
            default_variant: string;
            description: string;
            diagnostics?: components["schemas"]["AudiopluginDiagnostic"][];
            fields: components["schemas"]["AudiopluginField"][] | null;
            id: string;
            legacy_preferences?: components["schemas"]["AudiopluginLegacyPreferences"];
            name: string;
            variants: components["schemas"]["AudiopluginVariant"][] | null;
            version: number;
        };
        AudiopluginPlugin: {
            /** Format: int64 */
            bytes: number;
            digest: string;
            files: components["schemas"]["AudiopluginFile"][] | null;
            manifest: components["schemas"]["AudiopluginManifest"];
        };
        AudiopluginPreferences: {
            id: string;
            values: {
                [key: string]: number;
            } | null;
            variant: string;
        };
        AudiopluginRepositoryInstall: {
            commit: string;
            repository: string;
            sha256: string;
        };
        AudiopluginVariant: {
            description?: string;
            file: string;
            id: string;
            label: string;
        };
        BlobstoreConfiguration: {
            bucket?: string;
            /** @description Empty uses AWS S3. Custom endpoints may use HTTP for trusted LAN services. */
            endpoint?: string;
            /** @enum {string} */
            kind: "local" | "s3";
            path?: string;
            path_style: boolean;
            prefix?: string;
            region?: string;
        };
        BlobstoreCredentials: {
            access_key: string;
            /** Format: password */
            secret_key: string;
            /** Format: password */
            session_token?: string;
        };
        BlobstoreProvider: {
            active: boolean;
            /** Format: int64 */
            attachments: number;
            /** Format: int64 */
            bytes: number;
            configuration: components["schemas"]["BlobstoreConfiguration"];
            has_credentials: boolean;
            id: string;
            name: string;
        };
        BlobstoreRegisterRequest: {
            configuration: components["schemas"]["BlobstoreConfiguration"];
            credentials?: components["schemas"]["BlobstoreCredentials"];
            name: string;
        };
        ChatConversation: {
            id: string;
            kind: string;
            members?: string[];
        };
        ChatDMCryptoBundle: {
            devices: components["schemas"]["ChatDMDevice"][] | null;
            members: string[] | null;
            packages: components["schemas"]["ChatDMKeyPackage"][] | null;
            /** Format: int64 */
            revision: number;
        };
        ChatDMCryptoCommit: {
            actor: string;
            /** Format: base64 */
            commit: string;
            devices: string[] | null;
            /** Format: int64 */
            expected_revision: number;
            packages: string[] | null;
            request_id: string;
            /** Format: base64 */
            welcome?: string;
        };
        ChatDMCryptoEvent: {
            actor: string;
            /** Format: base64 */
            commit: string;
            devices: string[] | null;
            request_id: string;
            /** Format: int64 */
            revision: number;
            /** Format: base64 */
            welcome?: string;
        };
        ChatDMCryptoEvents: {
            events: components["schemas"]["ChatDMCryptoEvent"][] | null;
        };
        ChatDMDevice: {
            credential: string;
            id: string;
            /** Format: base64 */
            public_key: string;
            revoked: boolean;
            user_id: string;
        };
        ChatDMKeyPackage: {
            /** Format: base64 */
            data: string;
            device_id: string;
            id: string;
        };
        ChatDMKeyPackages: {
            packages: components["schemas"]["ChatDMKeyPackage"][] | null;
        };
        ChatEvent: {
            conversation_id: string;
            data: unknown;
            /** Format: int64 */
            id: number;
            type: string;
        };
        ChatHistory: {
            /** Format: int64 */
            event_cursor: number;
            gap: boolean;
            /** Format: int64 */
            last_seq: number;
            messages: components["schemas"]["ChatMessage"][] | null;
            /** Format: int64 */
            pruned_through: number;
        };
        ChatMessage: {
            attachment_ids: string[] | null;
            author_id: string;
            body: string;
            conversation_id: string;
            /** Format: date-time */
            created_at: string;
            deleted: boolean;
            /** Format: date-time */
            edited_at?: null | string;
            id: string;
            mention_user_ids?: string[];
            request_id: string;
            /** Format: int64 */
            seq: number;
        };
        ChatReadPage: {
            next?: string;
            states: components["schemas"]["ChatReadState"][] | null;
        };
        ChatReadState: {
            conversation_id: string;
            /** Format: int64 */
            event_cursor: number;
            kind: string;
            /** Format: int64 */
            last_seq: number;
            /** Format: int64 */
            mention_count: number;
            /** Format: int64 */
            read_seq: number;
            /** Format: int64 */
            unread_count: number;
        };
        ChatRegisterDMDevice: {
            id: string;
            /** Format: base64 */
            public_key: string;
            /** Format: base64 */
            signature: string;
        };
        ConfigDMPolicy: {
            /** Format: int64 */
            download_bytes_per_day: number;
            /** Format: int64 */
            image_max_bytes: number;
            /** Format: int64 */
            image_retention_days: number;
            images_enabled: boolean;
            /** Format: int64 */
            storage_bytes: number;
            /** Format: int64 */
            text_max_bytes: number;
            /** Format: int64 */
            text_retention_days: number;
            /** Format: int64 */
            upload_bytes_per_day: number;
            /** Format: int64 */
            user_storage_bytes: number;
            version: number;
        };
        ConfigICEServer: {
            credential?: string;
            urls: string[] | null;
            username?: string;
        };
        ConfigPolicy: {
            /** Format: int64 */
            attachment_max_bytes: number;
            /** Format: int64 */
            attachment_retention_days: number;
            dm?: components["schemas"]["ConfigDMPolicy"];
            /** Format: int64 */
            image_max_bytes: number;
            /** Format: int64 */
            text_max_bytes: number;
            /** Format: int64 */
            text_retention_days: number;
            /** Format: int64 */
            video_max_bytes: number;
        };
        ConfigRuntimeSettings: {
            limits: components["schemas"]["ConfigPolicy"];
            media_max_peers: number;
            media_room_limit: number;
            registration_enabled: boolean;
            /** Format: int64 */
            session_days: number;
        };
        EmbedsPreview: {
            description?: string;
            image: boolean;
            image_alt?: string;
            index: number;
            kind: string;
            site_name?: string;
            title?: string;
            url: string;
            youtube_id?: string;
        };
        HttpapiActivateStorageRequest: {
            /** @description Provider UUID, or an empty string to use the built-in local storage. */
            provider_id: null | string;
        };
        HttpapiAppealsResponse: {
            appeals: components["schemas"]["IdentityAppeal"][] | null;
        };
        HttpapiArtResponse: {
            version: string;
        };
        HttpapiAssignRolesRequest: {
            /** @description Complete replacement; an empty array removes assigned nondefault roles. */
            role_ids: string[];
        };
        HttpapiAudioPluginsResponse: {
            default: components["schemas"]["AudiopluginPreferences"];
            /** Format: int64 */
            max_package_bytes: number;
            plugins: components["schemas"]["AudiopluginPlugin"][] | null;
        };
        HttpapiAuditResponse: {
            entries: components["schemas"]["IdentityAuditEntry"][] | null;
        };
        HttpapiAuthenticationInfo: {
            registration: string;
            scheme: string;
            /** Format: int64 */
            session_days: number;
        };
        HttpapiBanAppealRequest: {
            appeal_ticket: string;
            /** @description Plain text only, no URLs or attachments. One submission per ban per rolling 30 days. */
            body: string;
        };
        HttpapiBanNetworkRequest: {
            /** @description IPv4 or IPv6 address or CIDR range; normalized by the service. */
            network: string;
            reason: string;
        };
        HttpapiBanTicketRequest: {
            appeal_ticket: string;
        };
        HttpapiBansResponse: {
            bans: components["schemas"]["IdentityBan"][] | null;
        };
        HttpapiCategoriesResponse: {
            categories: components["schemas"]["IdentityCategory"][] | null;
        };
        HttpapiChangePasswordRequest: {
            /** Format: password */
            current_password: string;
            /**
             * Format: password
             * @description At most 1024 UTF-8 bytes.
             */
            new_password: string;
        };
        HttpapiChannelsResponse: {
            channels: components["schemas"]["IdentityChannel"][] | null;
        };
        HttpapiClientInstallers: {
            available: string[] | null;
            manifest: components["schemas"]["HttpapiClientUpdateEnvelope"];
        };
        HttpapiClientUpdateEnvelope: {
            payload: string;
            schema: number;
            signature: string;
        };
        HttpapiClientUpdateSource: {
            authenticated?: boolean;
            installers?: boolean;
            manifest_url?: string;
        };
        HttpapiConfigurationResponse: {
            /** Format: int64 */
            attachment_reserved_bytes: number;
            /** Format: int64 */
            revision: number;
            settings: components["schemas"]["ConfigRuntimeSettings"];
        };
        HttpapiConversationsResponse: {
            conversations: components["schemas"]["ChatConversation"][] | null;
        };
        HttpapiCreateDMRequest: {
            /** @description Other participant UUIDs; the current user is added automatically. */
            members: string[] | null;
        };
        HttpapiCreateInviteRequest: {
            expires_in_hours: number;
            uses: number;
        };
        HttpapiCreateMessageRequest: {
            attachment_ids?: string[] | null;
            /** @description Nonblank body or at least one attachment. UTF-8 bytes are bounded by installation policy (at most 64 KiB). */
            body?: string;
            /** Format: uuid */
            request_id: string;
        };
        HttpapiCredentialsRequest: {
            device_name: string;
            /** @description Required for registration; unused on login. */
            invitation?: string;
            /**
             * Format: password
             * @description Registration requires at least 8 characters; at most 1024 UTF-8 bytes.
             */
            password: string;
            /** @description Keep this device signed in until revocation, with no calendar expiry. Defaults to false. */
            remember?: boolean;
            username: string;
        };
        HttpapiDMPurgeRequest: {
            /** Format: date-time */
            before: string;
            confirm?: boolean;
        };
        HttpapiDisableMemberRequest: {
            disabled: boolean;
        };
        HttpapiEditMessageRequest: {
            body?: string;
        };
        HttpapiEmbedsResponse: {
            embeds: components["schemas"]["EmbedsPreview"][] | null;
        };
        HttpapiEmojisResponse: {
            emojis: components["schemas"]["IdentityEmoji"][] | null;
        };
        HttpapiErrorResponse: {
            appeal_ticket?: string;
            ban_type?: string;
            error: string;
            request_id?: string;
        };
        HttpapiEventCommand: {
            admission_id?: string;
            after_event?: null | number;
            candidate?: components["schemas"]["V4ICECandidateInit"];
            conversations?: string[];
            enabled?: null | boolean;
            peer_id?: string;
            publisher_id?: string;
            sdp?: components["schemas"]["V4SessionDescription"];
            state?: components["schemas"]["VoiceState"];
            token?: string;
            tracks?: {
                [key: string]: string;
            };
            type?: string;
        };
        HttpapiIceResponse: {
            /** Format: date-time */
            expires_at: null | string;
            ice_servers: components["schemas"]["ConfigICEServer"][] | null;
            ice_transport_policy: string;
        };
        HttpapiInstanceResponse: {
            accent_color?: string;
            api_version: string;
            authentication: components["schemas"]["HttpapiAuthenticationInfo"];
            banner_version?: string;
            capabilities: string[] | null;
            client_updates?: components["schemas"]["HttpapiClientUpdateSource"];
            description?: string;
            icon_version?: string;
            instance_id: string;
            limits: components["schemas"]["ConfigPolicy"];
            media_transport: string;
            name: string;
            public_url: string;
        };
        HttpapiInvitesResponse: {
            invites: components["schemas"]["IdentityInvite"][] | null;
        };
        HttpapiMarkReadRequest: {
            /** Format: int64 */
            seq?: number;
        };
        HttpapiMediaAuthenticateCommand: {
            /** Format: uuid */
            participant_id: string;
            token: string;
            /** @enum {string} */
            type: "authenticate";
        };
        HttpapiMediaCommand: {
            publisher_id?: string;
            purpose?: string;
            tracks?: components["schemas"]["VoiceEncodedTrack"][];
            /** @enum {string} */
            type: "configure" | "keyframe";
        };
        HttpapiMemberIPsResponse: {
            ips: components["schemas"]["IdentityMemberIP"][] | null;
        };
        HttpapiMembersResponse: {
            members: components["schemas"]["IdentityMember"][] | null;
        };
        HttpapiMenuCommand: {
            confirmation: string;
            confirmation_label?: string;
            confirmation_value?: string;
            dangerous?: boolean;
            /** @enum {string} */
            method: "POST" | "PUT" | "DELETE";
            path: string;
            submit_label?: string;
            success_message?: string;
        };
        HttpapiMenuField: {
            help?: string;
            label: string;
            max?: null | number;
            max_length?: number;
            min?: null | number;
            options?: components["schemas"]["HttpapiMenuOption"][];
            path: string;
            required?: boolean;
            /** Format: double */
            scale?: number;
            step?: null | number;
            /** @enum {string} */
            type: "text" | "textarea" | "password" | "number" | "toggle" | "select";
        };
        HttpapiMenuForm: {
            carry_fields?: string[];
            description?: string;
            fields: components["schemas"]["HttpapiMenuField"][] | null;
            load_path: string;
            /** @enum {string} */
            method: "PUT" | "POST";
            save_path: string;
            submit_label: string;
            success_message?: string;
        };
        HttpapiMenuManifest: {
            pages: components["schemas"]["HttpapiMenuPage"][] | null;
            version: number;
        };
        HttpapiMenuOption: {
            label: string;
            value: string;
        };
        HttpapiMenuPage: {
            action?: components["schemas"]["HttpapiMenuCommand"];
            builtin?: string;
            context_label?: string;
            form?: components["schemas"]["HttpapiMenuForm"];
            id: string;
            label: string;
        };
        HttpapiModerateMemberRequest: {
            /** @enum {string} */
            action: "kick" | "ban" | "restore" | "delete";
            reason: string;
        };
        HttpapiModerationReasonRequest: {
            reason: string;
        };
        HttpapiOverridesResponse: {
            overrides: components["schemas"]["IdentityOverride"][] | null;
        };
        HttpapiParticipantsResponse: {
            participants: components["schemas"]["VoiceSnapshot"][] | null;
        };
        HttpapiRememberSessionRequest: {
            remember: boolean;
        };
        HttpapiResetPasswordRequest: {
            /**
             * Format: password
             * @description At most 1024 UTF-8 bytes.
             */
            new_password: string;
        };
        HttpapiRestoreSessionRequest: {
            device_name: string;
        };
        HttpapiRolesResponse: {
            roles: components["schemas"]["IdentityRole"][] | null;
        };
        HttpapiSaveCategoryRequest: {
            name: string;
        };
        HttpapiSaveChannelRequest: {
            category_id?: null | string;
            /**
             * @description Built-in SVG icon key; empty restores the default for the channel kind. Omission preserves the current icon.
             * @enum {null|string}
             */
            icon?: "" | "hash" | "headphones" | "message-circle" | "megaphone" | "volume-2" | "mic" | "music" | "radio" | "gamepad-2" | "monitor" | "video" | "camera" | "image" | "film" | "code" | "terminal" | "book-open" | "graduation-cap" | "coffee" | "users" | "calendar" | "star" | "heart" | "shield" | "wrench" | null;
            /** @enum {string} */
            kind: "text" | "voice";
            name: string;
            topic?: null | string;
        };
        HttpapiSaveCommunityRequest: {
            accent_color: string;
            description?: string;
            name: string;
        };
        HttpapiSaveConfigurationRequest: {
            revision: null | number;
            settings: components["schemas"]["ConfigRuntimeSettings"];
        };
        HttpapiSaveRoleRequest: {
            /** @description Show online members separately in the member list. Defaults to false for new roles; omission preserves existing settings. */
            display_separately?: null | boolean;
            name: string;
            permissions: number;
            /** @description Role rank; default role is zero. Delegates can only manage lower-ranked roles and members. */
            position?: null | number;
        };
        HttpapiSessionsResponse: {
            sessions: components["schemas"]["IdentitySession"][] | null;
        };
        HttpapiSetPermissionsRequest: {
            allow: number;
            deny: number;
        };
        HttpapiStatsResponse: {
            cloudflare_turn: {
                [key: string]: unknown;
            } | null;
            events: {
                [key: string]: unknown;
            } | null;
            media: {
                [key: string]: unknown;
            } | null;
            policy: components["schemas"]["ConfigPolicy"];
            pool: {
                [key: string]: unknown;
            } | null;
            relay: {
                [key: string]: unknown;
            } | null;
            storage: {
                [key: string]: unknown;
            } | null;
            storage_lock: {
                [key: string]: unknown;
            } | null;
        };
        HttpapiStatusResponse: {
            check?: string;
            status: string;
        };
        HttpapiStorageProvidersResponse: {
            default_active: boolean;
            /** Format: int64 */
            default_attachments: number;
            /** Format: int64 */
            default_bytes: number;
            providers: components["schemas"]["BlobstoreProvider"][] | null;
        };
        HttpapiTemporaryPasswordRequest: {
            reason: string;
        };
        HttpapiUnavailableResponse: {
            dependency: string;
            status: string;
        };
        HttpapiUsersResponse: {
            users: components["schemas"]["IdentityUser"][] | null;
        };
        IdentityAppeal: {
            ban_id: string;
            body: string;
            /** Format: date-time */
            created_at: string;
            id: string;
            /** Format: date-time */
            reviewed_at: null | string;
        };
        IdentityAuditEntry: {
            action: string;
            actor_id: null | string;
            /** Format: date-time */
            created_at: string;
            /** Format: int64 */
            id: number;
            ip: null | string;
            reason: string;
            target_id: string;
        };
        IdentityBan: {
            /** Format: date-time */
            created_at: string;
            created_by: string;
            id: string;
            network: null | string;
            reason: string;
            /** Format: date-time */
            revoked_at: null | string;
            user_id: null | string;
        };
        IdentityBanStatus: {
            active: boolean;
            ban_type: string;
            /** Format: date-time */
            next_appeal_at: null | string;
            reason: string;
        };
        IdentityCategory: {
            id: string;
            name: string;
        };
        IdentityChannel: {
            category_id: null | string;
            icon?: string;
            id: string;
            kind: string;
            name: string;
            /** Format: int64 */
            permissions?: number;
            topic?: string;
        };
        IdentityCommunitySettings: {
            accent_color: string;
            banner_version?: string;
            description: string;
            icon_version?: string;
            name: string;
        };
        IdentityDisplayRole: {
            id: string;
            name: string;
            position: number;
        };
        IdentityEmoji: {
            animated: boolean;
            id: string;
            name: string;
            version: string;
        };
        IdentityInvite: {
            /** Format: date-time */
            created_at: string;
            created_by: string;
            /** Format: date-time */
            expires_at: string;
            id: string;
            remaining_uses: number;
            token?: string;
        };
        IdentityLogin: {
            instance_id: string;
            /** @description Temporary password session: may only change the password or log out; expires after 15 minutes even when remember is true. */
            password_change_required?: boolean;
            session: components["schemas"]["IdentitySession"];
            token: string;
            token_type: string;
            user: components["schemas"]["IdentityUser"];
        };
        IdentityMember: {
            accent_color?: string;
            avatar_version?: string;
            banned: boolean;
            bio?: string;
            /** Format: date-time */
            created_at: string;
            deleted: boolean;
            disabled: boolean;
            display_name?: string;
            /** @description Highest-ranked role enabled for member-list sections; display metadata only. Absent when no role is enabled. */
            display_role?: components["schemas"]["IdentityDisplayRole"];
            id: string;
            is_owner: boolean;
            kicked: boolean;
            role_ids: string[] | null;
            role_position: number;
            username: string;
        };
        IdentityMemberIP: {
            /** Format: date-time */
            first_seen: string;
            ip: string;
            /** Format: date-time */
            last_seen: string;
        };
        IdentityOverride: {
            /** Format: int64 */
            allow: number;
            /** Format: int64 */
            deny: number;
            role_id: string;
        };
        IdentityPrincipal: {
            /** Format: int64 */
            permissions: number;
            role_position: number;
            session_id: string;
            user: components["schemas"]["IdentityUser"];
        };
        IdentityProfileSettingsRequest: {
            accent_color: string;
            bio?: string;
            display_name?: string;
        };
        IdentityRole: {
            /** @description Show online members in a separate member-list section. Disabled by default. */
            display_separately: boolean;
            id: string;
            is_default: boolean;
            name: string;
            /** Format: int64 */
            permissions: number;
            position: number;
        };
        IdentityRuntimeConfiguration: {
            /** Format: int64 */
            revision: number;
            settings: components["schemas"]["ConfigRuntimeSettings"];
        };
        IdentitySession: {
            /** Format: date-time */
            created_at: string;
            device_name: string;
            /**
             * Format: date-time
             * @description Null for a remembered device; otherwise the session's expiry in UTC. All sessions can be revoked.
             */
            expires_at: null | string;
            id: string;
        };
        IdentityTemporaryPassword: {
            /** @description Shown once. Share privately; the member must replace it before server access. */
            temporary_password: string;
        };
        IdentityUser: {
            accent_color?: string;
            avatar_version?: string;
            bio?: string;
            /** Format: date-time */
            created_at: string;
            display_name?: string;
            /** @description Highest-ranked role enabled for member-list sections; display metadata only. Absent when no role is enabled. */
            display_role?: components["schemas"]["IdentityDisplayRole"];
            id: string;
            is_owner: boolean;
            username: string;
        };
        V4ICECandidateInit: {
            candidate?: string;
            sdpMLineIndex?: null | number;
            sdpMid?: null | string;
            usernameFragment?: null | string;
        };
        V4RTPCodecCapability: {
            Channels: number;
            ClockRate: number;
            MimeType: string;
            RTCPFeedback: {
                Parameter?: string;
                Type?: string;
            }[] | null;
            SDPFmtpLine: string;
        };
        /** @enum {string} */
        V4SDPType: "offer" | "answer" | "pranswer" | "rollback";
        V4SessionDescription: {
            sdp?: string;
            type?: components["schemas"]["V4SDPType"];
        };
        VoiceAdmission: {
            admission_id: string;
            /** Format: date-time */
            expires_at: string;
            /** Format: date-time */
            ice_expires_at?: null | string;
            ice_servers: components["schemas"]["ConfigICEServer"][] | null;
            ice_transport_policy?: string;
            media_path?: string;
            room_id: string;
            transport: string;
        };
        VoiceEncodedTrack: {
            channels?: number;
            codec?: string;
            /** Format: base64 */
            description?: string;
            height?: number;
            purpose?: string;
            revision?: number;
            sample_rate?: number;
            width?: number;
        };
        VoicePresenceMember: {
            /** Format: date-time */
            joined_at: string;
            participant_id: string;
            state: components["schemas"]["VoiceState"];
            user_id: string;
        };
        VoiceSnapshot: {
            encoded_tracks?: components["schemas"]["VoiceEncodedTrack"][];
            /** Format: date-time */
            joined_at: string;
            participant_id: string;
            state: components["schemas"]["VoiceState"];
            tracks: components["schemas"]["VoiceTrack"][] | null;
            user_id: string;
        };
        VoiceState: {
            camera_off: boolean;
            deafened: boolean;
            muted: boolean;
            screen_off: boolean;
        };
        VoiceTrack: {
            codec: components["schemas"]["V4RTPCodecCapability"];
            purpose: string;
            track_id: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    listAppeals: {
        parameters: {
            query?: {
                /** @description Exclusive UUID cursor; up to 100 results. */
                after?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiAppealsResponse"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    reviewAppeal: {
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
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    installAudioPlugin: {
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
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AudiopluginPlugin"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    setDefaultAudioPlugin: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AudiopluginPreferences"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AudiopluginPreferences"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    installAudioPluginRepository: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AudiopluginRepositoryInstall"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AudiopluginPlugin"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    removeAudioPlugin: {
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
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    auditLog: {
        parameters: {
            query?: {
                /** @description Exclusive audit ID cursor; newest 100 entries by default. */
                before?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiAuditResponse"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    listBans: {
        parameters: {
            query?: {
                /** @description Exclusive UUID cursor; up to 100 results. */
                after?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiBansResponse"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    banNetwork: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["HttpapiBanNetworkRequest"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IdentityBan"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    revokeBan: {
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
                "application/json": components["schemas"]["HttpapiModerationReasonRequest"];
            };
        };
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    maintenance: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    disableMember: {
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
                "application/json": components["schemas"]["HttpapiDisableMemberRequest"];
            };
        };
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    memberIPs: {
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
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiMemberIPsResponse"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    moderateMember: {
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
                "application/json": components["schemas"]["HttpapiModerateMemberRequest"];
            };
        };
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    resetMemberPassword: {
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
                "application/json": components["schemas"]["HttpapiResetPasswordRequest"];
            };
        };
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    issueTemporaryPassword: {
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
                "application/json": components["schemas"]["HttpapiTemporaryPasswordRequest"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IdentityTemporaryPassword"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    getStats: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiStatsResponse"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    listStorage: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiStorageProvidersResponse"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    registerStorage: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BlobstoreRegisterRequest"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BlobstoreProvider"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    activateStorage: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["HttpapiActivateStorageRequest"];
            };
        };
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    removeStorage: {
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
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    checkStorage: {
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
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    rotateStorageCredentials: {
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
                "application/json": components["schemas"]["BlobstoreCredentials"];
            };
        };
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    downloadAttachment: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional HTTP byte range, for example bytes=0-1023. */
                Range?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Authorized file bytes. Content-Type is detected from content. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            /** @description Authorized file bytes. Content-Type is detected from content. */
            206: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            /** @description Unsatisfiable byte range */
            416: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    deleteAttachment: {
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
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    headAttachment: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional HTTP byte range, for example bytes=0-1023. */
                Range?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Attachment metadata headers, no body */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    getAttachmentMetadata: {
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
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AttachmentsAttachment"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    listAudioPlugins: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiAudioPluginsResponse"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    downloadAudioPlugin: {
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
            /** @description Authorized file bytes. Content-Type is detected from content. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            /** @description Authorized file bytes. Content-Type is detected from content. */
            206: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            /** @description Unsatisfiable byte range */
            416: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    appealBan: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["HttpapiBanAppealRequest"];
            };
        };
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    banStatus: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["HttpapiBanTicketRequest"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IdentityBanStatus"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    login: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["HttpapiCredentialsRequest"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IdentityLogin"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    logout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    register: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["HttpapiCredentialsRequest"] & {
                    invitation: string;
                    password?: unknown;
                };
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IdentityLogin"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    listCategories: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiCategoriesResponse"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    createCategory: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["HttpapiSaveCategoryRequest"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IdentityCategory"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    updateCategory: {
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
                "application/json": components["schemas"]["HttpapiSaveCategoryRequest"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IdentityCategory"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    deleteCategory: {
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
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    getCategoryPermissions: {
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
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiOverridesResponse"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    setCategoryPermissions: {
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
                "application/json": components["schemas"]["HttpapiSetPermissionsRequest"];
            };
        };
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    listChannels: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiChannelsResponse"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    createChannel: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["HttpapiSaveChannelRequest"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IdentityChannel"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    getChannel: {
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
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IdentityChannel"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    updateChannel: {
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
                "application/json": components["schemas"]["HttpapiSaveChannelRequest"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IdentityChannel"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    deleteChannel: {
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
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    getChannelMenu: {
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
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiMenuManifest"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    getChannelPermissions: {
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
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiOverridesResponse"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    setChannelPermissions: {
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
                "application/json": components["schemas"]["HttpapiSetPermissionsRequest"];
            };
        };
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    clientUpdateManifest: {
        parameters: {
            query: {
                /** @description Installed desktop version. */
                version: string;
                /** @description win32-x64, linux-x64, linux-arm64 or darwin-arm64. */
                target: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiClientUpdateEnvelope"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    clientInstallers: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiClientInstallers"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    clientUpdateFile: {
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
            /** @description Authorized file bytes. Content-Type is detected from content. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            /** @description Authorized file bytes. Content-Type is detected from content. */
            206: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            /** @description Unsatisfiable byte range */
            416: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    listConversations: {
        parameters: {
            query?: {
                /** @description Exclusive UUID cursor; up to 100 results. */
                after?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiConversationsResponse"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    uploadAttachment: {
        parameters: {
            query: {
                /** @description Set to 1 for an encrypted DM image; required for DM uploads. */
                encrypted?: string;
                /** @description Exact byte count; enforce the installation's advertised limits. */
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
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AttachmentsAttachment"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    dmEncryptionBundle: {
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
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChatDMCryptoBundle"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    dmEncryptionEvents: {
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
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChatDMCryptoEvents"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    commitDMEncryption: {
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
                "application/json": components["schemas"]["ChatDMCryptoCommit"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChatDMCryptoEvent"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    getHistory: {
        parameters: {
            query?: {
                /** @description Exclusive conversation sequence; zero starts at the oldest retained message. Pages are ascending by sequence. */
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
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChatHistory"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    createMessage: {
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
                "application/json": components["schemas"]["HttpapiCreateMessageRequest"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChatMessage"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    editMessage: {
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
                "application/json": components["schemas"]["HttpapiEditMessageRequest"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChatMessage"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    deleteMessage: {
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
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChatMessage"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    getMessageEmbeds: {
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
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiEmbedsResponse"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    getEmbedImage: {
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
            /** @description Authorized file bytes. Content-Type is detected from content. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            /** @description Authorized file bytes. Content-Type is detected from content. */
            206: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            /** @description Unsatisfiable byte range */
            416: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    markConversationRead: {
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
                "application/json": components["schemas"]["HttpapiMarkReadRequest"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChatReadState"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    createDM: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["HttpapiCreateDMRequest"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChatConversation"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    listEmojis: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiEmojisResponse"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    deleteEmoji: {
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
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    getEmojiImage: {
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
            /** @description Authorized file bytes. Content-Type is detected from content. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            /** @description Authorized file bytes. Content-Type is detected from content. */
            206: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            /** @description Unsatisfiable byte range */
            416: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    saveEmoji: {
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
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IdentityEmoji"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    events: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Switching Protocols */
            101: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    instance: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiInstanceResponse"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    get_banner: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Authorized file bytes. Content-Type is detected from content. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            /** @description Authorized file bytes. Content-Type is detected from content. */
            206: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            /** @description Unsatisfiable byte range */
            416: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    upload_banner: {
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
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiArtResponse"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    delete_banner: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    getConfiguration: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiConfigurationResponse"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    saveConfiguration: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["HttpapiSaveConfigurationRequest"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IdentityRuntimeConfiguration"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    get_icon: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Authorized file bytes. Content-Type is detected from content. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            /** @description Authorized file bytes. Content-Type is detected from content. */
            206: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            /** @description Unsatisfiable byte range */
            416: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    upload_icon: {
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
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiArtResponse"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    delete_icon: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    updateInstance: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["HttpapiSaveCommunityRequest"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IdentityCommunitySettings"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    listInvites: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiInvitesResponse"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    createInvite: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["HttpapiCreateInviteRequest"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IdentityInvite"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    revokeInvite: {
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
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    me: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IdentityPrincipal"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    upload_avatar: {
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
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiArtResponse"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    delete_avatar: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    registerDMDevice: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChatRegisterDMDevice"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChatDMDevice"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    ownDMKeyPackages: {
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
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChatDMKeyPackages"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    publishDMKeyPackages: {
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
                "application/json": components["schemas"]["ChatDMKeyPackages"];
            };
        };
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    dmStorage: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AttachmentsDMUsage"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    purgeDMUploads: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["HttpapiDMPurgeRequest"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AttachmentsDMPurge"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    changePassword: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["HttpapiChangePasswordRequest"];
            };
        };
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    updateProfile: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["IdentityProfileSettingsRequest"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IdentityUser"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    rememberSession: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["HttpapiRememberSessionRequest"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IdentitySession"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    media: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Switching Protocols */
            101: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    listMembers: {
        parameters: {
            query?: {
                /** @description Exclusive UUID cursor; up to 100 results. */
                after?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiMembersResponse"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    assignRoles: {
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
                "application/json": components["schemas"]["HttpapiAssignRolesRequest"];
            };
        };
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    getServerMenu: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiMenuManifest"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    listReadState: {
        parameters: {
            query?: {
                /** @description Exclusive UUID cursor; up to 100 results. */
                after?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChatReadPage"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    listRoles: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiRolesResponse"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    createRole: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["HttpapiSaveRoleRequest"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IdentityRole"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    updateRole: {
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
                "application/json": components["schemas"]["HttpapiSaveRoleRequest"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IdentityRole"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    deleteRole: {
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
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    listSessions: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiSessionsResponse"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    restoreSession: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["HttpapiRestoreSessionRequest"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IdentityLogin"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    revokeSession: {
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
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    listUsers: {
        parameters: {
            query?: {
                /** @description Exclusive UUID cursor; up to 100 results. */
                after?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiUsersResponse"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    getUser: {
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
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IdentityUser"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    get_avatar: {
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
            /** @description Authorized file bytes. Content-Type is detected from content. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            /** @description Authorized file bytes. Content-Type is detected from content. */
            206: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            /** @description Unsatisfiable byte range */
            416: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    getVoiceRoom: {
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
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiParticipantsResponse"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    admitVoice: {
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
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VoiceAdmission"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    getICE: {
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
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiIceResponse"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    health: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiStatusResponse"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
    readiness: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiStatusResponse"];
                };
            };
            /** @description Service Unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiUnavailableResponse"];
                };
            };
            /** @description Error; inspect the stable error code. Common statuses: 400 invalid request, 401 invalid session, 403 denied, 404 missing/expired, 409 conflict, 413 oversized, 429 rate limit, 503 capacity/provider unavailable, 507 attachment capacity. */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HttpapiErrorResponse"];
                };
            };
        };
    };
}
