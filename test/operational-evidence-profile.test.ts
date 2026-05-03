import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { validateOperationalEvidenceProfile } from "../src/index.js";

const fixturePath = path.join(
  "protocol-snapshots",
  "ensen-protocol",
  "v0.3.0",
  "fixtures",
  "operational-evidence-profile",
  "v1",
  "valid",
  "public-fixture-safe-profile.json",
);

const posixRootPath = (...segments: readonly string[]): string => ["", ...segments].join("/");
const windowsDrivePath = (...segments: readonly string[]): string => ["C:", ...segments].join("\\");
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function readProfileFixture(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(fixturePath, "utf8")) as Record<string, unknown>;
}

function cloneWith(
  profile: Record<string, unknown>,
  override: (copy: Record<string, unknown>) => void,
): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(profile)) as Record<string, unknown>;
  override(copy);
  return copy;
}

test("accepts the copied public operational evidence profile fixture", async () => {
  const result = validateOperationalEvidenceProfile(await readProfileFixture());

  assert.equal(result.ok, true);
});

test("fails closed when public operational evidence contains unsafe values", async () => {
  const profile = await readProfileFixture();
  const unsafeValues = [
    {
      label: "raw secret",
      value: "Authorization: Bearer ghp_1234567890abcdef",
      mutate: (copy: Record<string, unknown>, value: string) => {
        copy.producerMetadata = { producer: "ensen-loop", token: value };
      },
    },
    {
      label: "workstation path",
      value: posixRootPath("var", "tmp", "private-evidence", "bundle.json"),
      mutate: (copy: Record<string, unknown>, value: string) => {
        copy.evidence = {
          dataClassification: "public",
          referenceKind: "publicFixtureSafeArtifact",
          uri: value,
        };
      },
    },
    {
      label: "credential uri",
      value: "https://fixture-user:fixture-pass@example.invalid/evidence/bundle.json",
      mutate: (copy: Record<string, unknown>, value: string) => {
        copy.evidence = {
          dataClassification: "public",
          referenceKind: "publicFixtureSafeArtifact",
          uri: value,
        };
      },
    },
    {
      label: "private repository detail",
      value: "github.com/acme/private-customer-repo",
      mutate: (copy: Record<string, unknown>, value: string) => {
        copy.producerMetadata = { producer: "ensen-loop", repository: value };
      },
    },
    {
      label: "confidential local reference",
      value: windowsDrivePath("Evidence", "private-run", "bundle.json"),
      mutate: (copy: Record<string, unknown>, value: string) => {
        copy.confidentialReferencePolicy = {
          allowedInPublicFixture: true,
          placeholder: value,
        };
      },
    },
  ];

  for (const unsafeValue of unsafeValues) {
    const result = validateOperationalEvidenceProfile(
      cloneWith(profile, (copy) => unsafeValue.mutate(copy, unsafeValue.value)),
    );

    assert.equal(result.ok, false, unsafeValue.label);
    const diagnostics = result.ok
      ? ""
      : result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n");
    assert.doesNotMatch(diagnostics, new RegExp(escapeRegExp(unsafeValue.value)));
  }
});

test("does not treat public fixture-safe evidence and confidential references as interchangeable", async () => {
  const profile = await readProfileFixture();
  const result = validateOperationalEvidenceProfile(
    cloneWith(profile, (copy) => {
      copy.evidence = {
        dataClassification: "public",
        referenceKind: "confidentialLocalReference",
        uri: "artifacts/evidence/synthetic-run/bundle.json",
      };
      copy.confidentialReferencePolicy = {
        allowedInPublicFixture: false,
        placeholder: "artifacts/evidence/synthetic-run/bundle.json",
      };
    }),
  );

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.ok ? [] : result.issues.map((issue) => issue.path),
    ["evidence.referenceKind", "confidentialReferencePolicy.placeholder"],
  );
});

test("keeps checksum and retention hints within the public conformance profile", async () => {
  const profile = await readProfileFixture();
  const result = validateOperationalEvidenceProfile(
    cloneWith(profile, (copy) => {
      copy.evidence = {
        dataClassification: "public",
        referenceKind: "publicFixtureSafeArtifact",
        uri: "artifacts/evidence/synthetic-run/bundle.json",
        checksum: {
          algorithm: "md5",
          value: "0123456789abcdef0123456789abcdef",
        },
      };
      copy.retentionHint = "deleteAfterPublication";
    }),
  );

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.ok ? [] : result.issues.map((issue) => issue.path),
    ["evidence.checksum.algorithm", "evidence.checksum.value", "retentionHint"],
  );
});
