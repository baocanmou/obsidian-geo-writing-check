import { length, lineOf, overlaps, sentences, visible, type Block, type Doc } from './markdown';

export type Status = 'pass' | 'warn' | 'fail' | 'tip';

export const STATUS_LABEL: Record<Status, string> = {
	pass: '通过',
	warn: '可改进',
	fail: '需修改',
	tip: '提示',
};

export interface Mark {
	from: number;
	to: number;
	line: number;
	text: string;
	check: string;
	name: string;
	advice: string;
}

export interface Finding {
	id: string;
	group: string;
	name: string;
	status: Status;
	/** Share of the score; a tip carries none. */
	weight: number;
	summary: string;
	advice: string;
	marks: Mark[];
}

export interface CheckConfig {
	title: string;
	keyword: string;
	entities: string[];
	hasDate: boolean;
	leadMax: number;
	paragraphMax: number;
	sentenceMax: number;
	ignore: string[];
}

export interface CheckInfo {
	id: string;
	group: string;
	name: string;
	desc: string;
}

/** Every check, in display order. Used by settings to switch checks on and off. */
export const CHECKS: CheckInfo[] = [
	{ id: 'lead', group: '直接回答', name: '开头直接回答', desc: '第一段就给出结论，不用背景铺垫或反问开场。' },
	{ id: 'section-lead', group: '直接回答', name: '小节先给结论', desc: '每个小标题下的第一段先回答，再展开。' },
	{ id: 'title', group: '直接回答', name: '标题说清主题', desc: '标题长度适中；设了关键词时，标题、开头和小标题里应出现。' },
	{ id: 'entity', group: '主体明确', name: '主体名称出现', desc: '文中写出品牌或机构的名称，并且出现得足够早。' },
	{ id: 'pronoun', group: '主体明确', name: '段落不以指代开头', desc: '段落被单独引用时，“它”“这个”“该”会失去所指。' },
	{ id: 'self-reference', group: '主体明确', name: '自称带上名称', desc: '“本公司”“我司”“小编”无法被 AI 归到具体主体。' },
	{ id: 'facts', group: '证据可核', name: '具体数字与事实', desc: '有年份、数量、比例等可核对的信息。' },
	{ id: 'source', group: '证据可核', name: '说法有出处', desc: '“数据显示”“研究表明”这类说法同句给出来源。' },
	{ id: 'vague', group: '证据可核', name: '少用空泛形容', desc: '“领先的”“一站式”“匠心”等词不提供可引用的信息。' },
	{ id: 'reference', group: '证据可核', name: '引用来源', desc: '较长的文章至少引用一处外部资料或文件。' },
	{ id: 'paragraph', group: '便于摘录', name: '段落长度', desc: '过长的段落难以被完整摘录。' },
	{ id: 'sentence', group: '便于摘录', name: '句子长度', desc: '过长的句子容易被截断或误读。' },
	{ id: 'heading', group: '便于摘录', name: '标题层级', desc: '层级不跳级；较长的文章有小标题。' },
	{ id: 'question-heading', group: '便于摘录', name: '问句式小标题', desc: '小标题写成读者会问的问题，更容易对上提问。仅作提示。' },
	{ id: 'structure', group: '便于摘录', name: '列表或表格', desc: '步骤、对比、参数适合用列表或表格。仅作提示。' },
	{ id: 'date', group: '时效清楚', name: '日期信息', desc: '属性或正文里有明确日期。' },
	{ id: 'relative-time', group: '时效清楚', name: '不用相对时间', desc: '“最近”“今年”“去年”离开发布日期后无法判断所指。' },
];

const INFO = new Map(CHECKS.map((c) => [c.id, c]));

const FILLER =
	/^(?:随着|在当今|在如今|当今|如今|近年来|近些年|众所周知|大家都知道|相信很多|相信大家|你是否|你是不是|你有没有|有没有想过|说到|提到|提起|说起|在这个[^，。]{0,12}时代|在[^，。]{0,10}的今天|俗话说|古人云|不知道大家)/;
