import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import matter from "gray-matter";

const repoRoot = process.cwd();
const postsDir = path.join(repoRoot, "src/content/posts");
const dynamicDir = path.join(repoRoot, "src/content/dynamic");
const publicDir = path.join(repoRoot, "public");
// 隔离区：删掉的文移到这里，不参与构建（对齐 quarantine-bad-posts.mjs），可随时手动恢复。
const quarantineDir = path.join(repoRoot, "src/content/_quarantine");
const dialogConfigPath = path.join(repoRoot, "scripts/blog-helper.dialogrc");
const input = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});
const answers = input[Symbol.asyncIterator]();
const hasDialog =
	process.stdin.isTTY &&
	process.stdout.isTTY &&
	spawnSync("dialog", ["--version"], { stdio: "ignore" }).status === 0;

function dialog(args, { allowCancel = true } = {}) {
	const result = spawnSync(
		"dialog",
		[
			"--stdout",
			"--clear",
			"--no-shadow",
			"--no-lines",
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
			stdio: ["inherit", "pipe", "inherit"],
		},
	);
	if (result.status === 0) return result.stdout.trim();
	if (allowCancel && (result.status === 1 || result.status === 255))
		return null;
	throw new Error("终端界面启动失败");
}

function notice(title, message) {
	if (hasDialog) {
		dialog(["--title", title, "--msgbox", message, "8", "58"]);
		return;
	}
	console.log(`\n${title}\n${message}\n`);
}

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: repoRoot,
		stdio: ["ignore", "inherit", "inherit"],
		...options,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(" ")} 执行失败`);
	}
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

// frontmatter 里 published/updated 原写成 YYYY-MM-DD，gray-matter 读入时解析成 Date；
// 若直接 matter.stringify，Date 会被序列化为 ISO8601 长格式，造成无意义的 diff。
// 写回前把这两个字段转回 YYYY-MM-DD；非 Date 值保持原样。
function toDateString(value) {
	return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function writePost(filePath, parsed) {
	const data = { ...parsed.data };
	if (data.published) data.published = toDateString(data.published);
	if (data.updated) data.updated = toDateString(data.updated);
	fs.writeFileSync(filePath, matter.stringify(parsed.content, data));
}

// 微语的 published 是 YYYY-MM-DD HH:MM:SS 格式，与文章的纯日期不同，
// 必须自己格式化回带时分秒的字符串，否则 gray-matter 会把它序列化成 ISO8601。
function toDateTimeString(value) {
	if (!(value instanceof Date)) return value;
	const pad = (n) => String(n).padStart(2, "0");
	return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(
		value.getDate(),
	)} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}

function writeDynamic(filePath, parsed) {
	const data = { ...parsed.data };
	if (data.published) data.published = toDateTimeString(data.published);
	fs.writeFileSync(filePath, matter.stringify(parsed.content, data));
}

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
		return dialog([
			"--title",
			question,
			"--inputbox",
			"",
			"8",
			"58",
			defaultValue,
		]);
	}
	const suffix = defaultValue ? `（默认：${defaultValue}）` : "";
	process.stdout.write(`${question}${suffix}: `);
	const { value = "" } = await answers.next();
	const answer = value.trim();
	return answer || defaultValue;
}

async function confirm(question, defaultYes = false) {
	if (hasDialog) {
		const args = ["--title", "请确认"];
		if (!defaultYes) args.push("--defaultno");
		const result = dialog([...args, "--yesno", question, "8", "58"]);
		return result !== null;
	}
	const hint = defaultYes ? "Y/n" : "y/N";
	process.stdout.write(`${question} [${hint}] `);
	const { value = "" } = await answers.next();
	const answer = value.trim().toLowerCase();
	if (!answer) return defaultYes;
	return answer === "y" || answer === "yes" || answer === "是";
}

// 通用“从选项里选一个”。options: [{key,label}]。返回 key 或 null（取消）。
async function selectOption(title, options) {
	if (hasDialog) {
		const height = String(Math.min(options.length + 7, 22));
		const result = dialog([
			"--title",
			title,
			"--no-tags",
			"--menu",
			"",
			height,
			"60",
			String(Math.min(options.length, 14)),
			...options.flatMap((opt) => [opt.key, opt.label]),
		]);
		return result === null ? null : result;
	}
	console.log(`\n${title}`);
	for (const [index, opt] of options.entries()) {
		console.log(`  ${index}. ${opt.label}`);
	}
	const answer = await ask("输入编号，直接回车取消");
	if (!answer) return null;
	const index = Number.parseInt(answer, 10);
	if (!Number.isInteger(index) || !options[index]) {
		console.log("编号无效。\n");
		return null;
	}
	return options[index].key;
}

// 编辑一个字段：展示当前值，回车保留，输入新值则覆盖。取消则跳过。
// ask 在 readline 下回车会返回 defaultValue（即当前值），无需特判。
async function editField(label, currentValue) {
	const display =
		currentValue === "" || currentValue == null
			? "（空）"
			: String(currentValue);
	const result = await ask(`${label}  当前：${display}`, currentValue ?? "");
	return result === null ? null : result;
}

// 选封面图：从 public 里列图 + 随机封面(api) + 手动输入。回车=保留当前值。
async function chooseCoverImage(currentValue) {
	const images = listPublicImages();
	const options = [
		{
			key: "keep",
			label: currentValue ? `保留当前（${currentValue}）` : "留空",
		},
		{ key: "api", label: "随机封面（api）" },
		{ key: "manual", label: "手动输入路径/网址" },
		...images.map((img, i) => ({ key: String(i), label: img })),
	];
	const choice = await selectOption("封面图", options);
	if (choice === null || choice === "keep") return currentValue;
	if (choice === "api") return "api";
	if (choice === "manual") return await ask("图片路径或网址");
	return images[Number.parseInt(choice, 10)] ?? currentValue;
}

// 选语言：候选来自 src/i18n/languages/ 的实际语言文件。回车=保留当前。
// 返回 null=取消（保留原样）；""=清除（用站点默认）；否则为语言 code。
async function chooseLang(currentValue) {
	const langDir = path.join(repoRoot, "src/i18n/languages");
	const display = currentValue
		? `保留当前（${currentValue}）`
		: "留空（用站点默认）";
	const options = [
		{ key: "keep", label: display },
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
	if (choice === "custom") {
		const v = await ask("语言 code（如 zh_CN、en）", currentValue);
		return v === null ? null : v.trim();
	}
	return choice.slice("lang:".length);
}

async function createPost() {
	const title = await ask("文章标题");
	if (title === null) return;
	if (!title) {
		console.log("已取消：标题不能为空。");
		return;
	}

	let fileName;
	let description;
	let category;
	let tags;
	if (hasDialog) {
		const result = dialog([
			"--title",
			"文章信息",
			"--form",
			"",
			"14",
			"68",
			"5",
			"文件名",
			"1",
			"1",
			title,
			"1",
			"18",
			"50",
			"0",
			"一句话简介",
			"2",
			"1",
			"",
			"2",
			"18",
			"50",
			"0",
			"分类",
			"3",
			"1",
			"",
			"3",
			"18",
			"50",
			"0",
			"标签（逗号分隔）",
			"4",
			"1",
			"",
			"4",
			"18",
			"50",
			"0",
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
	fileName = fileName.trim();
	if (!fileName) throw new Error("文件名不能为空");

	const filePath = resolvePostPath(fileName);
	run("node", ["scripts/new-post.js", fileName]);

	try {
		const { parsed } = readPost(filePath);
		parsed.data.title = title;
		parsed.data.description = description ?? "";
		parsed.data.category = category ?? "";
		tags ??= "";
		parsed.data.tags = tags
			? tags
					.split(/[,，]/)
					.map((tag) => tag.trim())
					.filter(Boolean)
			: [];
		parsed.data.draft = true;
		writePost(filePath, parsed);
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

	if (hasDialog) {
		const filter = dialog([
			"--title",
			"文章范围",
			"--no-tags",
			"--menu",
			"",
			"11",
			"50",
			"5",
			"all",
			`全部文章（${posts.length}）`,
			"draft",
			`仅草稿（${posts.filter((post) => post.draft).length}）`,
			"published",
			`仅公开（${posts.filter((post) => !post.draft).length}）`,
			"search",
			"按标题搜索",
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

		const choice = dialog([
			"--title",
			"选择文章",
			"--no-tags",
			"--menu",
			"",
			"20",
			"76",
			"14",
			...posts.flatMap((post, index) => [
				String(index),
				`${post.draft ? "[草稿]" : "[公开]"} ${post.title}`,
			]),
		]);
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
		console.log("文章编号无效。\n");
		return null;
	}
	return posts[index];
}

async function changeVisibility() {
	const post = await choosePost();
	if (!post) return;
	const { parsed } = readPost(post.filePath);
	const nextDraft = !post.draft;
	const action = nextDraft ? "隐藏" : "公开";
	if (!(await confirm(`确认${action}《${post.title}》？`))) return;
	parsed.data.draft = nextDraft;
	if (!nextDraft) {
		parsed.data.updated = new Date().toISOString().slice(0, 10);
	}
	writePost(post.filePath, parsed);
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
	const recent = dynamics.slice(0, 30);
	const options = recent.map((dyn, index) => {
		const stamp =
			dyn.published instanceof Date
				? toDateTimeString(dyn.published)
				: String(dyn.published ?? "");
		const pin = dyn.pinned ? "📌" : "  ";
		const loc = dyn.location ? ` @${dyn.location}` : "";
		// 菜单项截断，太长看不全
		const prev =
			dyn.preview.length > 32 ? `${dyn.preview.slice(0, 30)}…` : dyn.preview;
		return { key: String(index), label: `${pin} ${stamp}${loc}  ${prev}` };
	});
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
		const mOptions = matched.map((dyn, index) => {
			const stamp =
				dyn.published instanceof Date
					? toDateTimeString(dyn.published)
					: String(dyn.published ?? "");
			const pin = dyn.pinned ? "📌" : "  ";
			const prev =
				dyn.preview.length > 36 ? `${dyn.preview.slice(0, 34)}…` : dyn.preview;
			return { key: String(index), label: `${pin} ${stamp}  ${prev}` };
		});
		const mChoice = await selectOption(`搜到 ${matched.length} 条`, mOptions);
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

	const { parsed } = readPost(dyn.filePath);

	if (action === "content") {
		const next = await editField("正文（Markdown）", dyn.content);
		if (next === null) return;
		if (!next.trim()) {
			console.log("正文不能为空，已保持原样。");
			return;
		}
		// editField 返回单行；微语本就是短文本，保留单行编辑即可
		parsed.content = `\n${next}\n`;
	}

	if (action === "pinned") {
		const nextPinned = !dyn.pinned;
		if (nextPinned) parsed.data.pinned = true;
		else delete parsed.data.pinned;
	}

	if (action === "location") {
		const nextLoc = await editField("位置（留空则清除）", dyn.location);
		if (nextLoc === null) return;
		if (nextLoc.trim()) parsed.data.location = nextLoc.trim();
		else delete parsed.data.location;
	}

	writeDynamic(dyn.filePath, parsed);
	notice("已更新", relativePostPath(dyn.filePath));
}

async function createDynamic() {
	const content = await ask("写一条动态（支持 Markdown）");
	if (content === null) return;
	if (!content) {
		console.log("已取消：内容不能为空。");
		return;
	}
	run("node", ["scripts/new-dynamic.js", content]);
	notice("动态已记录", "已写入 src/content/dynamic/，预览可见。");
}

async function editPostInfo() {
	const post = await choosePost();
	if (!post) return;
	const { parsed } = readPost(post.filePath);
	const d = parsed.data;

	console.log(`\n正在编辑《${post.title}》`);
	console.log(
		"逐项修改：回车保留当前值，输入新值则覆盖，取消(Ctrl-C/ESC)跳过该项。\n",
	);

	const title = await editField("标题", d.title);
	if (title === null || !title) return;

	const description = await editField("一句话简介", d.description ?? "");

	const category = await editField("分类（可留空）", d.category ?? "");

	const tagsRaw = await editField("标签（逗号分隔）", tagsToString(d.tags));
	const tags = tagsRaw === null ? d.tags : parseTags(tagsRaw);

	const image = await chooseCoverImage(d.image ?? "");

	const pinnedChoice = await selectOption("是否置顶", [
		{ key: "true", label: "置顶" },
		{ key: "false", label: "不置顶" },
		{
			key: "keep",
			label: d.pinned ? "保留当前（置顶）" : "保留当前（不置顶）",
		},
	]);
	const pinned =
		pinnedChoice === "keep" || pinnedChoice === null
			? d.pinned
			: pinnedChoice === "true";

	const slug = await editField(
		"自定义 slug（可留空，留空用文件名）",
		d.slug ?? "",
	);

	// 语言：用于 <html lang> 和 SEO。候选来自实际启用的 i18n 语言文件。
	const lang = await chooseLang(d.lang ?? "");

	// 加密：留空=公开文章；填密码=构建时 AES-256-GCM 加密，访客需输入密码解密。
	const password = await editField(
		"密码（留空则公开，填了则加密）",
		d.password ?? "",
	);
	let passwordHint = d.passwordHint ?? "";
	if (password !== null && password) {
		const hint = await editField("密码提示（访客可见）", d.passwordHint ?? "");
		passwordHint = hint ?? "";
	}

	parsed.data.title = title;
	parsed.data.description = description;
	parsed.data.category = category || "";
	parsed.data.tags = tags;
	parsed.data.image = image || "";
	if (pinned) parsed.data.pinned = true;
	else delete parsed.data.pinned;
	if (slug) parsed.data.slug = slug;
	else delete parsed.data.slug;

	if (lang === null) {
		// 用户取消，保留原样
	} else if (lang === "") {
		delete parsed.data.lang;
	} else {
		parsed.data.lang = lang;
	}

	if (password === null) {
		// 用户取消，保留原样
	} else if (password === "") {
		delete parsed.data.password;
		delete parsed.data.passwordHint;
	} else {
		parsed.data.password = password;
		parsed.data.passwordHint = passwordHint;
	}

	writePost(post.filePath, parsed);
	notice("已更新", relativePostPath(post.filePath));
}

function preview() {
	console.log("正在启动预览，浏览器地址：http://localhost:4321");
	console.log("按 Ctrl+C 可以停止。\n");
	run("pnpm", ["dev"], { stdio: "inherit" });
}

function validate() {
	console.log("\n正在执行完整检查");
	console.log("Biome -> Astro -> TypeScript -> Production build\n");
	run("pnpm", ["exec", "biome", "ci", "./src"]);
	run("pnpm", ["check"]);
	run("pnpm", ["type-check"]);
	run("pnpm", ["build"]);
	notice("全部检查通过", "代码质量、类型检查和生产构建均已完成。 ");
}

async function publish() {
	const status = capture("git", ["status", "--short"]);
	if (!status) {
		notice("无需发布", "当前工作区没有改动。");
		return;
	}

	if (hasDialog) {
		dialog([
			"--title",
			"待发布改动",
			"--scrollbar",
			"--msgbox",
			status,
			"16",
			"76",
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
	if (doValidate === "full") validate();

	const message = await ask("提交说明", "content: update blog");
	if (message === null) return;
	run("git", ["add", "--all"]);
	run("git", ["commit", "-m", message]);
	const branch = capture("git", ["branch", "--show-current"]);
	if (!branch) throw new Error("无法确定当前 Git 分支");
	run("git", ["push", "origin", branch]);
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
	run("git", ["push", "origin", branch]);
	notice("已同步", "代码已推送，GitHub Actions 会自动构建并部署博客。");
}

async function chooseMainAction() {
	const summary = getDashboardSummary();
	const changeSummary =
		summary.changes === null
			? "改动状态不可用"
			: `${summary.changes} 个未提交文件`;
	const dashboard = `公开 ${summary.published}  草稿 ${summary.drafts}  ${changeSummary}`;
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
	if (hasDialog) {
		return dialog([
			"--title",
			"博客小助手",
			"--no-tags",
			"--menu",
			dashboard,
			"16",
			"58",
			String(MAIN_ACTIONS.length),
			...MAIN_ACTIONS.flatMap((action) => [action.key, action.label]),
		]);
	}

	console.log("\n博客小助手");
	console.log(dashboard);
	for (const [index, action] of MAIN_ACTIONS.entries()) {
		if (action.key === "exit") {
			console.log("0. 退出");
			continue;
		}
		console.log(`${index + 1}. ${action.label}`);
	}
	const choice = await ask("请选择");
	const map = { 0: "exit" };
	for (const [index, action] of MAIN_ACTIONS.entries()) {
		map[index + 1] = action.key;
	}
	return map[choice];
}

async function menu() {
	while (true) {
		const choice = await chooseMainAction();

		try {
			if (choice === "new") await createPost();
			else if (choice === "dynamic") await createDynamic();
			else if (choice === "manage-dynamic") await manageDynamic();
			else if (choice === "edit") await editPostInfo();
			else if (choice === "visibility") await changeVisibility();
			else if (choice === "delete") await deletePost();
			else if (choice === "preview") preview();
			else if (choice === "validate") validate();
			else if (choice === "publish") await publish();
			else if (choice === "sync") await quickSync();
			else if (choice === "exit" || choice == null) return;
			else console.log("请输入 0 到 10。\n");
		} catch (error) {
			console.error(`\n操作失败：${error.message}\n`);
		}
	}
}

try {
	await menu();
} finally {
	input.close();
}
