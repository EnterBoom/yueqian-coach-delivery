"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type InterviewStage = "intro" | "chat" | "summary";
type InterviewMessage = { role: "user" | "assistant"; content: string };
type InterviewNode = { node: string; value: number; completeness: number; missing: string[] };
type ChatReply = {
  reply: string;
  topic: string;
  node: string | null;
  isNewNode: boolean;
  storyValue: number;
  completeness: number;
  missing: string[];
  action: string;
};

const SESSION_KEY = "yueqian-interview-session-v1";
const OPENER = "嗨，你好呀。我是跃迁 AI 深访助手。今天不问业绩，也没有标准答案，就想听你聊聊一路走来的故事。先认识一下，我该怎么称呼你？";

function formatTime(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

async function interviewApi(payload: Record<string, unknown>) {
  const response = await fetch("/api/interview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json() as ChatReply & { summary?: string; error?: string };
  if (!response.ok) throw new Error(data.error || "访谈服务暂时不可用");
  return data;
}

export function InterviewTool() {
  const [stage, setStage] = useState<InterviewStage>("intro");
  const [nineGrid, setNineGrid] = useState("");
  const [history, setHistory] = useState<InterviewMessage[]>([]);
  const [nodes, setNodes] = useState<InterviewNode[]>([]);
  const [input, setInput] = useState("");
  const [summary, setSummary] = useState("");
  const [topic, setTopic] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [thinking, setThinking] = useState(false);
  const [showNodes, setShowNodes] = useState(false);
  const [restored, setRestored] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SESSION_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { stage?: InterviewStage; nineGrid?: string; history?: InterviewMessage[]; nodes?: InterviewNode[]; seconds?: number; topic?: string; summary?: string };
        if (saved.stage && Array.isArray(saved.history) && saved.history.length) {
          setStage(saved.stage);
          setNineGrid(saved.nineGrid || "");
          setHistory(saved.history);
          setNodes(Array.isArray(saved.nodes) ? saved.nodes : []);
          setSeconds(Number(saved.seconds) || 0);
          setTopic(saved.topic || "");
          setSummary(saved.summary || "");
        }
      }
    } catch { /* 损坏的本地会话直接忽略 */ }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored || stage === "intro") return;
    window.localStorage.setItem(SESSION_KEY, JSON.stringify({ stage, nineGrid, history, nodes, seconds, topic, summary }));
  }, [history, nineGrid, nodes, restored, seconds, stage, summary, topic]);

  useEffect(() => {
    if (stage !== "chat") return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [stage]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [history, thinking]);

  function start() {
    const next = [{ role: "assistant", content: OPENER }] satisfies InterviewMessage[];
    setHistory(next);
    setNodes([]);
    setSummary("");
    setTopic("开场认识");
    setSeconds(0);
    setStage("chat");
  }

  function restart() {
    window.localStorage.removeItem(SESSION_KEY);
    setStage("intro");
    setNineGrid("");
    setHistory([]);
    setNodes([]);
    setSummary("");
    setTopic("");
    setSeconds(0);
    setShowNodes(false);
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = input.trim();
    if (!content || thinking) return;
    const nextHistory = [...history, { role: "user", content } satisfies InterviewMessage];
    setHistory(nextHistory);
    setInput("");
    setThinking(true);
    try {
      const result = await interviewApi({ action: "chat", history: nextHistory, nineGrid });
      setHistory((current) => [...current, { role: "assistant", content: result.reply }]);
      setTopic(result.topic || topic);
      if (result.node && result.isNewNode) {
        setNodes((current) => [...current, { node: result.node!, value: result.storyValue, completeness: result.completeness, missing: result.missing || [] }]);
      }
    } catch (error) {
      setHistory((current) => [...current, { role: "assistant", content: `服务提示：${(error as Error).message}` }]);
    } finally {
      setThinking(false);
    }
  }

  async function finish() {
    if (thinking) return;
    setStage("summary");
    setSummary("正在整理访谈小结…");
    try {
      const result = await interviewApi({ action: "summary", history, nodes });
      setSummary(result.summary || "暂时没有生成小结");
    } catch (error) {
      setSummary(`小结生成失败：${(error as Error).message}`);
    }
  }

  if (stage === "intro") return <section className="interview-shell interview-intro">
    <div className="interview-intro-copy">
      <span className="tool-status">TOOL 01 · AI 人设深访</span>
      <h2>把一个人真正<br/>聊明白</h2>
      <p>AI 会沿着对方刚刚说过的话继续追问，识别转折、故事和人设素材。访谈结束后自动整理时间线与待补问题。</p>
      <dl><div><dt>适合</dt><dd>导师、人设、IP定位访谈</dd></div><div><dt>建议时长</dt><dd>20–40 分钟</dd></div><div><dt>当前方式</dt><dd>文字深访</dd></div></dl>
    </div>
    <div className="interview-start-panel">
      <div className="interview-mark" aria-hidden="true">访</div>
      <div><span className="kicker">开始之前</span><h3>可选：粘贴已有资料</h3><p>如果已经有人设九宫格、个人简介或访谈提纲，可以贴在这里。没有也可以直接开始。</p></div>
      <label>基础资料<textarea value={nineGrid} onChange={(event) => setNineGrid(event.target.value)} placeholder="粘贴人设九宫格、个人简介或已有素材…"/></label>
      <button className="primary" onClick={start}>开始访谈</button>
      <small>聊天记录只保存在当前浏览器，刷新后可继续。</small>
    </div>
  </section>;

  if (stage === "summary") return <section className="interview-shell interview-summary">
    <header><div><span className="tool-status">INTERVIEW COMPLETE</span><h2>这次访谈，已经有了轮廓</h2><p>{formatTime(seconds)} · {nodes.length} 个故事节点</p></div><button className="ghost" onClick={restart}>开始新访谈</button></header>
    <div className="interview-summary-grid"><article><span className="kicker">访谈小结</span><div className="summary-copy">{summary}</div></article><aside><span className="kicker">故事节点</span>{nodes.length ? nodes.map((node, index) => <div className="summary-node" key={`${node.node}-${index}`}><b>{String(index + 1).padStart(2, "0")}</b><div><strong>{node.node}</strong><small>价值 {node.value}/10 · 完整度 {node.completeness}/10</small></div></div>) : <p>这次还没有识别到明确的故事节点。</p>}</aside></div>
  </section>;

  return <section className="interview-shell interview-chat">
    <header><div><span className="tool-status">跃迁 AI 深访</span><strong>{topic || "自然对话中"}</strong></div><div><time>{formatTime(seconds)}</time><button className={showNodes ? "active" : ""} onClick={() => setShowNodes((value) => !value)}>故事节点 {nodes.length}</button><button onClick={finish} disabled={thinking || history.length < 3}>结束访谈</button></div></header>
    <div className="interview-workspace">
      <div className="interview-conversation" ref={chatRef}>{history.map((message, index) => <article className={message.role} key={`${message.role}-${index}`}><span>{message.role === "assistant" ? "AI" : "你"}</span><p>{message.content}</p></article>)}{thinking && <article className="assistant thinking"><span>AI</span><p>我在听<span className="thinking-dots">•••</span></p></article>}</div>
      {showNodes && <aside className="interview-nodes"><header><span className="kicker">BACKGROUND NOTES</span><strong>AI 捕捉到的故事节点</strong></header>{nodes.length ? nodes.map((node, index) => <article key={`${node.node}-${index}`}><b>{String(index + 1).padStart(2, "0")}</b><div><strong>{node.node}</strong><small>价值 {node.value}/10 · 完整度 {node.completeness}/10</small>{node.missing.length > 0 && <p>待补：{node.missing.join("、")}</p>}</div></article>) : <p className="nodes-empty">还没有节点。聊到具体事件、转折或结果时，这里会自动出现记录。</p>}</aside>}
    </div>
    <form className="interview-input" onSubmit={send}><label><span className="sr-only">回复访谈</span><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} disabled={thinking} placeholder="像聊天一样回答，按 Enter 发送，Shift + Enter 换行" rows={1}/></label><button type="submit" disabled={!input.trim() || thinking} aria-label="发送">发送</button></form>
  </section>;
}
