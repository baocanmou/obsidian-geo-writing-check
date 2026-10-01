import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SETTINGS, analyze, type GeoSettings } from '../src/analysis';
import { parse } from '../src/markdown';
import { buildReport } from '../src/report';

const FILL = '品牌设计的周期取决于调研深度和确认轮次，常见做法是先定位再做视觉。'.repeat(12);

function run(text: string, overrides: Partial<GeoSettings> = {}, path: string | null = 'a.md') {
	return analyze({ ...DEFAULT_SETTINGS, ...overrides }, path, '文件名', text);
}
function status(text: string, id: string, overrides: Partial<GeoSettings> = {}) {
	return run(text, overrides).findings.find((f) => f.id === id)?.status;
}

test('parser: frontmatter, blocks, code and comments', () => {
	const doc = parse('---\ntitle: 标题\n主关键词: [南昌VI设计, 备用]\ntags:\n  - a\n  - b\n---\n# 一级\n\n第一段\n接着写\n\n- 列表\n> 引用\n\n```\n代码\n```\n\n%%\n注释\n%%\n\n| a | b |\n');
	assert.deepEqual(doc.frontmatter, { title: ['标题'], 主关键词: ['南昌VI设计', '备用'], tags: ['a', 'b'] });
	assert.deepEqual(doc.blocks.map((b) => [b.type, b.line]), [['heading', 8], ['paragraph', 10], ['paragraph', 11], ['list', 13], ['quote', 14], ['table', 24]]);
	assert.equal(doc.blocks[1]!.text, '第一段');
});

test('short notes are skipped, long enough notes are scored', () => {
	assert.equal(run('太短了。').skipped, 'short');
	const a = run(`# 品牌设计要多久\n\n品牌设计通常需要 4 到 8 周。\n\n${FILL}`);
	assert.equal(a.active, true);
	assert.ok(a.score !== null && a.score > 0 && a.score <= 100);
});

test('lead: filler, question and length', () => {
	assert.equal(status(`随着市场竞争加剧，品牌越来越重要。\n\n${FILL}`, 'lead'), 'fail');
	assert.equal(status(`做品牌设计到底要多久？\n\n${FILL}`, 'lead'), 'warn');
	assert.equal(status(`${'很长的开头'.repeat(40)}。\n\n${FILL}`, 'lead'), 'warn');
	assert.equal(status(`品牌设计通常需要 4 到 8 周。\n\n${FILL}`, 'lead'), 'pass');
});

test('section leads are checked under H2 and H3 only', () => {
	const text = `开头直接回答。\n\n## 周期\n\n众所周知，时间很重要。\n\n## 价格\n\n价格在 3 万到 8 万之间。\n\n${FILL}`;
	const f = run(text).findings.find((x) => x.id === 'section-lead')!;
	assert.equal(f.status, 'warn');
	assert.equal(f.marks.length, 1);
	assert.equal(f.marks[0]!.line, 5);
});

test('keyword placement and title length', () => {
	const fm = '---\n主关键词: 南昌VI设计\n---\n';
	assert.equal(status(`${fm}# 南昌VI设计怎么选公司\n\n南昌VI设计的价格在 3 万到 8 万。\n\n## 南昌VI设计的周期\n\n${FILL}`, 'title'), 'pass');
	assert.equal(status(`${fm}# 怎么选一家设计公司才靠谱\n\n价格在 3 万到 8 万。\n\n${FILL}`, 'title'), 'warn');
	assert.equal(status(`# 短\n\n直接回答。\n\n${FILL}`, 'title'), 'fail');
	assert.equal(status(`# 六个字的标题\n\n直接回答。\n\n${FILL}`, 'title'), 'warn');
});

test('entity: unset is a tip, missing fails, late warns, note property takes over', () => {
	const body = `开头直接回答。\n\n${FILL}`;
	assert.equal(status(body, 'entity'), 'tip');
	assert.equal(status(body, 'entity', { entities: '包参谋' }), 'fail');
	assert.equal(status(`包参谋的做法是先定位。\n\n${FILL}`, 'entity', { entities: '包参谋' }), 'pass');
	assert.equal(status(`${body}\n\n最后才提到包参谋。`, 'entity', { entities: '包参谋' }), 'warn');
	assert.equal(status(`---\n品牌: 木标网\n---\n木标网提供商标查询。\n\n${FILL}`, 'entity', { entities: '包参谋' }), 'warn');
});

test('pronoun-led paragraphs, with common non-pronoun words left alone', () => {
	const f = run(`开头直接回答。\n\n它的优势在于速度。\n\n其实这并不难。\n\n此外还要注意预算。\n\n该怎么办呢。\n\n${FILL}`).findings.find((x) => x.id === 'pronoun')!;
	assert.deepEqual(f.marks.map((m) => m.line), [3]);
});

