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

export function parse(text: string): Doc {
	const masks: Range[] = [];
	const blocks: Block[] = [];
	const fm = FRONTMATTER.exec(text);
	const bodyStart = fm ? fm[0].length : 0;
	const frontmatter = fm ? parseFrontmatter(fm[0]) : {};
	if (fm) masks.push([0, bodyStart]);

	let pos = bodyStart;
	let line = text.slice(0, bodyStart).split('\n').length;
	let fence: { char: string; length: number; start: number } | null = null;
	let paragraph: Block | null = null;
	let inComment = false;

	const closeParagraph = () => {
		if (paragraph) blocks.push(paragraph);
		paragraph = null;
	};

	for (const rawLine of text.slice(bodyStart).split('\n')) {
		const current = rawLine.replace(/\r$/, '');
		const from = pos;
		const to = pos + current.length;
		const lineNo = line;
		pos += rawLine.length + 1;
		line++;

		const fenceMatch = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(current);
		if (fenceMatch) {
			const marker = fenceMatch[1] ?? '';
			const rest = fenceMatch[2] ?? '';
			const char = marker.charAt(0);
			if (fence === null) {
				if (char !== '`' || !rest.includes('`')) {
					closeParagraph();
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
			closeParagraph();
			inComment = !inComment;
			continue;
		}
		if (inComment) continue;

		if (!current.trim()) {
			closeParagraph();
			continue;
		}
		const heading = /^(#{1,6})\s+(.*?)\s*#*$/.exec(current);
		if (heading) {
			closeParagraph();
			blocks.push({ type: 'heading', from, to, line: lineNo, text: heading[2] ?? '', level: (heading[1] ?? '').length });
			continue;
		}
		if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(current) || /^\s*!\[/.test(current) || /^\s*<\/?[a-zA-Z]/.test(current)) {
			closeParagraph();
			continue;
		}
		let type: BlockType = 'paragraph';
		if (/^\s*(?:[-*+]|\d+[.)、])\s+/.test(current)) type = 'list';
		else if (/^\s*>/.test(current)) type = 'quote';
		else if (/^\s*\|.*\|\s*$/.test(current)) type = 'table';

		if (type === 'paragraph') {
			if (paragraph) {
				paragraph.to = to;
				paragraph.text = text.slice(paragraph.from, to);
			} else {
				paragraph = { type, from, to, line: lineNo, text: current };
			}
		} else {
			closeParagraph();
			blocks.push({ type, from, to, line: lineNo, text: current });
		}
	}
	closeParagraph();
	if (fence !== null) masks.push([fence.start, text.length]);

	for (const re of [
		/`[^`\n]+`/g,
		/https?:\/\/[^\s)\]>\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]+/g,
		/\]\([^)\n]*\)/g,
		/%%[\s\S]*?%%/g,
		/<!--[\s\S]*?-->/g,
	]) {
		let m: RegExpExecArray | null;
		while ((m = re.exec(text))) masks.push([m.index, m.index + m[0].length]);
	}
	return { text, frontmatter, blocks, masks: mergeRanges(masks) };
}

/** Text as a reader sees it: Markdown syntax removed. */
export function visible(raw: string): string {
	return raw
		.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
		.replace(/!\[\[[^\]]*\]\]/g, '')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
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
