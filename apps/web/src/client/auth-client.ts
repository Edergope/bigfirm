import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";

/** Cliente de Better Auth. IUSIA no implementa login propio. */
export const authClient = createAuthClient({
  basePath: "/api/auth",
  plugins: [organizationClient()],
});

export const { useSession, signIn, signUp, signOut } = authClient;
