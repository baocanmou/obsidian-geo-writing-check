import { CHECKS, runChecks, score, type CheckConfig, type Finding, type Mark } from './checks';
import { length, parse } from './markdown';

export interface GeoSettings {
	liveMark: boolean;
	/** One name per line; the first is the main entity. */
	entities: string;
	entityKeys: string;
	keywordKeys: string;
	titleKeys: string;
	dateKeys: string;
	switchKey: string;
	leadMax: number;
	paragraphMax: number;
	sentenceMax: number;
	minLength: number;
	disabledChecks: string[];
	ignoreWords: string;
	includeFolders: string;
	excludeFolders: string;
}

export const DEFAULT_SETTINGS: GeoSettings = {
	liveMark: true,
	entities: '',
	entityKeys: '品牌, brand, GEO主体',
	keywordKeys: '主关键词, 目标关键词, primary_keyword, keyword',
	titleKeys: 'title, meta_title, 标题',
	dateKeys: '发布日期, 更新日期, date, updated, published_at, modified_at, created',
	switchKey: 'GEO检查',
	leadMax: 150,
	paragraphMax: 220,
	sentenceMax: 80,
	minLength: 300,
	disabledChecks: [],
	ignoreWords: '',
	includeFolders: '',
	excludeFolders: '',
};

export function defaultSettings(): GeoSettings {
	return { ...DEFAULT_SETTINGS, disabledChecks: [] };
}

export interface Analysis {
	/** False when the note is not checked; `skipped` says why. */
	active: boolean;
	skipped?: 'scope' | 'switch' | 'length' | 'short';
	score: number | null;
	bodyLength: number;
	findings: Finding[];
	/** Every location worth showing in the editor, in document order. */
	marks: Mark[];
}

/** Notes longer than this are not checked, to keep typing responsive. */
const MAX_LENGTH = 300_000;

function lines(text: string): string[] {
	return text
		.split(/\r?\n/)
		.map((s) => s.trim())
		.filter((s) => s && !s.startsWith('#'));
}

function keys(text: string): string[] {
	return text
		.split(/[,，、]/)
		.map((s) => s.trim())
		.filter(Boolean);
}

function inFolder(path: string, folder: string): boolean {
	const f = folder.replace(/^\/+|\/+$/g, '');
	return f === '' || path === f || path.startsWith(f + '/');
}

export function analyze(settings: GeoSettings, path: string | null, basename: string, text: string): Analysis {
	const skip = (skipped: Analysis['skipped']): Analysis => ({ active: false, skipped, score: null, bodyLength: 0, findings: [], marks: [] });
	if (text.length > MAX_LENGTH) return skip('length');
	if (path !== null) {
		const include = lines(settings.includeFolders);
		if (include.length && !include.some((f) => inFolder(path, f))) return skip('scope');
		if (lines(settings.excludeFolders).some((f) => inFolder(path, f))) return skip('scope');
	}

	const doc = parse(text);
	const fm = doc.frontmatter;
	const first = (names: string) => {
		for (const k of keys(names)) {
			const v = fm[k]?.[0];
			if (v) return v;
		}
		return '';
	};
	if (/^(false|no|off|否|关|关闭)$/i.test(fm[settings.switchKey]?.[0] ?? '')) return skip('switch');

	const bodyLength = doc.blocks.filter((b) => b.type !== 'heading').reduce((n, b) => n + length(b.text), 0);
	if (bodyLength < settings.minLength) return { ...skip('short'), bodyLength };

	const noteEntities = keys(settings.entityKeys).flatMap((k) => fm[k] ?? []);
	const config: CheckConfig = {
		title: first(settings.titleKeys) || doc.blocks.find((b) => b.type === 'heading' && b.level === 1)?.text || basename,
		keyword: first(settings.keywordKeys),
		// A note's own entity comes first, so it becomes the main one for that note.
		entities: [...new Set([...noteEntities, ...lines(settings.entities)])],
		hasDate: !!first(settings.dateKeys),
		leadMax: settings.leadMax,
		paragraphMax: settings.paragraphMax,
		sentenceMax: settings.sentenceMax,
		ignore: lines(settings.ignoreWords),
	};
	const known = new Set(CHECKS.map((c) => c.id));
	const findings = runChecks(doc, config, settings.disabledChecks.filter((id) => known.has(id)));
	const marks = findings.flatMap((f) => f.marks).sort((a, b) => a.from - b.from || a.to - b.to);
	return { active: true, score: score(findings), bodyLength, findings, marks };
}
