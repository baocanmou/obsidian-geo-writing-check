import type { Extension } from '@codemirror/state';
import { MarkdownView, Notice, Plugin, debounce, type Editor } from 'obsidian';
import { analyze, defaultSettings, type Analysis, type GeoSettings } from './analysis';
import type { Mark } from './checks';
import { geoExtension } from './editor';
import { SKIPPED, buildReport } from './report';
import { GeoSettingTab } from './settings';
import { GeoView, VIEW_TYPE } from './view';

export default class GeoPlugin extends Plugin {
	settings: GeoSettings = defaultSettings();

	private editorExtension: Extension[] = [];
	private statusBar: HTMLElement | null = null;
	/** Path of the note last edited, so the side panel keeps working while it has focus. */
	private targetPath: string | null = null;
	/** The editor, side panel and status bar ask about the same text; analyze it once. */
	private cache: { path: string | null; text: string; result: Analysis } | null = null;

	async onload() {
		await this.loadSettings();

		this.registerView(VIEW_TYPE, (leaf) => new GeoView(leaf, this));
		// Fill the extension before registering it, so notes that are already open get it too.
		this.applyEditorExtension();
		this.registerEditorExtension(this.editorExtension);
		this.addSettingTab(new GeoSettingTab(this.app, this));

		this.statusBar = this.addStatusBarItem();
		this.statusBar.addClass('mod-clickable');
		this.registerDomEvent(this.statusBar, 'click', () => void this.openPanel());

		this.addRibbonIcon('scan-search', 'GEO 写作检查', () => void this.openPanel());

		this.addCommand({ id: 'open-panel', name: '打开检查面板', callback: () => void this.openPanel() });
		this.addCommand({ id: 'copy-report', name: '复制检查报告', callback: () => void this.copyReport() });
		this.addCommand({
			id: 'next-mark',
			name: '跳到下一处待修改位置',
			editorCallback: (editor, ctx) => this.nextMark(editor, ctx.file?.path ?? null, ctx.file?.basename ?? ''),
		});
		this.addCommand({
			id: 'toggle-live-mark',
			name: '开关编辑器实时标注',
			callback: async () => {
				this.settings.liveMark = !this.settings.liveMark;
				await this.saveSettings();
				new Notice(this.settings.liveMark ? '已开启实时标注' : '已关闭实时标注');
			},
		});

		const refresh = debounce(() => this.refreshPanels(), 300, true);
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (leaf?.view instanceof MarkdownView) {
					this.targetPath = leaf.view.file?.path ?? null;
					refresh();
				}
			}),
		);
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				if (file) this.targetPath = file.path;
				refresh();
			}),
		);
		this.registerEvent(this.app.workspace.on('editor-change', () => refresh()));
		this.app.workspace.onLayoutReady(() => {
			this.targetPath = this.app.workspace.getActiveViewOfType(MarkdownView)?.file?.path ?? null;
			this.refreshPanels();
		});
	}

	async loadSettings() {
		this.settings = Object.assign(defaultSettings(), (await this.loadData()) as Partial<GeoSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.cache = null;
		this.applyEditorExtension();
		this.app.workspace.updateOptions();
		this.refreshPanels();
	}

	private applyEditorExtension() {
		this.editorExtension.length = 0;
		if (this.settings.liveMark) this.editorExtension.push(geoExtension(this));
	}

	analyze(path: string | null, basename: string, text: string): Analysis {
		const c = this.cache;
		if (c && c.path === path && c.text === text) return c.result;
		const result = analyze(this.settings, path, basename, text);
		this.cache = { path, text, result };
		return result;
	}

	/** The Markdown view the side panel and status bar describe. */
	targetView(): MarkdownView | null {
		const active = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (active) return active;
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			if (leaf.view instanceof MarkdownView && leaf.view.file?.path === this.targetPath) return leaf.view;
		}
		return null;
	}

	private refreshPanels() {
		const view = this.targetView();
		if (this.statusBar) {
			const analysis = view?.file ? this.analyze(view.file.path, view.file.basename, view.editor.getValue()) : null;
			this.statusBar.setText(analysis?.active && analysis.score !== null ? `GEO ${analysis.score}` : '');
		}
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
			if (leaf.view instanceof GeoView) leaf.view.render();
		}
	}

	async openPanel() {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0] ?? null;
		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			await leaf?.setViewState({ type: VIEW_TYPE, active: true });
		}
		if (leaf) await workspace.revealLeaf(leaf);
	}

	jumpTo(mark: Mark) {
		const view = this.targetView();
		if (!view) return;
		// The panel can lag behind typing; only jump to a place the current text still has.
		const current = this.analyze(view.file?.path ?? null, view.file?.basename ?? '', view.editor.getValue());
		if (!current.marks.some((m) => m.from === mark.from && m.to === mark.to && m.check === mark.check)) {
			this.refreshPanels();
			return;
		}
		this.app.workspace.setActiveLeaf(view.leaf, { focus: true });
		this.select(view.editor, mark);
	}

	private select(editor: Editor, mark: Mark) {
		const from = editor.offsetToPos(mark.from);
		const to = editor.offsetToPos(mark.to);
		editor.setSelection(from, to);
		editor.scrollIntoView({ from, to }, true);
	}

	private nextMark(editor: Editor, path: string | null, basename: string) {
		const { marks } = this.analyze(path, basename, editor.getValue());
		if (!marks.length) {
			new Notice('没有待修改的位置');
			return;
		}
		// Marks are sorted by start, then end; take the first one after the current selection.
		const start = editor.posToOffset(editor.getCursor('from'));
		const end = editor.posToOffset(editor.getCursor('to'));
		const next = marks.find((m) => m.from > start || (m.from === start && m.to > end));
		this.select(editor, next ?? (marks[0] as Mark));
	}

	async copyReport() {
		const view = this.targetView();
		if (!view?.file) {
			new Notice('请先打开一篇笔记');
			return;
		}
		const analysis = this.analyze(view.file.path, view.file.basename, view.editor.getValue());
		if (!analysis.active) {
			new Notice(SKIPPED[analysis.skipped ?? 'scope']);
			return;
		}
		const date = window.moment().format('YYYY-MM-DD HH:mm');
		await navigator.clipboard.writeText(buildReport(view.file.basename, analysis, date));
		new Notice('检查报告已复制');
	}
}
