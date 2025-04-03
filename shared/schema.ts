import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { v4 as uuidv4 } from 'uuid';

// Define available emojis for user selection - using generic icons
export const availableEmojis = [
  "🌟", "⭐", "🔆", "💫", "✨", // Stars and sparkles
  "🌸", "🌺", "🌻", "🌹", "🍀", // Flowers and nature
  "🦋", "🐢", "🦉", "🦁", "🐬", // Animals
  "🎨", "🎭", "🎪", "🎯", "🎮", // Arts and entertainment
  "🌈", "☁️", "🌙", "⛰️", "🌴", // Nature and weather
  "🎸", "🎹", "🎺", "🎻", "📚", // Music and books
  "🎪", "🎭", "🎨", "🎯", "🎮", // Entertainment
  "🌍", "🌎", "🌏", "🗺️", "🧭", // World and navigation
  "💎", "🔮", "🎲", "🎯", "🏆"  // Objects and symbols
] as const;

export type UserEmoji = typeof availableEmojis[number];

export const translations = pgTable("translations", {
  id: serial("id").primaryKey(),
  sourceText: text("source_text").notNull(),
  targetText: text("target_text").notNull(),
  sourceLang: text("source_lang").notNull().default("en"),
  targetLang: text("target_lang").notNull(),
  roomId: text("room_id").notNull(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  temp_user_uuid: text("temp_user_uuid").notNull().default(uuidv4()),
  user_emoji: text("user_emoji").notNull().default("🌟"), // Default to first emoji
  voiceType: text("voice_type").notNull().default("female") // Default voice type
});

export const insertTranslationSchema = createInsertSchema(translations).pick({
  sourceText: true,
  targetText: true,
  sourceLang: true,
  targetLang: true,
  roomId: true,
  temp_user_uuid: true,
  user_emoji: true,
  voiceType: true
});

export type InsertTranslation = z.infer<typeof insertTranslationSchema>;
export type Translation = typeof translations.$inferSelect;

export const supportedLanguages = {
  en: { native: "English", english: "English" },
  es: { native: "Español", english: "Spanish" },
  ar: { native: "العربية", english: "Arabic" },
  it: { native: "Italiano", english: "Italian" }
} as const;

export type LanguageCode = keyof typeof supportedLanguages;