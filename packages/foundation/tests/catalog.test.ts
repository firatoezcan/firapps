import { expect, test } from "vite-plus/test";
import {
  agentRoles,
  boundaryCards,
  commandCards,
  productTracks,
  reviewClaims,
} from "../src/index.ts";

test("bootstrap exports stay aligned with the repo contract", () => {
  expect(productTracks.map((track) => track.name)).toContain("apps/web");
  expect(boundaryCards.map((card) => card.title)).toContain("Does not own platform");
  expect(commandCards.map((card) => card.command)).toContain("vp run web#dev");
  expect(agentRoles).toHaveLength(7);
  expect(reviewClaims.map((claim) => claim.source)).toContain(
    "docs/reviews/repository-claim-matrix.md",
  );
});
