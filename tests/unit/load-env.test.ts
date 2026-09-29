import { describe, expect, it } from "vitest";
import { DEV_PROJECT_REF, TEST_PROJECT_REF, assertProdTarget, assertTestProjectRef } from "../../src/db/load-env";

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

describe("assertProdTarget", () => {
  const prodLike = [
    "https://abcdefghijklmnopqrst.supabase.co",
    "postgres://postgres.abcdefghijklmnopqrst:pw@aws-0-eu-west-3.pooler.supabase.com:6543/postgres",
    "postgres://postgres.abcdefghijklmnopqrst:pw@aws-0-eu-west-3.pooler.supabase.com:5432/postgres",
  ];

  it("runs with CONFIRM_PROD=1 and a project that is neither dev nor test", () => {
    expect(() => assertProdTarget(prodLike, "1")).not.toThrow();
  });

  it("refuses without the typed confirm", () => {
    expect(() => assertProdTarget(prodLike, undefined)).toThrow(/CONFIRM_PROD=1/);
    expect(() => assertProdTarget(prodLike, "true")).toThrow(/CONFIRM_PROD=1/);
  });

  it("refuses when a value is missing", () => {
    expect(() => assertProdTarget([prodLike[0], undefined, prodLike[2]], "1")).toThrow(/missing/);
  });

  it("refuses the dev project, even in one of the three values", () => {
    const mixed = [prodLike[0], prodLike[1].replace("abcdefghijklmnopqrst", DEV_PROJECT_REF), prodLike[2]];
    expect(() => assertProdTarget(mixed, "1")).toThrow(/dev project/);
  });

  it("refuses the test project", () => {
    const test = prodLike.map((v) => v.replace("abcdefghijklmnopqrst", TEST_PROJECT_REF));
    expect(() => assertProdTarget(test, "1")).toThrow(/test project/);
  });
});
