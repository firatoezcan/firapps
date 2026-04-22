import { type RunRecord, normalizeRuns, requestInternalApi } from "./internal-control-plane";

const requestedByFilter = "self" as const;

export type MemberRunScope = {
  description: string;
  kind: "backend-filtered";
  label: string;
  requestedBy: typeof requestedByFilter;
};

export type MemberScopedRunsResult = {
  organizationRuns: RunRecord[];
  runs: RunRecord[];
  scope: MemberRunScope;
};

type SessionIdentity = {
  email?: string | null;
  userId: string;
};

export async function loadMemberScopedRuns(
  identity: SessionIdentity,
): Promise<MemberScopedRunsResult> {
  const organizationRuns = await fetchRuns("/runs");
  const memberRuns = await fetchRuns(`/runs?requestedBy=${requestedByFilter}`);
  const organizationContainsKnownForeignRuns = organizationRuns.some((run) =>
    runHasKnownForeignRequestor(run, identity),
  );

  if (memberRuns.some((run) => runHasKnownForeignRequestor(run, identity))) {
    throw new Error(
      "The backend returned foreign runs for requestedBy=self, so the member-scoped run contract regressed.",
    );
  }

  return {
    organizationRuns,
    runs: memberRuns,
    scope: {
      description: organizationContainsKnownForeignRuns
        ? "Customer-web now relies on the explicit backend filter `requestedBy=self`, so this route only loads runs requested by your signed-in member even when the broader organization stream contains other members' work."
        : "Customer-web now relies on the explicit backend filter `requestedBy=self`, and the current organization sample also happens to contain only your runs.",
      kind: "backend-filtered",
      label: "Backend member scope",
      requestedBy: requestedByFilter,
    },
  };
}

function runBelongsToMember(run: RunRecord, identity: SessionIdentity) {
  if (run.requestedBy?.id && run.requestedBy.id === identity.userId) {
    return true;
  }

  if (identity.email && run.requestedBy?.email) {
    return run.requestedBy.email.trim().toLowerCase() === identity.email.trim().toLowerCase();
  }

  return false;
}

function runHasKnownForeignRequestor(run: RunRecord, identity: SessionIdentity) {
  if (!run.requestedBy) {
    return false;
  }

  return !runBelongsToMember(run, identity);
}

async function fetchRuns(path: string) {
  const payload = (await requestInternalApi(path)) as {
    runs?: unknown[];
  } | null;

  return normalizeRuns(payload?.runs);
}
