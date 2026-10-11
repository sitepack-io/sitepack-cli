import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { Command } from 'commander';
import { verifyTheme } from '../src/utils/theme-verify.js';
import { REQUIRED_APP_BLOCKS, REQUIRED_TEMPLATES } from '../src/utils/theme-requirements.js';
import themeVerifyCommand from '../src/commands/theme-verify.js';

/** Where each required hook goes in the fixture theme. */
const HOOK_FILES = {
    'home template': 'templates/index.twig',
    'snippets/blog-card.twig': 'snippets/blog-card.twig',
};

/**
 * Writes a minimal theme that meets every requirement, so a test only has to break
 * the one thing it is about.
 */
function writeValidTheme(dir) {
    const files = {};
    const add = (file, content) => { files[file] = (files[file] ?? '') + content; };

    add('layouts/base.twig', '{{ sitepack_head() }}\n{{ sitepack_cookies() }}\n{{ sitepack_scripts() }}\n');
    for (const name of REQUIRED_TEMPLATES) {
        add(`templates/${name}.twig`, "{% extends 'layouts/base.twig' %}\n");
    }
    add('templates/index.twig', "{% extends 'layouts/base.twig' %}\n");
    add('templates/account.twig', '{{ sitepack_account() }}\n');
    add('templates/cart.twig', '{{ sitepack_cart() }}\n');
    add('templates/product.twig', "{{ sitepack_product_options() }}\n<h1>{{ 'product.title'|trans }}</h1>\n");
    for (const [where, hooks] of Object.entries(REQUIRED_APP_BLOCKS)) {
        const file = HOOK_FILES[where] ?? where;
        for (const hook of hooks) add(file, `{% app_block '${hook}' %}\n`);
    }
    add('assets/css/theme.css', ':root { --gap: 1rem; }\n.btn { color: var(--brand-color); padding: var(--gap); }\n');

    const theme = {
        uuid: '019f6f6f-8e8a-72a3-91d4-625cf1274995',
        name: 'Fixture',
        author: 'SitePack',
        version: '1.0.0',
        settings: [{ key: 'brand-color', type: 'colour', label: 'Brand', default: '#123456' }],
        templates: [{ key: 'index', name: 'Home', fields: [{ key: 'hero-title', type: 'text', label: 'Title' }] }],
        platform_colors: { 'main-color': 'brand-color' },
    };
    files['theme.json'] = JSON.stringify(theme);

    const strings = { en: 'Product', nl: 'Product', de: 'Produkt', es: 'Producto' };
    for (const [lang, title] of Object.entries(strings)) {
        files[`translations/${lang}.json`] = JSON.stringify({ product: { title } });
    }

    for (const [file, content] of Object.entries(files)) write(dir, file, content);
}

function write(dir, file, content) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
}

function edit(dir, file, change) {
    write(dir, file, change(fs.readFileSync(path.join(dir, file), 'utf8')));
}

const messages = (findings, check) => findings.filter((f) => !check || f.check === check).map((f) => `${f.level}: ${f.message}`);

