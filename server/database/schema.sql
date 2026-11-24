-- Optional: the server creates these tables automatically on first start (Sequelize sync).
-- Use this file only if you prefer to create the schema manually.
CREATE DATABASE IF NOT EXISTS radiantmap CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE radiantmap;

/*M!999999\- enable the sandbox mode */ 

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `ConversationMembers` (
  `lastReadAt` datetime DEFAULT NULL,
  `ConversationId` int(11) NOT NULL,
  `UserId` int(11) NOT NULL,
  PRIMARY KEY (`ConversationId`,`UserId`),
  KEY `UserId` (`UserId`),
  CONSTRAINT `ConversationMembers_ibfk_1` FOREIGN KEY (`ConversationId`) REFERENCES `Conversations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ConversationMembers_ibfk_2` FOREIGN KEY (`UserId`) REFERENCES `Users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `Conversations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `type` enum('direct','group','channel') NOT NULL,
  `name` varchar(120) DEFAULT NULL,
  `department` varchar(100) DEFAULT NULL,
  `createdBy` int(11) DEFAULT NULL,
  `lastMessageAt` datetime DEFAULT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `ManualTimeRequests` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `date` date NOT NULL,
  `clockIn` datetime NOT NULL,
  `clockOut` datetime NOT NULL,
  `reason` varchar(500) NOT NULL,
  `status` enum('pending','approved','rejected') DEFAULT 'pending',
  `reviewNote` varchar(500) DEFAULT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  `UserId` int(11) DEFAULT NULL,
  `reviewedBy` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `UserId` (`UserId`),
  KEY `reviewedBy` (`reviewedBy`),
  CONSTRAINT `ManualTimeRequests_ibfk_1` FOREIGN KEY (`UserId`) REFERENCES `Users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `ManualTimeRequests_ibfk_2` FOREIGN KEY (`reviewedBy`) REFERENCES `Users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `Messages` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `text` text NOT NULL,
  `attachments` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`attachments`)),
  `reactions` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`reactions`)),
  `replyToId` int(11) DEFAULT NULL,
  `editedAt` datetime DEFAULT NULL,
  `deletedAt` datetime DEFAULT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  `ConversationId` int(11) DEFAULT NULL,
  `senderId` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `replyToId` (`replyToId`),
  KEY `senderId` (`senderId`),
  KEY `messages__conversation_id_created_at` (`ConversationId`,`createdAt`),
  CONSTRAINT `Messages_ibfk_1` FOREIGN KEY (`replyToId`) REFERENCES `Messages` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `Messages_ibfk_2` FOREIGN KEY (`ConversationId`) REFERENCES `Conversations` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `Messages_ibfk_3` FOREIGN KEY (`senderId`) REFERENCES `Users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `Tasks` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(200) NOT NULL,
  `description` text DEFAULT NULL,
  `dueDate` datetime DEFAULT NULL,
  `priority` enum('low','medium','high') DEFAULT 'medium',
  `status` enum('pending','in_progress','completed') DEFAULT 'pending',
  `comments` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`comments`)),
  `attachments` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`attachments`)),
  `completedAt` datetime DEFAULT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  `assigneeId` int(11) DEFAULT NULL,
  `createdBy` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `assigneeId` (`assigneeId`),
  KEY `createdBy` (`createdBy`),
  CONSTRAINT `Tasks_ibfk_1` FOREIGN KEY (`assigneeId`) REFERENCES `Users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `Tasks_ibfk_2` FOREIGN KEY (`createdBy`) REFERENCES `Users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `TimeEntries` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `date` date NOT NULL,
  `clockIn` datetime NOT NULL,
  `clockOut` datetime DEFAULT NULL,
  `breaks` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`breaks`)),
  `taskId` int(11) DEFAULT NULL,
  `source` enum('clock','manual') DEFAULT 'clock',
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  `UserId` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `time_entries__user_id_date` (`UserId`,`date`),
  CONSTRAINT `TimeEntries_ibfk_1` FOREIGN KEY (`UserId`) REFERENCES `Users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `Users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(120) NOT NULL,
  `email` varchar(190) NOT NULL,
  `password` varchar(100) NOT NULL,
  `role` enum('admin','manager','employee') DEFAULT 'employee',
  `department` varchar(100) DEFAULT NULL,
  `designation` varchar(100) DEFAULT NULL,
  `joinedAt` date DEFAULT NULL,
  `managerId` int(11) DEFAULT NULL,
  `isActive` tinyint(1) DEFAULT 1,
  `canApproveTime` tinyint(1) DEFAULT 0,
  `resetToken` varchar(100) DEFAULT NULL,
  `resetExpires` datetime DEFAULT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  KEY `managerId` (`managerId`),
  CONSTRAINT `Users_ibfk_1` FOREIGN KEY (`managerId`) REFERENCES `Users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

