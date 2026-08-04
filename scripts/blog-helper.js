import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import matter from "gray-matter";

const repoRoot = process.cwd();
const postsDir = path.join(repoRoot, "src/content/posts");
const publicDir = path.join(repoRoot, "public");
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

	parsed.data.title = title;
	parsed.data.description = description;
	parsed.data.category = category || "";
	parsed.data.tags = tags;
	parsed.data.image = image || "";
	if (pinned) parsed.data.pinned = true;
	else delete parsed.data.pinned;
	if (slug) parsed.data.slug = slug;
	else delete parsed.data.slug;

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
		{ key: "edit", label: "编辑文章信息" },
		{ key: "visibility", label: "公开或隐藏文章" },
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
			else if (choice === "edit") await editPostInfo();
			else if (choice === "visibility") await changeVisibility();
			else if (choice === "preview") preview();
			else if (choice === "validate") validate();
			else if (choice === "publish") await publish();
			else if (choice === "sync") await quickSync();
			else if (choice === "exit" || choice == null) return;
			else console.log("请输入 0 到 8。\n");
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