test('unsourced claims are flagged; sourced ones are not', () => {
	const text = `开头直接回答。\n\n数据显示，七成顾客会复购。\n\n《2025 餐饮报告》数据显示，七成顾客会复购。\n\n${FILL}`;
	const f = run(text).findings.find((x) => x.id === 'source')!;
	assert.deepEqual(f.marks.map((m) => [m.text, m.line]), [['数据显示', 3]]);
});

test('facts, vague words, relative time and self-reference', () => {
	assert.equal(status(`开头直接回答。\n\n${FILL}`, 'facts'), 'fail');
	assert.equal(status(`开头直接回答，大约三成顾客会复购。\n\n${FILL}`, 'facts'), 'warn');
	assert.equal(status(`2019 年成立，服务过 43 家客户，单项目 4 到 8 周，报价 3 万起，复购率 60%。\n\n${FILL}`, 'facts'), 'pass');
	const a = run(`我们是领先的一站式服务商，本公司最近完成了升级，去年开始深耕餐饮。\n\n${FILL}`);
	const marks = (id: string) => a.findings.find((f) => f.id === id)!.marks.map((m) => m.text);
	assert.deepEqual(marks('vague'), ['领先的', '一站式', '深耕']);
	assert.deepEqual(marks('relative-time'), ['最近', '去年']);
	assert.deepEqual(marks('self-reference'), ['本公司']);
	const ignored = run(`我们是领先的一站式服务商。\n\n${FILL}`, { ignoreWords: '一站式' });
	assert.deepEqual(ignored.findings.find((f) => f.id === 'vague')!.marks.map((m) => m.text), ['领先的']);
});

test('long paragraphs and sentences are marked at their start only', () => {
	const long = `${'这一句没有标点一直写下去'.repeat(30)}。`;
	const a = run(`开头直接回答。\n\n${long}\n\n${FILL}`);
	const p = a.findings.find((f) => f.id === 'paragraph')!;
	assert.equal(p.marks[0]!.line, 3);
	assert.equal(p.marks[0]!.to - p.marks[0]!.from, 12);
	assert.ok(a.findings.find((f) => f.id === 'sentence')!.marks.length >= 1);
});

test('headings: skipped levels warn, long text without subheadings fails', () => {
	assert.equal(status(`# 标题\n\n开头直接回答。\n\n#### 跳级\n\n${FILL}`, 'heading'), 'warn');
	assert.equal(status(`开头直接回答。\n\n${FILL}\n\n${FILL}\n\n${FILL}`, 'heading'), 'fail');
	assert.equal(status(`# 标题\n\n开头直接回答。\n\n## 小节\n\n${FILL}`, 'heading'), 'pass');
});

test('tips carry no weight; disabled checks disappear', () => {
	const a = run(`# 标题够长的一个标题\n\n开头直接回答。\n\n## 小节\n\n${FILL}\n\n${FILL}\n\n${FILL}`);
	const tips = a.findings.filter((f) => f.status === 'tip');
	assert.ok(tips.length >= 2);
	assert.ok(tips.every((f) => f.weight === 0));
	const b = run(`开头直接回答。\n\n${FILL}`, { disabledChecks: ['lead', 'facts'] });
	assert.equal(b.findings.some((f) => f.id === 'lead' || f.id === 'facts'), false);
});

test('scope, per-note switch, date property', () => {
	assert.equal(run(`开头。\n\n${FILL}`, { includeFolders: '内容' }, '别处/a.md').skipped, 'scope');
	assert.equal(run(`---\nGEO检查: false\n---\n开头。\n\n${FILL}`).skipped, 'switch');
	assert.equal(status(`---\n发布日期: 2026-09-01\n---\n开头直接回答。\n\n${FILL}`, 'date'), 'pass');
	assert.equal(status(`开头直接回答。\n\n${FILL}`, 'date'), 'warn');
});

test('marks stay inside the text, skip code and link targets, and the report builds', () => {
	const text = `开头直接回答。\n\n\`最近\` 的代码和[链接](https://a.com/最近)不算，但最近要算。\n\n\`\`\`\n去年\n\`\`\`\n\n${FILL}`;
	const a = run(text);
	assert.deepEqual(a.findings.find((f) => f.id === 'relative-time')!.marks.map((m) => text.slice(m.from, m.to)), ['最近']);
	assert.ok(a.marks.every((m) => m.from >= 0 && m.to <= text.length && m.from < m.to));
	const report = buildReport('标题', a, '2026-10-02 10:00');
	assert.ok(report.includes('引用友好度') && report.includes('| 时效清楚 | 不用相对时间 | 可改进 |'));
});

