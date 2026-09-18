import type { QuizQuestion, QuizSession } from "../types";

export type QuizEvidenceSource = { id: string; pageNumber: number; quote: string };

const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
const canonicalText = (value: string) => Array.from(value.normalize("NFKC"))
  .filter((character) => /[\p{L}\p{N}]/u.test(character))
  .join("")
  .toLocaleLowerCase();

export function normalizeQuizPlan(value: unknown, pageCount: number): { targetQuestionCount: number; basic: number; hard: number } {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const fallbackTotal = Math.max(8, Math.min(30, Math.round(8 + Math.sqrt(Math.max(1, pageCount)) * 2)));
  const targetQuestionCount = Math.max(5, Math.min(30, Math.round(Number(source.totalQuestions ?? source.targetQuestionCount) || fallbackTotal)));
  const requestedBasic = Math.round(Number(source.basicQuestions ?? source.basic));
  const basic = Number.isFinite(requestedBasic) ? Math.max(1, Math.min(targetQuestionCount - 1, requestedBasic)) : Math.ceil(targetQuestionCount * .6);
  return { targetQuestionCount, basic, hard: targetQuestionCount - basic };
}

export function appendQuizQuestions(session: QuizSession, questions: QuizQuestion[], now = new Date().toISOString()): QuizSession {
  const existing = new Set(session.questions.map((question) => canonicalText(question.question)));
  const additions = questions.filter((question) => {
    const key = canonicalText(question.question);
    if (!key || existing.has(key)) return false;
    existing.add(key);
    return true;
  }).slice(0, Math.max(0, session.targetQuestionCount - session.questions.length));
  return additions.length ? { ...session, questions: [...session.questions, ...additions], updatedAt: now } : session;
}

export function buildQuizEvidenceContext(pages: string[], maxCharacters = 45000): { context: string; sources: Map<string, QuizEvidenceSource> } {
  const sources = new Map<string, QuizEvidenceSource>();
  const populatedPages = pages.map((page, index) => ({ page: page.trim(), pageNumber: index + 1 })).filter(({ page }) => page);
  if (!populatedPages.length) return { context: "", sources };
  const perPage = Math.max(500, Math.floor(maxCharacters / populatedPages.length));
  const blocks = populatedPages.map(({ page, pageNumber }) => {
    const rawSegments = page.match(/[^.!?。！？]+[.!?。！？]?/g) || [page];
    const segments = rawSegments.flatMap((segment) => {
      const value = segment.replace(/\s+/g, " ").trim();
      if (value.length <= 500) return value ? [value] : [];
      return Array.from({ length: Math.ceil(value.length / 400) }, (_, index) => value.slice(index * 400, (index + 1) * 400).trim()).filter(Boolean);
    });
    let used = 0;
    const lines: string[] = [];
    segments.forEach((quote, index) => {
      if (quote.length < 16 || used + quote.length > perPage) return;
      const id = `p${pageNumber}-e${index + 1}`;
      sources.set(id, { id, pageNumber, quote });
      lines.push(`[${id}] ${quote}`);
      used += quote.length + id.length + 4;
    });
    return lines.length ? `[第 ${pageNumber} 页]\n${lines.join("\n")}` : "";
  }).filter(Boolean);
  return { context: blocks.join("\n\n"), sources };
}

export function validateQuizQuestion(value: unknown, pages: string[], createId = () => crypto.randomUUID()): QuizQuestion | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const nestedEvidence = item.evidence && typeof item.evidence === "object" && !Array.isArray(item.evidence)
    ? item.evidence as Record<string, unknown>
    : {};
  const options = Array.isArray(item.options) ? item.options.map(clean).filter(Boolean) : [];
  const answerIndex = Number(item.answerIndex);
  const requestedPageNumber = Number(item.pageNumber ?? nestedEvidence.pageNumber);
  const evidenceQuote = clean(item.evidenceQuote ?? nestedEvidence.evidenceQuote ?? nestedEvidence.quote);
  if (!clean(item.question) || options.length < 2 || options.length > 6 || new Set(options).size !== options.length) return null;
  if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= options.length) return null;
  if (!Number.isInteger(requestedPageNumber) || requestedPageNumber < 1 || requestedPageNumber > pages.length || !evidenceQuote) return null;
  const canonicalQuote = canonicalText(evidenceQuote);
  if (canonicalQuote.length < 16) return null;
  const matchingPages = pages.flatMap((page, index) => canonicalText(page).includes(canonicalQuote) ? [index + 1] : []);
  if (!matchingPages.length) return null;
  const pageNumber = matchingPages.includes(requestedPageNumber) ? requestedPageNumber : matchingPages[0];
  const explanation = clean(item.explanation);
  if (!explanation) return null;
  return {
    id: clean(item.id) || createId(), question: clean(item.question), options, answerIndex,
    hint: clean(item.hint), explanation,
    difficulty: item.difficulty === "hard" ? "hard" : item.difficulty === "basic" ? "basic" : undefined,
    intro: clean(item.intro) || "先回到论文中的关键线索，再判断最符合原意的选项。",
    correctFeedback: clean(item.correctFeedback) || `答对了。${explanation}`,
    incorrectFeedback: clean(item.incorrectFeedback) || `这次没有选中正确答案。${explanation}`,
    evidence: { pageNumber, evidenceQuote },
  };
}

