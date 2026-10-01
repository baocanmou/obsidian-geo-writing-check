export type Range = [number, number];

export type BlockType = 'heading' | 'paragraph' | 'list' | 'quote' | 'table';

export interface Block {
	type: BlockType;
	from: number;
	to: number;
	line: number;
	/** Raw Markdown of the block. */
	text: string;
	/** Heading level, 1 to 6. */
	level?: number;
}

export interface Doc {
	text: string;
	frontmatter: Record<string, string[]>;
	blocks: Block[];
	/** Ranges that are not prose: code, link targets, comments. */
	masks: Range[];
	/** Offset where each line starts, for line lookups. */
	lineStarts: number[];
}

/** 1-based line number of an offset. */
export function lineOf(doc: Doc, offset: number): number {
	let lo = 0;
	let hi = doc.lineStarts.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if ((doc.lineStarts[mid] as number) <= offset) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

const FRONTMATTER = /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/;

function splitList(value: string): string[] {
	return value
		.split(/[,，、]/)
		.map((s) => s.trim().replace(/^["']|["']$/g, ''))
		.filter(Boolean);
}

/** Reads flat `key: value` and `key:` + `- item` properties; enough for the keys this plugin uses. */
export function parseFrontmatter(block: string): Record<string, string[]> {
	const out: Record<string, string[]> = {};
	const lines = block.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const m = /^([^:#\s-][^:]*):\s*(.*)$/.exec(lines[i] ?? '');
		if (!m) continue;
		const key = (m[1] ?? '').trim();
		const value = (m[2] ?? '').replace(/\s+#.*$/, '').trim();
		if (value.startsWith('[')) {
			out[key] = splitList(value.replace(/^\[|\]$/g, ''));
		} else if (/^[>|][-+]?$/.test(value)) {
			// YAML block scalar: the indented lines that follow are the value.
			const parts: string[] = [];
			for (let j = i + 1; j < lines.length; j++) {
				const next = lines[j] ?? '';
				if (next.trim() && !/^\s/.test(next)) break;
				parts.push(next.trim());
			}
			out[key] = [parts.join(value.startsWith('>') ? ' ' : '\n').trim()];
		} else if (value) {
			out[key] = [value.replace(/^["']|["']$/g, '')];
		} else {
			const items: string[] = [];
			for (let j = i + 1; j < lines.length; j++) {
				const item = /^\s*-\s+(.+)$/.exec(lines[j] ?? '');
				if (!item) break;
				items.push((item[1] ?? '').trim().replace(/^["']|["']$/g, ''));
			}
			out[key] = items;
		}
	}
	return out;
}

function mergeRanges(ranges: Range[]): Range[] {
	ranges.sort((a, b) => a[0] - b[0]);
	const out: Range[] = [];
	for (const r of ranges) {
		const last = out[out.length - 1];
		if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
		else out.push([r[0], r[1]]);
	}
	return out;
}

export function overlaps(ranges: Range[], from: number, to: number): boolean {
	let lo = 0;
	let hi = ranges.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if ((ranges[mid] as Range)[1] <= from) lo = mid + 1;
		else hi = mid;
	}
	const r = ranges[lo];
	return !!r && r[0] < to;
}

const TAG_LINE = /^\s*(?:#[^\s#]+\s*)+$/;

export function parse(text: string): Doc {
	const masks: Range[] = [];
	const blocks: Block[] = [];
	const lineStarts = [0];
	for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lineStarts.push(i + 1);

	const fm = FRONTMATTER.exec(text);
	const bodyStart = fm ? fm[0].length : 0;
	const frontmatter = fm ? parseFrontmatter(fm[0]) : {};
	if (fm) masks.push([0, bodyStart]);

	let pos = bodyStart;
	let line = text.slice(0, bodyStart).split('\n').length;
	let fence: { char: string; length: number; start: number } | null = null;
	let inComment = false;

	for (const rawLine of text.slice(bodyStart).split('\n')) {
		const current = rawLine.replace(/\r$/, '');
		const from = pos;
		const to = pos + current.length;
		const lineNo = line;
		pos += rawLine.length + 1;
		line++;

		// Fences may be indented, e.g. inside a list item.
		const fenceMatch = /^\s*(`{3,}|~{3,})(.*)$/.exec(current);
		if (fenceMatch) {
			const marker = fenceMatch[1] ?? '';
			const rest = fenceMatch[2] ?? '';
			const char = marker.charAt(0);
			if (fence === null) {
				if (char !== '`' || !rest.includes('`')) {
					fence = { char, length: marker.length, start: from };
					continue;
				}
			} else if (char === fence.char && marker.length >= fence.length && rest.trim() === '') {
				masks.push([fence.start, to]);
				fence = null;
				continue;
			}
		}
		if (fence !== null) continue;

		// A line holding only a comment marker opens or closes a multi-line %% comment.
		if (/^\s*%%\s*$/.test(current)) {
			inComment = !inComment;
			continue;
		}
		if (inComment || !current.trim()) continue;

		const heading = /^(#{1,6})[ \t]+(.*)$/.exec(current);
		if (heading) {
			// Closing hashes (`## Title ##`) are dropped; done by hand to stay linear on long lines.
			let title = (heading[2] ?? '').trimEnd();
			const closing = /#+$/.exec(title);
			if (closing && (closing.index === 0 || /[ \t]/.test(title.charAt(closing.index - 1)))) {
				title = title.slice(0, closing.index).trimEnd();
			}
			blocks.push({ type: 'heading', from, to, line: lineNo, text: title, level: (heading[1] ?? '').length });
			continue;
		}
		if (
			/^\s*([-*_])(\s*\1){2,}\s*$/.test(current) ||
			/^\s*!\[/.test(current) ||
			/^\s*<\/?[a-zA-Z]/.test(current) ||
			TAG_LINE.test(current)
		) {
			continue;
		}

		// An indented line right after a list item continues that item.
		const last = blocks[blocks.length - 1];
		if (/^(?: {2,}|\t)\S/.test(current) && last?.type === 'list' && last.to === from - 1) {
			last.to = to;
			last.text = text.slice(last.from, to);
			continue;
		}

		// Each line is its own paragraph: Obsidian shows a single line break as a new line,
		// and most Chinese editors that the text is pasted into treat it as a new paragraph.
		let type: BlockType = 'paragraph';
		if (/^\s*(?:[-*+]|\d+[.)、])\s+/.test(current)) type = 'list';
		else if (/^\s*>/.test(current)) type = 'quote';
		else if (/^\s*\|.*\|\s*$/.test(current)) type = 'table';
		blocks.push({ type, from, to, line: lineNo, text: current });
	}
	if (fence !== null) masks.push([fence.start, text.length]);

	// Inline masks are searched with fenced code blanked out, so `%%` inside code cannot
	// pair with a comment marker in the prose that follows.
	let scan = text;
	for (const [a, b] of masks) scan = scan.slice(0, a) + ' '.repeat(b - a) + scan.slice(b);
	for (const re of [
		/`[^`\n]+`/g,
		/https?:\/\/[^\s)\]>\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]+/g,
		/\]\([^)\n]{0,2000}\)/g,
		/%%[\s\S]*?%%/g,
		/<!--[\s\S]*?-->/g,
	]) {
		let m: RegExpExecArray | null;
		while ((m = re.exec(scan))) masks.push([m.index, m.index + m[0].length]);
	}
	return { text, frontmatter, blocks, masks: mergeRanges(masks), lineStarts };
}

/** Text as a reader sees it: Markdown syntax removed. */
export function visible(raw: string): string {
	return raw
		.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
		.replace(/!\[\[[^\]]*\]\]/g, '')
		.replace(/\[([^\]\n]{0,500})\]\([^)\n]{0,2000}\)/g, '$1')
		.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
		.replace(/\[\^[^\]]+\]/g, '')
		.replace(/<[^>]+>/g, '')
		.replace(/%%[\s\S]*?%%/g, '')
		.replace(/^\s*(?:>+\s*|[-*+]\s+|\d+[.)、]\s+)/gm, '')
		.replace(/[*_~=`]+/g, '');
}

/** Character count without whitespace, the usual way Chinese copy is measured. */
export function length(raw: string): number {
	return visible(raw).replace(/\s/g, '').length;
}

export interface Sentence {
	from: number;
	to: number;
	text: string;
}

export function sentences(block: Block): Sentence[] {
	const out: Sentence[] = [];
	const re = /[^。！？!?；;\n]+[。！？!?；;]?/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(block.text))) {
		if (m[0].trim()) out.push({ from: block.from + m.index, to: block.from + m.index + m[0].length, text: m[0] });
	}
	return out;
}
