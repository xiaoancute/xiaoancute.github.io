import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import {
	applyFrontmatterEdits,
	DELETE_FIELD,
	splitFrontmatter,
} from "./frontmatter-utils.js";

const repoRoot = process.cwd();
const postsDir = path.join(repoRoot, "src/content/posts");
const dynamicDir = path.join(repoRoot, "src/content/dynamic");
const publicDir = path.join(repoRoot, "public");
// 隔离区：删掉的文移到这里，不参与构建（对齐 quarantine-bad-posts.mjs），可随时手动恢复。
const quarantineDir = path.join(repoRoot, "src/content/_quarantine");
const dialogConfigPath = path.join(repoRoot, "scripts/blog-helper.dialogrc");
// 站点把 frontmatter 日期当北京时间写、当 UTC 读（见 src/utils/date-utils.ts）。
const SITE_TIMEZONE = "Asia/Shanghai";
let matter;

// pnpm 会把当前入口写入 npm_execpath。复用它可以避免 Termux 上多个 pnpm 安装互相串台。
const pnpmInvocation = (() => {
	const execPath = process.env.npm_execpath;
	if (execPath && /(?:^|[/\\])pnpm(?:\.c?js|\.mjs)?$/i.test(execPath)) {
		return { command: process.execPath, args: [execPath] };
	}
	return { command: "pnpm", args: [] };
})();

const hasDialog =
	process.stdin.isTTY &&
	process.stdout.isTTY &&
	spawnSync("dialog", ["--version"], { stdio: "ignore" }).status === 0;

// readline 一旦建立就会把 stdin 切进 raw 模式，而 raw 模式关掉了 ISIG——
// 之后所有子进程（astro dev、pnpm build）都收不到 Ctrl+C 的 SIGINT，只能收到裸字节 0x03。
// 所以这里只在真正要用 readline 的时候（没有 dialog 的降级路径）才建，且全程复用同一个迭代器。
let inputInterface = null;
let inputIterator = null;
async function readLine() {
	if (!inputInterface) {
		inputInterface = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		inputIterator = inputInterface[Symbol.asyncIterator]();
	}
	const { value = "" } = await inputIterator.next();
	return value;
}

// 让用户看完控制台输出再回菜单——下一个 dialog 的 --clear 会把屏幕擦干净。
async function pause(message = "按回车键返回菜单…") {
	process.stdout.write(`\n${message}`);
	if (inputInterface) {
		await readLine();
		return;
	}
	// dialog 模式下平时没有 readline，临时建一个，用完立刻关掉恢复终端模式。
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	try {
		await rl.question("");
	} finally {
		rl.close();
	}
}

/* ---------------------------------------------------------------- 终端尺寸 */

function termSize() {
	return {
		rows: Math.max(12, process.stdout.rows || 24),
		cols: Math.max(36, process.stdout.columns || 80),
	};
}

// 手机竖屏只有四十来列，写死 58/68/76 会被 dialog 挤成一团；按实际终端算。
function boxWidth() {
	const { cols } = termSize();
	return Math.max(32, Math.min(cols - 4, 76));
}

// 全角字符占两列，估算说明文字折行后占几行
function visualWidth(text) {
	let width = 0;
	for (const char of text) {
		width +=
			/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(
				char,
			)
				? 2
				: 1;
	}
	return width;
}

function wrappedLines(text, width) {
	const inner = Math.max(10, width - 4);
	return text
		.split("\n")
		.reduce(
			(total, line) => total + Math.max(1, Math.ceil(visualWidth(line) / inner)),
			0,
		);
}

// 菜单盒子要留出标题、说明文字、按钮和上下边框。原来高度写死 16，
// 11 个主菜单项装不下，"退出" 被顶到屏幕外只能靠滚动才能看到。
function menuGeometry(itemCount, textLines = 0) {
	const { rows } = termSize();
	const chrome = 7 + textLines;
	const box = Math.min(Math.max(rows - 2, chrome + 1), itemCount + chrome);
	return {
		height: String(box),
		width: String(boxWidth()),
		menuHeight: String(Math.max(1, box - chrome)),
	};
}

/* ------------------------------------------------------------ dialog 封装 */

function dialog(args, { allowCancel = true } = {}) {
	const result = spawnSync(
		"dialog",
		[
			"--stdout",
			"--clear",
			"--no-shadow",
			"--no-mouse",
			"--ok-label",
			"确定",
			"--cancel-label",
			"返回",
			...args,
		],
		{
			cwd: repoRoot,
			encoding: "utf8",
			env: { ...process.env, DIALOGRC: dialogConfigPath },
			stdio: ["inherit", "pipe", "pipe"],
		},
	);
	if (result.error) throw result.error;
	if (result.status === 0) return result.stdout.trim();
	// dialog 用 255 同时表示「按了 ESC」和「自己出错了」（比如盒子摆不下）。
	// 只有出错时它才会往 stderr 写东西，靠这个区分，别把报错悄悄当成用户取消。
	const stderr = (result.stderr || "").trim();
	if (stderr) throw new Error(`终端界面出错：${stderr}`);
	if (allowCancel && (result.status === 1 || result.status === 255)) return null;
	throw new Error(`终端界面异常退出（代码 ${result.status}）`);
}

