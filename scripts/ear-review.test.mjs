// node --test scripts/ear-review.test.mjs
// 耳朵里几个纯判断：[旁听] 不触发 [回顾]、给决策脑看的“这段时间嘴巴那边”、聊天里叫没叫她的名字
import { test } from "node:test";
import assert from "node:assert/strict";

// EAR_TEST=1：只导入函数，不开端口、不连服务器、不起定时器
process.env.EAR_TEST = "1";
const { addToDigest, formatDigest, reviewDue, myNames, mentionsMe } = await import("./ear-server.mjs");

const MIN = 60 * 1000;

test("overheard lines alone never trigger a review", () => {
	const entries = [];
	for (let i = 0; i < 20; i++) addToDigest(entries, `21:${10 + i} [旁听] Tester: 好厉害啊（在跟 Friend 说）`, true);
	assert.equal(reviewDue(entries, 60 * MIN, 4 * MIN), false);
	// 嘴巴那边真跟人打过交道才叫
	addToDigest(entries, "21:40 [聊天] Tester: 小克你在干嘛");
	assert.equal(reviewDue(entries, 60 * MIN, 4 * MIN), true);
	assert.equal(reviewDue(entries, 3 * MIN, 4 * MIN), false);
	assert.equal(reviewDue([], 60 * MIN, 4 * MIN), false);
});

test("digest shows overheard lines as context, marked and explained", () => {
	const entries = [];
	addToDigest(entries, "21:03 [聊天] Tester: 小克你好");
	addToDigest(entries, "21:04 [旁听] Tester: Friend 你今天去哪了（在跟 Friend 说）", true);
	const text = formatDigest(entries);
	assert.ok(text.startsWith("　（这段时间嘴巴那边：21:03 [聊天] Tester: 小克你好 ／ 21:04 [旁听] Tester: Friend"));
	assert.ok(text.includes("标着 [旁听] 的是旁边的人互相在聊，不是对你说的"));
	assert.ok(text.endsWith("）"));
	// 没有 [旁听] 时跟以前一样
	assert.equal(formatDigest([{ text: "21:05 你: 好呀", overheard: false }]), "　（这段时间嘴巴那边：21:05 你: 好呀）");
	assert.equal(formatDigest([]), "");
});

test("chatter is evicted before what the mouth actually did", () => {
	const entries = [];
	addToDigest(entries, "21:00 [聊天] Tester: 小克帮我拿点木头");
	addToDigest(entries, "21:01 你: 好的");
	for (let i = 0; i < 60; i++) addToDigest(entries, `21:${i} [旁听] Friend: 第 ${i} 句`, true);
	assert.equal(entries.filter(e => e.overheard).length, 12);
	assert.deepEqual(entries.filter(e => !e.overheard).map(e => e.text), ["21:00 [聊天] Tester: 小克帮我拿点木头", "21:01 你: 好的"]);
	// 留下的是最近的旁听
	assert.equal(entries.at(-1).text, "21:59 [旁听] Friend: 第 59 句");
	// 总量上限还在：最多 40 条、3000 字，太长的一条截到 200 字
	const many = [];
	for (let i = 0; i < 50; i++) addToDigest(many, `第 ${i} 件事 ${"啊".repeat(300)}`);
	assert.ok(many.length <= 40);
	assert.ok(many.map(e => e.text).join(" ／ ").length <= 3000);
	assert.ok(many.every(e => e.text.length <= 201));
});

test("her names come from her own nick and login only", () => {
	assert.deepEqual(myNames("小克test", "clawd_test"), ["小克test", "小克", "clawd_test"]);
	assert.deepEqual(myNames("小克", "clawd"), ["小克", "clawd"]);
});

test("the test bot is not called when a visitor calls the official clawd", () => {
	const names = myNames("小克test", "clawd_test");
	assert.equal(mentionsMe("clawd 过来一下", names, ["Tester", "clawd", "Moby"]), false);
	assert.equal(mentionsMe("clawd_test 过来一下", names, ["Tester", "clawd", "Moby"]), true);
	assert.equal(mentionsMe("小克test 你好", names, ["Tester", "clawd"]), true);
});

test("the official clawd is not called when a visitor calls clawd_test", () => {
	const names = myNames("小克", "clawd");
	assert.equal(mentionsMe("CLAWD_TEST 过来一下", names, ["Tester", "clawd_test"]), false);
	assert.equal(mentionsMe("clawd 过来一下", names, ["Tester", "clawd_test"]), true);
	// 两个都叫到了，就也算叫了她
	assert.equal(mentionsMe("clawd_test 和 clawd 都过来", names, ["clawd_test"]), true);
	assert.equal(mentionsMe("小克你好", names, ["clawd_test"]), true);
});
