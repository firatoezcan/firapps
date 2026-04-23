# Claude Design Structural Hierarchy Prompt

Paste the block below into Claude Design. This prompt is for structural
hierarchy and navigation clarity, not for inventing a new product scope.

```text
You are redesigning the structural hierarchy of an existing SaaS product with two frontends:

1. an admin control-plane app
2. a customer workspace app

This is not a greenfield concept. Do not invent a different product. Do not turn it into a dashboard template. Do not give me generic SaaS cards with no information architecture.

The product is a high-trust, local-first, unattended engineering execution product. It is more “serious control plane” than “AI toy.” It has a customer side and an admin side. The visual system is being handled separately. Your job is structural hierarchy, navigation, grouping, page flow, and action priority.

## Product truth

The product currently supports:
- Better Auth sign-up, sign-in, verification, invitations, password reset, org membership
- project registration
- Blueprint creation and selection
- run dispatch
- run queue and run detail
- pull request visibility
- devbox / workspace visibility
- member roster and invitation management
- operator / runtime visibility
- billing placeholder surfaces

The product is not:
- a browser IDE product
- a general project management suite
- a consumer app

## Current frontend split

### Admin app

Purpose:
- founder / owner / admin control plane
- project inventory and repository bindings
- Blueprint registry
- run dispatch and queue management
- pull request visibility
- devbox inventory
- member / invitation management
- operator/runtime health
- billing placeholder state

Current admin routes:
- `/` = thin redirect into `/control-plane`
- `/control-plane`
- `/projects`
- `/blueprints`
- `/devboxes`
- `/runs`
- `/runs/$runId`
- `/queue`
- `/pull-requests`
- `/members`
- `/billing`
- `/activity`
- `/operators`

### Customer app

Purpose:
- member / reviewer workspace
- my work dashboard
- my runs
- my pull requests
- invitation handling
- organization visibility
- account/session state

Current customer routes:
- `/` = my work dashboard
- `/runs`
- `/runs/$runId`
- `/pull-requests`
- `/invitations`
- `/organization`
- `/account`
- auth flows: sign-in, sign-up, verification-pending, post-verify, forgot-password, reset-password, invitation acceptance

## The actual UX problem

The current frontends are hard to navigate.

The structural issues include:
- too many surfaces fighting for equal weight
- page-body navigation competing with page content
- “route map” style blocks inside the main content area
- overview pages trying to do the jobs of action pages
- weak separation between overview pages and action pages
- actions that are buried instead of clearly prioritized
- too many summary cards before the user gets to the operational table or detail surface
- insufficient distinction between “decide what to do” pages and “do the work” pages
- admin and customer surfaces do not feel clearly separated in intent
- the dashboard and feature pages feel more like collections of sections than a coherent flow

## What I want from you

Redesign the structural hierarchy of the product.

I want:
- a clearer global navigation model
- better distinction between overview, queue, inventory, and detail pages
- clearer page intros
- clearer primary and secondary actions
- more obvious scanning order
- fewer equal-priority blocks
- more coherent section sequencing
- cleaner list/detail relationships
- explicit “next action” and “why this page exists” hierarchy

## Constraints

- Keep the product scope exactly aligned to the routes and features listed above.
- Do not invent an IDE, chat surface, agent playground, or platform console that does not already exist.
- Do not rely on giant left-nav-only enterprise patterns if the page hierarchy can be solved more elegantly.
- Do not solve everything with more cards.
- Do not make every page a dashboard.
- Do not create decorative complexity.
- Keep the design implementation-friendly for a TanStack Start + shadcn-style app.
- Prefer a token-friendly system with limited bespoke components.
- Assume the visual direction is calm, premium, operational, and high-trust.

## Specific redesign goals

### 1. Admin information architecture

Make the admin app feel like a real control plane.

Desired hierarchy:
- `/` should stay a thin redirect into `/control-plane`, not turn back into a mixed landing page
- `/control-plane` should be the operational overview and setup hub
- `/queue` should be the attention / throughput / blockage lens
- `/runs` should be the dispatch + execution history surface
- `/projects` should be the project inventory and setup surface
- `/blueprints` should be the template / execution-plan surface
- `/devboxes` should be the runtime workspace inventory surface
- `/pull-requests` should be the review output surface
- `/members` should be the org access surface
- `/operators` should be the founder-only infrastructure health surface

I want you to recommend:
- what belongs in persistent navigation
- what belongs in page-local tabs or sub-navigation
- what belongs only as cross-links, not top-level navigation

### 2. Customer information architecture

Make the customer app feel like “my work,” not like a smaller copy of the admin control plane.

Desired hierarchy:
- `/` should clearly answer: what needs my attention right now?
- `/runs` should be my execution history and current work
- `/pull-requests` should be my reviewable outputs
- `/organization` should be org context, collaborator visibility, and assigned project/devbox context
- `/account` should stay narrow and utility-focused

### 3. Page structure

For the major pages, redesign:
- page intro block
- summary stats vs operational content
- primary action placement
- secondary action placement
- how filters / controls are grouped
- where lists/tables start
- how detail drill-down is introduced
- where “next action” should live

### 4. Navigation cleanup

Assume the current product overuses route-map content inside the page body.
I want that corrected.

Design a cleaner navigation approach for:
- global app navigation
- page-local navigation
- cross-linking between related pages
- contextual breadcrumbs only if they actually help

Important constraint:
- interior feature pages may use compact quick-nav or route chips
- only overview pages should carry the fuller route hierarchy and route handoff explanation
- do not put a large route-map card above every table or detail surface

## Deliverables

Give me:

1. A high-level information architecture for the admin app
2. A high-level information architecture for the customer app
3. The recommended persistent navigation model
4. A page-by-page structural hierarchy proposal for:
   - admin `/control-plane`
   - admin `/queue`
   - admin `/runs`
   - admin `/projects`
   - admin `/blueprints`
   - admin `/devboxes`
   - admin `/pull-requests`
   - admin `/members`
   - admin `/operators`
   - customer `/`
   - customer `/runs`
   - customer `/pull-requests`
   - customer `/organization`
   - customer `/account`
5. For each page:
   - purpose
   - primary user question
   - section order
   - action hierarchy
   - what should be above the fold
   - what should be de-emphasized or moved elsewhere
6. Reusable layout templates that can cover multiple pages without making everything feel identical
7. Explicit notes on what to remove from the current structural approach
8. Specific guidance for overview pages vs action pages so the implementation team can avoid turning every route into a dashboard

## Output style

- Be concrete.
- Be opinionated.
- Do not give vague inspiration language.
- Do not just say “improve hierarchy” or “make it cleaner.”
- Speak in terms of real page structure and navigation decisions.
- Optimize for something that an implementation team can directly build.
```
