#!/usr/bin/env node
//
//  generate.mjs
//  Generate the GitHub wiki (wiki/*.md) from the app's in-app Help, Mezmorize/HelpView.swift
//  in the private dan-snelson/Mezmorize repository. Run with:
//
//    node scripts/wiki/generate.mjs [--source <HelpView.swift>] [--out <dir>] [--static <dir>]
//
//  Defaults (relative to the root of this repository):
//    --source  ../Mezmorize/Mezmorize/HelpView.swift
//    --out     wiki
//    --static  wiki-static
//
//  To push the result to the wiki, run scripts/wiki/publish.sh (it runs this script first).
//
//  How HelpView.swift maps to Markdown
//    section("…", systemImage: "…") { … } ... one wiki page, in source order. The first section
//                                              becomes the intro on Home.md instead of a page.
//    topic("…") { … } / topic("…", "…") ...... ## heading (the short form adds one paragraph)
//    subhead("…") ............................ ### heading
//    paragraph("…") / Text("…") .............. a paragraph
//    bullets([…]) ............................ - list
//    steps([…]) .............................. 1. list
//    note("…") ............................... > **Note:** …
//    ForEach(reviews, …) { … reviewRow … } ... "The five reviews" table, built from the
//                                              `reviews` array (collection + days) in HelpView
//    ScrollView, VStack, LazyVStack, Group ... containers: their content is read, the view is not
//    Spacer, Divider ......................... skipped
//    .modifier(…) and #if around modifiers ... skipped
//    content outside any section ............. appended to Home.md
//
//  Strings are LocalizedStringKey literals; their inline Markdown (**bold**, *italic*, links)
//  is passed through unchanged. Swift escapes (\" \\ \n \t \r \0 \' \u{…}) and multi-line
//  """ literals are decoded. Anything else (an unknown helper or view, string interpolation,
//  raw strings, #if around content, …) stops the run with the line number. Nothing is written
//  unless the whole file is understood.
//
//  Hand-written pages for content that is only on the site (wiki-static/*.md) are copied into
//  the output as-is and listed after the generated pages.
//
//  No dependencies: Node 18+.
//

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SITE_URL = 'https://dan-snelson.github.io/mezmorize-app/';
export const SUPPORT_URL = `${SITE_URL}support.html`;
export const FOOTER_TEXT = "Generated from the app's in-app Help. Do not edit on GitHub.";

const CONTAINERS = new Set(['ScrollView', 'VStack', 'LazyVStack', 'Group']);
const SKIPPED_VIEWS = new Set(['Spacer', 'Divider']);

export class GenerateError extends Error {
	constructor(message, line) {
		super(line ? `line ${line}: ${message}` : message);
		this.line = line;
	}
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

/**
 * Split Swift source into tokens: { type, value, line }.
 * Types: ident, string, number, punct, directive. Comments and whitespace are dropped.
 * A directive (#if, #elseif, #else, #endif) carries the rest of its line as `value`.
 */
export function tokenize(source) {
	const tokens = [];
	let i = 0;
	let line = 1;
	const n = source.length;
	const peek = (k = 0) => source[i + k];

	while (i < n) {
		const c = source[i];
		if (c === '\n') { line++; i++; continue; }
		if (/\s/.test(c)) { i++; continue; }
		if (c === '/' && peek(1) === '/') {
			while (i < n && source[i] !== '\n') i++;
			continue;
		}
		if (c === '/' && peek(1) === '*') {
			const start = line;
			let depth = 1;
			i += 2;
			while (i < n && depth > 0) {
				if (source[i] === '/' && source[i + 1] === '*') { depth++; i += 2; continue; }
				if (source[i] === '*' && source[i + 1] === '/') { depth--; i += 2; continue; }
				if (source[i] === '\n') line++;
				i++;
			}
			if (depth > 0) throw new GenerateError('unterminated block comment', start);
			continue;
		}
		if (c === '#') {
			const m = /^#(if|elseif|else|endif)\b/.exec(source.slice(i));
			if (m) {
				let end = i;
				while (end < n && source[end] !== '\n') end++;
				tokens.push({ type: 'directive', value: source.slice(i, end).trim(), line });
				i = end;
				continue;
			}
			if (peek(1) === '"') throw new GenerateError('raw string literals (#"…"#) are not supported', line);
			const id = /^#[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i));
			if (id) {
				tokens.push({ type: 'ident', value: id[0], line });
				i += id[0].length;
				continue;
			}
		}
		if (c === '"') {
			const startLine = line;
			const { value, length, lines, interpolated } = source.startsWith('"""', i)
				? readMultilineString(source, i, startLine)
				: readString(source, i, startLine);
			tokens.push({ type: 'string', value, line: startLine, interpolated });
			i += length;
			line += lines;
			continue;
		}
		const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i, i + 200));
		if (id) {
			tokens.push({ type: 'ident', value: id[0], line });
			i += id[0].length;
			continue;
		}
		const num = /^[0-9][0-9_]*(\.[0-9]+)?/.exec(source.slice(i, i + 50));
		if (num) {
			tokens.push({ type: 'number', value: num[0], line });
			i += num[0].length;
			continue;
		}
		const op = /^(==|!=|<=|>=|->|&&|\|\||\?\?|\.\.\.|\.\.<)/.exec(source.slice(i, i + 3));
		const value = op ? op[0] : c;
		tokens.push({ type: 'punct', value, line });
		i += value.length;
	}
	return tokens;
}

