// node --test scripts/
import { test } from "node:test";
import assert from "node:assert/strict";
import { bubbleId, cleanText, renderEffect } from "./world-fx.mjs";

test("bubble text cannot break out of the command", () => {
	const line = renderEffect({ kind: "bubble", text: 'a"}]\nkill @e\\x', seconds: 5, style: "murmur" }, "clawd_test", () => 0.5);
	assert.equal(line.split("\n").length, 1);
	assert.ok(!line.includes("kill @e\\"));
	// 只有我们自己写的那些双引号，字里的都换成了全角
	const text = line.match(/text:"([^"]*)"/)[1];
	assert.equal(text, "a＂}] kill @e＼x");
});

test("control characters, colour codes and emoji are dropped, kaomoji stay", () => {
	// 只要 § 没了，后面的 c 就是普通字母
	assert.equal(cleanText("§c红\u0000色 😺 (=ↀωↀ=)"), "c红色 (=ↀωↀ=)");
	assert.equal(cleanText("x".repeat(100)).length, 60);
	assert.equal(renderEffect({ kind: "bubble", text: "😺😺", seconds: 3 }, "clawd"), null);
});

test("only known sounds and particles, only sane login names", () => {
	assert.equal(renderEffect({ kind: "sound", name: "entity.generic.explode" }, "clawd"), null);
	assert.equal(renderEffect({ kind: "particle", name: "explosion_emitter" }, "clawd"), null);
	assert.equal(renderEffect({ kind: "clear" }, "clawd @a"), null);
	assert.match(renderEffect({ kind: "sound", name: "purr" }, "clawd", () => 0.5), /^function xiaoke_fx:sound \{name:"clawd",sound:"entity\.cat\.purr",volume:"1",pitch:"1\.15"\}$/);
	assert.match(renderEffect({ kind: "particle", name: "heart" }, "clawd"), /particle:"heart"/);
});

test("each bot gets its own bubble id", () => {
	assert.notEqual(bubbleId("clawd"), bubbleId("clawd_test"));
	assert.equal(renderEffect({ kind: "clear" }, "Moby"), `function xiaoke_fx:bubble/clear {id:"${bubbleId("Moby")}"}`);
	const ttl = renderEffect({ kind: "bubble", text: "……", seconds: 999, style: "ponder" }, "clawd").match(/ttl:"(\d+)"/)[1];
	assert.equal(ttl, "600");
});
