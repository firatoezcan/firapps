import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";

import { createMailTransport, readMailEnv } from "@firapps/backend-common";

import { internalApiEnv, listAllowedOrigins } from "./config.js";
import { betterAuthSchema } from "./db/schema.js";
import { runtime } from "./db/runtime.js";
import {
  buildPasswordResetUrl,
  buildInvitationUrl,
  buildVerificationUrl,
  renderOrganizationInvitationMail,
  renderPasswordResetMail,
  renderVerificationMail,
} from "./mail.js";

const allowedOrigins = listAllowedOrigins();
const mailTransport = createMailTransport(readMailEnv());
const advancedOptions = {
  database: {
    generateId: "uuid" as const,
  },
  ...(internalApiEnv.BETTER_AUTH_COOKIE_DOMAIN
    ? {
        crossSubDomainCookies: {
          enabled: true,
          domain: internalApiEnv.BETTER_AUTH_COOKIE_DOMAIN,
        },
      }
    : {}),
};

function deliverMail(promise: Promise<void>) {
  promise.catch((error) => {
    console.error("[internal-api] failed to deliver auth mail", error);
  });
}

export const auth = betterAuth({
  appName: "firapps",
  advanced: advancedOptions,
  baseURL: internalApiEnv.AUTH_BASE_URL,
  secret: internalApiEnv.BETTER_AUTH_SECRET,
  trustedOrigins: allowedOrigins,
  database: drizzleAdapter(runtime.db, {
    provider: "pg",
    schema: betterAuthSchema,
  }),
  user: {
    modelName: "users",
  },
  session: {
    modelName: "sessions",
  },
  account: {
    modelName: "accounts",
  },
  verification: {
    modelName: "verifications",
  },
  emailAndPassword: {
    enabled: true,
    maxPasswordLength: 128,
    minPasswordLength: 8,
    requireEmailVerification: true,
    sendResetPassword: async ({ url, user }) => {
      const message = await renderPasswordResetMail({
        actionUrl: buildPasswordResetUrl(internalApiEnv.CUSTOMER_WEB_URL, url),
        recipientName: user.name ?? user.email,
      });

      deliverMail(
        mailTransport.send({
          html: message.html,
          subject: message.subject,
          text: message.text,
          to: user.email,
        }),
      );
    },
  },
  emailVerification: {
    autoSignInAfterVerification: true,
    sendOnSignIn: true,
    sendOnSignUp: true,
    sendVerificationEmail: async ({ url, user }) => {
      const message = await renderVerificationMail({
        actionUrl: buildVerificationUrl(internalApiEnv.CUSTOMER_WEB_URL, url),
        recipientName: user.name ?? user.email,
      });

      deliverMail(
        mailTransport.send({
          html: message.html,
          subject: message.subject,
          text: message.text,
          to: user.email,
        }),
      );
    },
  },
  plugins: [
    organization({
      cancelPendingInvitationsOnReInvite: true,
      invitationExpiresIn: 60 * 60 * 24 * 7,
      requireEmailVerificationOnInvitation: true,
      schema: {
        invitation: {
          modelName: "organization_invitations",
        },
        member: {
          modelName: "organization_memberships",
        },
        organization: {
          modelName: "organizations",
        },
      },
      async sendInvitationEmail(data) {
        const inviteUrl = buildInvitationUrl(internalApiEnv.CUSTOMER_WEB_URL, data.id);
        const senderLabel = data.inviter.user.name ?? data.inviter.user.email;
        const normalizedRole = Array.isArray(data.role)
          ? data.role.join(", ")
          : (data.role ?? "member");
        const message = await renderOrganizationInvitationMail({
          actionUrl: inviteUrl,
          organizationName: data.organization.name,
          recipientEmail: data.email,
          role: normalizedRole,
          senderLabel,
        });

        deliverMail(
          mailTransport.send({
            html: message.html,
            metadata: {
              invitationId: data.id,
              organizationId: data.organization.id,
              role: normalizedRole,
            },
            subject: message.subject,
            text: message.text,
            to: data.email,
          }),
        );
      },
    }),
  ],
});
