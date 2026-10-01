import { RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, hoverTooltip, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { editorInfoField } from 'obsidian';
import type { Analysis } from './analysis';
import type { Mark } from './checks';

export interface EditorHost {
	analyze(path: string | null, basename: string, text: string): Analysis;
}

const MARK = Decoration.mark({ class: 'geo-mark' });

/** Underlines the places a check points at and explains them on hover. */
export function geoExtension(host: EditorHost): Extension {
	const marker = ViewPlugin.fromClass(
		class {
			marks: Mark[] = [];
			decorations: DecorationSet = Decoration.none;

			constructor(view: EditorView) {
				this.compute(view);
			}

			update(update: ViewUpdate) {
				if (update.docChanged) this.compute(update.view);
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
