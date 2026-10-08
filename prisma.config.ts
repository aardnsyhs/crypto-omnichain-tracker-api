import 'dotenv/config';
import { defineConfig } from '@prisma/config';
import { validateEnvironment } from './src/config/environment';

validateEnvironment();

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url:
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5432/omnichain_tracker?schema=public',
  },
});
