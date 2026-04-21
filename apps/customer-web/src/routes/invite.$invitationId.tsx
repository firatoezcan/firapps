import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";
import { ArrowRight, LogOut, MailPlus, UserPlus } from "lucide-react";

import {
  AppPage,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  StatusPill,
} from "@firapps/ui";
import { Button } from "@firapps/ui/components/button";

import { authClient } from "../lib/auth-client";
import {
  buildCustomerPath,
  buildCustomerUrl,
  isEmailNotVerifiedError,
  toErrorMessage,
  toRoleLabel,
} from "../lib/customer-auth";

type InvitationRecord = NonNullable<
  Awaited<ReturnType<typeof authClient.organization.getInvitation>>["data"]
>;

type InvitationDetails = {
  id: InvitationRecord["id"];
  email: InvitationRecord["email"];
  role: InvitationRecord["role"];
  status: InvitationRecord["status"];
  expiresAt: string;
  organizationId: InvitationRecord["organizationId"];
  organizationName: string;
  organizationSlug: string;
  inviterEmail: string;
};

export const Route = createFileRoute("/invite/$invitationId")({
  component: InvitationRoute,
});

function InvitationRoute() {
  const navigate = useNavigate();
  const params = Route.useParams();
  const sessionQuery = authClient.useSession();

  const session = sessionQuery.data;

  const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
  const [loadStatus, setLoadStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    message: string;
    tone: "danger" | "success";
  } | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");

  const [signUpName, setSignUpName] = useState("");
  const [signUpEmail, setSignUpEmail] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");

  useEffect(() => {
    if (!session) {
      setInvitation(null);
      setLoadStatus("idle");
      setLoadError(null);
      return;
    }

    void loadInvitation();
  }, [params.invitationId, session?.session.id]);

  async function loadInvitation() {
    setLoadStatus("loading");
    setLoadError(null);

    try {
      const result = await authClient.organization.getInvitation({
        query: {
          id: params.invitationId,
        },
      });

      if (result.error) {
        throw result.error;
      }

      setInvitation(result.data ? toInvitationDetails(result.data) : null);
      setLoadStatus("ready");
    } catch (caughtError) {
      setLoadError(
        toErrorMessage(
          caughtError,
          "Unable to load the invitation for the current Better Auth session.",
        ),
      );
      setLoadStatus("error");
      setInvitation(null);
    }
  }

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setBusyAction("sign-in");
    setNotice(null);

    try {
      const normalizedEmail = signInEmail.trim().toLowerCase();
      const result = await authClient.signIn.email({
        email: normalizedEmail,
        password: signInPassword,
      });

      if (result.error) {
        if (isEmailNotVerifiedError(result.error)) {
          await navigate({
            to: "/verification-pending",
            search: {
              email: normalizedEmail,
              next: buildCustomerPath(`/invite/${params.invitationId}`),
            },
          });
          return;
        }

        throw result.error;
      }

      await sessionQuery.refetch();
    } catch (caughtError) {
      setNotice({
        message: toErrorMessage(caughtError, "Unable to sign in."),
        tone: "danger",
      });
    } finally {
      setBusyAction(null);
      setSignInPassword("");
    }
  }

  async function handleSignUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setBusyAction("sign-up");
    setNotice(null);

    try {
      const normalizedEmail = signUpEmail.trim().toLowerCase();
      const result = await authClient.signUp.email({
        callbackURL: buildCustomerUrl(`/invite/${params.invitationId}`),
        email: normalizedEmail,
        name: signUpName.trim(),
        password: signUpPassword,
      });

      if (result.error) {
        throw result.error;
      }

      await navigate({
        to: "/verification-pending",
        search: {
          email: normalizedEmail,
          next: buildCustomerPath(`/invite/${params.invitationId}`),
        },
      });
    } catch (caughtError) {
      setNotice({
        message: toErrorMessage(caughtError, "Unable to create the invited account."),
        tone: "danger",
      });
    } finally {
      setBusyAction(null);
      setSignUpPassword("");
    }
  }

  async function handleAcceptInvitation() {
    setBusyAction("accept");
    setNotice(null);

    try {
      const result = await authClient.organization.acceptInvitation({
        invitationId: params.invitationId,
      });

      if (result.error) {
        throw result.error;
      }

      setNotice({
        message: "Invitation accepted. The organization is now active on your session.",
        tone: "success",
      });
      setInvitation((current) =>
        current
          ? {
              ...current,
              status: "accepted",
            }
          : current,
      );
      setLoadError(null);
      setLoadStatus("ready");
      await sessionQuery.refetch();
    } catch (caughtError) {
      setNotice({
        message: toErrorMessage(caughtError, "Unable to accept the invitation."),
        tone: "danger",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRejectInvitation() {
    setBusyAction("reject");
    setNotice(null);

    try {
      const result = await authClient.organization.rejectInvitation({
        invitationId: params.invitationId,
      });

      if (result.error) {
        throw result.error;
      }

      setNotice({
        message: "Invitation rejected.",
        tone: "success",
      });
      setInvitation((current) =>
        current
          ? {
              ...current,
              status: "rejected",
            }
          : current,
      );
      setLoadError(null);
      setLoadStatus("ready");
    } catch (caughtError) {
      setNotice({
        message: toErrorMessage(caughtError, "Unable to reject the invitation."),
        tone: "danger",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSignOut() {
    setBusyAction("sign-out");
    setNotice(null);

    try {
      const result = await authClient.signOut();

      if (result.error) {
        throw result.error;
      }

      setInvitation(null);
      setLoadStatus("idle");
      await sessionQuery.refetch();
    } catch (caughtError) {
      setNotice({
        message: toErrorMessage(caughtError, "Unable to sign out."),
        tone: "danger",
      });
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <AppPage
      eyebrow="Customer web"
      title="Accept a Better Auth organization invitation"
      description="Create or sign into the invited account, verify the email if required, then accept the organization membership."
      actions={
        session ? (
          <Button onClick={() => void handleSignOut()} type="button" variant="outline">
            <LogOut className="size-4" />
            Sign out
          </Button>
        ) : null
      }
    >
      {notice ? <InlineNotice message={notice.message} tone={notice.tone} /> : null}

      {!session ? (
        <div className="grid gap-5 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MailPlus className="size-5" />
                Sign in with the invited email
              </CardTitle>
              <CardDescription>
                If this email already exists, sign in first. Unverified accounts are sent back
                through the verification route.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleSignIn}>
                <Field
                  autoComplete="email"
                  label="Email"
                  onChange={(event) => setSignInEmail(event.target.value)}
                  required
                  type="email"
                  value={signInEmail}
                />
                <Field
                  autoComplete="current-password"
                  label="Password"
                  onChange={(event) => setSignInPassword(event.target.value)}
                  required
                  type="password"
                  value={signInPassword}
                />
                <Button disabled={busyAction === "sign-in"} type="submit">
                  {busyAction === "sign-in" ? "Signing in..." : "Sign in"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserPlus className="size-5" />
                Create the invited account
              </CardTitle>
              <CardDescription>
                Use the exact invited email address. After verification, this route resumes and lets
                you accept the invitation.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleSignUp}>
                <Field
                  autoComplete="name"
                  label="Display name"
                  onChange={(event) => setSignUpName(event.target.value)}
                  required
                  value={signUpName}
                />
                <Field
                  autoComplete="email"
                  label="Email"
                  onChange={(event) => setSignUpEmail(event.target.value)}
                  required
                  type="email"
                  value={signUpEmail}
                />
                <Field
                  autoComplete="new-password"
                  label="Password"
                  onChange={(event) => setSignUpPassword(event.target.value)}
                  required
                  type="password"
                  value={signUpPassword}
                />
                <Button disabled={busyAction === "sign-up"} type="submit">
                  {busyAction === "sign-up" ? "Creating account..." : "Create account"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="mx-auto max-w-3xl space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Current Better Auth session</CardTitle>
              <CardDescription>
                Signed in as {session.user.email}. This must match the invitation recipient before
                Better Auth will reveal the invite details.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>Email verified: {session.user.emailVerified ? "yes" : "no"}</p>
              <p>User id: {session.user.id}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Invitation state</CardTitle>
              <CardDescription>
                Better Auth only exposes the invitation when the signed-in email matches the invited
                recipient.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {loadStatus === "loading" ? (
                <p className="text-sm text-muted-foreground">Loading invitation...</p>
              ) : null}

              {loadError ? <InlineNotice message={loadError} tone="danger" /> : null}

              {invitation ? (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-border/70 bg-muted/30 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">{invitation.organizationName}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {invitation.email} invited by {invitation.inviterEmail}
                        </p>
                      </div>
                      <StatusPill tone={invitation.status === "pending" ? "warning" : "success"}>
                        {invitation.status}
                      </StatusPill>
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground">
                      Role: {toRoleLabel(invitation.role)}. Slug: {invitation.organizationSlug}.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <Button
                      disabled={busyAction === "accept" || invitation.status !== "pending"}
                      onClick={() => void handleAcceptInvitation()}
                      type="button"
                    >
                      {busyAction === "accept" ? "Accepting..." : "Accept invitation"}
                    </Button>
                    <Button
                      disabled={busyAction === "reject" || invitation.status !== "pending"}
                      onClick={() => void handleRejectInvitation()}
                      type="button"
                      variant="outline"
                    >
                      {busyAction === "reject" ? "Rejecting..." : "Reject invitation"}
                    </Button>
                    <Button asChild type="button" variant="outline">
                      <Link to="/">
                        Customer home
                        <ArrowRight className="size-4" />
                      </Link>
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      )}
    </AppPage>
  );
}

function toInvitationDetails(invitation: InvitationRecord): InvitationDetails {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    status: invitation.status,
    expiresAt: invitation.expiresAt.toISOString(),
    organizationId: invitation.organizationId,
    organizationName: invitation.organization?.name ?? invitation.organizationId,
    organizationSlug: invitation.organization?.slug ?? "",
    inviterEmail: invitation.inviter?.user?.email ?? "unknown inviter",
  };
}

function Field({
  label,
  ...props
}: { label: string } & Omit<React.ComponentProps<"input">, "className">) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <input
        className="h-11 w-full rounded-xl border border-border/70 bg-background px-3 text-sm outline-none transition focus:border-foreground/30 focus:ring-2 focus:ring-primary/15"
        {...props}
      />
    </label>
  );
}

function InlineNotice({ message, tone }: { message: string; tone: "danger" | "success" }) {
  const toneClass =
    tone === "danger"
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700";

  return <div className={`rounded-xl border px-3 py-2 text-sm ${toneClass}`}>{message}</div>;
}
