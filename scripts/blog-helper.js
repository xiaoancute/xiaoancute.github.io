import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import matter from "gray-matter";

const repoRoot = process.cwd();
const postsDir = path.join(repoRoot, "src/content/posts");
const input = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});
const answers = input[Symbol.asyncIterator]();

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

function capture(command, args) {
	const result = spawnSync(command, args, {
		cwd: repoRoot,
		encoding: "utf8",
	});
	if (result.error) throw result.error;
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
	const suffix = defaultValue ? `（默认：${defaultValue}）` : "";
	process.stdout.write(`${question}${suffix}: `);
	const { value = "" } = await answers.next();
	const answer = value.trim();
	return answer || defaultValue;
}

async function confirm(question, defaultYes = false) {
	const hint = defaultYes ? "Y/n" : "y/N";
	process.stdout.write(`${question} [${hint}] `);
	const { value = "" } = await answers.next();
	const answer = value.trim().toLowerCase();
	if (!answer) return defaultYes;
	return answer === "y" || answer === "yes" || answer === "是";
}

async function createPost() {
	const title = await ask("文章标题");
	if (!title) {
		console.log("已取消：标题不能为空。");
		return;
	}

	const fileName = await ask("文件名或目录名", title);
	const filePath = resolvePostPath(fileName);
	run("node", ["scripts/new-post.js", fileName]);

	try {
		const { parsed } = readPost(filePath);
		parsed.data.title = title;
		parsed.data.description = await ask("一句话简介（可留空）");
		parsed.data.category = await ask("分类（可留空）");
		const tags = await ask("标签，多个用逗号分隔（可留空）");
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

	console.log(`\n草稿已创建：${relativePostPath(filePath)}`);
	console.log("草稿会在本地预览中显示，但不会出现在正式网站。\n");
}

async function choosePost() {
	const posts = getPostFiles().map((filePath) => {
		const { parsed } = readPost(filePath);
		return {
			filePath,
			title: parsed.data.title || path.basename(filePath),
			draft: parsed.data.draft === true,
		};
	});

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
	console.log(`已${action}：${relativePostPath(post.filePath)}\n`);
}

function preview() {
	console.log("正在启动预览，浏览器地址：http://localhost:4321");
	console.log("按 Ctrl+C 可以停止。\n");
	run("pnpm", ["dev"], { stdio: "inherit" });
}

function validate() {
	run("pnpm", ["exec", "biome", "ci", "./src"]);
	run("pnpm", ["check"]);
	run("pnpm", ["type-check"]);
	run("pnpm", ["build"]);
	console.log("\n全部检查通过。\n");
}

async function publish() {
	const status = capture("git", ["status", "--short"]);
	if (!status) {
		console.log("没有需要发布的改动。\n");
		return;
	}

	console.log("\n准备发布以下改动：\n");
	console.log(status);
	console.log("");
	if (!(await confirm("这些改动都要一起发布吗？"))) return;

	validate();
	const message = await ask("提交说明", "content: update blog");
	run("git", ["add", "--all"]);
	run("git", ["commit", "-m", message]);
	const branch = capture("git", ["branch", "--show-current"]);
	if (!branch) throw new Error("无法确定当前 Git 分支");
	run("git", ["push", "origin", branch]);
	console.log("\n发布完成，GitHub Actions 会自动构建并部署博客。\n");
}

async function menu() {
	while (true) {
		console.log("\n=== 博客小助手 ===");
		console.log("1. 写一篇新草稿");
		console.log("2. 公开或隐藏文章");
		console.log("3. 本地预览");
		console.log("4. 完整检查");
		console.log("5. 提交并发布");
		console.log("0. 退出");
		const choice = await ask("请选择");

		try {
			if (choice === "1") await createPost();
			else if (choice === "2") await changeVisibility();
			else if (choice === "3") preview();
			else if (choice === "4") validate();
			else if (choice === "5") await publish();
			else if (choice === "0") return;
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