/** Decode one escape sequence starting at source[i] === '\\'. Returns { text, length }. */
function readEscape(source, i, line) {
	const e = source[i + 1];
	const simple = { n: '\n', t: '\t', r: '\r', '0': '\0', '"': '"', "'": "'", '\\': '\\' };
	if (e in simple) return { text: simple[e], length: 2 };
	if (e === 'u') {
		const m = /^\\u\{([0-9A-Fa-f]{1,8})\}/.exec(source.slice(i, i + 13));
		if (!m) throw new GenerateError('malformed \\u{…} escape', line);
		return { text: String.fromCodePoint(parseInt(m[1], 16)), length: m[0].length };
	}
	if (e === '(') {
		// Interpolation: skip to the matching ")". The token is marked, and only fails if Help content uses it.
		let depth = 0;
		for (let k = i + 1; k < source.length && source[k] !== '\n'; k++) {
			if (source[k] === '(') depth++;
			else if (source[k] === ')' && --depth === 0) return { text: '', length: k + 1 - i, interpolated: true };
		}
		throw new GenerateError('unterminated string interpolation', line);
	}
	throw new GenerateError(`unknown string escape \\${e ?? ''}`, line);
}

function readString(source, start, line) {
	let i = start + 1;
	let text = '';
	let interpolated = false;
	while (true) {
		const c = source[i];
		if (c === undefined || c === '\n') throw new GenerateError('unterminated string literal', line);
		if (c === '"') return { value: text, length: i + 1 - start, lines: 0, interpolated };
		if (c === '\\') {
			const esc = readEscape(source, i, line);
			interpolated ||= Boolean(esc.interpolated);
			text += esc.text;
			i += esc.length;
			continue;
		}
		text += c;
		i++;
	}
}

function readMultilineString(source, start, line) {
	const close = source.indexOf('\n', start);
	if (close === -1 || source.slice(start + 3, close).trim() !== '') {
		throw new GenerateError('a multi-line string must start with """ followed by a line break', line);
	}
	// Find the closing """ (on its own line, after optional indentation), skipping escaped quotes.
	let i = close + 1;
	let end = -1;
	while (i < source.length) {
		if (source[i] === '\\') { i += 2; continue; }
		if (source.startsWith('"""', i)) { end = i; break; }
		i++;
	}
	if (end === -1) throw new GenerateError('unterminated multi-line string literal', line);
	const lineStart = source.lastIndexOf('\n', end - 1) + 1;
	const indent = source.slice(lineStart, end);
	if (!/^[ \t]*$/.test(indent)) throw new GenerateError('the closing """ must be on its own line', line);

	const raw = source.slice(close + 1, lineStart === close + 1 ? close + 1 : lineStart - 1);
	const rawLines = lineStart === close + 1 ? [] : raw.split('\n');
	let text = '';
	let interpolated = false;
	rawLines.forEach((rawLine, index) => {
		const lineNo = line + 1 + index;
		if (rawLine.trim() === '') rawLine = '';
		else if (!rawLine.startsWith(indent)) throw new GenerateError('multi-line string line is indented less than its closing """', lineNo);
		else rawLine = rawLine.slice(indent.length);
		let j = 0;
		let continued = false;
		while (j < rawLine.length) {
			if (rawLine[j] === '\\') {
				if (/^\\[ \t]*$/.test(rawLine.slice(j))) { continued = true; break; }
				const esc = readEscape(rawLine, j, lineNo);
				interpolated ||= Boolean(esc.interpolated);
				text += esc.text;
				j += esc.length;
				continue;
			}
			text += rawLine[j];
			j++;
		}
		if (!continued && index < rawLines.length - 1) text += '\n';
	});
	const length = end + 3 - start;
	const lines = source.slice(start, end + 3).split('\n').length - 1;
	return { value: text, length, lines, interpolated };
}

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

