import assert from "node:assert/strict";
import { answerQuizQuestion, appendQuizQuestions, buildQuizEvidenceContext, createQuizSession, migrateQuizSession, normalizeQuizPlan, validateQuizQuestion } from "../src/lib/quiz.ts";

const pages = ["The proposed adapter reduces the number of trainable parameters while preserving accuracy."];
const grounded = buildQuizEvidenceContext(pages);
assert.match(grounded.context, /\[p1-e1\]/);
assert.equal(grounded.sources.get("p1-e1")?.quote, pages[0]);
const candidate = {
  question: "What does the adapter reduce?",
  options: ["Trainable parameters", "Dataset size", "Sequence length", "Layer count"],
  answerIndex: 0,
  hint: "Look for the resource being optimized.",
  explanation: "The paper explicitly identifies trainable parameters.",
  intro: "Let us inspect the efficiency claim.",
  correctFeedback: "Exactly, this is the central efficiency claim.",
  incorrectFeedback: "The evidence discusses model parameters rather than data.",
  pageNumber: 1,
  evidenceQuote: "reduces the number of trainable parameters",
};

const question = validateQuizQuestion(candidate, pages, () => "q1");
assert.ok(question, "a verifiable question should be accepted");
assert.equal(validateQuizQuestion({ ...candidate, pageNumber: 2 }, pages), null, "out-of-range pages must be rejected");
assert.equal(validateQuizQuestion({ ...candidate, evidenceQuote: "a fabricated claim" }, pages), null, "unverifiable quotes must be rejected");
assert.ok(validateQuizQuestion({ ...candidate, evidenceQuote: "reduces the number of train- able parameters" }, pages), "PDF line-break hyphens should not invalidate evidence");
assert.equal(validateQuizQuestion({ ...candidate, pageNumber: 1, evidenceQuote: undefined, evidence: { pageNumber: 1, evidenceQuote: candidate.evidenceQuote } }, pages)?.evidence.pageNumber, 1, "nested evidence anchors should be supported");
assert.equal(validateQuizQuestion({ ...candidate, pageNumber: 1, evidenceQuote: candidate.evidenceQuote }, ["unrelated cover", ...pages])?.evidence.pageNumber, 2, "a mismatched model page should resolve to its verified page");

const session = createQuizSession([question], "basic", "2026-08-18T00:00:00.000Z");
const answered = answerQuizQuestion(session, "q1", 0, "2026-08-18T00:01:00.000Z");
assert.equal(answered.score, 1);
assert.equal(answered.answers.q1.correct, true);
assert.equal(answerQuizQuestion(answered, "q1", 1).score, 1, "an answer cannot be overwritten");

const plan = normalizeQuizPlan({ totalQuestions: 8, basicQuestions: 5, hardQuestions: 3 }, 12);
assert.deepEqual(plan, { targetQuestionCount: 8, basic: 5, hard: 3 });
const planned = createQuizSession([question], "basic", "2026-08-18T00:00:00.000Z", plan);
assert.equal(planned.targetQuestionCount, 8);
assert.deepEqual(planned.difficultyPlan, { basic: 5, hard: 3 });
const extra = { ...question, id: "q2", question: "Which resource is reduced?" };
assert.equal(appendQuizQuestions(planned, [question, extra]).questions.length, 2, "background batches append only non-duplicate questions");

const legacy = migrateQuizSession([{ id: "old", question: "Legacy?", options: ["Yes", "No"], answerIndex: 0, explanation: "Saved content" }]);
assert.ok(legacy);
assert.equal(legacy.questions[0].question, "Legacy?");
assert.equal(legacy.stage, "intro");
assert.equal(legacy.questions[0].evidence.pageNumber, 0, "legacy content remains reviewable without a misleading evidence link");
assert.equal(legacy.targetQuestionCount, 1, "legacy sessions finish at their preserved question count");

console.log("Quiz session migration, validation, and local scoring checks passed.");
