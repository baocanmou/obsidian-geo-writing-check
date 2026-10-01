import { App, PluginSettingTab, Setting, type SettingDefinitionItem } from 'obsidian';
import { DEFAULT_SETTINGS, type GeoSettings } from './analysis';
import { CHECKS } from './checks';
import type GeoPlugin from './main';
import { DISCLAIMER } from './report';

/** Toggles for individual checks use this key prefix instead of a settings field. */
const CHECK_KEY = 'check:';

type Control =
	| { type: 'toggle'; key: string }
	| { type: 'text'; key: string; placeholder?: string }
	| { type: 'textarea'; key: string; placeholder?: string; rows?: number }
	| { type: 'number'; key: string; min?: number };

interface Item {
	name: string;
	desc?: string;
	control?: Control;
}

interface Group {
	heading?: string;
	items: Item[];
}

function groups(): Group[] {
	return [
		{
			items: [
				{
					name: '编辑器实时标注',
					desc: '写作时在需要修改的位置画虚线，鼠标停留显示原因和改法。关闭后仍可在侧边面板查看。',
					control: { type: 'toggle', key: 'liveMark' },
				},
				{
					name: '主体名称',
					desc: '每行一个，第一行是主名称，其余可以写城市、业务等希望文中出现的词。单篇笔记可以在属性里另外指定。',
					control: { type: 'textarea', key: 'entities', placeholder: '品牌或机构全称\n所在城市', rows: 3 },
				},
			],
		},
		{
			heading: '检查项',
			items: CHECKS.map((c) => ({
				name: `${c.group}：${c.name}`,
				desc: c.desc,
				control: { type: 'toggle', key: CHECK_KEY + c.id },
			})),
		},
		{
			heading: '阈值',
			items: [
				{ name: '第一段字数上限', desc: '超过后提示压缩。', control: { type: 'number', key: 'leadMax', min: 1 } },
				{ name: '段落字数上限', desc: '超过后提示拆分。', control: { type: 'number', key: 'paragraphMax', min: 1 } },
				{ name: '句子字数上限', desc: '超过后提示拆分。', control: { type: 'number', key: 'sentenceMax', min: 1 } },
				{ name: '最少正文字数', desc: '正文少于这个字数的笔记不检查。', control: { type: 'number', key: 'minLength', min: 1 } },
				{
					name: '不提示的词',
					desc: '每行一个。出现在这里的空泛形容、相对时间、自称不再提示。',
					control: { type: 'textarea', key: 'ignoreWords', rows: 3 },
				},
			],
		},
		{
			heading: '检查范围',
			items: [
				{
					name: '只检查这些文件夹',
					desc: '每行一个文件夹路径。留空表示检查所有笔记。',
					control: { type: 'textarea', key: 'includeFolders', rows: 3 },
				},
				{ name: '不检查这些文件夹', desc: '每行一个文件夹路径。', control: { type: 'textarea', key: 'excludeFolders', rows: 3 } },
			],
		},
		{
			heading: '笔记属性',
			items: [
				{ name: '标题属性', desc: '属性名用逗号隔开，按顺序取第一个有值的。没有时用一级标题，再没有用文件名。', control: { type: 'text', key: 'titleKeys' } },
				{ name: '关键词属性', desc: '有值时检查关键词是否出现在标题、第一段和小标题。', control: { type: 'text', key: 'keywordKeys' } },
				{ name: '主体属性', desc: '有值时作为这一篇的主名称。', control: { type: 'text', key: 'entityKeys' } },
				{ name: '日期属性', desc: '任意一个有值即视为有日期。', control: { type: 'text', key: 'dateKeys' } },
				{ name: '开关属性', desc: '在笔记属性里把它写成 false，关闭这一篇的检查。', control: { type: 'text', key: 'switchKey' } },
			],
		},
		{ items: [{ name: '说明', desc: DISCLAIMER }] },
	];
}

export class GeoSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: GeoPlugin,
	) {
		super(app, plugin);
	}

	/** Obsidian 1.13 and later render this, and include it in settings search. */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return groups().map((g) => ({
			type: 'group',
			heading: g.heading,
			items: g.items.map((item) =>
				item.control
					? { name: item.name, desc: item.desc, control: item.control }
					: { name: item.name, desc: item.desc, searchable: false },
			),
		}));
	}

	private stored(key: string): string {
		const v = this.getControlValue(key);
		return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
	}

	getControlValue(key: string): unknown {
		const s = this.plugin.settings;
		if (key.startsWith(CHECK_KEY)) return !s.disabledChecks.includes(key.slice(CHECK_KEY.length));
		return s[key as keyof GeoSettings];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const s = this.plugin.settings;
		if (key.startsWith(CHECK_KEY)) {
			const id = key.slice(CHECK_KEY.length);
			s.disabledChecks = s.disabledChecks.filter((x) => x !== id);
			if (!value) s.disabledChecks.push(id);
		} else {
			const field = key as keyof GeoSettings;
			const fallback = DEFAULT_SETTINGS[field];
			let next = value;
			// Empty or invalid input falls back to the default rather than breaking a check.
			if (typeof fallback === 'number') {
				const n = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
				next = Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
			} else if (typeof fallback === 'string' && /Keys?$/.test(field)) {
				// Property names cannot be blank.
				next = (typeof value === 'string' ? value.trim() : '') || fallback;
			}
			(s as unknown as Record<string, unknown>)[field] = next;
		}
		await this.plugin.saveSettings();
	}

	/** Fallback for Obsidian versions before 1.13, built from the same definitions. */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		for (const group of groups()) {
			if (group.heading) new Setting(containerEl).setName(group.heading).setHeading();
			for (const item of group.items) this.renderItem(containerEl, item);
		}
	}

	private renderItem(containerEl: HTMLElement, item: Item): void {
		const setting = new Setting(containerEl).setName(item.name);
		if (item.desc) setting.setDesc(item.desc);
		const control = item.control;
		if (!control) return;
		const value = this.stored(control.key);
		const save = (v: unknown) => void this.setControlValue(control.key, v);
		switch (control.type) {
			case 'toggle':
				setting.addToggle((t) => t.setValue(Boolean(this.getControlValue(control.key))).onChange(save));
				break;
			case 'text':
				setting.addText((t) => t.setPlaceholder(control.placeholder ?? '').setValue(value).onChange(save));
				break;
			case 'number':
				setting.addText((t) => {
					t.inputEl.type = 'number';
					t.setValue(value).onChange(save);
				});
				break;
			case 'textarea':
				setting.setClass('geo-setting-area');
				setting.addTextArea((t) => t.setPlaceholder(control.placeholder ?? '').setValue(value).onChange(save));
				break;
		}
	}
}
