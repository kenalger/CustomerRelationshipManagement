import "dotenv/config";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set — start the local db with `npx prisma dev --name crm-local`");
}
