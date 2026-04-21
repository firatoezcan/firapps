import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { render } from "@react-email/render";
import * as React from "react";

type RenderedMail = {
  html: string;
  subject: string;
  text: string;
};

type AuthMailTemplateProps = {
  actionLabel: string;
  actionUrl: string;
  eyebrow: string;
  footer: string;
  intro: string;
  preview: string;
  title: string;
};

function AuthMailTemplate({
  actionLabel,
  actionUrl,
  eyebrow,
  footer,
  intro,
  preview,
  title,
}: AuthMailTemplateProps) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Section style={heroStyle}>
            <Text style={eyebrowStyle}>{eyebrow}</Text>
            <Heading as="h1" style={headingStyle}>
              {title}
            </Heading>
            <Text style={introStyle}>{intro}</Text>
          </Section>
          <Section style={buttonSectionStyle}>
            <Button href={actionUrl} style={buttonStyle}>
              {actionLabel}
            </Button>
          </Section>
          <Text style={linkCopyStyle}>{actionUrl}</Text>
          <Hr style={dividerStyle} />
          <Text style={footerStyle}>{footer}</Text>
        </Container>
      </Body>
    </Html>
  );
}

async function renderMail(input: AuthMailTemplateProps & { subject: string }) {
  const html = await render(<AuthMailTemplate {...input} />);

  return {
    html,
    subject: input.subject,
    text: [input.title, input.intro, `${input.actionLabel}: ${input.actionUrl}`, input.footer].join(
      "\n\n",
    ),
  } satisfies RenderedMail;
}

function resolveCustomerRoute(
  customerWebUrl: string,
  callbackUrl: string | null,
  fallbackPath: string,
) {
  const customerBase = new URL(customerWebUrl);

  if (!callbackUrl) {
    return new URL(fallbackPath, customerBase);
  }

  try {
    const callbackTarget = new URL(callbackUrl, customerBase);

    if (callbackTarget.origin !== customerBase.origin) {
      return new URL(fallbackPath, customerBase);
    }

    return callbackTarget;
  } catch {
    return new URL(fallbackPath, customerBase);
  }
}

export function buildVerificationUrl(customerWebUrl: string, actionUrl: string) {
  const actionTarget = new URL(actionUrl);
  const token = actionTarget.searchParams.get("token");
  const callbackUrl = actionTarget.searchParams.get("callbackURL");
  const target = new URL("/post-verify", customerWebUrl);

  if (token) {
    target.searchParams.set("token", token);
  }

  target.searchParams.set(
    "next",
    resolveCustomerRoute(customerWebUrl, callbackUrl, "/").toString(),
  );

  return target.toString();
}

export function buildPasswordResetUrl(customerWebUrl: string, actionUrl: string) {
  const actionTarget = new URL(actionUrl);
  const callbackUrl = actionTarget.searchParams.get("callbackURL");
  const target = resolveCustomerRoute(customerWebUrl, callbackUrl, "/reset-password");
  const token = actionTarget.pathname.split("/").at(-1);

  if (token) {
    target.searchParams.set("token", token);
  }

  return target.toString();
}

export function buildInvitationUrl(customerWebUrl: string, invitationId: string) {
  return new URL(`/invite/${invitationId}`, customerWebUrl).toString();
}

export async function renderVerificationMail({
  actionUrl,
  recipientName,
}: {
  actionUrl: string;
  recipientName: string;
}) {
  return renderMail({
    actionLabel: "Verify email",
    actionUrl,
    eyebrow: "firapps account verification",
    footer: "This link verifies the email address on your local firapps account.",
    intro: `${recipientName}, verify your email address to finish the signup flow and continue into organization setup.`,
    preview: "Verify your email to finish your firapps signup.",
    subject: "Verify your firapps email",
    title: "Finish your signup",
  });
}

export async function renderPasswordResetMail({
  actionUrl,
  recipientName,
}: {
  actionUrl: string;
  recipientName: string;
}) {
  return renderMail({
    actionLabel: "Reset password",
    actionUrl,
    eyebrow: "firapps password reset",
    footer: "This reset link only affects your local firapps development account.",
    intro: `${recipientName}, use this link to choose a new password for your firapps account.`,
    preview: "Reset your firapps password.",
    subject: "Reset your firapps password",
    title: "Choose a new password",
  });
}

export async function renderOrganizationInvitationMail({
  actionUrl,
  organizationName,
  recipientEmail,
  role,
  senderLabel,
}: {
  actionUrl: string;
  organizationName: string;
  recipientEmail: string;
  role: string;
  senderLabel: string;
}) {
  return renderMail({
    actionLabel: "Open invitation",
    actionUrl,
    eyebrow: "firapps organization invitation",
    footer:
      "You will need to verify your email before accepting this invitation if your account is not verified yet.",
    intro: `${senderLabel} invited ${recipientEmail} to join ${organizationName} as ${role}.`,
    preview: `Join ${organizationName} on firapps.`,
    subject: `Invitation to join ${organizationName}`,
    title: "Join the organization",
  });
}

const bodyStyle: React.CSSProperties = {
  backgroundColor: "#f4f4f5",
  fontFamily:
    '"Geist Variable", Geist, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  margin: 0,
  padding: "32px 0",
};

const containerStyle: React.CSSProperties = {
  backgroundColor: "#ffffff",
  border: "1px solid #e4e4e7",
  borderRadius: "24px",
  margin: "0 auto",
  maxWidth: "560px",
  padding: "32px",
};

const heroStyle: React.CSSProperties = {
  paddingBottom: "8px",
};

const eyebrowStyle: React.CSSProperties = {
  color: "#71717a",
  fontSize: "12px",
  letterSpacing: "0.2em",
  margin: "0 0 12px",
  textTransform: "uppercase",
};

const headingStyle: React.CSSProperties = {
  color: "#09090b",
  fontSize: "28px",
  fontWeight: 700,
  letterSpacing: "-0.03em",
  lineHeight: 1.1,
  margin: "0 0 16px",
};

const introStyle: React.CSSProperties = {
  color: "#3f3f46",
  fontSize: "15px",
  lineHeight: 1.7,
  margin: 0,
};

const buttonSectionStyle: React.CSSProperties = {
  padding: "24px 0 12px",
};

const buttonStyle: React.CSSProperties = {
  backgroundColor: "#18181b",
  borderRadius: "999px",
  color: "#fafafa",
  display: "inline-block",
  fontSize: "14px",
  fontWeight: 600,
  padding: "14px 22px",
  textDecoration: "none",
};

const linkCopyStyle: React.CSSProperties = {
  color: "#71717a",
  fontSize: "13px",
  lineHeight: 1.6,
  margin: "0 0 8px",
  wordBreak: "break-all",
};

const dividerStyle: React.CSSProperties = {
  borderColor: "#e4e4e7",
  margin: "24px 0 20px",
};

const footerStyle: React.CSSProperties = {
  color: "#71717a",
  fontSize: "13px",
  lineHeight: 1.6,
  margin: 0,
};
