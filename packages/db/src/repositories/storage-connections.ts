import { and, eq } from "drizzle-orm";
import { newId } from "@iusia/domain";
import type { IusiaDb } from "../client.js";
import { organizationStorageConnections, platformStorageConnections } from "../schema/iusia.js";

export class StorageConnectionRepository {
  constructor(private readonly db: IusiaDb) {}

  async findOrganization(organizationId: string) {
    const [row] = await this.db.select().from(organizationStorageConnections)
      .where(and(eq(organizationStorageConnections.organizationId, organizationId), eq(organizationStorageConnections.provider, "GOOGLE_DRIVE"), eq(organizationStorageConnections.status, "ACTIVE"))).limit(1);
    return row ?? null;
  }

  async findPlatform() {
    const [row] = await this.db.select().from(platformStorageConnections)
      .where(and(eq(platformStorageConnections.provider, "GOOGLE_DRIVE"), eq(platformStorageConnections.status, "ACTIVE"))).limit(1);
    return row ?? null;
  }

  async upsertOrganization(input: { organizationId: string; accountId: string; storageOwnerUserId: string }) {
    const now = new Date().toISOString();
    await this.db.insert(organizationStorageConnections).values({ id: newId("driveFolder"), provider: "GOOGLE_DRIVE", status: "ACTIVE", createdAt: now, updatedAt: now, ...input })
      .onConflictDoUpdate({ target: [organizationStorageConnections.organizationId, organizationStorageConnections.provider], set: { accountId: input.accountId, storageOwnerUserId: input.storageOwnerUserId, status: "ACTIVE", updatedAt: now } });
  }

  async upsertPlatform(input: { accountId: string; storageOwnerUserId: string }) {
    const now = new Date().toISOString();
    await this.db.insert(platformStorageConnections).values({ id: newId("driveFolder"), provider: "GOOGLE_DRIVE", status: "ACTIVE", createdAt: now, updatedAt: now, ...input })
      .onConflictDoUpdate({ target: platformStorageConnections.provider, set: { accountId: input.accountId, storageOwnerUserId: input.storageOwnerUserId, status: "ACTIVE", updatedAt: now } });
  }
}
