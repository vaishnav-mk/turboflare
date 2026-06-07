import { describe, it } from "vitest";

import { AuthScope } from "../../src/auth/types";
import { parseAllowedTokens, parseScopedTokens } from "../../src/auth/static";

describe("bearer auth", () => {
  it("parses comma-separated token allowlists with trimming", ({ expect }) => {
    expect(parseAllowedTokens("alpha, beta ,,gamma")).toEqual([
      { id: "static-0", scopes: [AuthScope.Read, AuthScope.Write], teams: ["*"], token: "alpha" },
      { id: "static-1", scopes: [AuthScope.Read, AuthScope.Write], teams: ["*"], token: "beta" },
      { id: "static-2", scopes: [AuthScope.Read, AuthScope.Write], teams: ["*"], token: "gamma" },
    ]);
  });

  it("drops oversized static tokens", ({ expect }) => {
    expect(parseAllowedTokens(`${"x".repeat(513)},valid`)).toEqual([
      { id: "static-0", scopes: [AuthScope.Read, AuthScope.Write], teams: ["*"], token: "valid" },
    ]);
  });

  it("parses scoped token rules", ({ expect }) => {
    expect(
      parseScopedTokens(
        JSON.stringify([
          {
            id: "ci",
            token: "scoped-token",
            teams: ["team_a"],
            scopes: [AuthScope.Read, AuthScope.Write],
          },
        ]),
      ),
    ).toEqual([
      {
        id: "ci",
        scopes: [AuthScope.Read, AuthScope.Write],
        teams: ["team_a"],
        token: "scoped-token",
      },
    ]);
  });

  it("ignores invalid scoped token rules", ({ expect }) => {
    expect(
      parseScopedTokens(
        JSON.stringify([
          { token: "missing-teams", scopes: [AuthScope.Read] },
          { teams: ["team_a"], scopes: [AuthScope.Read] },
        ]),
      ),
    ).toEqual([]);
  });
});
