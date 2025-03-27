
import { db } from '../db';
import { translations } from '@shared/schema';
import { desc } from 'drizzle-orm';

async function getRecentTranslations() {
  try {
    const results = await db.select()
      .from(translations)
      .orderBy(desc(translations.timestamp))
      .limit(2);
    
    console.table(results);
  } catch (error) {
    console.error('Error querying database:', error);
  }
  process.exit(0);
}

getRecentTranslations();
