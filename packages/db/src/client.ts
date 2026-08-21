import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./schema/index.js";

export type IusiaDb = DrizzleD1Database<typeof schema>;

export function createDb(binding: D1Database): IusiaDb {
  return drizzle(binding, { schema });
}

export { schema };