test('long input stays fast', () => {
	const start = Date.now();
	run(`开头直接回答。\n\n${FILL.repeat(200)}`);
	assert.ok(Date.now() - start < 1500);
});

test('review: relative-time words inside ordinary phrases are not flagged', () => {
	const safe = '如今年轻人更看重体验，节日前后客流最高，离门店最近的地铁站步行可达，附近日料店也多，说明年限要写清，十年前年轻人不这样，贴近日常，过去年份的数据，投标截止日前提交。';
	const a = run(`开头直接回答。\n\n${safe}\n\n${FILL}`);
	assert.deepEqual(a.findings.find((f) => f.id === 'relative-time')!.status, 'pass');
	const b = run(`开头直接回答。\n\n最近我们改了方案，去年开始做，今年会扩店。\n\n${FILL}`);
	assert.deepEqual(b.findings.find((f) => f.id === 'relative-time')!.marks.map((m) => m.text), ['最近', '去年', '今年']);
});

test('review: self-reference and sources', () => {
	const a = run(`开头直接回答。\n\n做一本公司相册，一本品牌手册，日本公司的做法。请咨询有关部门。乘联会的数据显示销量上涨。\n\n${FILL}`);
	assert.equal(a.findings.find((f) => f.id === 'self-reference')!.status, 'pass');
	assert.equal(a.findings.find((f) => f.id === 'source')!.status, 'pass');
});

test('review: units and currency count as facts', () => {
	for (const t of ['周期通常是 4 到 8 周。', '尺寸 200mm，容量 500ml，重 2kg。', '设计费 ¥3000 起。']) {
		assert.notEqual(status(`${t}\n\n${FILL}`, 'facts'), 'fail', t);
	}
});

test('review: a passing check never underlines, one long sentence is a warning', () => {
	const a = run(`我们有专业团队。\n\n${FILL}\n\n${FILL}\n\n${FILL}`);
	const vague = a.findings.find((f) => f.id === 'vague')!;
	assert.equal(vague.status, 'pass');
	assert.equal(vague.marks.length, 0);
	assert.ok(a.findings.filter((f) => f.status === 'pass').every((f) => !f.marks.length && !f.advice));
	const long = `${'这一句没有标点一直写下去'.repeat(10)}。`;
	assert.equal(status(`开头直接回答。\n\n${long}\n\n${FILL}`, 'sentence'), 'warn');
});

test('review: %% inside code does not hide the prose after it', () => {
	const text = `开头直接回答。\n\n\`\`\`sql\nWHERE a LIKE '%%'\n\`\`\`\n\n本公司最近的数据显示增长。\n\n%% 注释 %%\n\n${FILL}`;
	const a = run(text);
	assert.ok(a.findings.find((f) => f.id === 'self-reference')!.marks.length === 1);
	assert.ok(a.findings.find((f) => f.id === 'relative-time')!.marks.length === 1);
});

test('review: each line is a paragraph; list continuation and indented fences', () => {
	const lines = `第一行直接回答，品牌设计要 4 到 8 周。\n${FILL}\n${FILL}`;
	const a = run(lines);
	assert.equal(a.findings.find((f) => f.id === 'lead')!.status, 'pass');
	const doc = parse('- 列表项\n  接着写\n    \`\`\`\n    本公司\n    \`\`\`\n');
	assert.deepEqual(doc.blocks.map((b) => [b.type, b.text]), [['list', '- 列表项\n  接着写']]);
});

test('review: frontmatter and lead edge cases', () => {
	assert.equal(status(`---\n品牌: 包参谋, 南昌\n---\n包参谋在南昌做品牌设计。\n\n${FILL}`, 'entity'), 'pass');
	const folded = run(`---\ntitle: >\n  南昌品牌设计公司怎么选\n---\n直接回答。\n\n${FILL}`);
	assert.equal(folded.findings.find((f) => f.id === 'title')!.status, 'pass');
	assert.equal(status(`#品牌 #设计\n随着市场变化，品牌越来越重要。\n\n${FILL}`, 'lead'), 'fail');
	assert.equal(status(`> [!tip] 摘要\n> 随着市场变化，品牌越来越重要。\n\n${FILL}`, 'lead'), 'fail');
	assert.equal(status(`开头直接回答。\n\n其一，先定位。其二，再设计。\n\n${FILL}`, 'pronoun'), 'pass');
});

test('review: pathological input stays fast', () => {
	for (const text of [
		`# a${' '.repeat(60000)}b\n\n${FILL}`,
		`开头。\n\n${'](x'.repeat(20000)}\n\n${FILL}`,
		`开头。\n\n${'最近'.repeat(35000)}\n\n${FILL}`,
	]) {
		const start = Date.now();
		run(text);
		assert.ok(Date.now() - start < 1500, `${Date.now() - start}ms`);
	}
});
