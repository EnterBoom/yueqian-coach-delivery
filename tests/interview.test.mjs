import assert from "node:assert/strict";
import test from "node:test";
import { buildInterviewPrompt, buildInterviewSummaryPrompt, parseInterviewReply } from "../lib/interview.mjs";

test("interview prompt uses optional context without treating it as an answer", () => {
  const plain = buildInterviewPrompt("");
  const enriched = buildInterviewPrompt("做过十年线下教育");
  assert.match(plain, /九宫格话题骨架/);
  assert.match(enriched, /做过十年线下教育/);
  assert.match(enriched, /不要把它当成已经被对方亲口确认/);
});

test("interview replies tolerate fenced JSON and clamp metrics", () => {
  const parsed = parseInterviewReply('```json\n{"reply":"继续讲讲","topic":"个人转折故事","node":"离开大厂","is_new_node":true,"story_value":12,"completeness":7,"missing":["时间"]}\n```');
  assert.equal(parsed.reply, "继续讲讲");
  assert.equal(parsed.node, "离开大厂");
  assert.equal(parsed.isNewNode, true);
  assert.equal(parsed.storyValue, 10);
  assert.deepEqual(parsed.missing, ["时间"]);
});

test("summary prompt contains transcript and story nodes", () => {
  const messages = buildInterviewSummaryPrompt(
    [{ role: "user", content: "我在2020年转行" }, { role: "assistant", content: "当时发生了什么？" }],
    [{ node: "第一次转行", value: 8, completeness: 6 }],
  );
  assert.match(messages[1].content, /我在2020年转行/);
  assert.match(messages[1].content, /第一次转行/);
});
