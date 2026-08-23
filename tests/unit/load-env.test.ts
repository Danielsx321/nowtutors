import { describe, expect, it } from "vitest";
import { TEST_PROJECT_REF, assertTestProjectRef } from "../../src/db/load-env";

describe("assertTestProjectRef", () => {
  it("passes when the connection string contains the hardcoded test project ref", () => {
    const url = `postgres://user:pass@aws-0-region.pooler.supabase.com:5432/postgres?options=project%3D${TEST_PROJECT_REF}`;
    expect(() => assertTestProjectRef(url)).not.toThrow();
  });

  it("aborts when the connection string points at a different project (e.g. dev)", () => {
    const url = "postgres://user:pass@aws-0-region.pooler.supabase.com:5432/postgres?options=project%3Dmipnoxlhurdbaahmvhhx";
    expect(() => assertTestProjectRef(url)).toThrow(/does not contain the/);
  });

  it("does not depend on any environment variable to fail closed", () => {
    const original = process.env.SUPABASE_TEST_PROJECT_REF;
    delete process.env.SUPABASE_TEST_PROJECT_REF;
    try {
      const url = `postgres://user:pass@host:5432/postgres?ref=${TEST_PROJECT_REF}`;
      expect(() => assertTestProjectRef(url)).not.toThrow();
    } finally {
      if (original !== undefined) process.env.SUPABASE_TEST_PROJECT_REF = original;
    }
  });
});
