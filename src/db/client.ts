// ============================================================
// db/client — PostgreSQL pool setup
// Nexus Recall Phase 1 — S03
// ============================================================

import { Pool } from 'pg';
import { config } from '../config';

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: config.databasePoolSize,
});
