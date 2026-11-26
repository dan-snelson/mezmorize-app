//
//  generate.test.mjs
//  Tests for generate.mjs. Run with:  node --test scripts/wiki/
//
//  The fixture (fixtures/HelpView.sample.swift) is a small HelpView that uses every helper the
//  generator reads, Swift string escapes, a multi-line literal, inline Markdown, and the five
//  reviews table. The expected Markdown below is exact.
//

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as G from './generate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, 'fixtures', 'HelpView.sample.swift');
const fixture = fs.readFileSync(fixturePath, 'utf8');

const SITE = 'https://dan-snelson.github.io/mezmorize-app/';

const expected = {
	'Home.md': [
		'## What it is',
		'',
		'A *method* for "quotable" quotes.',
		'',
		'## Help',
		'',
		'- [The five reviews](The-Five-Reviews)',
		'- [Getting quotes in](Getting-Quotes-In)',
		'- [iCloud Sync](iCloud-Sync)',
		'- [Contact](Contact)',
		'',
		'## Links',
		'',
		`- [Mezmorize web site](${SITE})`,
		`- [Support](${SITE}support.html)`,
		'',
		'[Mezmorize](https://example.com/) on GitHub.com',
		'',
	].join('\n'),
	'The-Five-Reviews.md': [
		'| Review | When |',
		'| --- | --- |',
		'| Today | day added |',
		'| Next Week | 7 days |',
		'| Next Year | 365 days |',
		'',
		'Counted from the day you add it.',
		'',
	].join('\n'),
	'Getting-Quotes-In.md': [
		'## Capture',
		'',
		'1. Tap + (on a Mac, the **+** button).',
		'2. Save.',
		'',
		'- See [the site](https://example.com/) — it’s free.',
		'- A back\\slash and a tab:\there.',
		'',
		'<!-- -->',
		'',
		'- A second list right after the first.',
		'',
		'## Short form',
		'',
		'One paragraph only.',
		'',
		'## Details',
		'',
		'### What gets filled in',
		'',
		'First line of a multi-line literal,',
		'second line joined to this one.',
		'',
		'> **Note:** Never changes the schedule.',
		'',
	].join('\n'),
	'iCloud-Sync.md': 'Quotes sync through iCloud.\n',
	'Contact.md': 'Email us.\n',
	'_Sidebar.md': [
		'- [Home](Home)',
		'- [The five reviews](The-Five-Reviews)',
		'- [Getting quotes in](Getting-Quotes-In)',
		'- [iCloud Sync](iCloud-Sync)',
		'- [Contact](Contact)',
		'',
	].join('\n'),
	'_Footer.md': `Generated from the app's in-app Help. Do not edit on GitHub. [Mezmorize web site](${SITE})\n`,
};

test('fixture generates the exact Markdown for every page', () => {
	const files = G.generate(fixture, { Contact: 'Email us.\n' });
	assert.deepEqual(Object.keys(files).sort(), Object.keys(expected).sort());
	for (const [name, content] of Object.entries(expected)) assert.equal(files[name], content, name);
});

/** Replace one line of the fixture and expect generation to fail on that line. */
function withLine(find, replace) {
	assert.ok(fixture.includes(find), `fixture contains ${find}`);
	return fixture.replace(find, replace);
}
const lineOf = (source, text) => source.split('\n').findIndex((l) => l.includes(text)) + 1;

test('an unknown helper fails and names the line', () => {
	const source = withLine('note("Never changes the schedule.")', 'callout("Never changes the schedule.")');
	assert.throws(() => G.generate(source), (error) => {
		assert.ok(error instanceof G.GenerateError);
		assert.equal(error.line, lineOf(source, 'callout('));
		assert.match(error.message, /unknown helper or view "callout"/);
		return true;
	});
});

test('string interpolation in Help content fails', () => {
	const source = withLine('"Save.",', '"Save \\(count).",');
	assert.throws(() => G.generate(source), /line \d+: string interpolation/);
});

test('a missing reviews array fails loudly', () => {
	const source = fixture.replace(/private let reviews[\s\S]*?\n {4}\]\n/, '');
	assert.throws(() => G.generate(source), /`reviews` array \(collection \+ days\) not found/);
});

test('ForEach over anything but reviews fails', () => {
	const source = withLine('ForEach(reviews, id: \\.collection)', 'ForEach(items, id: \\.self)');
	assert.throws(() => G.generate(source), /ForEach is only supported over `reviews`/);
});

test('#if around Help content fails', () => {
	const source = withLine('                    Divider()', '                    #if os(macOS)\n                    Divider()\n                    #endif');
	assert.throws(() => G.generate(source), /conditional compilation/);
});

test('helpers outside a section fail', () => {
	const source = withLine('paragraph("[Mezmorize]', 'subhead("Stray")\n                paragraph("[Mezmorize]');
	assert.throws(() => G.generate(source), /subhead outside a section/);
});

test('page names', () => {
	assert.equal(G.pageName('Getting quotes in'), 'Getting-Quotes-In');
	assert.equal(G.pageName('iCloud Sync'), 'iCloud-Sync');
	assert.equal(G.pageName('Why it is said to work'), 'Why-It-Is-Said-To-Work');
	assert.equal(G.collectionTitle('nextQuarter'), 'Next Quarter');
});

test('main writes the pages, replaces old ones, and writes nothing on failure', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-generate-'));
	try {
		const out = path.join(dir, 'wiki');
		const statics = path.join(dir, 'static');
		fs.mkdirSync(out);
		fs.mkdirSync(statics);
		fs.writeFileSync(path.join(out, 'Old-Page.md'), 'stale\n');
		fs.writeFileSync(path.join(statics, 'Contact.md'), 'Email us.\n');
		const log = console.log;
		console.log = () => {};
		try {
			G.main(['--source', fixturePath, '--out', out, '--static', statics]);
		} finally {
			console.log = log;
		}
		assert.deepEqual(fs.readdirSync(out).sort(), Object.keys(expected).sort());
		assert.equal(fs.readFileSync(path.join(out, 'Home.md'), 'utf8'), expected['Home.md']);

		const broken = path.join(dir, 'Broken.swift');
		fs.writeFileSync(broken, withLine('note("Never changes the schedule.")', 'callout("x")'));
		assert.throws(() => G.main(['--source', broken, '--out', out, '--static', statics]), /Broken\.swift: line \d+: unknown helper/);
		assert.deepEqual(fs.readdirSync(out).sort(), Object.keys(expected).sort());
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
