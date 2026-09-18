import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  CheckCircle2,
  Clock3,
  GitCompareArrows,
  History,
  MessageSquarePlus,
  Reply,
  RotateCcw,
  Send,
  Trash2,
  X,
} from "lucide-react";
import {
  addWriterThreadMessage,
  createWriterThread,
  createWriterVersion,
  deleteWriterThread,
  getWriterVersion,
  listWriterRevisions,
  listWriterThreads,
  listWriterVersions,
  setWriterThreadResolved,
  updateWriterThreadMessage,
} from "./services/local-writer";
import type { WriterProject, WriterRevision, WriterThread, WriterVersion, WriterVersionDetail } from "./types";

export type WriterSourceSelection = { from: number; to: number; quote: string };

type WriterReviewSidebarProps = {
  mode: "comments" | "versions" | "revisions";
  project: WriterProject;
  rootPath: string;
  mainFile: string;
  activePath: string | null;
  activeContent: string;
  selectedRange: WriterSourceSelection | null;
  refreshToken: number;
  onCaptureSelection: () => void;
  onOpenRange: (filePath: string, from: number, to: number, quote: string) => void;
  onRestoreVersion: (versionId: string) => Promise<void>;
  onApplyRevision: (revision: WriterRevision, status: "accepted" | "rejected") => Promise<void>;
  onSaveAll: () => Promise<void>;
};

type DiffLine = { type: "same" | "add" | "remove"; text: string };

function lineDiff(before: string, after: string): DiffLine[] {
  const left = before.split("\n");
  const right = after.split("\n");
  if (left.length * right.length > 360_000) {
    const length = Math.max(left.length, right.length);
    return Array.from({ length }, (_, index) => left[index] === right[index]
      ? [{ type: "same", text: left[index] || "" } as DiffLine]
      : [
          ...(left[index] === undefined ? [] : [{ type: "remove", text: left[index] } as DiffLine]),
          ...(right[index] === undefined ? [] : [{ type: "add", text: right[index] } as DiffLine]),
        ]).flat();
  }
  const matrix = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) matrix[i][j] = left[i] === right[j] ? matrix[i + 1][j + 1] + 1 : Math.max(matrix[i + 1][j], matrix[i][j + 1]);
  }
  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      result.push({ type: "same", text: left[i] }); i += 1; j += 1;
    } else if (j < right.length && (i >= left.length || matrix[i][j + 1] >= matrix[i + 1][j])) {
      result.push({ type: "add", text: right[j] }); j += 1;
    } else {
      result.push({ type: "remove", text: left[i] }); i += 1;
    }
  }
  return result;
}

