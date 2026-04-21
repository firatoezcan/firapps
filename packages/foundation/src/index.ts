export type ProductTrack = {
  name: string;
  summary: string;
};

export type CommandCard = {
  label: string;
  command: string;
  note: string;
};

export type BoundaryCard = {
  title: string;
  summary: string;
};

export type AgentRole = {
  name: string;
  summary: string;
  handoff: string;
};

export type ReviewClaim = {
  claim: string;
  source: string;
  evidence: string;
};

export const repoIdentity = {
  name: "firapps",
  eyebrow: "Vite+ product monorepo",
  tagline:
    "A product application repo that keeps app code, shared packages, reviewer proof, and agent workflow visible without drifting into platform concerns.",
  doctrine: [
    "Vite+ is the canonical command surface.",
    "Apps and packages stay separate from platform material.",
    "Docs, runtime, and reviewer proof move together.",
  ],
} as const;

export const commandCards: CommandCard[] = [
  {
    label: "Install",
    command: "vp install",
    note: "Use Vite+ as the package-manager front door.",
  },
  {
    label: "Hooks",
    command: "vp config --hooks-dir .vite-hooks",
    note: "Keep commit hooks on the Vite+ path.",
  },
  {
    label: "Verify",
    command: "vp check && vp run -r test && vp run -r build",
    note: "Static checks, tests, and builds must agree.",
  },
  {
    label: "Dev",
    command: "vp run web#dev",
    note: "Start the first product surface locally.",
  },
];

export const productTracks: ProductTrack[] = [
  {
    name: "apps/web",
    summary: "The initial React + TypeScript frontend for product-facing UI work.",
  },
  {
    name: "packages/foundation",
    summary:
      "Shared repo identity, proof copy, and team cards consumed by apps without dragging platform code into the repo.",
  },
];

export const boundaryCards: BoundaryCard[] = [
  {
    title: "Owns product code",
    summary: "Applications, shared packages, repo doctrine, and reviewer proof.",
  },
  {
    title: "Does not own platform",
    summary: "No GitOps, cluster bootstrap, Helm control plane, or Velero story.",
  },
  {
    title: "One front door",
    summary: "Vite+ commands stay canonical across local development and CI.",
  },
];

export const agentRoles: AgentRole[] = [
  {
    name: "bootstrap lead",
    summary: "Owns repo shape, doctrine, and final integration.",
    handoff: "Leaves behind the front door, team topology, and truth boundary.",
  },
  {
    name: "product planner",
    summary: "Defines repo scope, touched contracts, and non-goals.",
    handoff: "Produces the smallest truthful change plan.",
  },
  {
    name: "web builder",
    summary: "Implements the application surface under apps/web.",
    handoff: "Reports UI changes, imports, and runtime gaps.",
  },
  {
    name: "package steward",
    summary: "Keeps shared package exports and app consumers aligned.",
    handoff: "Reports export changes and affected consumers.",
  },
  {
    name: "docs integrator",
    summary: "Owns doctrine, contracts, and reviewer guidance.",
    handoff: "Leaves behind the updated truth docs and claim matrix.",
  },
  {
    name: "qa verifier",
    summary: "Runs the Vite+ verification path and browser smoke.",
    handoff: "Reports pass or fail with exact command evidence.",
  },
  {
    name: "review integrator",
    summary: "Checks claim and evidence alignment before merge.",
    handoff: "Leaves actionable findings with file-level proof.",
  },
];

export const reviewClaims: ReviewClaim[] = [
  {
    claim: "This is a product repo, not a platform repo.",
    source: "docs/contracts/product-repo.md",
    evidence: "Repo layout and top-level docs stay product-scoped.",
  },
  {
    claim: "Vite+ is the canonical workflow surface.",
    source: "docs/contracts/toolchain.md",
    evidence: "The same vp commands work locally and in CI.",
  },
  {
    claim: "The first app consumes real shared workspace code.",
    source: "apps/web/src/App.tsx",
    evidence: "The web app renders data exported from @firapps/foundation.",
  },
  {
    claim: "Reviewer guidance is part of the repo contract.",
    source: "docs/reviews/repository-claim-matrix.md",
    evidence: "Review claims are documented instead of left in chat memory.",
  },
];
