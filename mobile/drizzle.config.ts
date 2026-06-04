import type { Config } from 'drizzle-kit';

export default {
  schema: './src/database/schemaDef.ts',
  out: './drizzle',
  dialect: 'sqlite',
} satisfies Config;