describe('verifyTheme', () => {
    let dir;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sitepack-verify-'));
        writeValidTheme(dir);
    });

    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('passes a theme that meets every requirement', () => {
        expect(verifyTheme(dir).findings).toEqual([]);
    });

    it('reports a missing hook with the file it belongs in', () => {
        edit(dir, 'templates/product.twig', (s) => s.replace("{% app_block 'product_price_after' %}\n", ''));

        const missing = verifyTheme(dir).findings.filter((f) => f.check === 'appBlocks');
        expect(missing).toEqual([expect.objectContaining({
            level: 'error',
            message: "'product_price_after' is missing",
            file: 'templates/product.twig',
        })]);
    });

    it('accepts a hook that moved into a snippet', () => {
        edit(dir, 'templates/product.twig', (s) => s.replace("{% app_block 'product_usps' %}\n", ''));
        write(dir, 'snippets/product/usps.twig', "{% app_block 'product_usps' %}\n");

        expect(verifyTheme(dir).findings).toEqual([]);
    });

    it('ignores a hook that only appears in a Twig comment', () => {
        edit(dir, 'templates/cart.twig', (s) => s.replace("{% app_block 'cart_after' %}", "{# {% app_block 'cart_after' %} #}"));

        expect(messages(verifyTheme(dir).findings, 'appBlocks')).toEqual(["error: 'cart_after' is missing"]);
    });

    it('requires a literal app_block name', () => {
        write(dir, 'snippets/dynamic.twig', '{% app_block name %}\n');

        expect(messages(verifyTheme(dir).findings, 'appBlocks')).toEqual(['error: app_block needs a literal name']);
    });

    it('expects the home hooks in the declared home template', () => {
        edit(dir, 'theme.json', (s) => s.replace('"key":"index"', '"key":"restaurant-home"'));
        fs.renameSync(path.join(dir, 'templates/index.twig'), path.join(dir, 'templates/restaurant-home.twig'));
        edit(dir, 'templates/restaurant-home.twig', (s) => s.replace("{% app_block 'index_after' %}\n", ''));

        const finding = verifyTheme(dir).findings.find((f) => f.check === 'appBlocks');
        expect(finding.file).toBe('templates/restaurant-home.twig');
    });

    it('reports missing templates and a missing home template', () => {
        fs.rmSync(path.join(dir, 'templates/sitemap.twig'));
        edit(dir, 'theme.json', (s) => s.replace('"templates":[{"key":"index"', '"templates":[{"key":"landing"'));
        fs.renameSync(path.join(dir, 'templates/index.twig'), path.join(dir, 'templates/landing.twig'));

        expect(messages(verifyTheme(dir).findings, 'templates')).toEqual([
            'error: templates/sitemap.twig is missing',
            'error: theme.json declares no home template',
        ]);
    });

    it('requires the platform functions that render app blocks', () => {
        write(dir, 'layouts/base.twig', '{{ sitepack_cookies() }}\n{{ sitepack_scripts() }}\n' + fs.readFileSync(path.join(dir, 'layouts/base.twig'), 'utf8').replace('{{ sitepack_head() }}\n', ''));

        expect(messages(verifyTheme(dir).findings, 'templates')).toEqual([
            expect.stringContaining('never calls sitepack_head()'),
        ]);
    });

    it('requires en, nl, de and es with the same keys', () => {
        fs.rmSync(path.join(dir, 'translations/es.json'));
        write(dir, 'translations/de.json', JSON.stringify({ product: {} }));

        expect(messages(verifyTheme(dir).findings, 'translations')).toEqual([
            'error: translations/es.json is missing',
            "error: misses 'product.title'",
        ]);
    });

    it('lets a regional file override only a few keys', () => {
        write(dir, 'translations/nl_be.json', JSON.stringify({ product: {} }));

        expect(verifyTheme(dir).findings).toEqual([]);
    });

    it('reports a translation key the templates use but en.json lacks', () => {
        write(dir, 'snippets/stock.twig', "{{ 'stock.in_stock' | trans }}\n");

        const finding = verifyTheme(dir).findings.find((f) => f.check === 'translations');
        expect(finding).toEqual(expect.objectContaining({
            level: 'error',
            message: "'stock.in_stock' is used but missing in translations/en.json",
            file: 'snippets/stock.twig',
            line: 1,
        }));
    });

    it('warns when a language is a copy of English', () => {
        const strings = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`key${i}`, `English text ${i}`]));
        for (const lang of ['en', 'nl', 'de', 'es']) {
            write(dir, `translations/${lang}.json`, JSON.stringify({ product: { title: lang }, home: strings }));
        }

        expect(messages(verifyTheme(dir).findings, 'translations')).toEqual([
            'warning: 12 of 12 strings are identical to translations/en.json; is it translated?',
            'warning: 12 of 12 strings are identical to translations/en.json; is it translated?',
            'warning: 12 of 12 strings are identical to translations/en.json; is it translated?',
        ]);
    });

    it('refuses what the Twig sandbox refuses', () => {
        write(dir, 'snippets/bad.twig', [
            '{% macro card() %}{% endmacro %}',
            '{{ content.body|raw }}',
            '{{ dump(product) }}',
        ].join('\n'));

        expect(messages(verifyTheme(dir).findings, 'sandbox')).toEqual([
            "error: tag 'macro' is not allowed",
            "error: tag 'endmacro' is not allowed",
            "error: filter 'raw' is not allowed",
            "error: function 'dump()' is not allowed",
        ]);
    });

    it('accepts allowed Twig, tests and method calls', () => {
        write(dir, 'snippets/good.twig', [
            "{% for p in sitepack_products(4, 'new')|filter(p => p.price > 0) %}",
            '{% if loop.index is divisible by(2) and (p.name is not empty) %}{{ p.getName() }}{% endif %}',
            "{{ 'a|raw(x)'|upper }}",
            '{% endfor %}',
        ].join('\n'));

        expect(messages(verifyTheme(dir).findings, 'sandbox')).toEqual([]);
    });

    it('checks theme.json the way core reads it', () => {
        edit(dir, 'theme.json', (s) => {
            const theme = JSON.parse(s);
            theme.settings.push({ key: 'gap', type: 'spacing', label: 'Gap', default: '1rem' });
            theme.settings.push({ key: 'radius', type: 'pixels', label: 'Radius' });
            theme.templates[0].fields.push({ key: 'hero-image', type: 'image' });
            theme.platform_colors['link-color'] = 'gap';
            return JSON.stringify(theme);
        });

        expect(messages(verifyTheme(dir).findings, 'themeJson')).toEqual([
            'error: setting gap has unknown type "spacing"; core drops it',
            'error: setting radius needs a key, a type and a default; core drops it otherwise',
            'error: template index field hero-image needs a key, a type and a label; core drops it otherwise',
            'error: platform_colors: "link-color" points at "gap", which is not a colour setting; core ignores it',
        ]);
    });

    it('rejects files devcdn would refuse', () => {
        write(dir, 'assets/logo.png', '');
        write(dir, 'templates/README.md', '');
        write(dir, 'translations/NL-be.json', '{}');
        write(dir, 'config/settings.json', '{}');

        expect(messages(verifyTheme(dir).findings, 'structure')).toEqual([
            "error: 'config/' is not part of a theme: devcdn refuses it and theme:publish aborts",
            'error: files in assets/ must sit in one of: css, js, img, fonts',
            "error: '.md' files are not allowed in templates/ (devcdn refuses the upload)",
            'error: filenames in translations/ must be lowercase',
        ]);
    });

    it('skips what .sitepackignore leaves out', () => {
        write(dir, '.sitepackignore', 'templates/drafts\n');
        write(dir, 'templates/drafts/notes.md', '');

        expect(verifyTheme(dir).findings).toEqual([]);
    });

    it('warns about hardcoded colours, fonts and undeclared variables', () => {
        write(dir, 'assets/css/extra.css', [
            '/* #ffffff in a comment is fine */',
            '.a { color: #fff; }',
            '.b { color: var(--ink, #000); }',
            '.c { font-family: Arial; }',
            '.d { margin: var(--undeclared); }',
        ].join('\n'));
        write(dir, 'snippets/img.twig', '<img src="x.png">\n<a href="#top" style="color: rgb(0,0,0)">Top</a>\n');

        expect(messages(verifyTheme(dir).findings, 'design')).toEqual([
            'warning: hardcoded colour: .a { color: #fff; }',
            'warning: var() with a hardcoded fallback colour: .b { color: var(--ink, #000); }',
            'warning: var(--ink) is not a colour, pixels or font setting in theme.json',
            'warning: own font-family: Arial',
            'warning: var(--undeclared) is not a colour, pixels or font setting in theme.json',
            'warning: <img> without alt text',
            'warning: hardcoded colour: <a href="#top" style="color: rgb(0,0,0)">Top</a>',
        ]);
    });
});