function formatDate(value: number): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function WriterReviewSidebar(props: WriterReviewSidebarProps) {
  const [threads, setThreads] = useState<WriterThread[]>([]);
  const [versions, setVersions] = useState<WriterVersion[]>([]);
  const [revisions, setRevisions] = useState<WriterRevision[]>([]);
  const [versionDetail, setVersionDetail] = useState<WriterVersionDetail | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [versionLabel, setVersionLabel] = useState("");
  const [versionNote, setVersionNote] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reviewLoaded, setReviewLoaded] = useState(false);
  const baselineRequested = useRef(false);
  const projectRef = useRef(props.project.id);

  useEffect(() => {
    if (projectRef.current === props.project.id) return;
    projectRef.current = props.project.id;
    baselineRequested.current = false;
    setVersionDetail(null);
    setReviewLoaded(false);
  }, [props.project.id]);

  const refreshThreads = async () => setThreads(await listWriterThreads(props.project.id));
  const refreshVersions = async () => setVersions(await listWriterVersions(props.project.id));
  const refreshRevisions = async () => setRevisions(await listWriterRevisions(props.project.id));

  useEffect(() => {
    let cancelled = false;
    void Promise.all([listWriterThreads(props.project.id), listWriterVersions(props.project.id), listWriterRevisions(props.project.id)])
      .then(([nextThreads, nextVersions, nextRevisions]) => {
        if (!cancelled) { setThreads(nextThreads); setVersions(nextVersions); setRevisions(nextRevisions); setReviewLoaded(true); }
      })
      .catch((nextError) => !cancelled && setError(String(nextError)));
    return () => { cancelled = true; };
  }, [props.project.id, props.refreshToken]);

  useEffect(() => {
    if (!reviewLoaded || versions.length || !props.mainFile || baselineRequested.current) return;
    baselineRequested.current = true;
    void createWriterVersion(props.rootPath, props.mainFile, "首次打开", "项目进入 WhalePaper 写作库时创建的基线版本")
      .then(() => refreshVersions())
      .catch((nextError) => setError(String(nextError)));
  }, [props.mainFile, props.rootPath, reviewLoaded, versions.length]);

  const selectedVersionContent = versionDetail?.files[props.activePath || ""] || "";
  const versionDiff = useMemo(() => lineDiff(selectedVersionContent, props.activeContent), [props.activeContent, selectedVersionContent]);
  const visibleThreads = threads.filter((thread) => showResolved || !thread.resolved);

  const submitComment = async () => {
    if (!props.activePath || !props.selectedRange || !commentBody.trim()) return;
    setBusy(true); setError("");
    try {
      await createWriterThread({
        id: crypto.randomUUID(), projectId: props.project.id, filePath: props.activePath,
        fromOffset: props.selectedRange.from, toOffset: props.selectedRange.to,
        quotedText: props.selectedRange.quote, messageId: crypto.randomUUID(), body: commentBody.trim(),
      });
      setCommentBody("");
      await refreshThreads();
    } catch (nextError) { setError(String(nextError)); } finally { setBusy(false); }
  };

  const createVersion = async () => {
    if (!props.mainFile) return;
    setBusy(true); setError("");
    try {
      await props.onSaveAll();
      await createWriterVersion(props.rootPath, props.mainFile, versionLabel.trim() || `版本 ${versions.length + 1}`, versionNote);
      setVersionLabel(""); setVersionNote("");
      await refreshVersions();
    } catch (nextError) { setError(String(nextError)); } finally { setBusy(false); }
  };

  return (
    <div className="writer-review-panel">
      {error && <div className="writer-review-error">{error}<button type="button" onClick={() => setError("")}><X size={12} /></button></div>}

      {props.mode === "comments" && <>
        <div className="writer-review-command">
          <button type="button" onClick={props.onCaptureSelection}><MessageSquarePlus size={14} />从源码选区添加评论</button>
          <label><input type="checkbox" checked={showResolved} onChange={(event) => setShowResolved(event.target.checked)} />已解决</label>
        </div>
        {props.selectedRange && <div className="writer-comment-composer">
          <blockquote>{props.selectedRange.quote}</blockquote>
          <textarea rows={3} value={commentBody} onChange={(event) => setCommentBody(event.target.value)} placeholder="写下评论" />
          <button type="button" disabled={busy || !commentBody.trim()} onClick={() => void submitComment()}><Send size={13} />提交评论</button>
        </div>}
        <div className="writer-thread-list">
          {visibleThreads.map((thread) => <article className={thread.resolved ? "is-resolved" : ""} key={thread.id}>
            <header><button type="button" onClick={() => props.onOpenRange(thread.filePath, thread.fromOffset, thread.toOffset, thread.quotedText)}>{thread.filePath}</button><span>{formatDate(thread.updatedAt)}</span></header>
            <blockquote>{thread.quotedText}</blockquote>
            {thread.messages.map((message) => <textarea key={message.id} defaultValue={message.body} rows={2} aria-label="评论内容" onBlur={(event) => { if (event.target.value.trim() && event.target.value !== message.body) void updateWriterThreadMessage(message.id, event.target.value).then(refreshThreads); }} />)}
            <div className="writer-thread-reply"><input value={replyDrafts[thread.id] || ""} onChange={(event) => setReplyDrafts((current) => ({ ...current, [thread.id]: event.target.value }))} placeholder="回复" /><button type="button" disabled={!replyDrafts[thread.id]?.trim()} onClick={() => void addWriterThreadMessage(thread.id, replyDrafts[thread.id]).then(() => { setReplyDrafts((current) => ({ ...current, [thread.id]: "" })); return refreshThreads(); })}><Reply size={12} /></button></div>
            <footer><button type="button" onClick={() => void setWriterThreadResolved(thread.id, !thread.resolved).then(refreshThreads)}>{thread.resolved ? <RotateCcw size={12} /> : <Check size={12} />}{thread.resolved ? "重新打开" : "解决"}</button><button type="button" onClick={() => void deleteWriterThread(thread.id).then(refreshThreads)}><Trash2 size={12} />删除</button></footer>
          </article>)}
          {!visibleThreads.length && <div className="writer-review-empty"><MessageSquarePlus size={27} /><span>还没有评论</span></div>}
        </div>
      </>}

      {props.mode === "versions" && <>
        <div className="writer-version-create">
          <input value={versionLabel} onChange={(event) => setVersionLabel(event.target.value)} placeholder="版本名称" />
          <input value={versionNote} onChange={(event) => setVersionNote(event.target.value)} placeholder="版本说明（可选）" />
          <button type="button" disabled={busy} onClick={() => void createVersion()}><History size={13} />保存版本</button>
        </div>
        {!versionDetail ? <div className="writer-version-list">
          {versions.map((version) => <button type="button" key={version.id} onClick={() => void getWriterVersion(version.id).then(setVersionDetail).catch((nextError) => setError(String(nextError)))}><span><strong>{version.label}</strong><small>{version.note || `${version.fileCount} 个文件`}</small></span><time><Clock3 size={11} />{formatDate(version.createdAt)}</time></button>)}
          {!versions.length && <div className="writer-review-empty"><History size={27} /><span>还没有历史版本</span></div>}
        </div> : <div className="writer-version-detail">
          <header><button type="button" onClick={() => setVersionDetail(null)}><X size={13} />关闭差异</button><strong>{versionDetail.label}</strong><button type="button" disabled={busy} onClick={() => { setBusy(true); void props.onRestoreVersion(versionDetail.id).catch((nextError) => setError(String(nextError))).finally(() => setBusy(false)); }}><RotateCcw size={13} />恢复</button></header>
          <div className="writer-diff-summary"><GitCompareArrows size={13} /><span>{props.activePath || "请选择文件"}</span><small>历史版本 → 当前内容</small></div>
          <pre className="writer-diff-view">{versionDiff.map((line, index) => <span className={`is-${line.type}`} key={`${index}-${line.text}`}><i>{line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}</i>{line.text || " "}</span>)}</pre>
        </div>}
      </>}

      {props.mode === "revisions" && <div className="writer-revision-list">
        {revisions.map((revision) => {
          const diff = lineDiff(revision.beforeContent, revision.afterContent).filter((line) => line.type !== "same");
          return <article className={`is-${revision.status}`} key={revision.id}>
            <header><strong>{revision.filePath}</strong><span>{revision.status === "pending" ? "待处理" : revision.status === "accepted" ? "已接受" : "已拒绝"}</span></header>
            <pre>{diff.slice(0, 10).map((line, index) => <span className={`is-${line.type}`} key={index}>{line.type === "add" ? "+" : "-"} {line.text}</span>)}</pre>
            {revision.status === "pending" && <footer><button type="button" onClick={() => void props.onApplyRevision(revision, "rejected").then(refreshRevisions).catch((nextError) => setError(String(nextError)))}><X size={13} />拒绝</button><button type="button" onClick={() => void props.onApplyRevision(revision, "accepted").then(refreshRevisions).catch((nextError) => setError(String(nextError)))}><CheckCircle2 size={13} />接受</button></footer>}
          </article>;
        })}
        {!revisions.length && <div className="writer-review-empty"><GitCompareArrows size={27} /><span>开启修订模式后，修改会出现在这里</span></div>}
      </div>}
    </div>
  );
}
