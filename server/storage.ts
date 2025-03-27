import { translations, type Translation, type InsertTranslation } from "@shared/schema";
import { db } from "./db";
import { desc, eq } from "drizzle-orm";
import crypto from 'crypto';

export interface IStorage {
  addTranslation(translation: InsertTranslation): Promise<Translation>;
  getTranslations(): Promise<Translation[]>;
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
        temp_user_uuid: translation.temp_user_uuid,
        user_emoji: translation.user_emoji
      };

      if (!dataToInsert.temp_user_uuid) {
        console.error('Missing temp_user_uuid in translation data!');
      }

      console.log('Attempting to insert translation with:', {
        temp_user_uuid: dataToInsert.temp_user_uuid,
        user_emoji: dataToInsert.user_emoji
      });

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
        timestamp: new Date(),
        sourceLang: translation.sourceLang || "en",
        temp_user_uuid: translation.temp_user_uuid,
        user_emoji: translation.user_emoji
      };
      this.memoryStore.push(newTranslation);
      return newTranslation;
    }
  }

  async getTranslations(): Promise<Translation[]> {
    try {
      return db
        .select()
        .from(translations)
        .orderBy(desc(translations.timestamp));
    } catch (error) {
      console.warn("Database unavailable, using memory storage");
      return this.memoryStore;
    }
  }

  async clearRoomMessages(roomId: string): Promise<void> {
    try {
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