function notice(title, message) {
	if (hasDialog) {
		const width = boxWidth();
		const height = Math.min(
			termSize().rows - 2,
			wrappedLines(message, width) + 6,
		);
		dialog([
			"--title",
			title,
			"--msgbox",
			message,
			String(height),
			String(width),
		]);
		return;
	}
	console.log(`\n${title}\n${message}\n`);
}

/* ---------------------------------------------------------------- 子进程 */

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: repoRoot,
		stdio: ["ignore", "inherit", "inherit"],
		...options,
	});
	if (result.error) throw result.error;
	// 用户自己按 Ctrl+C 掐掉子进程不算失败。子进程可能是被信号打死（signal 有值），
	// 也可能自己装了 handler 后按惯例退出 128+signo（astro dev / vite 就是 130）。
	if (result.signal === "SIGINT" || result.signal === "SIGTERM") return false;
	if (result.status === 130 || result.status === 143) return false;
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(" ")} 执行失败`);
	}
	return true;
}

function runPnpm(args, options = {}) {
	return run(pnpmInvocation.command, [...pnpmInvocation.args, ...args], options);
}

// 跑长命令时先接管 SIGINT：spawnSync 期间事件循环是停的，信号会排队等回来再处理，
// 于是 Ctrl+C 只掐掉子进程，本进程不会跟着一起死。
function runInterruptible(fn) {
	const swallow = () => {};
	process.on("SIGINT", swallow);
	try {
		return fn();
	} finally {
		process.off("SIGINT", swallow);
	}
}

function installDependencies() {
	console.log("首次使用，正在自动安装博客依赖，请稍候……\n");
	try {
		// 锁文件没问题时不改它；只有锁文件确实需要更新时才放宽限制。
		runPnpm(["install", "--frozen-lockfile"]);
	} catch {
		console.log("锁文件需要更新，正在重新安装依赖……\n");
		runPnpm(["install", "--no-frozen-lockfile"]);
	}
}

async function loadMatter() {
	try {
		matter = (await import("gray-matter")).default;
		return;
	} catch (error) {
		if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
	}

	installDependencies();
	matter = (await import("gray-matter")).default;
}

function capture(command, args, { optional = false } = {}) {
	const result = spawnSync(command, args, {
		cwd: repoRoot,
		encoding: "utf8",
	});
	if (result.error) {
		if (optional) return null;
		throw result.error;
	}
	if (result.status !== 0) return "";
	return result.stdout.trim();
}

/* -------------------------------------------------------------- 内容读取 */

function getPostFiles(directory = postsDir) {
	return fs
		.readdirSync(directory, { withFileTypes: true })
		.flatMap((entry) => {
			const fullPath = path.join(directory, entry.name);
			if (entry.isDirectory()) return getPostFiles(fullPath);
			return /\.(md|mdx)$/i.test(entry.name) ? [fullPath] : [];
		})
		.sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function getPosts() {
	return getPostFiles().map((filePath) => {
		const { parsed } = readPost(filePath);
		return {
			filePath,
			title: parsed.data.title || path.basename(filePath),
			draft: parsed.data.draft === true,
		};
	});
}

function getDynamics() {
	if (!fs.existsSync(dynamicDir)) return [];
	return fs
		.readdirSync(dynamicDir, { withFileTypes: true })
		.filter((entry) => entry.isFile() && /\.md$/i.test(entry.name))
		.map((entry) => {
			const filePath = path.join(dynamicDir, entry.name);
			const { source, parsed } = readPost(filePath);
			const content = parsed.content.trim();
			// 微语正文可能多行，菜单里只显示首行预览
			const preview = content.split("\n")[0] || "（空）";
			return {
				filePath,
				source,
				parsed,
				content,
				preview,
				published: parsed.data.published,
				pinned: parsed.data.pinned === true,
				location: parsed.data.location || "",
			};
		})
		.sort((a, b) => {
			// published 是 Date，倒序（最新在前）
			const ta = a.published instanceof Date ? a.published.getTime() : 0;
			const tb = b.published instanceof Date ? b.published.getTime() : 0;
			return tb - ta;
		});
}

function getDashboardSummary() {
	const posts = getPosts();
	const drafts = posts.filter((post) => post.draft).length;
	const published = posts.length - drafts;
	const status = capture("git", ["status", "--short"], { optional: true });
	const changes =
		status === null ? null : status.split("\n").filter(Boolean).length;
	return { drafts, published, changes };
}

function readPost(filePath) {
	const source = fs.readFileSync(filePath, "utf8");
	return { source, parsed: matter(source) };
}

function relativePostPath(filePath) {
	return path.relative(repoRoot, filePath);
}

function resolvePostPath(fileName) {
	const extension = /\.(md|mdx)$/i.test(fileName) ? "" : ".md";
	const filePath = path.resolve(postsDir, `${fileName}${extension}`);
	if (!filePath.startsWith(`${postsDir}${path.sep}`)) {
		throw new Error("文章文件必须放在 src/content/posts 目录中");
	}
	return filePath;
}

/* ------------------------------------------------------ frontmatter 定点改写 */

function updateFrontmatter(filePath, edits) {
	if (Object.keys(edits).length === 0) return false;
	const source = fs.readFileSync(filePath, "utf8");
	fs.writeFileSync(filePath, applyFrontmatterEdits(source, edits));
	return true;
}

function updateDynamicBody(filePath, nextContent) {
	const source = fs.readFileSync(filePath, "utf8");
	const { open, block, close } = splitFrontmatter(source);
	fs.writeFileSync(filePath, `${open}${block}${close}\n${nextContent.trim()}\n`);
}

/* ------------------------------------------------------------------ 日期 */

// 按北京时间取“今天”。原来用的 toISOString() 是 UTC，本地 00:00–08:00 之间
// 写出来的 updated 会差一天。
function todayInSiteTimezone() {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: SITE_TIMEZONE,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(new Date());
}

// 微语的 published 是 "YYYY-MM-DD HH:MM:SS"，不带时区。
// js-yaml 把这种时间戳按 UTC 解析，站点也按 UTC 渲染（date-utils.ts 里 timeZone: "UTC"），
// 所以写回时必须用 getUTC* 取值，否则每编辑一次时间就平移一个时区偏移（北京 = +8 小时）。
function toDateTimeString(value) {
	if (!(value instanceof Date)) return value;
	const pad = (n) => String(n).padStart(2, "0");
	return (
		`${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}` +
		` ${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}`
	);
}

/* -------------------------------------------------------------- 输入组件 */

// 列出 public 目录下常见图片，供“封面图”快捷选用
const IMAGE_RE = /\.(png|jpe?g|webp|avif|gif|svg)$/i;
function listPublicImages() {
	if (!fs.existsSync(publicDir)) return [];
	const images = [];
	const walk = (dir) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				if (entry.name.startsWith(".") || entry.name === "favicon") continue;
				walk(fullPath);
			} else if (IMAGE_RE.test(entry.name)) {
				images.push(`/${path.relative(publicDir, fullPath)}`);
			}
		}
	};
	walk(publicDir);
	return images.sort((a, b) => a.localeCompare(b, "zh-CN"));
}

// 把标签数组格式化为逗号分隔字符串，供编辑时显示当前值
function tagsToString(tags) {
	return Array.isArray(tags) ? tags.join(", ") : "";
}

// 把逗号分隔字符串解析为标签数组（中英文逗号都行）
function parseTags(input) {
	return input
		.split(/[,，]/)
		.map((tag) => tag.trim())
		.filter(Boolean);
}

async function ask(question, defaultValue = "") {
	if (hasDialog) {
		const width = boxWidth();
		// 原来是把整句问题塞进 --title，标题会被盒宽截断；问题该放正文里。
		const height = Math.min(
			termSize().rows - 2,
			wrappedLines(question, width) + 7,
		);
		return dialog([
			"--title",
			"博客小助手",
			"--inputbox",
			question,
			String(height),
			String(width),
			defaultValue,
		]);
	}
	const suffix = defaultValue ? `（默认：${defaultValue}）` : "";
	process.stdout.write(`${question}${suffix}: `);
	const answer = (await readLine()).trim();
	return answer || defaultValue;
}

async function confirm(question, defaultYes = false) {
	if (hasDialog) {
		const width = boxWidth();
		const height = Math.min(
			termSize().rows - 2,
			wrappedLines(question, width) + 6,
		);
		const args = ["--title", "请确认", "--yes-label", "是", "--no-label", "否"];
		if (!defaultYes) args.push("--defaultno");
		const result = dialog([
			...args,
			"--yesno",
			question,
			String(height),
			String(width),
		]);
		return result !== null;
	}
	const hint = defaultYes ? "Y/n" : "y/N";
	process.stdout.write(`${question} [${hint}] `);
	const answer = (await readLine()).trim().toLowerCase();
	if (!answer) return defaultYes;
	return answer === "y" || answer === "yes" || answer === "是";
}

// 通用“从选项里选一个”。options: [{key,label}]。返回 key 或 null（取消）。
async function selectOption(title, options) {
	if (hasDialog) {
		const { height, width, menuHeight } = menuGeometry(options.length);
		const result = dialog([
			"--title",
			title,
			"--no-tags",
			"--menu",
			"",
			height,
			width,
			menuHeight,
			...options.flatMap((opt) => [opt.key, opt.label]),
		]);
		return result === null ? null : result;
	}
	// 降级路径统一用 1 开始编号，跟其它菜单保持一致
	console.log(`\n${title}`);
	for (const [index, opt] of options.entries()) {
		console.log(`${String(index + 1).padStart(2, " ")}. ${opt.label}`);
	}
	const answer = await ask("输入编号，直接回车取消");
	if (!answer) return null;
	const index = Number.parseInt(answer, 10) - 1;
	if (!Number.isInteger(index) || !options[index]) {
		notice("编号无效", `请输入 1 到 ${options.length} 之间的编号。`);
		return null;
	}
	return options[index].key;
}

// 非 dialog 模式下回车表示「保留原值」，所以约定输入单个 "-" 表示清空。
const CLEAR_TOKEN = "-";

// 编辑一个字段：展示当前值，回车保留，输入新值则覆盖。取消返回 null（跳过该项）。
async function editField(label, currentValue, { allowClear = true } = {}) {
	const current = currentValue == null ? "" : String(currentValue);
	if (hasDialog) {
		const question = allowClear
			? `${label}\n（清空输入框即可删除该项，按 ESC 跳过不改）`
			: label;
		return await ask(question, current);
	}
	const clearHint = allowClear ? `，输入 ${CLEAR_TOKEN} 清空` : "";
	const result = await ask(
		`${label}  当前：${current || "（空）"}（回车保留${clearHint}）`,
		current,
	);
	if (result === null) return null;
	return allowClear && result.trim() === CLEAR_TOKEN ? "" : result;
}

// 多行编辑（微语正文）。原来用单行 inputbox，多行正文一编辑就被压成一行。
async function editMultiline(title, current) {
	if (!hasDialog) {
		notice(
			title,
			"当前终端没有 dialog，无法多行编辑。\n请直接用编辑器修改对应的 .md 文件。",
		);
		return null;
	}
	const tempFile = path.join(
		os.tmpdir(),
		`blog-helper-${process.pid}-${Date.now()}.md`,
	);
	fs.writeFileSync(tempFile, `${current}\n`);
	try {
		const { rows } = termSize();
		return dialog([
			"--title",
			title,
			"--editbox",
			tempFile,
			String(Math.max(8, Math.min(rows - 2, 20))),
			String(boxWidth()),
		]);
	} finally {
		fs.rmSync(tempFile, { force: true });
	}
}

// 选封面图。public 下有近百张图，全塞进菜单根本翻不完，所以先给几个常用选项，
// 要浏览再进子菜单，数量多时先按关键词筛。
async function chooseCoverImage(currentValue) {
	const images = listPublicImages();
	const choice = await selectOption("封面图", [
		{
			key: "keep",
			label: currentValue ? `保留当前（${currentValue}）` : "保持留空",
		},
		{ key: "api", label: "随机封面（api）" },
		{ key: "manual", label: "手动输入路径或网址" },
		{ key: "browse", label: `从 public/ 里挑（共 ${images.length} 张）` },
		{ key: "clear", label: "清除封面" },
	]);
	if (choice === null || choice === "keep") return null;
	if (choice === "api") return "api";
	if (choice === "clear") return "";
	if (choice === "manual") return await ask("图片路径或网址", currentValue);

	let candidates = images;
	if (candidates.length > 20) {
		const keyword = await ask(
			`共 ${images.length} 张图，输入关键词筛选（直接回车看全部）`,
		);
		if (keyword === null) return null;
		if (keyword) {
			const needle = keyword.toLocaleLowerCase("zh-CN");
			candidates = images.filter((img) =>
				img.toLocaleLowerCase("zh-CN").includes(needle),
			);
		}
	}
	if (candidates.length === 0) {
		notice("没有匹配的图片", "换个关键词再试试。");
		return null;
	}
	const picked = await selectOption(
		`选一张图（${candidates.length}）`,
		candidates.map((img, index) => ({ key: String(index), label: img })),
	);
	return picked === null ? null : candidates[Number.parseInt(picked, 10)];
}

// 选语言：候选来自 src/i18n/languages/ 的实际语言文件。
// 返回 null=取消（保留原样）；""=清除（用站点默认）；否则为语言 code。
async function chooseLang(currentValue) {
	const langDir = path.join(repoRoot, "src/i18n/languages");
	const options = [
		{
			key: "keep",
			label: currentValue
				? `保留当前（${currentValue}）`
				: "保持留空（用站点默认）",
		},
		{ key: "clear", label: "清除（用站点默认）" },
		{ key: "custom", label: "手动输入语言 code" },
	];
	if (fs.existsSync(langDir)) {
		const langs = fs
			.readdirSync(langDir)
			.filter((f) => /\.ts$/i.test(f))
			.map((f) => f.replace(/\.ts$/i, ""))
			.sort((a, b) => a.localeCompare(b, "zh-CN"));
		for (const lang of langs) {
			const mark = lang === currentValue ? " ✓" : "";
			options.push({ key: `lang:${lang}`, label: `${lang}${mark}` });
		}
	} else {
		// 没有语言文件就给几个常见值兜底
		options.push(
			{ key: "lang:zh_CN", label: "zh_CN（简中）" },
			{ key: "lang:zh_TW", label: "zh_TW（繁中）" },
			{ key: "lang:en", label: "en（英语）" },
			{ key: "lang:ja", label: "ja（日语）" },
			{ key: "lang:ko", label: "ko（韩语）" },
			{ key: "lang:ru", label: "ru（俄语）" },
		);
	}
	const choice = await selectOption("语言", options);
	if (choice === null || choice === "keep") return null;
	if (choice === "clear") return "";
	if (choice === "custom") {
		const value = await ask("语言 code（如 zh_CN、en）", currentValue);
		return value === null ? null : value.trim();
	}
	return choice.slice("lang:".length);
}

/* ---------------------------------------------------------------- 各功能 */

async function createPost() {
	const title = await ask("文章标题");
	if (title === null) return;
	if (!title) {
		notice("已取消", "标题不能为空。");
		return;
	}

	let fileName;
	let description;
	let category;
	let tags;
	if (hasDialog) {
		// --form 的字段位置是写死的坐标，盒子被终端挤窄时会被裁掉，所以按实际宽度排布
		const width = boxWidth();
		const labelWidth = 18;
		const fieldWidth = Math.max(12, width - labelWidth - 6);
		const fields = [
			["文件名", title],
			["一句话简介", ""],
			["分类", ""],
			["标签（逗号分隔）", ""],
		];
		const result = dialog([
			"--title",
			"文章信息",
			"--form",
			"",
			String(Math.min(termSize().rows - 2, 14)),
			String(width),
			"4",
			...fields.flatMap(([label, value], index) => [
				label,
				String(index + 1),
				"1",
				value,
				String(index + 1),
				String(labelWidth),
				String(fieldWidth),
				"0",
			]),
		]);
		if (result === null) return;
		[fileName = title, description = "", category = "", tags = ""] =
			result.split("\n");
	} else {
		fileName = await ask("文件名或目录名", title);
		if (fileName === null) return;
		description = await ask("一句话简介（可留空）");
		category = await ask("分类（可留空）");
		tags = await ask("标签，多个用逗号分隔（可留空）");
	}
	fileName = (fileName ?? "").trim();
	if (!fileName) {
		notice("已取消", "文件名不能为空。");
		return;
	}

	const filePath = resolvePostPath(fileName);
	if (fs.existsSync(filePath)) {
		notice("文件已存在", `${relativePostPath(filePath)}\n\n换个文件名再试。`);
		return;
	}
	run("node", ["scripts/new-post.js", fileName]);

	try {
		updateFrontmatter(filePath, {
			title,
			description: description ?? "",
			category: category ?? "",
			tags: parseTags(tags ?? ""),
			draft: true,
		});
	} catch (error) {
		fs.rmSync(filePath, { force: true });
		throw error;
	}

	notice(
		"草稿已创建",
		`${relativePostPath(filePath)}\n\n本地预览可见，正式网站不会显示。`,
	);
}

async function choosePost() {
	let posts = getPosts();
	if (posts.length === 0) {
		notice("还没有文章", "src/content/posts/ 下还没有任何文章。");
		return null;
	}

	if (hasDialog) {
		const filter = await selectOption("文章范围", [
			{ key: "all", label: `全部文章（${posts.length}）` },
			{
				key: "draft",
				label: `仅草稿（${posts.filter((post) => post.draft).length}）`,
			},
			{
				key: "published",
				label: `仅公开（${posts.filter((post) => !post.draft).length}）`,
			},
			{ key: "search", label: "按标题搜索" },
		]);
		if (filter === null) return null;
		if (filter === "draft") posts = posts.filter((post) => post.draft);
		if (filter === "published") posts = posts.filter((post) => !post.draft);
		if (filter === "search") {
			const keyword = await ask("搜索文章标题");
			if (!keyword) return null;
			posts = posts.filter((post) =>
				post.title
					.toLocaleLowerCase("zh-CN")
					.includes(keyword.toLocaleLowerCase("zh-CN")),
			);
			if (posts.length === 0) {
				notice("没有找到文章", `没有标题包含“${keyword}”的文章。`);
				return null;
			}
		}
		if (posts.length === 0) {
			notice("这里是空的", "该范围下没有文章。");
			return null;
		}

		const choice = await selectOption(
			"选择文章",
			posts.map((post, index) => ({
				key: String(index),
				label: `${post.draft ? "[草稿]" : "[公开]"} ${post.title}`,
			})),
		);
		return choice === null ? null : posts[Number.parseInt(choice, 10)];
	}

	for (const [index, post] of posts.entries()) {
		const state = post.draft ? "草稿" : "公开";
		console.log(
			`${String(index + 1).padStart(2, " ")}. [${state}] ${post.title}`,
		);
	}

	const answer = await ask("输入文章编号，直接回车取消");
	if (!answer) return null;
	const index = Number.parseInt(answer, 10) - 1;
	if (!Number.isInteger(index) || !posts[index]) {
		notice("编号无效", `请输入 1 到 ${posts.length} 之间的编号。`);
		return null;
	}
	return posts[index];
}

async function changeVisibility() {
	const post = await choosePost();
	if (!post) return;
	const nextDraft = !post.draft;
	const action = nextDraft ? "隐藏" : "公开";
	if (!(await confirm(`确认${action}《${post.title}》？`))) return;

	const edits = { draft: nextDraft };
	if (!nextDraft) edits.updated = todayInSiteTimezone();
	updateFrontmatter(post.filePath, edits);
	notice(`已${action}`, relativePostPath(post.filePath));
}

// 删除文章：移到 src/content/_quarantine/ 而非真删，构建不会带上，需要时手动恢复即可。
async function deletePost() {
	const post = await choosePost();
	if (!post) return;
	if (!(await confirm(`确认删除《${post.title}》？`))) return;
	// 再确认一次：删除不可逆（虽然文件进了隔离区，但菜单流程里视为删除）
	if (
		!(await confirm(
			"文件会移到 src/content/_quarantine/，不进构建，可手动恢复。仍要继续？",
		))
	)
		return;

	const relative = relativePostPath(post.filePath);
	const target = path.join(
		quarantineDir,
		path.relative(postsDir, post.filePath),
	);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.renameSync(post.filePath, target);

	// 原文章目录若已空（只剩被删的那个 index.md），顺手清掉空目录，不留垃圾
	const originalDir = path.dirname(post.filePath);
	const postsRoot = postsDir;
	const removeEmptyDirs = (dir) => {
		if (dir === postsRoot || !dir.startsWith(`${postsRoot}${path.sep}`)) return;
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		if (entries.length === 0) {
			fs.rmdirSync(dir);
			removeEmptyDirs(path.dirname(dir));
		}
	};
	removeEmptyDirs(originalDir);

	notice(
		"已删除",
		`${relative}\n\n文件已移到 src/content/_quarantine/，可手动恢复。`,
	);
}

// 选择一条微语用于编辑/删除。微语按时间倒序（最新在前），最近 N 条进菜单。
async function chooseDynamic() {
	const dynamics = getDynamics();
	if (dynamics.length === 0) {
		notice("没有微语", "src/content/dynamic/ 下还没有任何微语。");
		return null;
	}
	const describe = (dyn, limit) => {
		const stamp =
			dyn.published instanceof Date
				? toDateTimeString(dyn.published)
				: String(dyn.published ?? "");
		const pin = dyn.pinned ? "📌" : "  ";
		const loc = dyn.location ? ` @${dyn.location}` : "";
		const prev =
			dyn.preview.length > limit
				? `${dyn.preview.slice(0, limit - 2)}…`
				: dyn.preview;
		return `${pin} ${stamp}${loc}  ${prev}`;
	};

	const recent = dynamics.slice(0, 30);
	const options = recent.map((dyn, index) => ({
		key: String(index),
		label: describe(dyn, 32),
	}));
	if (dynamics.length > recent.length) {
		options.push({
			key: "search",
			label: `…（共 ${dynamics.length} 条，搜索更早的）`,
		});
	}
	const choice = await selectOption("管理微语（选一条）", options);
	if (choice === null) return null;
	if (choice === "search") {
		const keyword = await ask("输入关键词搜正文");
		if (!keyword) return null;
		const matched = dynamics.filter((dyn) =>
			dyn.content
				.toLocaleLowerCase("zh-CN")
				.includes(keyword.toLocaleLowerCase("zh-CN")),
		);
		if (matched.length === 0) {
			notice("没找到", `没有正文包含“${keyword}”的微语。`);
			return null;
		}
		const mChoice = await selectOption(
			`搜到 ${matched.length} 条`,
			matched.map((dyn, index) => ({
				key: String(index),
				label: describe(dyn, 36),
			})),
		);
		return mChoice === null ? null : matched[Number.parseInt(mChoice, 10)];
	}
	return recent[Number.parseInt(choice, 10)];
}

async function manageDynamic() {
	const dyn = await chooseDynamic();
	if (!dyn) return;

	const action = await selectOption(`微语：${dyn.preview.slice(0, 40)}`, [
		{ key: "content", label: "编辑正文" },
		{ key: "pinned", label: dyn.pinned ? "取消置顶" : "置顶" },
		{ key: "location", label: `位置（当前：${dyn.location || "无"}）` },
		{ key: "delete", label: "删除这条微语" },
	]);
	if (action === null) return;

	if (action === "delete") {
		if (!(await confirm(`确认删除这条微语？\n${dyn.preview.slice(0, 50)}`)))
			return;
		fs.rmSync(dyn.filePath);
		notice("已删除", relativePostPath(dyn.filePath));
		return;
	}

	if (action === "content") {
		const next = await editMultiline("正文（Markdown，支持多行）", dyn.content);
		if (next === null) return;
		if (!next.trim()) {
			notice("没有改动", "正文不能为空，已保持原样。");
			return;
		}
		updateDynamicBody(dyn.filePath, next);
		notice("已更新", relativePostPath(dyn.filePath));
		return;
	}

	if (action === "pinned") {
		updateFrontmatter(dyn.filePath, {
			pinned: dyn.pinned ? DELETE_FIELD : true,
		});
		notice(dyn.pinned ? "已取消置顶" : "已置顶", relativePostPath(dyn.filePath));
		return;
	}

	if (action === "location") {
		const nextLoc = await editField("位置（清空则删除）", dyn.location);
		if (nextLoc === null) return;
		const trimmed = nextLoc.trim();
		if (trimmed === dyn.location) {
			notice("没有改动", "位置和原来一样。");
			return;
		}
		updateFrontmatter(dyn.filePath, {
			location: trimmed ? trimmed : DELETE_FIELD,
		});
		notice("已更新", relativePostPath(dyn.filePath));
	}
}

async function createDynamic() {
	const content = hasDialog
		? await editMultiline("写一条动态（支持 Markdown，可多行）", "")
		: await ask("写一条动态（支持 Markdown）");
	if (content === null) return;
	if (!content.trim()) {
		notice("已取消", "内容不能为空。");
		return;
	}
	run("node", ["scripts/new-dynamic.js", content.trim()]);
	notice("动态已记录", "已写入 src/content/dynamic/，预览可见。");
}

async function editPostInfo() {
	const post = await choosePost();
	if (!post) return;
	const { parsed } = readPost(post.filePath);
	const d = parsed.data;
	const edits = {};

	// 这些字段留空就直接把整行删掉；其余留空写成 ''（schema 有默认值，留着更直观）
	const OPTIONAL_FIELDS = new Set([
		"slug",
		"lang",
		"pinned",
		"password",
		"passwordHint",
	]);
	// next === null 表示用户按 ESC 跳过这一项——必须原样保留，
	// 直接赋值会写出 description: null，下次构建 schema 直接报 expected string。
	const setField = (key, next) => {
		if (next === null) return;
		const current = d[key];
		const currentText =
			current === undefined || current === null ? "" : String(current);
		if (next === "" && OPTIONAL_FIELDS.has(key)) {
			if (current !== undefined) edits[key] = DELETE_FIELD;
			return;
		}
		if (String(next) !== currentText) edits[key] = next;
	};

	const title = await editField("标题", d.title, { allowClear: false });
	if (title === null) return;
	if (!title.trim()) {
		notice("已取消", "标题不能为空。");
		return;
	}
	setField("title", title.trim());

	setField("description", await editField("一句话简介", d.description ?? ""));
	setField("category", await editField("分类（可留空）", d.category ?? ""));

	const tagsRaw = await editField("标签（逗号分隔）", tagsToString(d.tags));
	if (tagsRaw !== null) {
		const nextTags = parseTags(tagsRaw);
		if (nextTags.join(" ") !== (d.tags ?? []).join(" ")) {
			edits.tags = nextTags;
		}
	}

	// chooseCoverImage 返回 null 表示不改，"" 表示清除
	const image = await chooseCoverImage(d.image ?? "");
	if (image !== null && image !== (d.image ?? "")) edits.image = image;

	const pinnedChoice = await selectOption("是否置顶", [
		{
			key: "keep",
			label: d.pinned ? "保留当前（置顶）" : "保留当前（不置顶）",
		},
		{ key: "true", label: "置顶" },
		{ key: "false", label: "不置顶" },
	]);
	if (pinnedChoice !== null && pinnedChoice !== "keep") {
		const nextPinned = pinnedChoice === "true";
		// 原本没写 pinned 又选「不置顶」的话没什么可改；其余情况照实写 true / false
		if (nextPinned !== (d.pinned === true)) edits.pinned = nextPinned;
	}

	setField(
		"slug",
		await editField("自定义 slug（清空则用文件名）", d.slug ?? ""),
	);

	// 语言：用于 <html lang> 和 SEO。候选来自实际启用的 i18n 语言文件。
	setField("lang", await chooseLang(d.lang ?? ""));

	// 加密：留空=公开文章；填密码=构建时 AES-256-GCM 加密，访客需输入密码解密。
	const password = await editField(
		"密码（清空则公开，填了则加密）",
		d.password ?? "",
	);
	setField("password", password);
	if (password !== null && password) {
		setField("passwordHint", await editField("密码提示（访客可见）", d.passwordHint ?? ""));
	} else if (password === "" && d.passwordHint !== undefined) {
		edits.passwordHint = DELETE_FIELD;
	}

	if (!updateFrontmatter(post.filePath, edits)) {
		notice("没有改动", "所有字段都保持原样，文件没有被修改。");
		return;
	}
	notice(
		"已更新",
		`${relativePostPath(post.filePath)}\n\n改动字段：${Object.keys(edits).join("、")}`,
	);
}

async function preview() {
	console.log("正在启动预览，浏览器打开 http://localhost:4321");
	console.log("按 Ctrl+C 停止预览并返回菜单。\n");
	runInterruptible(() => runPnpm(["dev"], { stdio: "inherit" }));
	await pause();
}

async function validate() {
	console.log("\n正在执行完整检查");
	console.log("Biome -> Astro -> TypeScript -> Production build");
	console.log("按 Ctrl+C 可以中断。\n");
	try {
		runInterruptible(() => {
			runPnpm(["exec", "biome", "ci", "./src"]);
			runPnpm(["check"]);
			runPnpm(["type-check"]);
			runPnpm(["build"]);
		});
	} catch (error) {
		// 失败时上面的编译器输出才是重点，先让用户看完再让 dialog 清屏
		console.error(`\n检查未通过：${error.message}`);
		await pause("按回车键继续…");
		throw error;
	}
	console.log("\n全部检查通过。");
	await pause("按回车键继续…");
}

// 推送前先同步远程：远程有新提交时用 rebase 搬到其上，避免 push 被 non-fast-forward 拒绝。
function syncAndPush(branch) {
	capture("git", ["fetch", "origin"], { optional: true });
	const upstream = `origin/${branch}`;
	const behind = capture("git", ["rev-list", "--count", `HEAD..${upstream}`], {
		optional: true,
	});
	if (Number.parseInt(behind ?? "0", 10) > 0) {
		console.log(`远程有 ${behind} 个新提交，正在变基合并…`);
		try {
			run("git", ["rebase", upstream]);
		} catch {
			run("git", ["rebase", "--abort"]);
			throw new Error(
				"与远程改动冲突，已取消合并（本地提交完好），请手动处理后再发布",
			);
		}
	}
	run("git", ["push", "origin", branch]);
}

async function publish() {
	const status = capture("git", ["status", "--short"]);
	if (!status) {
		notice("无需发布", "当前工作区没有改动。");
		return;
	}

	if (hasDialog) {
		const width = boxWidth();
		dialog([
			"--title",
			"待发布改动",
			"--scrollbar",
			"--msgbox",
			status,
			String(Math.min(termSize().rows - 2, wrappedLines(status, width) + 6)),
			String(width),
		]);
	} else {
		console.log("\n准备发布以下改动：\n");
		console.log(status);
		console.log("");
	}
	if (!(await confirm("这些改动都要一起发布吗？"))) return;

	const doValidate = await selectOption("发布前检查", [
		{ key: "quick", label: "快速发布（跳过检查，直接提交推送）" },
		{ key: "full", label: "完整检查（Biome→Astro→TS→Build，较慢）" },
	]);
	if (doValidate === null) return;
	if (doValidate === "full") await validate();

	const message = await ask("提交说明", "content: update blog");
	if (message === null) return;
	run("git", ["add", "--all"]);
	run("git", ["commit", "-m", message]);
	const branch = capture("git", ["branch", "--show-current"]);
	if (!branch) throw new Error("无法确定当前 Git 分支");
	syncAndPush(branch);
	notice("发布完成", "代码已推送，GitHub Actions 会自动构建并部署博客。");
}

// 单纯改了点配置想直接推上去：跳过展示改动、确认、检查，只问提交说明就提交推送。
// 适合你清楚自己只动了配置、不想走完整发布流程的场景。无改动则提示。
async function quickSync() {
	const status = capture("git", ["status", "--short"]);
	if (!status) {
		notice("无需同步", "当前工作区没有改动。");
		return;
	}
	const message = await ask(
		"提交说明（直接回车用默认）",
		"chore: update config",
	);
	if (message === null) return;
	run("git", ["add", "--all"]);
	run("git", ["commit", "-m", message]);
	const branch = capture("git", ["branch", "--show-current"]);
	if (!branch) throw new Error("无法确定当前 Git 分支");
	syncAndPush(branch);
	notice("已同步", "代码已推送，GitHub Actions 会自动构建并部署博客。");
}

const MAIN_ACTIONS = [
	{ key: "new", label: "写一篇新草稿" },
	{ key: "dynamic", label: "写一条动态/微语" },
	{ key: "manage-dynamic", label: "管理微语（编辑/删除/置顶/位置）" },
	{ key: "edit", label: "编辑文章信息" },
	{ key: "visibility", label: "公开或隐藏文章" },
	{ key: "delete", label: "删除文章（移入隔离区）" },
	{ key: "preview", label: "启动本地预览" },
	{ key: "validate", label: "运行完整检查" },
	{ key: "publish", label: "提交并发布" },
	{ key: "sync", label: "快速同步（仅提交推送小改动）" },
	{ key: "exit", label: "退出" },
];

async function chooseMainAction() {
	const summary = getDashboardSummary();
	const changeSummary =
		summary.changes === null
			? "改动状态不可用"
			: `${summary.changes} 个未提交文件`;
	const dashboard = `公开 ${summary.published}  草稿 ${summary.drafts}  ${changeSummary}`;

	if (hasDialog) {
		const { height, width, menuHeight } = menuGeometry(MAIN_ACTIONS.length, 1);
		return dialog([
			"--title",
			"博客小助手",
			"--no-tags",
			"--menu",
			dashboard,
			height,
			width,
			menuHeight,
			...MAIN_ACTIONS.flatMap((action) => [action.key, action.label]),
		]);
	}

	console.log("\n博客小助手");
	console.log(dashboard);
	for (const [index, action] of MAIN_ACTIONS.entries()) {
		console.log(`${String(index + 1).padStart(2, " ")}. ${action.label}`);
	}
	const choice = Number.parseInt(await ask("请选择编号"), 10);
	return MAIN_ACTIONS[choice - 1]?.key;
}

const HANDLERS = {
	new: createPost,
	dynamic: createDynamic,
	"manage-dynamic": manageDynamic,
	edit: editPostInfo,
	visibility: changeVisibility,
	delete: deletePost,
	preview,
	validate,
	publish,
	sync: quickSync,
};

async function menu() {
	while (true) {
		const choice = await chooseMainAction();
		if (choice === "exit" || choice == null) return;

		const handler = HANDLERS[choice];
		if (!handler) {
			notice("编号无效", `请输入 1 到 ${MAIN_ACTIONS.length} 之间的编号。`);
			continue;
		}

		try {
			await handler();
		} catch (error) {
			// 原来这里用 console.error，下一轮 dialog 的 --clear 会立刻把它擦掉，
			// 结果就是菜单闪一下又回来了、完全看不到失败原因。改用 msgbox 挡住。
			notice("操作失败", error.message || String(error));
		}
	}
}

try {
	await loadMatter();
	await menu();
} catch (error) {
	console.error(`\n启动失败：${error.message}\n`);
	process.exitCode = 1;
} finally {
	inputInterface?.close();
}
