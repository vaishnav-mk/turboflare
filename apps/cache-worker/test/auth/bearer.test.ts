import { describe, it } from "vitest";

import { parseAllowedTokens } from "../../src/auth/bearer";

describe("bearer auth", () => {
	it("parses comma-separated token allowlists with trimming", ({ expect }) => {
		expect(parseAllowedTokens("alpha, beta ,,gamma")).toEqual(["alpha", "beta", "gamma"]);
	});

	it("drops oversized static tokens", ({ expect }) => {
		expect(parseAllowedTokens(`${"x".repeat(513)},valid`)).toEqual(["valid"]);
	});
});