const PRONOUN =
	/^(?:它们?|他们|她们|这个|这种|这些|这类|这样的|上述|前者|后者|其(?![实他它中次余间一二三四五六七八九十])|该(?:品牌|公司|产品|项目|方案|方法|模型|门?店|企业|机构|平台|服务|系统|工具|功能|技术|标准|规定|行业|市场|地区|城市)|此(?:举|事|法|类|种|款|项|处)|以上(?:这|几|两|三|四|五|内容|方法|做法))/;
const SELF = /本公司|我司|我公司|本店|本品牌|本机构|本平台|小编/g;
/** “一本公司相册”“日本公司” are not self-reference. */
const SELF_SKIP = /[一日基成资根版剧样书课范文脚账]本(?:公司|店|品牌|机构|平台)/g;
const CLAIM =
	/数据显示|数据表明|研究表明|研究发现|研究显示|调查显示|调研显示|据统计|据了解|据悉|报告指出|报告显示|专家表示|专家认为|专家指出|业内人士|有数据表明|科学证明/g;
const SOURCED =
	/《[^》]+》|https?:\/\/|\]\(|\[\[|来源|出自|引自|发布的|公布的|(?:会|局|部|委|署|院|所|中心|协会|学会|大学|研究院|集团|银行|机构|平台)(?:的|最新的)?(?:数据|研究|调查|调研|报告|统计)/;
const VAGUE =
	/领先的|优质的|一站式|全方位|高品质|高端大气|匠心|赋能|深耕|助力|引领|卓越|行业标杆|口碑良好|广受好评|深受喜爱|实力雄厚|经验丰富|值得信赖|专业团队|用心服务|品质保证|性价比高|备受青睐|不二之选/g;
const RELATIVE =
	/最近|近期|近日|日前|前不久|不久前|前段时间|今年|去年|明年|前年|上个月|本月|下个月|上周|本周|下周|上半年|下半年/g;
/** Ordinary words that contain a relative-time word: 如今年轻、说明年限、贴近日常、节日前后、离门店最近的. */
const RELATIVE_SKIP =
	/如今年|今年轻|年前年|过去年|[说表证声标注写查阐发聪光文鲜清透分]明年|[贴接靠邻临将附]近日|近日[常用料]|[节生假工作念止]日前|日前[后夕]|离[^，。；\n]{0,10}最近|最近的(?:地铁|门店|距离|站|路|地方|位置|城市|店|医院|学校)|[上下本]周[期边年]|本月[刊报]/g;
const FACT =
	/\d+(?:\.\d+)?\s*(?:%|％|个|家|年|月|日|天|周|小时|分钟|元|块|万|亿|千|百|倍|次|轮|版|人|位|名|款|种|项|条|张|份|台|瓶|盒|箱|平方|㎡|米|公里|毫米|厘米|毫升|升|公斤|斤|克|吨|度|岁|店|城|页|字|秒|件|套|类|步|成|折|期|届|号|mm|cm|km|ml|kg|g|m)|[¥￥$]\s*\d|(?:19|20)\d{2}/i;
const FACT_ALL = new RegExp(FACT.source, 'gi');
const ROUGH = /[一二三四五六七八九十百千两半几]+(?:成|倍|年|个月|周|天|家|万|亿|千|百)/g;
const QUESTION = /[？?]\s*$|吗|如何|怎么|怎样|为什么|为何|多少|哪些|哪个|哪里|是什么|有什么|能不能|要不要|该不该|值不值/;

/** Block-level findings underline only the first few characters, so the page stays readable. */
const BLOCK_MARK = 12;

function finding(id: string, status: Status, weight: number, summary: string, advice: string, marks: Mark[] = []): Finding {
	const info = INFO.get(id) as CheckInfo;
	// A passing check underlines nothing, so the editor never contradicts the panel.
	return {
		id,
		group: info.group,
		name: info.name,
		status,
		weight: status === 'tip' ? 0 : weight,
		summary,
		advice: status === 'pass' ? '' : advice,
		marks: status === 'pass' ? [] : marks,
	};
}

function blockMark(block: Block, id: string, advice: string): Mark {
	const lead = /^\s*(?:>+\s*|[-*+]\s+|\d+[.)、]\s+)?/.exec(block.text)?.[0].length ?? 0;
	const from = block.from + lead;
	const to = Math.min(block.to, from + BLOCK_MARK);
	return { from, to, line: block.line, text: visible(block.text).trim().slice(0, 24), check: id, name: (INFO.get(id) as CheckInfo).name, advice };
}

/** Finds a pattern in prose blocks, skipping code, link targets and ignored words. */
function findMarks(
	doc: Doc,
	re: RegExp,
	id: string,
	advice: string,
	ignore: string[],
	skip?: RegExp,
	types = ['paragraph', 'list', 'quote'],
): Mark[] {
	const marks: Mark[] = [];
	const name = (INFO.get(id) as CheckInfo).name;
	for (const block of doc.blocks) {
		if (!types.includes(block.type)) continue;
		const skipped: Array<[number, number]> = [];
		if (skip) {
			skip.lastIndex = 0;
			let s: RegExpExecArray | null;
			while ((s = skip.exec(block.text))) {
				if (!s[0]) {
					skip.lastIndex++;
					continue;
				}
				skipped.push([block.from + s.index, block.from + s.index + s[0].length]);
			}
		}
		re.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = re.exec(block.text))) {
			if (!m[0]) {
				re.lastIndex++;
				continue;
			}
			const from = block.from + m.index;
			const to = from + m[0].length;
			if (overlaps(doc.masks, from, to) || ignore.includes(m[0])) continue;
			if (skipped.some(([a, b]) => a < to && b > from)) continue;
			marks.push({ from, to, line: lineOf(doc, from), text: m[0], check: id, name, advice });
		}
	}
	return marks;
}