export function createQuizSession(
  questions: QuizQuestion[],
  difficulty: "basic" | "hard",
  now = new Date().toISOString(),
  plan?: { targetQuestionCount: number; basic: number; hard: number },
): QuizSession {
  const targetQuestionCount = Math.max(questions.length, plan?.targetQuestionCount || questions.length);
  const basic = Math.max(0, Math.min(targetQuestionCount, plan?.basic ?? (difficulty === "basic" ? targetQuestionCount : 0)));
  return { version: 3, questions, currentIndex: 0, stage: "intro", answers: {}, hintShown: {}, completed: false, score: 0, difficulty, targetQuestionCount, difficultyPlan: { basic, hard: targetQuestionCount - basic }, createdAt: now, updatedAt: now };
}

export function migrateQuizSession(value: unknown): QuizSession | null {
  if (!value) return null;
  if (!Array.isArray(value) && typeof value === "object" && Array.isArray((value as QuizSession).questions)) {
    const session = value as QuizSession;
    const questions = session.questions.filter((question) => question && typeof question.question === "string").map((question) => ({
      ...question,
      intro: question.intro || "先想想论文如何描述这个概念。",
      correctFeedback: question.correctFeedback || `答对了。${question.explanation || ""}`,
      incorrectFeedback: question.incorrectFeedback || `再看一次论文依据。${question.explanation || ""}`,
      evidence: question.evidence || { pageNumber: 0, evidenceQuote: "" },
    }));
    const targetQuestionCount = Math.max(questions.length, Number(session.targetQuestionCount) || questions.length);
    const storedPlan = session.difficultyPlan;
    const basic = storedPlan && Number.isFinite(storedPlan.basic)
      ? Math.max(0, Math.min(targetQuestionCount, Math.round(storedPlan.basic)))
      : session.difficulty === "hard" ? 0 : targetQuestionCount;
    return { ...createQuizSession(questions, session.difficulty === "hard" ? "hard" : "basic", session.createdAt, { targetQuestionCount, basic, hard: targetQuestionCount - basic }), ...session, version: 3, targetQuestionCount, difficultyPlan: { basic, hard: targetQuestionCount - basic }, questions };
  }
  if (!Array.isArray(value) || !value.length) return null;
  const questions = (value as Array<Partial<QuizQuestion>>).filter((item) => item && typeof item.question === "string").map((item, index) => ({
    id: item.id || `legacy-${index}`, question: item.question!, options: item.options || [], answerIndex: item.answerIndex || 0,
    hint: item.hint, explanation: item.explanation || "",
    intro: "先想想论文如何描述这个概念。", correctFeedback: `答对了。${item.explanation || ""}`,
    incorrectFeedback: `再看一次论文依据。${item.explanation || ""}`, evidence: { pageNumber: 0, evidenceQuote: "" },
  }));
  return createQuizSession(questions, "basic");
}

export function answerQuizQuestion(session: QuizSession, questionId: string, selectedIndex: number, now = new Date().toISOString()): QuizSession {
  const question = session.questions.find((item) => item.id === questionId);
  if (!question || session.answers[questionId] || selectedIndex < 0 || selectedIndex >= question.options.length) return session;
  const correct = selectedIndex === question.answerIndex;
  return { ...session, stage: "feedback", answers: { ...session.answers, [questionId]: { selectedIndex, correct, answeredAt: now } }, score: session.score + (correct ? 1 : 0), updatedAt: now };
}
