# Better Auth Requirements Spec

Status: implementation-driving handoff for the `freestyle/devboxes-local-saas` lane.

This file defines what the local-SaaS auth slice must do before implementation.
It is intentionally specific so later agents can build and verify against it
instead of inventing their own auth shape.

## 1. Product Goal

Turn `firapps` into a usable local-only SaaS skeleton with real account,
session, organization, membership, and invitation behavior.

For this lane, "usable" means:

- a new local user can create an account
- that account can create or own an organization
- an owner/admin can invite another member by email
- invite, verification, and reset emails render from repo-owned templates and
  land in Mailpit
- the invitee can complete the flow in the browser and end up as a real member
- the frontend and backend both rely on the same auth/session/org source of
  truth

## 2. Mandatory Solution Decision

Better Auth is mandatory.

This is not negotiable for this lane:

- Better Auth must be the only auth/session/account solution in `firapps`.
- Better Auth must be the source of truth for:
  - user accounts
  - sessions
  - email verification
  - password reset
  - organization membership and invitation lifecycle
- No new homewritten auth stack is allowed.
- No new bespoke session tokens, password logic, invite token logic, or custom
  auth database ownership is allowed outside Better Auth.
- Existing hand-rolled auth-like code in `internal-api` is transitional only.
  It must either be replaced by Better Auth ownership or be reduced to app-side
  orchestration around Better Auth APIs and tables.
- If existing `operations.users`, `organization_memberships`, or
  `organization_invitations` tables cannot be cleanly owned by official Better
  Auth adapters/plugins, they must stop being the source of truth.

## 3. Current Starting Point

The repo already has a partial homegrown identity slice in `apps/internal-api`
for `users`, `organizations`, `organization_memberships`, and
`organization_invitations`, plus a console-log mail transport.

That is not the target.

The target is:

- Better Auth-backed auth and session handling
- Better Auth-backed organization and invitation lifecycle
- React Email-rendered mail content
- Mailpit delivery in local dev
- frontend flows that use Better Auth client/session semantics instead of
  custom request choreography where Better Auth already provides the behavior

## 4. Scope For This Lane

Required in this lane:

- email/password sign-up
- email/password sign-in
- sign-out
- session restoration in the browser
- email verification
- forgot-password / reset-password flow
- organization creation
- owner/admin invitation flow
- invitation acceptance flow for:
  - a brand-new user
  - an already-existing user on the invited email
- membership listing
- pending invitation listing
- active organization context for the signed-in user

Explicitly out of scope for this first auth pass unless the docs-research agent
finds a zero-friction official Better Auth path that materially reduces work:

- social login
- enterprise SSO
- passkeys
- two-factor auth
- teams inside organizations
- custom RBAC beyond `owner`, `admin`, and `member`
- platform or cluster deployment ownership in `firapps`

## 5. Required Auth Flows

### 5.1 Owner Sign-up And Organization Bootstrap

The product must support a first user creating an account and becoming the
owner of a new organization.

Minimum expected UX:

- the user enters:
  - display name
  - email
  - password
  - organization name
  - organization slug
- the resulting state creates:
  - a Better Auth user
  - a Better Auth-backed session
  - an organization
  - an owner membership
- the org slug must be unique
- the owner must become the active organization immediately or by the first
  post-sign-up redirect

### 5.2 Sign-in / Sign-out / Session Restore

The product must support:

- sign-in with email and password
- sign-out from the current session
- restoring the session on refresh
- reading the signed-in user and active organization in both frontend shells

### 5.3 Email Verification

Email verification is required in this lane.

Expected outcome:

- sign-up triggers a verification email
- the verification email lands in Mailpit
- the user can complete verification from a browser link or another official
  Better Auth-supported mechanism
- an unverified user must not be able to silently bypass verification for
  invite acceptance or authenticated org-management behavior

### 5.4 Password Reset

The product must support:

- requesting a reset by email
- receiving the reset email in Mailpit
- completing the reset in the browser
- signing in with the new password afterward

### 5.5 Invitation Flow

The product must support the full invitation loop:

