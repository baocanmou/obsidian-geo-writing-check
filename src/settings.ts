import { App, PluginSettingTab, Setting } from 'obsidian';
import type { GeoSettings } from './analysis';
import { CHECKS } from './checks';
import type GeoPlugin from './main';
import { DISCLAIMER } from './report';

type TextKey = 'entityKeys' | 'keywordKeys' | 'titleKeys' | 'dateKeys' | 'switchKey';
type AreaKey = 'entities' | 'ignoreWords' | 'includeFolders' | 'excludeFolders';
type NumberKey = 'leadMax' | 'paragraphMax' | 'sentenceMax' | 'minLength';

export class GeoSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: GeoPlugin,
	) {
		super(app, plugin);
	}

	private area(key: AreaKey, name: string, desc: string, placeholder = ''): void {
		new Setting(this.containerEl)
			.setName(name)
			.setDesc(desc)
			.setClass('geo-setting-area')
			.addTextArea((t) =>
				t
					.setPlaceholder(placeholder)
					.setValue(this.plugin.settings[key])
					.onChange(async (v) => {
						this.plugin.settings[key] = v;
						await this.plugin.saveSettings();
					}),
			);
	}

	private text(key: TextKey, name: string, desc: string, fallback: string): void {
		new Setting(this.containerEl)
			.setName(name)
			.setDesc(desc)
			.addText((t) =>
				t.setValue(this.plugin.settings[key]).onChange(async (v) => {
					this.plugin.settings[key] = v.trim() || fallback;
					await this.plugin.saveSettings();
				}),
			);
	}

	private number(key: NumberKey, name: string, desc: string, fallback: number): void {
		new Setting(this.containerEl)
			.setName(name)
			.setDesc(desc)
			.addText((t) =>
				t.setValue(String(this.plugin.settings[key])).onChange(async (v) => {
					const n = Number.parseInt(v, 10);
					this.plugin.settings[key] = Number.isFinite(n) && n > 0 ? n : fallback;
					await this.plugin.saveSettings();
				}),
			);
	}

	display(): void {
		const { containerEl } = this;
		const s: GeoSettings = this.plugin.settings;
		containerEl.empty();

		new Setting(containerEl)
			.setName('编辑器实时标注')
			.setDesc('写作时在需要修改的位置画虚线，鼠标停留显示原因和改法。关闭后仍可在侧边面板查看。')
			.addToggle((t) =>
				t.setValue(s.liveMark).onChange(async (v) => {
					s.liveMark = v;
					await this.plugin.saveSettings();
				}),
			);

		this.area(
			'entities',
			'主体名称',
			'每行一个，第一行是主名称，其余可以写城市、业务等希望文中出现的词。单篇笔记可以在属性里另外指定。',
			'品牌或机构全称\n所在城市',
		);

		new Setting(containerEl).setName('检查项').setDesc('关闭的检查项不显示，也不计入分数。').setHeading();
		for (const check of CHECKS) {
			new Setting(containerEl)
				.setName(`${check.group}：${check.name}`)
				.setDesc(check.desc)
				.addToggle((t) =>
					t.setValue(!s.disabledChecks.includes(check.id)).onChange(async (v) => {
						s.disabledChecks = s.disabledChecks.filter((id) => id !== check.id);
						if (!v) s.disabledChecks.push(check.id);
						await this.plugin.saveSettings();
					}),
				);
		}

		new Setting(containerEl).setName('阈值').setHeading();
		this.number('leadMax', '第一段字数上限', '超过后提示压缩。', 150);
		this.number('paragraphMax', '段落字数上限', '超过后提示拆分。', 220);
		this.number('sentenceMax', '句子字数上限', '超过后提示拆分。', 80);
		this.number('minLength', '最少正文字数', '正文少于这个字数的笔记不检查。', 300);
		this.area('ignoreWords', '不提示的词', '每行一个。出现在这里的空泛形容、相对时间、自称不再提示。');

		new Setting(containerEl).setName('检查范围').setHeading();
		this.area('includeFolders', '只检查这些文件夹', '每行一个文件夹路径。留空表示检查所有笔记。');
		this.area('excludeFolders', '不检查这些文件夹', '每行一个文件夹路径。');

		new Setting(containerEl)
			.setName('笔记属性')
			.setDesc('插件从笔记属性里读取标题、关键词、主体和日期。属性名用逗号隔开，按顺序取第一个有值的。')
			.setHeading();
		this.text('titleKeys', '标题属性', '没有时用一级标题，再没有用文件名。', 'title');
		this.text('keywordKeys', '关键词属性', '有值时检查关键词是否出现在标题、第一段和小标题。', '主关键词');
		this.text('entityKeys', '主体属性', '有值时作为这一篇的主名称。', '品牌');
		this.text('dateKeys', '日期属性', '任意一个有值即视为有日期。', '发布日期');
		this.text('switchKey', '开关属性', '在笔记属性里把它写成 false，关闭这一篇的检查。', 'GEO检查');

		containerEl.createEl('p', { cls: 'geo-disclaimer', text: DISCLAIMER });
	}
}