const isPunct = (t, v) => t && t.type === 'punct' && t.value === v;
const isIdent = (t, v) => t && t.type === 'ident' && (v === undefined || t.value === v);

/** Index of the bracket that closes the one at tokens[open]. */
function matchBracket(tokens, open) {
	const pairs = { '(': ')', '[': ']', '{': '}' };
	const opener = tokens[open].value;
	const closer = pairs[opener];
	let depth = 0;
	for (let k = open; k < tokens.length; k++) {
		const t = tokens[k];
		if (t.type !== 'punct') continue;
		if (t.value === opener) depth++;
		else if (t.value === closer && --depth === 0) return k;
	}
	throw new GenerateError(`unbalanced "${opener}"`, tokens[open].line);
}

/** Split tokens (start, end) exclusive at top-level commas into arguments: { label, tokens }. */
function splitArgs(tokens, start, end) {
	const args = [];
	let current = [];
	let k = start;
	while (k < end) {
		const t = tokens[k];
		if (t.type === 'punct' && '([{'.includes(t.value)) {
			const close = matchBracket(tokens, k);
			current.push(...tokens.slice(k, close + 1));
			k = close + 1;
			continue;
		}
		if (isPunct(t, ',')) {
			args.push(current);
			current = [];
			k++;
			continue;
		}
		current.push(t);
		k++;
	}
	if (current.length) args.push(current);
	return args.map((ts) => (ts.length >= 2 && ts[0].type === 'ident' && isPunct(ts[1], ':')
		? { label: ts[0].value, tokens: ts.slice(2) }
		: { label: null, tokens: ts }));
}

function literal(token) {
	if (token.interpolated) throw new GenerateError('string interpolation \\(…) is not supported in Help content', token.line);
	return token.value;
}

function stringArg(arg, what, line) {
	if (!arg || arg.tokens.length !== 1 || arg.tokens[0].type !== 'string') {
		throw new GenerateError(`${what} must be a single string literal`, arg?.tokens[0]?.line ?? line);
	}
	return literal(arg.tokens[0]);
}

function stringArrayArg(arg, what, line) {
	const ts = arg?.tokens ?? [];
	if (ts.length < 2 || !isPunct(ts[0], '[') || !isPunct(ts[ts.length - 1], ']')) {
		throw new GenerateError(`${what} must be an array literal of strings`, ts[0]?.line ?? line);
	}
	const items = [];
	for (let k = 1; k < ts.length - 1; k++) {
		if (ts[k].type !== 'string') throw new GenerateError(`${what} must contain only string literals`, ts[k].line);
		items.push(literal(ts[k]));
		if (k + 1 < ts.length - 1 && !isPunct(ts[++k], ',')) throw new GenerateError(`expected "," in ${what}`, ts[k].line);
	}
	if (!items.length) throw new GenerateError(`${what} is empty`, ts[0].line);
	return items;
}

// ---------------------------------------------------------------------------
// HelpView parsing
// ---------------------------------------------------------------------------

/** Turn a QuoteCollection case name into its tile title: nextWeek -> Next Week. */
export function collectionTitle(caseName) {
	return caseName
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/^./, (c) => c.toUpperCase());
}