- an authenticated owner or admin sends an invitation to an email address
- the invitation is persisted in the database
- the invite email lands in Mailpit
- the invite link opens a real frontend route
- a brand-new invitee can create an account and then accept the invitation
- an existing user can sign in and then accept the invitation
- acceptance creates the org membership if one does not already exist
- acceptance must not create duplicate memberships
- acceptance must fail clearly if the session email does not match the invited
  email

Invite lifecycle controls required in this pass:

- create invitation
- list invitations
- accept invitation
- cancel invitation
- reject invitation
- resend invitation if Better Auth supports it cleanly

## 6. Organization / Member / Invite Behavior

The product behavior must follow these business rules in the first pass:

- The initial role set is exactly:
  - `owner`
  - `admin`
  - `member`
- `owner` can create the org, invite users, view members, and manage pending
  invites.
- `admin` can invite users and view members/invites.
- `member` is authenticated but cannot send invites.
- Only one pending invitation per email per organization may exist at a time.
- The same email may belong to multiple organizations over time.
- A user may end up with memberships in multiple organizations; the auth layer
  must preserve an active-organization concept instead of assuming one global
  org forever.
- Organization membership and invitation truth must come from Better Auth's
  official organization support, not from separate custom write paths.
- We do not ship custom team logic in this pass.

## 7. Frontend / Backend Ownership Boundary

### Frontend ownership

`apps/customer-web` owns:

- sign-up UI
- sign-in UI
- verify-email completion UI if the flow lands in the customer app
- forgot/reset-password UI
- invite acceptance UI for invited end users
- session-aware customer-facing shell behavior

`apps/admin-web` owns:

- signed-in owner/admin experience
- organization overview
- member list UI
- invitation list UI
- invitation creation, cancel, and resend UI if resend ships in pass one

Both frontends must:

- use Better Auth client/session primitives instead of inventing a parallel
  auth client
- treat Better Auth session/org state as canonical
- avoid storing auth state in custom browser persistence when Better Auth
  session APIs already provide it

### Backend ownership

`apps/internal-api` owns:

- the canonical Better Auth server configuration unless official docs prove a
  different mount topology is required
- Better Auth database adapter wiring
- Better Auth organization plugin wiring
- Better Auth email callbacks/hooks needed for:
  - verification emails
  - reset emails
  - invitation emails
- app-side protected endpoints that depend on the Better Auth session and org
  membership
- migrations and seed behavior for the auth/org slice

`apps/public-api` stays out of the auth write path in this pass unless a later
task explicitly expands its responsibility.

## 8. Local-Only Constraints

This lane is local-first and local-only.

Requirements:

- no production-only assumptions
- no hosted auth vendor other than Better Auth libraries running in-repo
- no external email provider
- no OAuth/SAML provider setup
- no dependency on cloud DNS or public callback URLs
- the full flow must work on localhost/devboxes-local addresses
- the flow must work against the repo's local Postgres runtime
- the auth slice must remain product-repo code, not platform/GitOps material

Local delivery expectations:

- Mailpit is the local mail sink
- emails must be sent to Mailpit, not just logged to stdout
- the current log-only mail transport is insufficient
- the frontend flow must be testable against Mailpit inbox contents in local
  development

## 9. Mailpit And React Email Expectations

Mail and templating are part of this lane, not optional polish.

Required:

- auth-related emails are rendered from repo-owned React Email templates
- at minimum, templates exist for:
  - email verification
  - organization invitation
  - password reset
- the backend mail-sending layer must be able to render those templates to HTML
  and plain text
- local delivery must go to Mailpit via a real mail transport path
- emails must contain the actual Better Auth-generated action URL or the
  official token/callback shape required by Better Auth
- the invite email must clearly identify:
  - inviter
  - organization name
  - invited role
  - acceptance action

Not acceptable:

- console-only fake mail success
- hardcoded invitation text without template ownership
- a separate non-React-Email invite system for auth emails

## 10. Minimum Verification Proof

The slice is not done until the following proof exists and is rerunnable.