function byCount(count: number, warnAt: number, failAt: number): Status {
	if (count >= failAt) return 'fail';
	return count >= warnAt ? 'warn' : 'pass';
}

export function runChecks(doc: Doc, cfg: CheckConfig, disabled: string[]): Finding[] {
	const out: Finding[] = [];
	const prose = doc.blocks.filter((b) => b.type !== 'heading');
	const paragraphs = doc.blocks.filter((b) => b.type === 'paragraph');
	const headings = doc.blocks.filter((b) => b.type === 'heading');
	const bodyLength = prose.reduce((n, b) => n + length(b.text), 0);
	const on = (id: string) => !disabled.includes(id);

	// ---- 直接回答
	// The first prose a reader meets; a callout's title line is a label, not the lead.
	const lead = doc.blocks.find((b) => b.type === 'paragraph' || (b.type === 'quote' && !/^\s*>+\s*\[!/.test(b.text)));
	if (on('lead') && lead) {
		const text = visible(lead.text).trim();
		const size = length(lead.text);
		if (FILLER.test(text)) {
			const advice = '删掉铺垫，第一句直接写结论：是什么、适合谁、怎么做。';
			out.push(finding('lead', 'fail', 3, '开头是背景铺垫或反问，没有直接给出回答。', advice, [blockMark(lead, 'lead', advice)]));
		} else if (/[？?]\s*$/.test(text)) {
			const advice = '开头以问句结束，建议紧接着在同一段给出回答。';
			out.push(finding('lead', 'warn', 3, '第一段以提问结束，没有给出回答。', advice, [blockMark(lead, 'lead', advice)]));
		} else if (size > cfg.leadMax) {
			const advice = `把第一段压缩到 ${cfg.leadMax} 字以内，只留结论，细节放到后文。`;
			out.push(finding('lead', 'warn', 3, `第一段 ${size} 字，超过 ${cfg.leadMax} 字。`, advice, [blockMark(lead, 'lead', advice)]));
		} else {
			out.push(finding('lead', 'pass', 3, `第一段 ${size} 字，直接进入主题。`, ''));
		}
	}

	if (on('section-lead')) {
		const advice = '小节第一段先写这一节的结论，再展开原因和细节。';
		const marks: Mark[] = [];
		let sections = 0;
		doc.blocks.forEach((b, i) => {
			if (b.type !== 'heading' || (b.level ?? 1) < 2 || (b.level ?? 1) > 3) return;
			const next = doc.blocks[i + 1];
			if (!next || next.type !== 'paragraph') return;
			sections++;
			const text = visible(next.text).trim();
			if (FILLER.test(text) || /[？?]\s*$/.test(text)) marks.push(blockMark(next, 'section-lead', advice));
		});
		if (sections) {
			const status: Status = !marks.length ? 'pass' : marks.length * 2 > sections ? 'fail' : 'warn';
			out.push(
				finding('section-lead', status, 2, marks.length ? `${sections} 个小节中有 ${marks.length} 个以铺垫或提问开头。` : `${sections} 个小节都先给出了内容。`, marks.length ? advice : '', marks),
			);
		}
	}

	if (on('title')) {
		const size = cfg.title.replace(/\s/g, '').length;
		const problems: string[] = [];
		if (size < 8) problems.push(`标题只有 ${size} 字，主题可能说不清`);
		if (size > 32) problems.push(`标题 ${size} 字，偏长`);
		if (cfg.keyword) {
			const leadText = lead ? visible(lead.text) : '';
			const inTitle = cfg.title.includes(cfg.keyword);
			const inLead = leadText.includes(cfg.keyword);
			const inHeading = headings.some((h) => (h.level ?? 1) >= 2 && h.text.includes(cfg.keyword));
			const missing = [!inTitle && '标题', !inLead && '第一段', !inHeading && '小标题'].filter(Boolean);
			if (missing.length) problems.push(`关键词“${cfg.keyword}”未出现在${missing.join('、')}`);
		}
		const status: Status = !problems.length ? 'pass' : size < 4 ? 'fail' : 'warn';
		out.push(
			finding('title', status, 2, problems.length ? `${problems.join('；')}。` : `标题 ${size} 字${cfg.keyword ? '，关键词位置齐全' : ''}。`, problems.length ? '标题控制在 8 到 32 字，写明对象和问题；关键词自然地放进标题、第一段和一个小标题。' : ''),
		);
	}

	// ---- 主体明确
	if (on('entity')) {
		if (!cfg.entities.length) {
			out.push(finding('entity', 'tip', 0, '还没有设置主体名称。', '在设置里填写品牌或机构名称，或在笔记属性里写“品牌: 名称”，即可检查文中是否写明主体。'));
		} else {
			const body = prose.map((b) => visible(b.text)).join('\n');
			const main = cfg.entities[0] as string;
			const index = body.indexOf(main);
			const missing = cfg.entities.filter((e) => !body.includes(e));
			if (index < 0) {
				out.push(finding('entity', 'fail', 2, `正文没有出现“${main}”。`, '在第一段或前三分之一处写出完整名称，AI 才能把内容归到这个主体。'));
			} else if (index > body.length / 3) {
				out.push(finding('entity', 'warn', 2, `“${main}”出现得较晚。`, '把完整名称提前到开头部分。'));
			} else if (missing.length) {
				out.push(finding('entity', 'warn', 2, `正文未出现：${missing.join('、')}。`, '在合适的位置补上这些名称或地点。'));
			} else {
				out.push(finding('entity', 'pass', 2, `主体名称齐全，“${main}”在前三分之一出现。`, ''));
			}
		}
	}

	if (on('pronoun')) {
		const advice = '把开头的指代换成具体名称，让这一段单独拿出来也能看懂。';
		const marks = paragraphs.filter((b) => PRONOUN.test(visible(b.text).trim())).map((b) => blockMark(b, 'pronoun', advice));
		out.push(finding('pronoun', byCount(marks.length, 1, 3), 2, marks.length ? `${marks.length} 个段落以指代词开头。` : '没有以指代词开头的段落。', marks.length ? advice : '', marks));
	}

	if (on('self-reference')) {
		const advice = '换成品牌或机构的名称。';
		const marks = findMarks(doc, SELF, 'self-reference', advice, cfg.ignore, SELF_SKIP);
		out.push(finding('self-reference', byCount(marks.length, 1, 4), 1, marks.length ? `${marks.length} 处使用“本公司”“小编”等自称。` : '没有无法归属的自称。', marks.length ? advice : '', marks));
	}

	// ---- 证据可核
	if (on('facts') && bodyLength) {
		const facts = prose.reduce((n, b) => n + (visible(b.text).match(FACT_ALL) ?? []).length, 0);
		const density = (facts * 1000) / bodyLength;
		// Rounded quantities written in Chinese numerals (三成、两倍) soften a miss but do not replace exact figures.
		const rough = prose.reduce((n, b) => n + (visible(b.text).match(ROUGH) ?? []).length, 0);
		const status: Status = facts === 0 ? (rough ? 'warn' : 'fail') : density < 3 ? 'warn' : 'pass';
		const summary = facts
			? `${facts} 处具体数字或年份，约每千字 ${density.toFixed(1)} 处。`
			: rough
				? `全文没有阿拉伯数字或年份，只有 ${rough} 处概数。`
				: '全文没有具体数字或年份。';
		out.push(
			finding('facts', status, 3, summary, status === 'pass' ? '' : '补充可核对的事实：年份、数量、比例、价格区间、步骤数。只写有依据的数字。'),
		);
	}

	if (on('source')) {
		const advice = '在同一句写明来源：机构、文件名或年份；没有来源就改成自己的观察，或删掉这个说法。';
		const marks: Mark[] = [];
		for (const block of prose) {
			for (const s of sentences(block)) {
				if (SOURCED.test(s.text)) continue;
				CLAIM.lastIndex = 0;
				let m: RegExpExecArray | null;
				while ((m = CLAIM.exec(s.text))) {
					const from = s.from + m.index;
					if (overlaps(doc.masks, from, from + m[0].length) || cfg.ignore.includes(m[0])) continue;
					marks.push({ from, to: from + m[0].length, line: lineOf(doc, from), text: m[0], check: 'source', name: '说法有出处', advice });
				}
			}
		}
		out.push(finding('source', byCount(marks.length, 1, 2), 3, marks.length ? `${marks.length} 处引述没有写明来源。` : '没有缺少来源的引述。', marks.length ? advice : '', marks));
	}

	if (on('vague') && bodyLength) {
		const advice = '换成能核对的事实，例如做了多少年、服务过多少家、具体做法是什么。';
		const marks = findMarks(doc, VAGUE, 'vague', advice, cfg.ignore);
		const density = (marks.length * 1000) / bodyLength;
		const status: Status = density > 3 ? 'fail' : density > 1 ? 'warn' : 'pass';
		out.push(finding('vague', status, 2, marks.length ? `${marks.length} 处空泛形容，约每千字 ${density.toFixed(1)} 处。` : '没有空泛形容。', status === 'pass' ? '' : advice, marks));
	}

	if (on('reference') && bodyLength >= 800) {
		const body = doc.blocks.map((b) => b.text).join('\n');
		const count = (body.match(/https?:\/\/|《[^》]+》/g) ?? []).length;
		out.push(
			finding('reference', count ? 'pass' : 'warn', 1, count ? `引用了 ${count} 处链接或文件。` : '全文没有引用任何外部资料或文件。', count ? '' : '关键论据处引用一处可查的资料：法规、标准、公开报告或官方页面。'),
		);
	}

	// ---- 便于摘录
	if (on('paragraph')) {
		const advice = `拆成两到三段，每段只讲一件事，控制在 ${cfg.paragraphMax} 字以内。`;
		const marks = paragraphs.filter((b) => length(b.text) > cfg.paragraphMax).map((b) => blockMark(b, 'paragraph', advice));
		out.push(finding('paragraph', byCount(marks.length, 1, 3), 2, marks.length ? `${marks.length} 个段落超过 ${cfg.paragraphMax} 字。` : `没有超过 ${cfg.paragraphMax} 字的段落。`, marks.length ? advice : '', marks));
	}

	if (on('sentence')) {
		const advice = `拆成两句，每句控制在 ${cfg.sentenceMax} 字以内。`;
		const marks: Mark[] = [];
		for (const block of paragraphs) {
			for (const s of sentences(block)) {
				if (length(s.text) <= cfg.sentenceMax) continue;
				const pad = s.text.length - s.text.trimStart().length;
				const from = s.from + pad;
				marks.push({ from, to: Math.min(s.to, from + BLOCK_MARK), line: lineOf(doc, from), text: visible(s.text).trim().slice(0, 24), check: 'sentence', name: '句子长度', advice });
			}
		}
		out.push(finding('sentence', byCount(marks.length, 1, 5), 1, marks.length ? `${marks.length} 个句子超过 ${cfg.sentenceMax} 字。` : `没有超过 ${cfg.sentenceMax} 字的句子。`, marks.length ? advice : '', marks));
	}

	if (on('heading')) {
		const problems: string[] = [];
		if (headings.filter((h) => h.level === 1).length > 1) problems.push('有多个一级标题');
		let previous = 0;
		let skipped = false;
		for (const h of headings) {
			const level = h.level ?? 1;
			if (previous && level > previous + 1) skipped = true;
			previous = level;
		}
		if (skipped) problems.push('标题层级有跳级');
		const noHeadings = bodyLength >= 800 && !headings.some((h) => (h.level ?? 1) >= 2);
		if (noHeadings) problems.push(`正文 ${bodyLength} 字但没有小标题`);
		out.push(finding('heading', noHeadings ? 'fail' : problems.length ? 'warn' : 'pass', 1, problems.length ? `${problems.join('；')}。` : '标题层级正常。', problems.length ? '全文只留一个一级标题，按二级、三级依次展开；较长的文章用小标题分节。' : ''));
	}

	const subheadings = headings.filter((h) => (h.level ?? 1) >= 2);
	if (on('question-heading') && subheadings.length) {
		const asked = subheadings.filter((h) => QUESTION.test(h.text)).length;
		out.push(
			finding('question-heading', asked ? 'pass' : 'tip', 0, asked ? `${subheadings.length} 个小标题中有 ${asked} 个是问句。` : '小标题里没有问句。', asked ? '' : '可以把一两个小标题写成读者会问的问题，例如“多久能见效？”。不必每个都改。'),
		);
	}

	if (on('structure') && bodyLength >= 1000) {
		const has = doc.blocks.some((b) => b.type === 'list' || b.type === 'table');
		out.push(finding('structure', has ? 'pass' : 'tip', 0, has ? '用了列表或表格。' : '全文没有列表或表格。', has ? '' : '如果有步骤、对比或参数，可以改成列表或表格；没有就不必硬加。'));
	}

	// ---- 时效清楚
	if (on('date')) {
		const inBody = /(?:19|20)\d{2}\s*年|(?:19|20)\d{2}[-/.]\d{1,2}/.test(prose.map((b) => b.text).join('\n'));
		const ok = cfg.hasDate || inBody;
		out.push(finding('date', ok ? 'pass' : 'warn', 1, ok ? (cfg.hasDate ? '属性里有日期。' : '正文里有明确年份。') : '属性和正文里都没有明确日期。', ok ? '' : '在笔记属性里写上发布日期或更新日期，或在正文注明年份。'));
	}

	if (on('relative-time')) {
		const advice = '换成具体的年月，例如“2026 年 9 月”。';
		const marks = findMarks(doc, RELATIVE, 'relative-time', advice, cfg.ignore, RELATIVE_SKIP);
		out.push(finding('relative-time', byCount(marks.length, 1, 3), 2, marks.length ? `${marks.length} 处相对时间。` : '没有相对时间表述。', marks.length ? advice : '', marks));
	}

	return out;
}

const POINTS: Record<Status, number> = { pass: 1, warn: 0.5, fail: 0, tip: 0 };

/** 0 to 100, weighted over the scored checks; null when nothing was scored. */
export function score(findings: Finding[]): number | null {
	const total = findings.reduce((n, f) => n + f.weight, 0);
	if (!total) return null;
	return Math.round((findings.reduce((n, f) => n + f.weight * POINTS[f.status], 0) / total) * 100);
}
