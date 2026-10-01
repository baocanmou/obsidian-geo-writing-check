import { ItemView, type WorkspaceLeaf } from 'obsidian';
import { STATUS_LABEL, type Finding } from './checks';
import type GeoPlugin from './main';
import { DISCLAIMER, SKIPPED, counts, grade } from './report';

export const VIEW_TYPE = 'geo-writing-check';

/** How many locations a check lists before folding the rest into a count. */
const MAX_MARKS = 12;

/** Side panel: the score, then every check with its locations. */
export class GeoView extends ItemView {
	constructor(
		leaf: WorkspaceLeaf,
		private plugin: GeoPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'GEO 写作检查';
	}

	getIcon(): string {
		return 'scan-search';
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	render(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass('geo-view');

		const target = this.plugin.targetView();
		if (!target?.file) {
			root.createDiv({ cls: 'geo-empty', text: '打开一篇文章后，这里显示检查结果。' });
			return;
		}
		const analysis = this.plugin.analyze(target.file.path, target.file.basename, target.editor.getValue());

		const head = root.createDiv({ cls: 'geo-head' });
		head.createDiv({ cls: 'geo-title', text: target.file.basename });
		if (!analysis.active) {
			root.createDiv({ cls: 'geo-empty', text: SKIPPED[analysis.skipped ?? 'scope'] });
			return;
		}
		if (analysis.score !== null) {
			const level = analysis.score >= 85 ? 'pass' : analysis.score >= 65 ? 'warn' : 'fail';
			const scoreEl = head.createDiv({ cls: `geo-score geo-score-${level}` });
			scoreEl.createSpan({ cls: 'geo-score-number', text: String(analysis.score) });
			scoreEl.createSpan({ cls: 'geo-score-label', text: `引用友好度 · ${grade(analysis.score)}` });
		}
		head.createDiv({ cls: 'geo-summary', text: `${counts(analysis.findings)} · 正文 ${analysis.bodyLength} 字` });
		const copy = head.createEl('button', { text: '复制检查报告' });
		copy.addEventListener('click', () => void this.plugin.copyReport());

		let group = '';
		for (const f of analysis.findings) {
			if (f.group !== group) {
				group = f.group;
				root.createDiv({ cls: 'geo-group', text: group });
			}
			this.renderFinding(root, f);
		}
		root.createDiv({ cls: 'geo-disclaimer', text: DISCLAIMER });
	}

	private renderFinding(root: HTMLElement, f: Finding): void {
		const item = root.createDiv({ cls: `geo-item geo-item-${f.status}` });
		const head = item.createDiv({ cls: 'geo-item-head' });
		head.createSpan({ cls: `geo-badge geo-badge-${f.status}`, text: STATUS_LABEL[f.status] });
		head.createSpan({ cls: 'geo-item-name', text: f.name });
		item.createDiv({ cls: 'geo-item-summary', text: f.summary });
		if (f.advice) item.createDiv({ cls: 'geo-item-advice', text: f.advice });

		if (!f.marks.length) return;
		const list = item.createDiv({ cls: 'geo-item-marks' });
		for (const m of f.marks.slice(0, MAX_MARKS)) {
			const row = list.createDiv({ cls: 'geo-item-mark' });
			row.createSpan({ cls: 'geo-item-line', text: `第 ${m.line} 行` });
			row.createSpan({ text: m.text });
			row.addEventListener('click', () => this.plugin.jumpTo(m));
		}
		if (f.marks.length > MAX_MARKS) {
			list.createDiv({ cls: 'geo-item-more', text: `另有 ${f.marks.length - MAX_MARKS} 处` });
		}
	}
}