/** Locate `struct HelpView` and return the token range of its body. */
function findHelpView(tokens) {
	const s = tokens.findIndex((t, k) => isIdent(t, 'struct') && isIdent(tokens[k + 1], 'HelpView'));
	if (s === -1) throw new GenerateError('struct HelpView not found');
	const open = tokens.findIndex((t, k) => k > s && isPunct(t, '{'));
	if (open === -1) throw new GenerateError('struct HelpView has no body', tokens[s].line);
	return { start: open + 1, end: matchBracket(tokens, open) };
}

/** Parse `let reviews: [...] = [(.tomorrow, 1), …]` inside HelpView. */
export function parseReviews(tokens, scope) {
	let k = scope.start;
	for (; k < scope.end; k++) {
		if ((isIdent(tokens[k], 'let') || isIdent(tokens[k], 'var')) && isIdent(tokens[k + 1], 'reviews')) break;
	}
	if (k >= scope.end) throw new GenerateError('the five reviews: `reviews` array (collection + days) not found in HelpView');
	const line = tokens[k].line;
	let eq = k + 2;
	while (eq < scope.end && !isPunct(tokens[eq], '=')) {
		if (isPunct(tokens[eq], '[') || isPunct(tokens[eq], '(')) eq = matchBracket(tokens, eq);
		eq++;
	}
	if (!isPunct(tokens[eq + 1], '[')) throw new GenerateError('`reviews` must be initialized with an array literal', line);
	const open = eq + 1;
	const close = matchBracket(tokens, open);
	const reviews = splitArgs(tokens, open + 1, close).map(({ tokens: ts }) => {
		const ok = ts.length === 6 && isPunct(ts[0], '(') && isPunct(ts[1], '.') && isIdent(ts[2])
			&& isPunct(ts[3], ',') && ts[4].type === 'number' && /^[0-9]+$/.test(ts[4].value) && isPunct(ts[5], ')');
		if (!ok) throw new GenerateError('`reviews` entries must look like (.collection, days)', ts[0]?.line ?? line);
		return { collection: ts[2].value, days: Number(ts[4].value) };
	});
	if (!reviews.length) throw new GenerateError('`reviews` array is empty', line);
	return reviews;
}

/**
 * Read the ForEach(reviews) block: `if review.collection == .X { reviewRow(…, title: "…", trailing: "…") }`
 * gives the per-row overrides; every other row uses the collection title and "N days".
 */
function parseReviewRows(tokens, open, close, reviews) {
	const overrides = {};
	let rows = 0;
	for (let k = open + 1; k < close; k++) {
		if (!isIdent(tokens[k], 'reviewRow')) continue;
		rows++;
		if (!isPunct(tokens[k + 1], '(')) throw new GenerateError('expected "(" after reviewRow', tokens[k].line);
		const end = matchBracket(tokens, k + 1);
		// The nearest preceding `== .case` (inside this block) names the row the overrides apply to.
		let target = null;
		for (let b = k - 1; b > open; b--) {
			if (isPunct(tokens[b], '}')) break;
			if (isPunct(tokens[b], '==') && isPunct(tokens[b + 1], '.') && isIdent(tokens[b + 2])) { target = tokens[b + 2].value; break; }
		}
		const labels = {};
		for (const arg of splitArgs(tokens, k + 2, end)) {
			if (arg.label === 'title' || arg.label === 'trailing') labels[arg.label] = stringArg(arg, `reviewRow ${arg.label}`, tokens[k].line);
		}
		if (Object.keys(labels).length) {
			if (!target) throw new GenerateError('reviewRow title/trailing overrides need an `if review.collection == .case` around them', tokens[k].line);
			if (!reviews.some((r) => r.collection === target)) throw new GenerateError(`reviewRow override for .${target}, which is not in \`reviews\``, tokens[k].line);
			overrides[target] = labels;
		}
		k = end;
	}
	if (!rows) throw new GenerateError('ForEach(reviews) does not call reviewRow', tokens[open].line);
	return reviews.map((r) => ({
		title: overrides[r.collection]?.title ?? collectionTitle(r.collection),
		when: overrides[r.collection]?.trailing ?? (r.days === 1 ? '1 day' : `${r.days} days`),
	}));
}

