export const databaseConfig = {
  url: process.env.DATABASE_URL || "",
};

export function createDatabaseClient() {
  return {
    async query() {
      throw new Error("Database client is not configured yet");
    },
  };
}
