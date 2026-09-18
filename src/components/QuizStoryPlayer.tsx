import { useEffect, useMemo, useState } from "react";
import { BookOpen, Check, ChevronRight, History, Lightbulb, Pause, Play, RotateCcw, X } from "lucide-react";
import type { QuizQuestion, QuizSession } from "../types";
import { answerQuizQuestion, createQuizSession } from "../lib/quiz";
import { CodexPetSprite, type CodexPetAnimation } from "./CodexPetSprite";

type Props = {
  session: QuizSession;
  onChange: (session: QuizSession) => void;
  onEvidence: (question: QuizQuestion) => void;
  onRegenerate: () => void;
};

export function QuizStoryPlayer({ session, onChange, onEvidence, onRegenerate }: Props) {
  const [autoPlay, setAutoPlay] = useState(true);
  const [logOpen, setLogOpen] = useState(false);
  const question = session.questions[session.currentIndex];
  const answer = question ? session.answers[question.id] : undefined;
  const dialogue = session.stage === "intro" ? question?.intro : session.stage === "feedback" ? (answer?.correct ? question?.correctFeedback : question?.incorrectFeedback) : question?.question;
  const [typedLength, setTypedLength] = useState(dialogue?.length || 0);
  const logs = useMemo(() => session.questions.slice(0, session.currentIndex + 1).flatMap((item, index) => {
    const saved = session.answers[item.id];
    return saved ? [`第 ${index + 1} 题：${saved.correct ? "回答正确" : "回答错误"}`] : index === session.currentIndex ? [`第 ${index + 1} 题：进行中`] : [];
  }), [session]);

  useEffect(() => {
    setTypedLength(0);
    if (!dialogue) return;
    const timer = window.setInterval(() => setTypedLength((length) => {
      if (length >= dialogue.length) { window.clearInterval(timer); return length; }
      return length + 1;
    }), 24);
    return () => window.clearInterval(timer);
  }, [dialogue]);

  useEffect(() => {
    if (!autoPlay || session.stage !== "intro" || !dialogue || typedLength < dialogue.length) return;
    const timer = window.setTimeout(() => onChange({ ...session, stage: "answer", updatedAt: new Date().toISOString() }), 650);
    return () => window.clearTimeout(timer);
  }, [autoPlay, dialogue, onChange, session, typedLength]);

  if (session.completed) return <QuizResults session={session} onChange={onChange} onEvidence={onEvidence} onRegenerate={onRegenerate} />;
  if (!question) return null;
  const animation: CodexPetAnimation = session.stage === "intro" ? "review" : session.stage === "answer" ? "waiting" : answer?.correct ? (session.currentIndex % 2 ? "jumping" : "waving") : "failed";
  const goNext = () => {
    const atLoadedEnd = session.currentIndex + 1 >= session.questions.length;
    const finished = atLoadedEnd && session.questions.length >= session.targetQuestionCount;
    if (atLoadedEnd && !finished) return;
    onChange({ ...session, currentIndex: finished ? session.currentIndex : session.currentIndex + 1, stage: finished ? "feedback" : "intro", completed: finished, updatedAt: new Date().toISOString() });
  };

  return <div className="quiz-story quiz-vn-player">
    <header className="quiz-story-header"><div><strong>{session.currentIndex + 1} / {session.targetQuestionCount}</strong><span>问答游戏</span></div><div>
      <button className={autoPlay ? "is-active" : ""} title="自动播放" onClick={() => setAutoPlay((value) => !value)}>{autoPlay ? <Pause size={13} /> : <Play size={13} />}</button>
      <button className={logOpen ? "is-active" : ""} title="学习日志" onClick={() => setLogOpen((value) => !value)}><History size={13} /></button>
    </div></header>
    <div className="quiz-progress"><span style={{ width: `${((session.currentIndex + (answer ? 1 : 0)) / session.targetQuestionCount) * 100}%` }} /></div>
    <section className={`quiz-vn-stage is-${session.stage}`}>
      <div className="quiz-vn-character"><CodexPetSprite animation={animation} size={1.8} /></div>
      {logOpen && <aside className="quiz-story-log"><button title="关闭日志" onClick={() => setLogOpen(false)}><X size={12} /></button><strong>剧情回放</strong>{logs.map((item) => <p key={item}>{item}</p>)}</aside>}
      {session.stage === "answer" && <div className="quiz-options quiz-vn-choices">{question.options.map((option, index) => {
        const state = answer ? index === question.answerIndex ? "is-correct" : index === answer.selectedIndex ? "is-wrong" : "" : "";
        return <button key={index} disabled={Boolean(answer)} className={state} onClick={() => onChange(answerQuizQuestion(session, question.id, index))}>{option}</button>;
      })}</div>}
      {session.hintShown[question.id] && !answer && <div className="quiz-hint quiz-vn-hint"><Lightbulb size={12} />{question.hint || "回到题干中的关键词，排除论文没有直接支持的说法。"}</div>}
      <button className="quiz-dialogue quiz-vn-dialogue" type="button" onClick={() => {
        if (session.stage === "intro") onChange({ ...session, stage: "answer", updatedAt: new Date().toISOString() });
      }}>
        <span className="quiz-vn-name">WhalePaper 导学员</span>
        <p>{dialogue?.slice(0, typedLength)}<i /></p>
        {session.stage === "intro" && <b aria-hidden="true">▼</b>}
      </button>
    </section>
    <footer className="quiz-story-actions">
      {session.stage === "intro" && <button onClick={() => onChange({ ...session, stage: "answer", updatedAt: new Date().toISOString() })}>跳过讲解</button>}
      {session.stage === "answer" && <button onClick={() => onChange({ ...session, hintShown: { ...session.hintShown, [question.id]: !session.hintShown[question.id] }, updatedAt: new Date().toISOString() })}><Lightbulb size={12} />提示</button>}
      {answer && question.evidence.pageNumber > 0 && question.evidence.evidenceQuote && <button onClick={() => onEvidence(question)}><BookOpen size={12} />查看原文依据</button>}
      <span />{answer && (session.currentIndex + 1 < session.questions.length || session.questions.length >= session.targetQuestionCount) && <button className="primary-button compact" onClick={goNext}>{session.currentIndex + 1 >= session.targetQuestionCount ? "查看结果" : "下一题"}<ChevronRight size={13} /></button>}
    </footer>
  </div>;
}

function QuizResults({ session, onChange, onEvidence, onRegenerate }: Props) {
  return <div className="quiz-story-results"><CodexPetSprite animation={session.score / session.targetQuestionCount >= .6 ? "jumping" : "review"} size={.9} /><span>本次得分</span><h2>{session.score} / {session.targetQuestionCount}</h2>
    <div className="quiz-result-list">{session.questions.map((question, index) => <div key={question.id}><span className={session.answers[question.id]?.correct ? "quiz-correct" : "quiz-wrong"}>{session.answers[question.id]?.correct ? <Check size={12} /> : <X size={12} />}</span><p><strong>第 {index + 1} 题</strong>{question.question}</p>{question.evidence.pageNumber > 0 && <button title="查看原文依据" onClick={() => onEvidence(question)}><BookOpen size={13} /></button>}</div>)}</div>
    <div className="quiz-result-actions"><button className="primary-button compact" onClick={() => onChange(createQuizSession(session.questions, session.difficulty, new Date().toISOString(), { targetQuestionCount: session.targetQuestionCount, ...session.difficultyPlan }))}><RotateCcw size={13} />重新挑战</button><button onClick={onRegenerate}>生成新问答游戏</button></div>
  </div>;
}