/**
 * Parse HelpView.swift into { intro, pages, extra }:
 *   pages: [{ title, blocks: [{ kind, … }] }] in source order
 *   extra: blocks found outside any section
 */
export function parseHelpView(source) {
	const tokens = tokenize(source);
	const scope = findHelpView(tokens);
	const reviews = parseReviews(tokens, scope);

	let b = scope.start;
	for (; b < scope.end; b++) {
		if (isIdent(tokens[b], 'var') && isIdent(tokens[b + 1], 'body')) break;
	}
	if (b >= scope.end) throw new GenerateError('HelpView has no `var body`');
	let open = b;
	while (open < scope.end && !isPunct(tokens[open], '{')) open++;
	if (open >= scope.end) throw new GenerateError('HelpView body has no "{"', tokens[b].line);
	const close = matchBracket(tokens, open);

	const pages = [];
	const extra = [];
	const state = { page: null, topic: false };
	const emit = (block) => (state.page ? state.page.blocks : extra).push(block);

	function parseBlock(start, end) {
		let k = start;
		while (k < end) {
			const t = tokens[k];
			if (t.type === 'directive') throw new GenerateError(`conditional compilation (${t.value}) around Help content is not supported`, t.line);
			if (!isIdent(t)) throw new GenerateError(`unexpected "${t.value}"`, t.line);
			const name = t.value;
			k++;
			let args = null;
			if (isPunct(tokens[k], '(')) {
				const c = matchBracket(tokens, k);
				args = splitArgs(tokens, k + 1, c);
				k = c + 1;
			}
			let closure = null;
			if (isPunct(tokens[k], '{')) {
				const c = matchBracket(tokens, k);
				closure = { open: k, close: c };
				k = c + 1;
			}
			k = skipModifiers(k, end);
			handle(name, t.line, args ?? [], closure);
		}
	}

	/** Skip `.modifier(…) { … }` chains, and #if/#endif lines that only wrap modifiers. */
	function skipModifiers(k, end) {
		while (k < end) {
			let j = k;
			while (j < end && tokens[j].type === 'directive') j++;
			if (j < end && !isPunct(tokens[j], '.')) return k;
			k = j;
			if (k >= end) return k;
			k++;
			if (!isIdent(tokens[k])) throw new GenerateError('expected a modifier name after "."', tokens[k - 1].line);
			k++;
			if (isPunct(tokens[k], '(')) k = matchBracket(tokens, k) + 1;
			if (isPunct(tokens[k], '{')) k = matchBracket(tokens, k) + 1;
		}
		return k;
	}

	const noClosure = (name, line, closure) => {
		if (closure) throw new GenerateError(`${name} does not take a closure`, line);
	};
	const arity = (name, line, args, count) => {
		if (args.length !== count) throw new GenerateError(`${name} expects ${count} argument(s), found ${args.length}`, line);
	};
	const requireSection = (name, line) => {
		if (!state.page) throw new GenerateError(`${name} outside a section`, line);
	};

	function handle(name, line, args, closure) {
		if (CONTAINERS.has(name)) {
			if (!closure) throw new GenerateError(`${name} without content`, line);
			parseBlock(closure.open + 1, closure.close);
			return;
		}
		if (SKIPPED_VIEWS.has(name)) return;
		switch (name) {
			case 'section': {
				if (state.page) throw new GenerateError('section inside a section', line);
				if (!closure) throw new GenerateError('section without content', line);
				const unlabeled = args.filter((a) => a.label === null);
				const unknown = args.filter((a) => a.label !== null && a.label !== 'systemImage');
				if (unlabeled.length !== 1 || unknown.length) throw new GenerateError('section expects ("title", systemImage: "…")', line);
				const title = stringArg(unlabeled[0], 'section title', line);
				if (pages.some((p) => p.title === title)) throw new GenerateError(`duplicate section "${title}"`, line);
				state.page = { title, blocks: [], line };
				pages.push(state.page);
				parseBlock(closure.open + 1, closure.close);
				state.page = null;
				return;
			}
			case 'topic': {
				requireSection(name, line);
				if (state.topic) throw new GenerateError('topic inside a topic', line);
				const title = stringArg(args[0], 'topic title', line);
				emit({ kind: 'heading', level: 2, text: title });
				if (closure) {
					arity(name, line, args, 1);
					state.topic = true;
					parseBlock(closure.open + 1, closure.close);
					state.topic = false;
				} else {
					arity(name, line, args, 2);
					emit({ kind: 'paragraph', text: stringArg(args[1], 'topic text', line) });
				}
				return;
			}
			case 'subhead':
				requireSection(name, line);
				noClosure(name, line, closure);
				arity(name, line, args, 1);
				emit({ kind: 'heading', level: 3, text: stringArg(args[0], 'subhead', line) });
				return;
			case 'paragraph':
			case 'Text':
				noClosure(name, line, closure);
				arity(name, line, args, 1);
				emit({ kind: 'paragraph', text: stringArg(args[0], name, line) });
				return;
			case 'note':
				noClosure(name, line, closure);
				arity(name, line, args, 1);
				emit({ kind: 'note', text: stringArg(args[0], 'note', line) });
				return;
			case 'bullets':
			case 'steps':
				noClosure(name, line, closure);
				arity(name, line, args, 1);
				emit({ kind: name, items: stringArrayArg(args[0], name, line) });
				return;
			case 'ForEach': {
				const first = args[0]?.tokens ?? [];
				if (first.length === 1 && isIdent(first[0], 'reviews') && closure) {
					requireSection('the reviews table', line);
					emit({ kind: 'table', header: ['Review', 'When'], rows: parseReviewRows(tokens, closure.open, closure.close, reviews).map((r) => [r.title, r.when]) });
					return;
				}
				throw new GenerateError('ForEach is only supported over `reviews`', line);
			}
			default:
				throw new GenerateError(`unknown helper or view "${name}"`, line);
		}
	}

	parseBlock(open + 1, close);
	if (!pages.length) throw new GenerateError('no sections found in HelpView body');
	for (const p of pages) {
		if (!p.blocks.length) throw new GenerateError(`section "${p.title}" is empty`, p.line);
	}
	return { pages, extra, reviews };
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

/** Wiki page name for a section title: "Getting quotes in" -> "Getting-Quotes-In" (iCloud stays iCloud). */
export function pageName(title) {
	const words = title.split(/\s+/).map((w) => w.replace(/[^A-Za-z0-9-]/g, '')).filter(Boolean);
	if (!words.length) throw new GenerateError(`cannot make a page name from "${title}"`);
	return words.map((w) => (/[A-Z]/.test(w) ? w : w[0].toUpperCase() + w.slice(1))).join('-');
}

/** Display title for a hand-written page name: Apple-Watch -> Apple Watch. */
const staticTitle = (name) => name.replace(/-/g, ' ');

const indentContinuation = (text, pad) => text.split('\n').join(`\n${pad}`);
const cell = (text) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function renderBlocks(blocks) {
	return blocks.map((b, k) => {
		// Two lists of the same kind in a row would merge into one; an empty comment keeps them apart.
		const separator = k > 0 && blocks[k - 1].kind === b.kind && (b.kind === 'bullets' || b.kind === 'steps') ? '<!-- -->\n\n' : '';
		return separator + renderBlock(b);
	}).join('\n\n');
}

function renderBlock(b) {
	switch (b.kind) {
		case 'heading': return `${'#'.repeat(b.level)} ${b.text}`;
		case 'paragraph': return b.text;
		case 'note': return `> **Note:** ${b.text.split('\n').join('\n> ')}`;
		case 'bullets': return b.items.map((item) => `- ${indentContinuation(item, '  ')}`).join('\n');
		case 'steps': return b.items.map((item, k) => `${k + 1}. ${indentContinuation(item, ' '.repeat(String(k + 1).length + 2))}`).join('\n');
		case 'table': return [
			`| ${b.header.map(cell).join(' | ')} |`,
			`| ${b.header.map(() => '---').join(' | ')} |`,
			...b.rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
		].join('\n');
		default: throw new GenerateError(`internal: unknown block kind ${b.kind}`);
	}
}

const link = (text, target) => `[${text}](${target})`;

/**
 * Build every wiki file from HelpView.swift source and hand-written pages.
 * staticPages: { "Apple-Watch": "markdown…", … }. Returns { "Home.md": "…", … }.
 */
export function generate(source, staticPages = {}) {
	const { pages, extra } = parseHelpView(source);
	const [intro, ...rest] = pages;
	const files = {};
	const generated = rest.map((p) => ({ name: pageName(p.title), title: p.title, blocks: p.blocks, line: p.line }));

	const names = new Set(['Home', '_Sidebar', '_Footer']);
	for (const p of generated) {
		if (names.has(p.name)) throw new GenerateError(`two pages would be named ${p.name}.md`, p.line);
		names.add(p.name);
	}
	const statics = Object.keys(staticPages).sort().map((name) => {
		if (names.has(name)) throw new GenerateError(`wiki-static/${name}.md clashes with a generated page`);
		names.add(name);
		return { name, title: staticTitle(name) };
	});

	for (const p of generated) files[`${p.name}.md`] = `${renderBlocks(p.blocks)}\n`;
	for (const s of statics) files[`${s.name}.md`] = staticPages[s.name];

	const allPages = [...generated, ...statics];
	const home = [
		renderBlocks([{ kind: 'heading', level: 2, text: intro.title }, ...intro.blocks]),
		'## Help',
		allPages.map((p) => `- ${link(p.title, p.name)}`).join('\n'),
		'## Links',
		[`- ${link('Mezmorize web site', SITE_URL)}`, `- ${link('Support', SUPPORT_URL)}`].join('\n'),
	];
	if (extra.length) home.push(renderBlocks(extra));
	files['Home.md'] = `${home.join('\n\n')}\n`;

	files['_Sidebar.md'] = `${[`- ${link('Home', 'Home')}`, ...allPages.map((p) => `- ${link(p.title, p.name)}`)].join('\n')}\n`;
	files['_Footer.md'] = `${FOOTER_TEXT} ${link('Mezmorize web site', SITE_URL)}\n`;
	return files;
}

// ---------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------

export function parseArgs(argv, root) {
	const options = {
		source: path.resolve(root, '../Mezmorize/Mezmorize/HelpView.swift'),
		out: path.resolve(root, 'wiki'),
		static: path.resolve(root, 'wiki-static'),
	};
	for (let k = 0; k < argv.length; k++) {
		const flag = argv[k].replace(/^--/, '');
		if (!(flag in options) || !argv[k].startsWith('--')) throw new Error(`unknown option ${argv[k]}`);
		if (k + 1 >= argv.length) throw new Error(`${argv[k]} needs a value`);
		options[flag] = path.resolve(argv[++k]);
	}
	return options;
}

export function main(argv = process.argv.slice(2)) {
	const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
	const options = parseArgs(argv, root);
	if (!fs.existsSync(options.source)) throw new Error(`HelpView.swift not found at ${options.source} (use --source)`);
	const source = fs.readFileSync(options.source, 'utf8');

	const staticPages = {};
	if (fs.existsSync(options.static)) {
		for (const file of fs.readdirSync(options.static).filter((f) => f.endsWith('.md'))) {
			staticPages[file.slice(0, -3)] = fs.readFileSync(path.join(options.static, file), 'utf8');
		}
	}

	let files;
	try {
		files = generate(source, staticPages);
	} catch (error) {
		if (error instanceof GenerateError) throw new Error(`${options.source}: ${error.message}`);
		throw error;
	}

	// Everything is generated in memory first, so a failure above never leaves partial output.
	fs.mkdirSync(options.out, { recursive: true });
	for (const file of fs.readdirSync(options.out).filter((f) => f.endsWith('.md'))) fs.rmSync(path.join(options.out, file));
	for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(options.out, name), content);
	console.log(`Wrote ${Object.keys(files).length} pages to ${path.relative(process.cwd(), options.out) || '.'}: ${Object.keys(files).sort().join(', ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		main();
	} catch (error) {
		console.error(`error: ${error instanceof Error ? error.message : error}`);
		process.exit(1);
	}
}
