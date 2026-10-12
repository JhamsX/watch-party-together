-- Initial MySQL schema for together. Watch Party.
CREATE TABLE `users` (
  `id` VARCHAR(30) NOT NULL,
  `email` VARCHAR(191) NULL,
  `displayName` VARCHAR(48) NOT NULL,
  `passwordHash` VARCHAR(255) NULL,
  `isGuest` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `users_email_key` (`email`),
  INDEX `users_displayName_idx` (`displayName`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `rooms` (
  `id` VARCHAR(30) NOT NULL,
  `code` VARCHAR(10) NOT NULL,
  `name` VARCHAR(80) NOT NULL,
  `isPublic` BOOLEAN NOT NULL DEFAULT false,
  `passwordHash` VARCHAR(255) NULL,
  `hostTokenHash` CHAR(64) NOT NULL,
  `allowEveryoneControls` BOOLEAN NOT NULL DEFAULT false,
  `currentVideoUrl` VARCHAR(2048) NULL,
  `currentVideoTitle` VARCHAR(200) NULL,
  `ownerId` VARCHAR(30) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `lastActivityAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `rooms_code_key` (`code`),
  INDEX `rooms_isPublic_createdAt_idx` (`isPublic`, `createdAt`),
  INDEX `rooms_ownerId_createdAt_idx` (`ownerId`, `createdAt`),
  INDEX `rooms_lastActivityAt_idx` (`lastActivityAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `rooms_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `room_videos` (
  `id` VARCHAR(30) NOT NULL,
  `roomId` VARCHAR(30) NOT NULL,
  `url` VARCHAR(2048) NOT NULL,
  `title` VARCHAR(200) NOT NULL,
  `provider` VARCHAR(24) NOT NULL,
  `position` INTEGER NOT NULL DEFAULT 0,
  `addedBy` VARCHAR(48) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `room_videos_roomId_position_idx` (`roomId`, `position`),
  PRIMARY KEY (`id`),
  CONSTRAINT `room_videos_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `rooms` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `room_messages` (
  `id` VARCHAR(30) NOT NULL,
  `roomId` VARCHAR(30) NOT NULL,
  `userId` VARCHAR(30) NULL,
  `displayName` VARCHAR(48) NOT NULL,
  `content` VARCHAR(500) NOT NULL,
  `kind` VARCHAR(16) NOT NULL DEFAULT 'chat',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `room_messages_roomId_createdAt_idx` (`roomId`, `createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `room_messages_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `rooms` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `room_messages_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `playlists` (
  `id` VARCHAR(30) NOT NULL,
  `userId` VARCHAR(30) NOT NULL,
  `name` VARCHAR(80) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `playlists_userId_updatedAt_idx` (`userId`, `updatedAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `playlists_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `playlist_videos` (
  `id` VARCHAR(30) NOT NULL,
  `playlistId` VARCHAR(30) NOT NULL,
  `url` VARCHAR(2048) NOT NULL,
  `title` VARCHAR(200) NOT NULL,
  `provider` VARCHAR(24) NOT NULL,
  `position` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `playlist_videos_playlistId_position_idx` (`playlistId`, `position`),
  PRIMARY KEY (`id`),
  CONSTRAINT `playlist_videos_playlistId_fkey` FOREIGN KEY (`playlistId`) REFERENCES `playlists` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
