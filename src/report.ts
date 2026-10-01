import { STATUS_LABEL, type Finding } from './checks';
import type { Analysis } from './analysis';

export const DISCLAIMER = '分数只反映文章的结构和写法是否便于 AI 理解与引用，不代表会被收录、引用或推荐。';

export const SKIPPED = {
	scope: '这篇笔记不在检查范围内。',
	switch: '这篇笔记已在属性中关闭检查。',
	length: '这篇笔记超过 30 万字，未做检查。',
	short: '正文太短，未做检查。',
};

export function grade(score: number): string {
	if (score >= 85) return '便于引用';
	if (score >= 65) return '基本可用';
	return '需要修改';
}

export function counts(findings: Finding[]): string {
	const fail = findings.filter((f) => f.status === 'fail').length;
	const warn = findings.filter((f) => f.status === 'warn').length;
	if (!fail && !warn) return '各项均通过';
	return [fail && `需修改 ${fail} 项`, warn && `可改进 ${warn} 项`].filter(Boolean).join(' · ');
}

function cell(s: string): string {
	return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function buildReport(title: string, analysis: Analysis, date: string): string {
	const out = [
		`# GEO 写作检查报告：${title}`,
		'',
		`- 检查时间：${date}`,
		`- 正文字数：${analysis.bodyLength}`,
		`- 引用友好度：${analysis.score ?? '-'} / 100（${analysis.score === null ? '未评分' : grade(analysis.score)}）`,
		`- 结果：${counts(analysis.findings)}`,
		'',
		'| 类别 | 检查项 | 结果 | 情况 | 建议 |',
		'| --- | --- | --- | --- | --- |',
	];
	for (const f of analysis.findings) {
		out.push(`| ${f.group} | ${f.name} | ${STATUS_LABEL[f.status]} | ${cell(f.summary)} | ${cell(f.advice)} |`);
	}
	const located = analysis.findings.filter((f) => f.marks.length);
	if (located.length) {
		out.push('', '## 具体位置', '');
		for (const f of located) {
			out.push(`**${f.name}**`, '');
			for (const m of f.marks) out.push(`- 第 ${m.line} 行：${m.text}`);
			out.push('');
		}
	}
	out.push('', `> ${DISCLAIMER}`, '');
	return out.join('\n');
}
