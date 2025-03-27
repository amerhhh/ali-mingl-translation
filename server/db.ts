import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

// Initialize pool and db as null
let pool: Pool | null = null;
let db: ReturnType<typeof drizzle> | null = null;

// Set up database connection if URL is available
if (process.env.DATABASE_URL) {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  db = drizzle({ client: pool, schema });
} else {
  console.warn("Warning: DATABASE_URL not set. Some features may be limited.");
}

// Export the initialized variables
export { pool, db };