describe('sitepack theme:verify', () => {
    let dir;
    let output;

    const run = async (args = []) => {
        const program = new Command();
        program.exitOverride();
        themeVerifyCommand(program);
        await program.parseAsync(['node', 'sitepack', 'theme:verify', ...args]);
    };

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sitepack-verify-'));
        writeValidTheme(dir);
        output = [];
        vi.spyOn(console, 'log').mockImplementation((line) => output.push(String(line)));
        process.exitCode = undefined;
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
        process.exitCode = undefined;
    });

    it('passes a valid theme given as a path', async () => {
        await run([dir]);

        expect(process.exitCode).toBeUndefined();
        expect(output.join('\n')).toContain('Meets the SitePack requirements');
    });

    it('verifies the current directory by default', async () => {
        vi.spyOn(process, 'cwd').mockReturnValue(dir);
        fs.rmSync(path.join(dir, 'translations/de.json'));

        await run();

        expect(process.exitCode).toBe(1);
        expect(output.join('\n')).toContain('translations/de.json is missing');
    });

    it('fails on warnings only with --strict', async () => {
        write(dir, 'assets/css/extra.css', '.a { color: #fff; }\n');

        await run([dir]);
        expect(process.exitCode).toBeUndefined();

        await run([dir, '--strict']);
        expect(process.exitCode).toBe(1);
    });

    it('prints JSON for scripts and CI', async () => {
        fs.rmSync(path.join(dir, 'templates/tag.twig'));

        await run([dir, '--json']);

        const result = JSON.parse(output.join('\n'));
        expect(result).toEqual(expect.objectContaining({ passed: false, errors: 1, warnings: 0 }));
        expect(result.findings[0]).toEqual(expect.objectContaining({ check: 'templates', file: 'templates/tag.twig' }));
    });

    it('stops outside a theme directory', async () => {
        await run([os.tmpdir()]);

        expect(process.exitCode).toBe(1);
        expect(output.join('\n')).toContain('no theme.json');
    });
});
