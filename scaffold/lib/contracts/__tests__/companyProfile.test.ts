import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CompanyProfileSchema,
  type CompanyProfile,
} from "../companyProfile";

/** §3.1 — provenance is MANDATORY on every field. */

test("a fully-provenanced profile parses", () => {
  const p = {
    id: "profile_1",
    raw_text: { value: "We build AI for hospitals.", provenance: "user_stated", confidence: 1 },
    entity_type: { value: "for_profit_small_business", provenance: "model_inferred", confidence: 0.7 },
    employee_count: { value: 15, provenance: "user_stated", confidence: 1 },
    interview_answers: [
      {
        question_id: "q_entity",
        question: "What kind of entity are you?",
        answer: { value: "for-profit small business", provenance: "user_stated", confidence: 1 },
        skipped: false,
      },
    ],
  };
  assert.doesNotThrow(() => CompanyProfileSchema.parse(p));
});

test("a field WITHOUT provenance is rejected at runtime", () => {
  const bad = {
    id: "profile_1",
    // raw_text is missing provenance + confidence
    raw_text: { value: "We build AI for hospitals." },
    interview_answers: [],
  };
  const res = CompanyProfileSchema.safeParse(bad);
  assert.equal(res.success, false);
});

test("a field with an invalid provenance value is rejected", () => {
  const bad = {
    id: "profile_1",
    raw_text: { value: "x", provenance: "assumed", confidence: 0.5 },
    interview_answers: [],
  };
  assert.equal(CompanyProfileSchema.safeParse(bad).success, false);
});

test("confidence outside 0..1 is rejected", () => {
  const bad = {
    id: "profile_1",
    raw_text: { value: "x", provenance: "user_stated", confidence: 2 },
    interview_answers: [],
  };
  assert.equal(CompanyProfileSchema.safeParse(bad).success, false);
});

// Compile-time: a provenanced field type cannot be built without provenance.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _compileTimeChecks() {
  // @ts-expect-error - `raw_text` requires provenance + confidence, not just value.
  const rt: CompanyProfile["raw_text"] = { value: "x" };
  return rt;
}
