import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import matter from "gray-matter";

const repoRoot = process.cwd();
const postsDir = path.join(repoRoot, "src/content/posts");
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

function writePost(filePath, parsed) {
	fs.writeFileSync(filePath, matter.stringify(parsed.content, parsed.data));
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

	validate();
	const message = await ask("提交说明", "content: update blog");
	if (message === null) return;
	run("git", ["add", "--all"]);
	run("git", ["commit", "-m", message]);
	const branch = capture("git", ["branch", "--show-current"]);
	if (!branch) throw new Error("无法确定当前 Git 分支");
	run("git", ["push", "origin", branch]);
	notice("发布完成", "代码已推送，GitHub Actions 会自动构建并部署博客。");
}

async function chooseMainAction() {
	const summary = getDashboardSummary();
	const changeSummary =
		summary.changes === null
			? "改动状态不可用"
			: `${summary.changes} 个未提交文件`;
	const dashboard = `公开 ${summary.published}  草稿 ${summary.drafts}  ${changeSummary}`;
	if (hasDialog) {
		return dialog([
			"--title",
			"博客小助手",
			"--no-tags",
			"--menu",
			dashboard,
			"14",
			"58",
			"6",
			"new",
			"写一篇新草稿",
			"visibility",
			"公开或隐藏文章",
			"preview",
			"启动本地预览",
			"validate",
			"运行完整检查",
			"publish",
			"检查、提交并发布",
			"exit",
			"退出",
		]);
	}

	console.log("\n博客小助手");
	console.log(dashboard);
	console.log("1. 写一篇新草稿");
	console.log("2. 公开或隐藏文章");
	console.log("3. 本地预览");
	console.log("4. 完整检查");
	console.log("5. 提交并发布");
	console.log("0. 退出");
	const choice = await ask("请选择");
	return {
		1: "new",
		2: "visibility",
		3: "preview",
		4: "validate",
		5: "publish",
		0: "exit",
	}[choice];
}

async function menu() {
	while (true) {
		const choice = await chooseMainAction();

		try {
			if (choice === "new") await createPost();
			else if (choice === "visibility") await changeVisibility();
			else if (choice === "preview") preview();
			else if (choice === "validate") validate();
			else if (choice === "publish") await publish();
			else if (choice === "exit" || choice == null) return;
			else console.log("请输入 0 到 5。\n");
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
