"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses, lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from "ai";
import { ArrowUp, Check, ChevronRight, FileText, LoaderCircle, Paperclip, Pencil, ShieldCheck, Sparkles, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createPdfUploadMessageParts, DEFAULT_PDF_REPORT_REQUEST, getPdfAttachment, getVisibleUserText, submittedPdfWorkflowIsTerminal } from "@/lib/ai/chat-source";
import { questionInputSchema, questionOutputSchema, type QuestionOutput } from "@/lib/ai/question";
import { MAX_CHAT_TITLE_LENGTH, normalizeChatTitle } from "@/lib/chat-title";
import { extractPdf } from "@/lib/pdf/client";
import { deleteRetainedPdf, uploadRetainedPdf, type RetainedChatPdf } from "@/lib/pdf/storage-client";
import { runFitPrediction, type ModelProgress } from "@/lib/ml/client";

export function ChatWorkspace({ chatId, initialTitle, initialMessages, initialDocumentIds }: { chatId: string; initialTitle: string; initialMessages: UIMessage[]; initialDocumentIds: string[] }) {
  const router = useRouter();
  const [file, setFile] = useState<RetainedChatPdf | null>(null);
  const [availableDocumentIds, setAvailableDocumentIds] = useState(initialDocumentIds);
  const [fileError, setFileError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [removingFile, setRemovingFile] = useState(false);
  const [submittedDocumentId, setSubmittedDocumentId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [title, setTitle] = useState(initialTitle);
  const [titleDraft, setTitleDraft] = useState(initialTitle);
  const [editingTitle, setEditingTitle] = useState(false);
  const [savingTitle, setSavingTitle] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [modelProgress, setModelProgress] = useState<ModelProgress | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/chat" }), []);
  const availableDocuments = useMemo(() => new Set(availableDocumentIds), [availableDocumentIds]);

  const { messages, sendMessage, status, error, addToolOutput, addToolApprovalResponse } = useChat({
    id: chatId,
    messages: initialMessages,
    transport,
    onFinish: () => router.refresh(),
    sendAutomaticallyWhen: (options) => lastAssistantMessageIsCompleteWithApprovalResponses(options) || lastAssistantMessageIsCompleteWithToolCalls(options),
    async onToolCall({ toolCall }) {
      if (toolCall.dynamic || toolCall.toolName !== "runLocalFitPrediction") return;
      try {
        const input = toolCall.input as { profile: Parameters<typeof runFitPrediction>[0] };
        const prediction = await runFitPrediction(input.profile, setModelProgress);
        addToolOutput({ tool: "runLocalFitPrediction", toolCallId: toolCall.toolCallId, output: prediction });
      } catch (toolError) {
        addToolOutput({ tool: "runLocalFitPrediction", toolCallId: toolCall.toolCallId, state: "output-error", errorText: toolError instanceof Error ? toolError.message : "Local prediction failed." });
      }
    },
  });

  useEffect(() => {
    setTitle(initialTitle);
    setTitleDraft(initialTitle);
  }, [initialTitle]);

  useEffect(() => setAvailableDocumentIds(initialDocumentIds), [initialDocumentIds]);

  useEffect(() => {
    const published = messages.some((message) => message.parts.some((part) => part.type === "tool-publishReport" && part.state === "output-available"));
    if (published) setModelProgress(null);
  }, [messages]);

  useEffect(() => {
    if (submittedDocumentId && (error || submittedPdfWorkflowIsTerminal(messages, submittedDocumentId))) {
      setSubmittedDocumentId(null);
    }
  }, [error, messages, submittedDocumentId]);

  async function chooseFile(selected: File | undefined) {
    if (!selected || submittedDocumentId) return;
    setExtracting(true); setFileError(null);
    try {
      const extracted = await extractPdf(selected);
      const retained = await uploadRetainedPdf(chatId, selected, extracted);
      if (file) {
        try {
          await deleteRetainedPdf(chatId, file.id);
        } catch (cause) {
          await deleteRetainedPdf(chatId, retained.id).catch(() => undefined);
          throw cause;
        }
      }
      setFile(retained);
      setAvailableDocumentIds((current) => [...current.filter((id) => id !== file?.id), retained.id]);
      router.refresh();
    }
    catch (cause) { setFileError(cause instanceof Error ? cause.message : "PDF upload failed."); }
    finally { setExtracting(false); }
  }

  async function removeFile() {
    if (!file) return;
    setRemovingFile(true); setFileError(null);
    try {
      await deleteRetainedPdf(chatId, file.id);
      setAvailableDocumentIds((current) => current.filter((id) => id !== file.id));
      setFile(null);
      router.refresh();
    } catch (cause) {
      setFileError(cause instanceof Error ? cause.message : "Could not delete the stored PDF.");
    } finally {
      setRemovingFile(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (status !== "ready") return;
    if (file) {
      const retained = file;
      const request = input.trim() || DEFAULT_PDF_REPORT_REQUEST;
      setSubmittedDocumentId(retained.id);
      setFile(null);
      setInput("");
      try {
        await sendMessage({ parts: createPdfUploadMessageParts({ documentId: retained.id, metadata: retained.metadata }, request) });
      } catch {
        setSubmittedDocumentId(null);
        setFile((current) => current ?? retained);
      }
      return;
    }
    if (input.trim()) { const text = input.trim(); setInput(""); await sendMessage({ text }); }
  }

  function beginRename() {
    setTitleDraft(title);
    setTitleError(null);
    setEditingTitle(true);
  }

  function cancelRename() {
    setTitleDraft(title);
    setTitleError(null);
    setEditingTitle(false);
  }

  async function saveTitle(event: React.FormEvent) {
    event.preventDefault();
    const nextTitle = normalizeChatTitle(titleDraft);
    if (!nextTitle) { setTitleError("Title cannot be empty."); return; }
    if (nextTitle === title) { cancelRename(); return; }

    setSavingTitle(true);
    setTitleError(null);
    try {
      const response = await fetch(`/api/chats/${chatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: nextTitle }),
      });
      const result = await response.json() as { title?: string; error?: string };
      if (!response.ok || !result.title) throw new Error(result.error ?? "Could not rename this conversation.");
      setTitle(result.title);
      setTitleDraft(result.title);
      setEditingTitle(false);
      router.refresh();
    } catch (cause) {
      setTitleError(cause instanceof Error ? cause.message : "Could not rename this conversation.");
    } finally {
      setSavingTitle(false);
    }
  }

  return (
    <div className="chat-workspace">
      <div className="chat-column">
        <header className="chat-header">
          <div className="chat-title-block">
            <span className="section-index">Private analysis</span>
            {editingTitle ? (
              <form className="chat-title-form" onSubmit={saveTitle}>
                <input autoFocus aria-label="Conversation title" maxLength={MAX_CHAT_TITLE_LENGTH} value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") cancelRename(); }} disabled={savingTitle} />
                <button type="submit" aria-label="Save conversation title" disabled={savingTitle}><Check size={15} /></button>
                <button type="button" aria-label="Cancel rename" onClick={cancelRename} disabled={savingTitle}><X size={15} /></button>
              </form>
            ) : (
              <div className="chat-title"><h1>{title}</h1><button type="button" aria-label="Rename conversation" onClick={beginRename}><Pencil size={13} /></button></div>
            )}
            {titleError && <span className="chat-title-error">{titleError}</span>}
          </div>
          <span className="privacy-pill"><ShieldCheck size={13} /> PDF retained in storage</span>
        </header>
        <div className="message-stream">
          {messages.length === 0 && <div className="chat-intro"><span className="spark-mark"><Sparkles size={22} /></span><p className="eyebrow">Start with your idea</p><h2>Describe your startup or attach your plan.</h2><p>Ask for a YC Fit Score from a typed description, or upload a detailed PDF. The PDF is retained in configured S3 storage so approval still works after returning to the conversation.</p></div>}
          {messages.map((message) => <ChatMessage key={message.id} message={message} availableDocuments={availableDocuments} onApproval={(id, approved) => addToolApprovalResponse({ id, approved })} onQuestionAnswer={(toolCallId, output) => addToolOutput({ tool: "askQuestion", toolCallId, output })} modelProgress={modelProgress} />)}
          {status === "streaming" && <div className="thinking"><LoaderCircle size={14} className="spin" /> Application Signal is working…</div>}
          {error && <div className="chat-error">{error.message}</div>}
        </div>
        <form className="composer" onSubmit={submit}>
          {file && <div className="file-chip"><FileText size={16} /><span><strong>{file.metadata.name}</strong><small>{file.metadata.pages} pages · {(file.metadata.size / 1024 / 1024).toFixed(1)} MB · stored in S3</small></span><button type="button" aria-label="Remove PDF" disabled={removingFile} onClick={removeFile}>{removingFile ? <LoaderCircle size={14} className="spin" /> : <X size={14} />}</button></div>}
          {fileError && <div className="chat-error">{fileError}</div>}
          <div className="composer-row"><input ref={fileInputRef} hidden type="file" accept="application/pdf,.pdf" onChange={(event) => { const selected = event.target.files?.[0]; event.target.value = ""; void chooseFile(selected); }} /><button className="icon-button" type="button" aria-label="Attach a PDF" disabled={extracting || removingFile || Boolean(submittedDocumentId) || status !== "ready"} onClick={() => fileInputRef.current?.click()}>{extracting ? <LoaderCircle size={18} className="spin" /> : <Paperclip size={18} />}</button><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return; event.preventDefault(); event.currentTarget.form?.requestSubmit(); }} placeholder={file ? "Ready to request approval" : "Describe your startup, ask for a fit score, or attach a PDF…"} rows={1} /><button className="send-button" type="submit" aria-label="Send" disabled={status !== "ready" || extracting || removingFile || (!input.trim() && !file)}><ArrowUp size={18} /></button></div>
          <p className="composer-note">PDFs retained in configured S3 storage · Analysis is independent of YC</p>
        </form>
      </div>
      <aside className="report-preview"><div className="panel-heading"><span className="section-index">Live report</span><span className="mono-label">Private</span></div><ReportPreview messages={messages} /></aside>
    </div>
  );
}

function ChatMessage({ message, availableDocuments, onApproval, onQuestionAnswer, modelProgress }: { message: UIMessage; availableDocuments: ReadonlySet<string>; onApproval: (id: string, approved: boolean) => void; onQuestionAnswer: (toolCallId: string, output: QuestionOutput) => void; modelProgress: ModelProgress | null }) {
  const attachment = message.role === "user" ? getPdfAttachment(message) : null;
  if (message.role === "user") {
    const text = getVisibleUserText(message);
    return <article className="message user"><span className="message-role">You</span><div className="message-content">
      {attachment && <MessageAttachment attachment={attachment} />}
      {text && <p>{text}</p>}
    </div></article>;
  }

  return <article className={`message ${message.role}`}><span className="message-role">Signal</span><div className="message-content">{message.parts.map((part, index) => {
    if (part.type === "text") return message.role === "assistant"
      ? <div className="message-markdown" key={index}><ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown></div>
      : <p key={index}>{part.text}</p>;
    if (part.type.startsWith("tool-")) return <ToolCard key={index} part={part as never} availableDocuments={availableDocuments} onApproval={onApproval} onQuestionAnswer={onQuestionAnswer} modelProgress={modelProgress} />;
    return null;
  })}</div></article>;
}

function MessageAttachment({ attachment }: { attachment: NonNullable<ReturnType<typeof getPdfAttachment>> }) {
  const size = attachment.metadata.size >= 1024 * 1024
    ? `${(attachment.metadata.size / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(attachment.metadata.size / 1024))} KB`;
  return <div className="message-attachment"><span className="message-attachment-icon"><FileText size={19} /></span><span><strong>{attachment.metadata.name}</strong><small>PDF · {attachment.metadata.pages} pages · {size}</small></span><span className="message-attachment-status"><Check size={12} /> Stored</span></div>;
}

type RenderedToolPart = { type: string; state: string; toolCallId: string; input?: Record<string, unknown>; output?: unknown; errorText?: string; approval?: { id: string; approved?: boolean } };

function ToolCard({ part, availableDocuments, onApproval, onQuestionAnswer, modelProgress }: { part: RenderedToolPart; availableDocuments: ReadonlySet<string>; onApproval: (id: string, approved: boolean) => void; onQuestionAnswer: (toolCallId: string, output: QuestionOutput) => void; modelProgress: ModelProgress | null }) {
  const name = part.type.replace("tool-", "");
  if (name === "askQuestion") return <QuestionToolCard part={part} onAnswer={onQuestionAnswer} />;
  const sourceKind = part.input?.sourceKind === "chat" ? "chat" : "pdf";
  const documentId = typeof part.input?.documentId === "string" ? part.input.documentId : null;
  const sourceReady = name === "confirm" || sourceKind === "chat" || Boolean(documentId && availableDocuments.has(documentId));
  const awaitingApproval = name === "confirm" && part.state === "approval-requested";
  const denied = part.state === "output-denied";
  const details = name === "confirm" ? { step: "01", title: typeof part.input?.title === "string" ? part.input.title : "Confirm action", copy: awaitingApproval ? "Approval requested" : denied ? "The request was cancelled." : "Permission recorded." } : name === "analyzeApplication" ? { step: "02", title: "Categorize application", copy: "Extract a fixed startup profile and page-level evidence." } : name === "runLocalFitPrediction" ? { step: "03", title: "Run local fit model", copy: "Vectorize, score, and locate the company in your browser." } : { step: "04", title: "Publish visual report", copy: "Validate and save structured insights while retaining the source PDF." };
  const complete = part.state === "output-available";
  return <div className={`tool-card ${complete ? "complete" : ""}`}><div className="tool-top"><span className="tool-index">{details.step}</span><span className="tool-icon">{complete ? <Check size={16} /> : part.state.includes("error") || denied ? <X size={16} /> : awaitingApproval ? <ShieldCheck size={16} /> : <LoaderCircle size={16} className={part.state === "input-streaming" ? "spin" : ""} />}</span><div><strong>{details.title}</strong><p>{details.copy}</p></div></div>
    {part.state === "approval-requested" && <div className="approval-box"><p><ShieldCheck size={15} /> {typeof part.input?.message === "string" ? part.input.message : "Please confirm this action."}</p>{!sourceReady && <span className="approval-warning">The source is unavailable. Start a new request.</span>}<div><button className="button-primary" disabled={!sourceReady} onClick={() => onApproval(part.approval!.id, true)}>{typeof part.input?.confirmLabel === "string" ? part.input.confirmLabel : "Confirm"}</button><button className="button-ghost" onClick={() => onApproval(part.approval!.id, false)}>{typeof part.input?.cancelLabel === "string" ? part.input.cancelLabel : "Cancel"}</button></div></div>}
    {name === "runLocalFitPrediction" && modelProgress && part.state !== "output-available" && <div className="progress-block"><span>{modelProgress.label}</span><div><i style={{ width: `${modelProgress.progress * 100}%` }} /></div></div>}
    {part.state === "output-error" && <div className="tool-error">{part.errorText}</div>}
    {complete && name === "confirm" && <div className="tool-result"><span>Confirmation</span><strong>Approved</strong></div>}
    {complete && name === "analyzeApplication" && <div className="tool-result"><span>Profile ready</span><strong>{((part.output as { profile?: { companyName?: string } } | undefined)?.profile?.companyName) ?? "Application"}</strong></div>}
    {complete && name === "runLocalFitPrediction" && <div className="tool-result"><span>YC Fit Score</span><strong>{Math.round(Number((part.output as { score?: number } | undefined)?.score ?? 0))}/100</strong></div>}
    {complete && name === "publishReport" && <Link className="report-link" href={String((part.output as { href?: string } | undefined)?.href ?? "#")} target="_blank" rel="noopener noreferrer">Open the full report <ChevronRight size={15} /></Link>}
  </div>;
}

function QuestionToolCard({ part, onAnswer }: { part: RenderedToolPart; onAnswer: (toolCallId: string, output: QuestionOutput) => void }) {
  const parsedInput = questionInputSchema.safeParse(part.input);
  const parsedOutput = questionOutputSchema.safeParse(part.output);
  const [singleChoice, setSingleChoice] = useState("");
  const [customAnswer, setCustomAnswer] = useState("");
  const [multipleChoices, setMultipleChoices] = useState<string[]>([]);
  const [freeFormAnswer, setFreeFormAnswer] = useState("");

  if (!parsedInput.success) {
    return <div className="tool-card question-tool"><div className="tool-top"><span className="tool-index">?</span><span className="tool-icon"><LoaderCircle size={16} className={part.state === "input-streaming" ? "spin" : ""} /></span><div><strong>Preparing question</strong><p>Waiting for the question details.</p></div></div></div>;
  }

  const question = parsedInput.data;
  if (part.state === "output-available" && parsedOutput.success) {
    const answer = parsedOutput.data.type === "multiple-select" ? parsedOutput.data.answers.join(", ") : parsedOutput.data.answer;
    return <div className="tool-card question-tool complete"><div className="tool-top"><span className="tool-index">?</span><span className="tool-icon"><Check size={16} /></span><div><strong>{question.question}</strong><p>Answered</p></div></div><div className="question-answer"><span>Your answer</span><strong>{answer}</strong></div></div>;
  }

  function submitQuestion(event: React.FormEvent) {
    event.preventDefault();
    if (question.type === "single-select") {
      const answer = singleChoice === "__other__" ? customAnswer.trim() : question.options.find((option) => option.id === singleChoice)?.label;
      if (answer) onAnswer(part.toolCallId, { type: "single-select", answer, selectedOptionId: singleChoice === "__other__" ? null : singleChoice });
    } else if (question.type === "multiple-select") {
      const answers = question.options.filter((option) => multipleChoices.includes(option.id)).map((option) => option.label);
      if (answers.length) onAnswer(part.toolCallId, { type: "multiple-select", answers });
    } else {
      const answer = freeFormAnswer.trim();
      if (answer) onAnswer(part.toolCallId, { type: "free-form", answer });
    }
  }

  const canSubmit = question.type === "single-select"
    ? Boolean(singleChoice && (singleChoice !== "__other__" || customAnswer.trim()))
    : question.type === "multiple-select" ? multipleChoices.length > 0 : Boolean(freeFormAnswer.trim());

  return <div className="tool-card question-tool"><div className="tool-top"><span className="tool-index">?</span><span className="tool-icon"><Sparkles size={16} /></span><div><strong>{question.question}</strong><p>{question.type === "single-select" ? "Choose one or write your own answer." : question.type === "multiple-select" ? "Choose all that apply." : "Write your answer below."}</p></div></div>
    <form className="question-form" onSubmit={submitQuestion}>
      {question.type === "single-select" && <div className="question-options">{question.options.map((option) => <label className={`question-option ${singleChoice === option.id ? "selected" : ""}`} key={option.id}><input type="radio" name={`question-${part.toolCallId}`} checked={singleChoice === option.id} onChange={() => setSingleChoice(option.id)} /><span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span></label>)}<label className={`question-option question-other ${singleChoice === "__other__" ? "selected" : ""}`}><input type="radio" name={`question-${part.toolCallId}`} checked={singleChoice === "__other__"} onChange={() => setSingleChoice("__other__")} /><span><strong>Other</strong><input aria-label="Other answer" value={customAnswer} placeholder={question.otherPlaceholder ?? "Write your own answer…"} onFocus={() => setSingleChoice("__other__")} onChange={(event) => { setSingleChoice("__other__"); setCustomAnswer(event.target.value); }} /></span></label></div>}
      {question.type === "multiple-select" && <div className="question-options">{question.options.map((option) => { const selected = multipleChoices.includes(option.id); return <label className={`question-option ${selected ? "selected" : ""}`} key={option.id}><input type="checkbox" checked={selected} onChange={() => setMultipleChoices((current) => selected ? current.filter((id) => id !== option.id) : [...current, option.id])} /><span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span></label>; })}</div>}
      {question.type === "free-form" && (question.multiline === false ? <input className="question-free-form" aria-label="Your answer" value={freeFormAnswer} placeholder={question.placeholder ?? "Type your answer…"} onChange={(event) => setFreeFormAnswer(event.target.value)} /> : <textarea className="question-free-form" aria-label="Your answer" rows={4} value={freeFormAnswer} placeholder={question.placeholder ?? "Type your answer…"} onChange={(event) => setFreeFormAnswer(event.target.value)} />)}
      <button className="button-primary question-submit" type="submit" disabled={!canSubmit}>Submit answer</button>
    </form>
  </div>;
}

function ReportPreview({ messages }: { messages: UIMessage[] }) {
  const tools = messages.flatMap((message) => message.parts).filter((part) => part.type.startsWith("tool-")) as Array<{ type: string; state: string; output?: Record<string, unknown> }>;
  const prediction = [...tools].reverse().find((part) => part.type === "tool-runLocalFitPrediction" && part.state === "output-available")?.output as { score?: number; band?: string; scoreComponents?: { startupFit: number; founderFit: number | null }; factors?: Array<{ label: string; value: string }> } | undefined;
  const publication = [...tools].reverse().find((part) => part.type === "tool-publishReport" && part.state === "output-available")?.output;
  if (!prediction) return <div className="empty-report"><div className="empty-orbit"><span /></div><h3>Your company will appear here.</h3><p>The candidate node, closest public YC analogs, evidence coverage, and fit factors populate after approval.</p></div>;
  return <div className="mini-report"><p className="eyebrow">YC Fit Score</p><strong className="mini-score">{Math.round(prediction.score ?? 0)}</strong><span className="score-suffix">/100 · {prediction.band}</span>{prediction.scoreComponents && <span className="score-suffix">Startup {Math.round(prediction.scoreComponents.startupFit)} · Founder {prediction.scoreComponents.founderFit === null ? "N/A" : Math.round(prediction.scoreComponents.founderFit)}</span>}<div className="mini-cluster">{Array.from({ length: 42 }).map((_, index) => <i key={index} style={{ left: `${8 + ((index * 37) % 84)}%`, top: `${12 + ((index * 53) % 74)}%` }} />)}<b style={{ left: "55%", top: "42%" }} /></div><div className="factor-list">{prediction.factors?.map((factor) => <div key={factor.label}><span>{factor.label}</span><strong>{factor.value}</strong></div>)}</div>{publication && <Link href={String(publication.href)} className="button-dark" target="_blank" rel="noopener noreferrer">View report <ChevronRight size={15} /></Link>}</div>;
}
