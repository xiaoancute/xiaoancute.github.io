/* frontmatter 的定点改写：只动指定字段所在的那几行，其余字节原样保留。
 *
 * 之前的做法是 gray-matter 全量反序列化再写回，副作用很大：
 *   tags: [a, b]  →  拆成三行块状列表
 *   image: "api"  →  image: api
 *   原本没写的键被补成 description: ''
 * 改个标题就能糊出一屏无关 diff，所以换成在原文上做外科手术。
 */

export const DELETE_FIELD = Symbol("delete-field");

// published/updated 必须是裸日期。加引号后 Astro 的 schema 会判成 string，
// 构建时报 Expected type 'date', received 'string'。
const PLAIN_DATE_FIELDS = new Set(["published", "updated"]);

export function splitFrontmatter(source) {
	const match = /^(---[ \t]*\r?\n)([\s\S]*?)(\r?\n---[ \t]*\r?\n?)/.exec(source);
	if (!match) throw new Error("这个文件没有 frontmatter，无法修改");
	return {
		open: match[1],
		block: match[2],
		close: match[3],
		body: source.slice(match[0].length),
	};
}

// 记录每个顶层字段占了哪几行（块状列表这类续行也算进去）
function fieldRegions(lines) {
	const regions = new Map();
	let current = null;
	lines.forEach((line, index) => {
		const key = /^([A-Za-z_][\w-]*)[ \t]*:/.exec(line);
		if (key) {
			current = { start: index, end: index + 1 };
			regions.set(key[1], current);
			return;
		}
		// 缩进的续行，或者顶格写的 "- item" 列表项
		if (current && /^(?:[ \t]+\S|-[ \t]+\S)/.test(line)) {
			current.end = index + 1;
		}
	});
	return regions;
}

function needsQuote(text) {
	if (text === "") return true;
	if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(text)) return true;
	if (/:\s|\s#/.test(text)) return true;
	if (/^\s|\s$/.test(text)) return true;
	if (/^(?:true|false|null|yes|no|on|off|~)$/i.test(text)) return true;
	if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return true;
	if (/^\d{4}-\d{2}-\d{2}/.test(text)) return true;
	return false;
}

function quoteScalar(value) {
	const text = String(value);
	return needsQuote(text) ? `'${text.replace(/'/g, "''")}'` : text;
}

function serializeField(key, value, previousLine = "") {
	if (typeof value === "boolean") return [`${key}: ${value}`];
	if (Array.isArray(value)) {
		if (value.length === 0) return [`${key}: []`];
		// 保持原来的书写风格：本来写成块状列表就继续用块状
		const wasBlock = /^[A-Za-z_][\w-]*[ \t]*:[ \t]*$/.test(previousLine);
		if (wasBlock) {
			return [`${key}:`, ...value.map((item) => `  - ${quoteScalar(item)}`)];
		}
		return [`${key}: [${value.map(quoteScalar).join(", ")}]`];
	}
	if (PLAIN_DATE_FIELDS.has(key)) return [`${key}: ${value}`];
	return [`${key}: ${quoteScalar(value)}`];
}

export function applyFrontmatterEdits(source, edits) {
	const { open, block, close, body } = splitFrontmatter(source);
	const lines = block.split("\n");
	const regions = fieldRegions(lines);

	// 从后往前改，免得前面的增删把后面记下来的行号搞偏
	const existing = Object.keys(edits)
		.filter((key) => regions.has(key))
		.sort((a, b) => regions.get(b).start - regions.get(a).start);
	for (const key of existing) {
		const { start, end } = regions.get(key);
		const value = edits[key];
		if (value === DELETE_FIELD) {
			lines.splice(start, end - start);
		} else {
			lines.splice(
				start,
				end - start,
				...serializeField(key, value, lines[start]),
			);
		}
	}

	// 原本没有的字段追加到 frontmatter 末尾
	for (const [key, value] of Object.entries(edits)) {
		if (regions.has(key) || value === DELETE_FIELD) continue;
		lines.push(...serializeField(key, value));
	}

	return `${open}${lines.join("\n")}${close}${body}`;
}