### Self-contained proof

- `vp install`
- `vp check`
- `vp run -r build`

### Runtime proof

- Postgres starts locally
- Better Auth and app migrations apply successfully
- the auth server starts without schema/runtime errors
- Mailpit is reachable locally

### Browser proof

At minimum, one rerunnable browser-driven proof must show:

1. owner signs up with email/password and org details
2. verification email arrives in Mailpit
3. owner verifies email
4. owner signs in to the admin surface
5. owner sends an invite
6. invitation email arrives in Mailpit and uses the React Email template
7. invitee follows the link
8. invitee signs up or signs in
9. invitee accepts the invitation
10. admin surface or protected API shows the resulting membership

### Additional runtime checks required

- forgot-password email arrives in Mailpit
- reset completes successfully
- sign-in works with the new password
- duplicate membership creation is prevented
- duplicate pending invite creation is prevented

Playwright is the expected vehicle for the browser proof unless the docs-research
agent finds a repo-consistent better option.

## 11. Non-Negotiable Implementation Rules

- Better Auth must stay the canonical auth boundary.
- We do not ship a parallel custom auth API "for now".
- We do not keep duplicate truth between Better Auth tables and custom org/user
  tables.
- If app-specific endpoints are kept, they must read/write through Better Auth's
  canonical state rather than duplicate it.
- Frontend auth flows must be implemented against official Better Auth client
  patterns.
- Backend auth flows must be implemented against official Better Auth adapters,
  plugins, handlers, and documented extension points.

## 12. Open Questions For The Better Auth Docs-Research Agent

The next agent must answer these against official Better Auth docs only.
No blog posts, no guesswork, no community hearsay unless the official docs are
silent and that is called out explicitly.

1. What is the best official topology for this repo shape:
   two TanStack Start frontends plus Hono backends?
   Specifically:
   - should the canonical Better Auth handler live in `internal-api`
   - or should it be mounted inside a TanStack Start route
   - or is a hybrid approach officially recommended
2. For our localhost multi-port setup, what are the exact official Better Auth
   cookie and client requirements?
   Resolve:
   - `credentials: include`
   - CORS expectations
   - `SameSite` behavior
   - whether `tanstackStartCookies` is required here
3. Which official Better Auth plugin set is required for this spec?
   Confirm the exact role of:
   - email/password auth
   - organization plugin
   - email verification support
   - password reset support
   - any TanStack Start cookie plugin
4. What is the official Better Auth invitation happy path for a new invited
   user?
   Resolve:
   - whether invite acceptance must happen only after login
   - how the invitation identifier is passed through the frontend
   - how to resume acceptance after sign-up/sign-in
5. What is the cleanest official Drizzle adapter setup for an existing repo
   that already uses Drizzle-generated SQL migrations and a nontrivial schema
   layout?
   Resolve:
   - config file placement
   - CLI command path
   - table/model name mapping
   - field mapping
   - non-default PostgreSQL schema support
6. Can Better Auth cleanly own the current `users`, `organizations`,
   `organization_memberships`, and `organization_invitations` data shape
   through official schema/model mapping, or is replacement/migration the
   cleaner path?
7. What official Better Auth callbacks or hooks should be used for:
   - verification email
   - reset email
   - invitation email
     and what payload does each callback receive?
8. What is the officially recommended frontend client usage for:
   - session lookup
   - active organization lookup
   - sign-up
   - sign-in
   - sign-out
   - invite acceptance
9. Are there official Better Auth constraints or caveats around:
   - active organization switching
   - multi-organization membership
   - role customization beyond built-in org roles
     that affect our first-pass design?
10. What is the exact migration workflow we should use so Better Auth schema
    changes remain compatible with this repo's Drizzle and `vp` workflow rather
    than introducing an ad hoc side path?

## 13. Expected Outcome If This Spec Is Followed

If the implementation agent follows this spec correctly, `firapps` will have a
real local SaaS auth spine instead of demo-only seeded organization endpoints,
and the repo will be positioned to grow product features on top of Better Auth
instead of rewriting auth again later.
