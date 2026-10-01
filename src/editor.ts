import { RangeSetBuilder, StateEffect, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, hoverTooltip, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { editorInfoField } from 'obsidian';
import type { Analysis } from './analysis';
import type { Mark } from './checks';

export interface EditorHost {
	analyze(path: string | null, basename: string, text: string): Analysis;
}

const MARK = Decoration.mark({ class: 'geo-mark' });
const REFRESH = StateEffect.define<null>();
/** Re-analyze this long after the last keystroke, not on every keystroke. */
const DELAY = 400;

/** Underlines the places a check points at and explains them on hover. */
export function geoExtension(host: EditorHost): Extension {
	const marker = ViewPlugin.fromClass(
		class {
			marks: Mark[] = [];
			decorations: DecorationSet = Decoration.none;
			private timer: number | null = null;

			constructor(view: EditorView) {
				this.compute(view);
			}

			update(update: ViewUpdate) {
				if (update.transactions.some((tr) => tr.effects.some((e) => e.is(REFRESH)))) {
					this.compute(update.view);
					return;
				}
				if (!update.docChanged) return;
				// Until the next analysis, keep the existing marks attached to the text they were on.
				this.decorations = this.decorations.map(update.changes);
				this.marks = this.marks
					.map((m) => ({ ...m, from: update.changes.mapPos(m.from, 1), to: update.changes.mapPos(m.to, -1) }))
					.filter((m) => m.from < m.to);
				if (this.timer !== null) window.clearTimeout(this.timer);
				const view = update.view;
				this.timer = window.setTimeout(() => {
					this.timer = null;
					view.dispatch({ effects: REFRESH.of(null) });
				}, DELAY);
			}

			destroy() {
				if (this.timer !== null) window.clearTimeout(this.timer);
			}

			compute(view: EditorView) {
				const file = view.state.field(editorInfoField, false)?.file;
				const size = view.state.doc.length;
				this.marks = host
					.analyze(file?.path ?? null, file?.basename ?? '', view.state.doc.toString())
					.marks.filter((m) => m.from < m.to && m.to <= size);
				const builder = new RangeSetBuilder<Decoration>();
				for (const m of this.marks) builder.add(m.from, m.to, MARK);
				this.decorations = builder.finish();
			}
		},
		{ decorations: (v) => v.decorations },
	);

	const tooltip = hoverTooltip((view, pos) => {
		const marks = view.plugin(marker)?.marks.filter((m) => m.from <= pos && m.to >= pos) ?? [];
		const first = marks[0];
		if (!first) return null;
		return {
			pos: first.from,
			end: first.to,
			above: true,
			create: () => {
				const dom = createDiv({ cls: 'geo-tooltip' });
				for (const m of marks) {
					dom.createDiv({ cls: 'geo-tooltip-name', text: m.name });
					dom.createDiv({ cls: 'geo-tooltip-advice', text: m.advice });
				}
				return { dom };
			},
		};
	});

	return [marker, tooltip];
}
