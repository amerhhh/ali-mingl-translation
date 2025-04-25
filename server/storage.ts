import { translations, type Translation, type InsertTranslation } from "@shared/schema";
import { db } from "./db";
import { desc, eq } from "drizzle-orm";
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

export interface IStorage {
  addTranslation(translation: InsertTranslation): Promise<Translation>;
  getTranslations(): Promise<Translation[]>;
  getRecentTranslations(roomId: string, limit: number): Promise<Translation[]>;
  clearRoomMessages(roomId: string): Promise<void>;
  isRoomExists(roomId: string): Promise<boolean>;
}

export class DatabaseStorage implements IStorage {
  private memoryStore: Translation[] = [];

  async isRoomExists(roomId: string): Promise<boolean> {
    try {
      if (!db) return false;

      const [result] = await db
        .select({ count: translations.roomId })
        .from(translations)
        .where(eq(translations.roomId, roomId));

      return !!result;
    } catch (error) {
      console.error('Error checking room existence:', error);
      // Check memory store as fallback
      return this.memoryStore.some(t => t.roomId === roomId);
    }
  }

  async addTranslation(translation: InsertTranslation): Promise<Translation> {
    try {
      console.log('Storage received translation:', {
        ...translation,
        sourceText: translation.sourceText.substring(0, 50) // Truncate text for logging
      });

      const dataToInsert = {
        ...translation,
        sourceLang: translation.sourceLang || "en",
        temp_user_uuid: translation.temp_user_uuid || uuidv4(),
        user_emoji: translation.user_emoji || "🌟",
        voiceType: translation.voiceType || "female",
        // Use provided timestamp or create a new one (prevents duplicate messages at minute boundaries)
        timestamp: translation.timestamp || new Date()
      };

      if (!dataToInsert.temp_user_uuid) {
        console.error('Missing temp_user_uuid in translation data!');
      }

      console.log('Attempting to insert translation with:', {
        temp_user_uuid: dataToInsert.temp_user_uuid,
        user_emoji: dataToInsert.user_emoji,
        timestamp: dataToInsert.timestamp
      });

      if (!db) {
        throw new Error("Database not available");
      }
      
      // Check for potential duplicates before inserting
      // Get recent translations for this room
      const recentTranslations = await this.getRecentTranslations(dataToInsert.roomId, 10);
      
      // Check if this exact message was recently stored (within last 5 seconds)
      const now = new Date().getTime();
      const potentialDuplicate = recentTranslations.find(t => 
        t.sourceText === dataToInsert.sourceText &&
        t.targetText === dataToInsert.targetText &&
        t.temp_user_uuid === dataToInsert.temp_user_uuid &&
        // Within last 5 seconds
        (now - t.timestamp.getTime() < 5000)
      );
      
      if (potentialDuplicate) {
        console.log('Detected potential duplicate message, returning existing translation');
        return potentialDuplicate;
      }

      const [result] = await db.insert(translations).values(dataToInsert).returning();
      console.log("Translation saved to database:", {
        temp_user_uuid: result.temp_user_uuid,
        user_emoji: result.user_emoji,
        roomId: result.roomId
      });
      return result;
    } catch (error) {
      console.error("Database error:", error instanceof Error ? error.message : String(error));
      console.warn("Falling back to memory storage");

      const newTranslation = {
        ...translation,
        id: Date.now(),
        timestamp: translation.timestamp || new Date(),
        sourceLang: translation.sourceLang || "en",
        temp_user_uuid: translation.temp_user_uuid || uuidv4(),
        user_emoji: translation.user_emoji || "🌟",
        voiceType: translation.voiceType || "female"
      } as Translation; // Type assertion to match Translation type
      
      this.memoryStore.push(newTranslation);
      return newTranslation;
    }
  }

  async getTranslations(): Promise<Translation[]> {
    try {
      if (!db) {
        throw new Error("Database not available");
      }
      
      return db
        .select()
        .from(translations)
        .orderBy(desc(translations.timestamp));
    } catch (error) {
      console.warn("Database unavailable, using memory storage");
      return this.memoryStore;
    }
  }

  async getRecentTranslations(roomId: string, limit: number = 100): Promise<Translation[]> {
    try {
      if (!db) {
        throw new Error("Database not available");
      }
      
      const result = await db
        .select()
        .from(translations)
        .where(eq(translations.roomId, roomId))
        .orderBy(desc(translations.timestamp))
        .limit(limit);
      
      // Deduplicate messages
      const uniqueMessagesMap = new Map<string, Translation>();
      result.forEach(t => {
        // Create a key based on content and timestamp
        const key = `${t.sourceText}|${t.targetText}|${t.timestamp.toISOString()}|${t.temp_user_uuid}`;
        if (!uniqueMessagesMap.has(key)) {
          uniqueMessagesMap.set(key, t);
        }
      });
      
      const uniqueMessages = Array.from(uniqueMessagesMap.values());
      
      // If we removed duplicates, log it
      if (uniqueMessages.length < result.length) {
        console.log(`Removed ${result.length - uniqueMessages.length} duplicate messages from database query for room ${roomId}`);
      }
      
      // Return messages in chronological order (oldest first)
      return uniqueMessages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    } catch (error) {
      console.warn("Database unavailable for recent translations, using memory storage");
      
      // Apply same deduplication logic to memory store
      const messagesFromMemory = this.memoryStore.filter(t => t.roomId === roomId);
      const uniqueMessagesMap = new Map<string, Translation>();
      
      messagesFromMemory.forEach(t => {
        const key = `${t.sourceText}|${t.targetText}|${t.timestamp.toISOString()}|${t.temp_user_uuid}`;
        if (!uniqueMessagesMap.has(key)) {
          uniqueMessagesMap.set(key, t);
        }
      });
      
      const uniqueMessages = Array.from(uniqueMessagesMap.values());
      
      // If we removed duplicates, log it
      if (uniqueMessages.length < messagesFromMemory.length) {
        console.log(`Removed ${messagesFromMemory.length - uniqueMessages.length} duplicate messages from memory store for room ${roomId}`);
      }
      
      return uniqueMessages
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()) // Oldest first
        .slice(0, limit);
    }
  }

  async clearRoomMessages(roomId: string): Promise<void> {
    try {
      if (!db) {
        throw new Error("Database not available");
      }
      
      await db.delete(translations)
        .where(eq(translations.roomId, roomId));
      console.log(`Deleted all messages for room: ${roomId}`);

      this.memoryStore = this.memoryStore.filter(t => t.roomId !== roomId);
    } catch (error) {
      console.error('Failed to clear room messages:', error);
      this.memoryStore = this.memoryStore.filter(t => t.roomId !== roomId);
    }
  }
}

export const storage = new DatabaseStorage();