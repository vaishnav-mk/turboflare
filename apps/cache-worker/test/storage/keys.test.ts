import { describe, it } from "vitest";

import { artifactKey } from "../../src/storage/keys";
import { TenantSource } from "../../src/tenancy/types";

describe("artifact keys", () => {
  it("uses a versioned team-prefixed R2 key", ({ expect }) => {
    const key = artifactKey(
      { key: "team_turboflare", readOnly: false, source: TenantSource.TeamId },
      "abc123",
    );

    expect(key).toBe("v1/team/team_turboflare/artifact/abc123");
  });

  it("percent-encodes tenant and artifact key parts", ({ expect }) => {
    const key = artifactKey(
      { key: "my team", readOnly: false, source: TenantSource.Slug },
      "incremental/a b",
    );

    expect(key).toBe("v1/team/my%20team/artifact/incremental%2Fa%20b");
  });

  it("uses a branch namespace when a branch is resolved", ({ expect }) => {
    const key = artifactKey(
      { branch: "feature/a", key: "my team", readOnly: false, source: TenantSource.Slug },
      "abc123",
    );

    expect(key).toBe("v1/team/my%20team/branch/feature%2Fa/artifact/abc123");
  });
});
