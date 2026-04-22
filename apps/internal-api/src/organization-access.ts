import { and, eq } from "drizzle-orm";
import type { Context } from "hono";

import { auth } from "./auth.js";
import { runtime } from "./db/runtime.js";
import { organizationMemberships } from "./db/schema.js";

const organizationAdminRoles = new Set(["owner", "admin"]);

export type OrganizationAccess = {
  organizationId: string;
  role: string;
  session: NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;
};

type OrganizationAccessResult =
  | {
      access: OrganizationAccess;
      response?: never;
    }
  | {
      access?: never;
      response: Response;
    };

export async function requireOrganizationAccess(
  c: Context,
  options?: {
    requireAdmin?: boolean;
  },
): Promise<OrganizationAccessResult> {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    return {
      response: c.json({ error: "unauthorized" }, 401),
    };
  }

  const organizationId = session.session.activeOrganizationId;

  if (!organizationId) {
    return {
      response: c.json({ error: "active_organization_required" }, 403),
    };
  }

  const [membership] = await runtime.db
    .select({
      role: organizationMemberships.role,
    })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, session.user.id),
      ),
    )
    .limit(1);

  if (!membership) {
    return {
      response: c.json({ error: "organization_membership_required" }, 403),
    };
  }

  if (options?.requireAdmin && !organizationAdminRoles.has(membership.role)) {
    return {
      response: c.json({ error: "forbidden" }, 403),
    };
  }

  c.get("log").set({
    auth: {
      organizationId,
      role: membership.role,
      userId: session.user.id,
    },
  });

  return {
    access: {
      organizationId,
      role: membership.role,
      session,
    },
  };
}
