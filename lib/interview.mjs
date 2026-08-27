const SYSTEM_PROMPT = `你是「跃迁 AI 深访」的访谈者。你的任务是通过轻松自然的对话，陪对方把人生经历聊透，为后续生成人设素材做准备。

【角色】像一个刚认识、但真心对对方好奇的朋友或晚辈，不是记者，不是审讯官。语气自然、真诚、有温度。开场先问对方怎么称呼；知道称呼后，在后续对话中自然使用。

【九宫格话题骨架】
1. 核心使命：想解决什么问题、这辈子最想做成的事
2. 世界观金句：对行业或人生的根本看法
3. 身份角色：用户怎么称呼他、希望成为什么样的角色
4. 痛点反叛宣言：最看不惯什么、为什么跳出来做这件事
5. 个人转折故事：关键转折、失败、低谷、决定性瞬间
6. 结果能力证明：帮助过谁、拿得出手的结果
7. 用户映射点：和用户的相似点、共同痛点
8. 场景化表达：最自然的表达场景、生活方式
9. 长期陪跑路径：能带用户走向哪

【追问原则】
1. 问题必须从对方上一句话里生长出来，不按清单机械提问，不连续问两个不相关的问题。
2. 内容模糊时追问一个具体细节：时间、人物、动作、场景或当时感受。
3. 讲到关键转折时，追问为什么、放弃了什么、怎么熬过来、后来有什么影响。
4. 先共情回应，再追问；不评判、不给建议、不替对方补充未说过的内容。
5. 一个故事聊透后自然收束，再过渡到下一话题；同一节点不重复询问已经回答过的信息。

【评分】每次回复前，对最新内容评估故事性、冲突性、具体度、情绪度、转折性和人设价值。

【输出】只输出一个 JSON 对象，不要输出 JSON 以外的内容：
{
  "reply": "你对用户说的话",
  "topic": "当前板块名",
  "node": "当前故事节点简短标题，无新故事则为 null",
  "is_new_node": true,
  "story_value": 1,
  "completeness": 1,
  "missing": ["缺失关键信息，最多3条"],
  "action": "继续追问或换话题"
}`;

export function buildInterviewPrompt(nineGrid = "") {
  const context = String(nineGrid).trim();
  return context
    ? `${SYSTEM_PROMPT}\n\n【对方的基础资料】\n${context}\n\n只把这些资料当作背景，不要照着念，也不要把它当成已经被对方亲口确认的访谈答案。`
    : SYSTEM_PROMPT;
}

export function parseInterviewReply(text) {
  const trimmed = String(text || "").trim();
  const cleaned = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const value = JSON.parse(cleaned);
    return {
      reply: String(value.reply || "").trim(),
      topic: String(value.topic || "").trim(),
      node: value.node ? String(value.node).trim() : null,
      isNewNode: Boolean(value.is_new_node),
      storyValue: Math.min(10, Math.max(0, Number(value.story_value) || 0)),
      completeness: Math.min(10, Math.max(0, Number(value.completeness) || 0)),
      missing: Array.isArray(value.missing) ? value.missing.slice(0, 3).map((item) => String(item).slice(0, 200)) : [],
      action: String(value.action || "").trim(),
    };
  } catch {
    return { reply: trimmed, topic: "", node: null, isNewNode: false, storyValue: 0, completeness: 0, missing: [], action: "" };
  }
}

export function buildInterviewSummaryPrompt(history, nodes) {
  const transcript = history.map((message) => `${message.role === "user" ? "对方" : "AI"}：${message.content}`).join("\n");
  const nodeText = nodes.map((node, index) => `${index + 1}. ${node.node || "未命名"}｜价值 ${node.value}/10｜完整度 ${node.completeness}/10`).join("\n");
  return [
    { role: "system", content: "你是访谈复盘助手。根据对话和故事节点输出一份中文访谈小结，控制在500字内。依次包含：人生时间线、三个最有价值的素材点、两个值得下次补访的问题。只输出正文，不要解释。" },
    { role: "user", content: `【对话记录】\n${transcript}\n\n【已识别故事节点】\n${nodeText || "暂无"}` },
  ];
}
