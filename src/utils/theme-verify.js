import fs from 'fs';
import path from 'path';
import ignore from 'ignore';
import {
    REQUIRED_TEMPLATES,
    isHomeTemplateKey,
    REQUIRED_APP_BLOCKS,
    REQUIRED_FUNCTIONS,
    REQUIRED_LANGUAGES,
    FALLBACK_LANGUAGE,
    ALLOWED_TAGS,
    ALLOWED_FILTERS,
    ALLOWED_FUNCTIONS,
    SANDBOX_HINTS,
    ROOT_FILES,
    DIRECTORIES,
    FIELD_TYPES,
    PLATFORM_COLOR_KEYS,
    PLATFORM_CSS_VARIABLES,
} from './theme-requirements.js';

/** The checks in the order they are reported. */
export const CHECKS = {
    structure: 'Directory structure',
    themeJson: 'theme.json',
    templates: 'Templates',
    appBlocks: 'App blocks',
    translations: 'Translations',
    sandbox: 'Twig sandbox',
    design: 'Design rules',
};

/** Twig words that are followed by "(" without being a function call. */
const TWIG_KEYWORDS = new Set([
    'if', 'elseif', 'else', 'for', 'in', 'and', 'or', 'not', 'is', 'set', 'with', 'matches',
    'b-and', 'b-or', 'b-xor', 'starts', 'ends', 'same', 'as', 'divisible', 'by', 'defined',
    'empty', 'null', 'iterable', 'even', 'odd', 'true', 'false', 'none', 'loop', 'only', 'ignore', 'missing',
]);

/**
 * Checks a theme directory against what SitePack requires: the directory layout devcdn
 * accepts, a theme.json core can read, the templates the storefront renders, the
 * app_block hooks apps target, the required translations and the Twig sandbox. Design
 * rules (no hardcoded colours or fonts) come back as warnings.
 *
 * @param {string} themeDir
 * @returns {{ theme: object|null, findings: Array<{check: string, level: 'error'|'warning', message: string, file?: string, line?: number, hint?: string}> }}
 */
export function verifyTheme(themeDir) {
    const root = path.resolve(themeDir);
    const findings = [];
    const report = (check, level, message, extra = {}) => findings.push({ check, level, message, ...extra });

    const files = listFiles(root);
    const twigFiles = files.filter((f) => /^(layouts|snippets|templates)\/.+\.twig$/.test(f));
    const twig = Object.fromEntries(twigFiles.map((f) => [f, stripTwigComments(read(root, f))]));

    checkStructure(root, files, report);
    const theme = checkThemeJson(root, report);
    checkTemplates(root, theme, twig, report);
    checkAppBlocks(theme, twig, report);
    checkTranslations(root, files, twig, report);
    checkSandbox(twig, report);
    checkDesign(root, files, theme, twig, report);

    return { theme, findings };
}

function checkStructure(root, files, report) {
    const check = 'structure';

    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        if (entry.isDirectory() && !DIRECTORIES[entry.name]) {
            if (entry.name === 'config') {
                report(check, 'error', `'config/' is not part of a theme: devcdn refuses it and theme:publish aborts`, { file: 'config/' });
            } else {
                report(check, 'warning', `'${entry.name}/' is not part of a theme and is never published`, { file: `${entry.name}/` });
            }
        }
    }

    if (!files.includes('theme.json')) {
        report(check, 'error', 'theme.json is missing; run this inside a theme directory');
    }

    for (const file of files) {
        const parts = file.split('/');
        if (parts.length === 1) continue; // root files other than theme.json are never uploaded

        const rule = DIRECTORIES[parts[0]];
        if (!rule) continue;

        const ext = path.extname(file).slice(1).toLowerCase();
        if (!rule.extensions.includes(ext)) {
            report(check, 'error', `'.${ext}' files are not allowed in ${parts[0]}/ (devcdn refuses the upload)`, { file });
        }
        if (rule.subdirectories && (parts.length < 3 || !rule.subdirectories.includes(parts[1]))) {
            report(check, 'error', `files in ${parts[0]}/ must sit in one of: ${rule.subdirectories.join(', ')}`, { file });
        }
        if (rule.lowercase && parts[parts.length - 1] !== parts[parts.length - 1].toLowerCase()) {
            report(check, 'error', `filenames in ${parts[0]}/ must be lowercase`, { file });
        }
    }
}

function checkThemeJson(root, report) {
    const check = 'themeJson';
    const file = 'theme.json';
    if (!fs.existsSync(path.join(root, file))) return null;

    let theme;
    try {
        theme = JSON.parse(read(root, file));
    } catch (err) {
        report(check, 'error', `invalid JSON: ${err.message}`, { file });
        return null;
    }

    if (!theme.name) report(check, 'error', `"name" is empty`, { file });
    if (!theme.author) report(check, 'warning', `"author" is empty`, { file });
    if (!theme.version) report(check, 'warning', `"version" is empty (core falls back to 1.0.0)`, { file });
    if (!theme.uuid) {
        report(check, 'warning', `"uuid" is empty`, { file, hint: 'run "sitepack theme:init" to register the theme before syncing' });
    }

    const settings = Array.isArray(theme.settings) ? theme.settings : [];
    if (!Array.isArray(theme.settings)) report(check, 'error', `"settings" must be a list`, { file });

    const seen = new Set();
    for (const setting of settings) {
        const name = setting?.key ?? '(no key)';
        if (!setting?.key || !setting?.type || !('default' in (setting ?? {}))) {
            report(check, 'error', `setting ${name} needs a key, a type and a default; core drops it otherwise`, { file });
            continue;
        }
        if (!FIELD_TYPES.includes(setting.type)) {
            report(check, 'error', `setting ${name} has unknown type "${setting.type}"; core drops it`, { file, hint: `use one of: ${FIELD_TYPES.join(', ')}` });
        }
        if (!setting.label) report(check, 'warning', `setting ${name} has no label`, { file });
        if (seen.has(setting.key)) report(check, 'error', `setting ${name} is declared twice`, { file });
        seen.add(setting.key);
    }

    const templates = Array.isArray(theme.templates) ? theme.templates : [];
    for (const template of templates) {
        const name = template?.key ?? '(no key)';
        if (!template?.key || !template?.name) {
            report(check, 'error', `template ${name} needs a key and a name; core drops it otherwise`, { file });
            continue;
        }
        if (!Array.isArray(template.fields)) {
            report(check, 'error', `template ${name} needs a "fields" list`, { file });
            continue;
        }
        for (const field of template.fields) {
            if (!field?.key || !field?.type || !field?.label) {
                report(check, 'error', `template ${name} field ${field?.key ?? '(no key)'} needs a key, a type and a label; core drops it otherwise`, { file });
            } else if (!FIELD_TYPES.includes(field.type)) {
                report(check, 'warning', `template ${name} field ${field.key} has unknown type "${field.type}"`, { file });
            }
            if (field?.type === 'options' && !Array.isArray(field.options)) {
                report(check, 'error', `template ${name} field ${field.key} is an options field without "options"`, { file });
            }
        }
    }

    const colourSettings = new Set(settings.filter((s) => s?.type === 'colour').map((s) => s.key));
    for (const [platformKey, settingKey] of Object.entries(theme.platform_colors ?? {})) {
        if (!PLATFORM_COLOR_KEYS.includes(platformKey)) {
            report(check, 'error', `platform_colors: "${platformKey}" is not a platform colour; core ignores it`, { file, hint: `use one of: ${PLATFORM_COLOR_KEYS.join(', ')}` });
        } else if (!colourSettings.has(settingKey)) {
            report(check, 'error', `platform_colors: "${platformKey}" points at "${settingKey}", which is not a colour setting; core ignores it`, { file });
        }
    }

    return theme;
}

function checkTemplates(root, theme, twig, report) {
    const check = 'templates';

    if (!twig['layouts/base.twig']) {
        report(check, 'error', 'layouts/base.twig is missing', { file: 'layouts/base.twig' });
    }

    for (const name of REQUIRED_TEMPLATES) {
        const file = `templates/${name}.twig`;
        if (twig[file] === undefined) {
            report(check, 'error', `${file} is missing`, { file });
        } else if (!/\{%-?\s*extends\s/.test(twig[file])) {
            report(check, 'warning', `${file} does not extend a layout`, { file });
        }
    }

    const templates = Array.isArray(theme?.templates) ? theme.templates : [];
    for (const template of templates) {
        if (template?.key && twig[`templates/${template.key}.twig`] === undefined) {
            report(check, 'error', `custom template "${template.key}" is declared in theme.json but templates/${template.key}.twig is missing`, { file: `templates/${template.key}.twig` });
        }
    }

    if (theme && !templates.some((t) => isHomeTemplateKey(t?.key))) {
        report(check, 'error', 'theme.json declares no home template', {
            file: 'theme.json',
            hint: 'add a custom template with key "index" and fields for every home section; onboarding fills it for new sites',
        });
    }

    for (const fn of REQUIRED_FUNCTIONS) {
        const scope = Object.entries(twig).filter(([file]) => file.startsWith(fn.where));
        if (scope.length === 0) continue; // the missing file is reported above
        const called = scope.some(([, source]) => new RegExp(`\\b${fn.name}\\s*\\(`).test(source));
        if (!called) {
            report(check, fn.level ?? 'error', `${fn.where} never calls ${fn.name}(), which ${fn.why}`, { file: fn.where });
        }
    }
}

function checkAppBlocks(theme, twig, report) {
    const check = 'appBlocks';
    const present = new Set();

    for (const [file, source] of Object.entries(twig)) {
        for (const block of twigBlocks(source)) {
            if (block.type !== 'tag' || !/^\s*app_block\b/.test(block.body)) continue;
            const literal = block.body.match(/^\s*app_block\s+(['"])([\w-]+)\1\s*$/);
            if (literal) {
                present.add(literal[2]);
            } else {
                report(check, 'error', 'app_block needs a literal name', { file, line: block.line, hint: "{% app_block 'product_price_after' %}" });
            }
        }
    }

    const homeKey = (theme?.templates ?? []).find((t) => isHomeTemplateKey(t?.key))?.key;
    for (const [where, hooks] of Object.entries(REQUIRED_APP_BLOCKS)) {
        const location = where === 'home template' ? `templates/${homeKey ?? 'index'}.twig` : where;
        // A missing template is reported once under Templates, not once per hook.
        if (location.startsWith('templates/') && twig[location] === undefined) continue;
        for (const hook of hooks) {
            if (!present.has(hook)) {
                report(check, 'error', `'${hook}' is missing`, { file: location, hint: `{% app_block '${hook}' %}` });
            }
        }
    }
}

function checkTranslations(root, files, twig, report) {
    const check = 'translations';
    const languages = {};

    for (const file of files.filter((f) => /^translations\/[^/]+\.json$/i.test(f))) {
        const lang = path.basename(file, '.json').toLowerCase();
        try {
            const data = JSON.parse(read(root, file));
            if (data === null || typeof data !== 'object' || Array.isArray(data)) {
                report(check, 'error', 'must hold a JSON object of keys', { file });
                continue;
            }
            languages[lang] = { file, strings: flatten(data) };
        } catch (err) {
            report(check, 'error', `invalid JSON: ${err.message}`, { file });
        }
    }

    for (const lang of REQUIRED_LANGUAGES) {
        if (!languages[lang] && !files.includes(`translations/${lang}.json`)) {
            report(check, 'error', `translations/${lang}.json is missing`, {
                file: `translations/${lang}.json`,
                hint: `every theme ships ${REQUIRED_LANGUAGES.join(', ')}`,
            });
        }
    }

    const fallback = languages[FALLBACK_LANGUAGE];
    if (!fallback) return;
    const fallbackKeys = Object.keys(fallback.strings);

    for (const [lang, { file, strings }] of Object.entries(languages)) {
        if (lang === FALLBACK_LANGUAGE) continue;

        // An empty English string is a deliberate blank (e.g. the second half of a title).
        for (const [key, value] of Object.entries(strings)) {
            if (typeof value === 'string' && value.trim() === '' && String(fallback.strings[key] ?? '').trim() !== '') {
                report(check, 'warning', `'${key}' is empty`, { file });
            }
        }

        for (const key of Object.keys(strings).filter((k) => !(k in fallback.strings))) {
            report(check, 'warning', `'${key}' is not in ${fallback.file}, so other languages have no fallback for it`, { file });
        }

        // A regional file (nl_be.json) only overrides what differs from nl.json.
        if (lang.includes('_')) continue;

        const missing = fallbackKeys.filter((key) => !(key in strings));
        for (const key of missing) report(check, 'error', `misses '${key}'`, { file });

        // Copy-pasted English is the usual sign of a language that was never translated.
        const comparable = fallbackKeys.filter((key) => typeof strings[key] === 'string' && /[a-z]{4}/i.test(fallback.strings[key]));
        const same = comparable.filter((key) => strings[key] === fallback.strings[key]);
        if (comparable.length >= 10 && same.length / comparable.length > 0.4) {
            report(check, 'warning', `${same.length} of ${comparable.length} strings are identical to ${fallback.file}; is it translated?`, { file });
        }
    }

    for (const [file, source] of Object.entries(twig)) {
        const lines = source.split('\n');
        lines.forEach((text, i) => {
            for (const match of text.matchAll(/(['"])([A-Za-z0-9_]+(?:\.[A-Za-z0-9_-]+)+)\1\s*\|\s*trans\b/g)) {
                if (!(match[2] in fallback.strings)) {
                    report(check, 'error', `'${match[2]}' is used but missing in ${fallback.file}`, { file, line: i + 1 });
                }
            }
        });
    }
}

function checkSandbox(twig, report) {
    const check = 'sandbox';

    for (const [file, source] of Object.entries(twig)) {
        for (const block of twigBlocks(source)) {
            const expression = stripStrings(block.body);

            if (block.type === 'tag') {
                const tag = expression.match(/^\s*([a-zA-Z_]\w*)/)?.[1];
                const base = tag?.startsWith('end') ? tag.slice(3) : tag;
                if (tag && !ALLOWED_TAGS.includes(base)) {
                    report(check, 'error', `tag '${tag}' is not allowed`, { file, line: block.line, hint: SANDBOX_HINTS[base] });
                    continue;
                }
            }

            for (const [, filter] of expression.matchAll(/\|\s*([a-zA-Z_]\w*)/g)) {
                if (!ALLOWED_FILTERS.includes(filter)) {
                    report(check, 'error', `filter '${filter}' is not allowed`, { file, line: block.line, hint: SANDBOX_HINTS[filter] });
                }
            }

            const calls = expression
                .replace(/\|\s*[a-zA-Z_]\w*/g, '|')
                .replace(/\bis\s+(not\s+)?(same\s+as|divisible\s+by|constant)\s*\(/g, 'is (');
            for (const [, fn] of calls.matchAll(/(?<![\w.$])([a-zA-Z_]\w*)\s*\(/g)) {
                if (!ALLOWED_FUNCTIONS.includes(fn) && !TWIG_KEYWORDS.has(fn)) {
                    report(check, 'error', `function '${fn}()' is not allowed`, { file, line: block.line, hint: SANDBOX_HINTS[fn] });
                }
            }
        }
    }
}

function checkDesign(root, files, theme, twig, report) {
    const check = 'design';
    const colour = /#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?)\(/;
    const css = files.filter((f) => /^assets\/.+\.css$/.test(f));

    const declared = new Set(PLATFORM_CSS_VARIABLES);
    for (const setting of theme?.settings ?? []) {
        if (!['colour', 'pixels', 'font'].includes(setting?.type)) continue;
        declared.add(setting.key);
        if (setting.type === 'colour' && setting.key.endsWith('-color')) declared.add(`${setting.key}-text`);
    }

    const sources = [
        ...css.map((file) => [file, read(root, file).replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))]),
        ...Object.entries(twig),
    ];
    for (const [, source] of sources) {
        for (const [, name] of source.matchAll(/(?:^|[;{\s"'])--([\w-]+)\s*:/g)) declared.add(name);
    }

    for (const [file, source] of sources) {
        const isCss = file.endsWith('.css');
        let inStyle = false;
        source.split('\n').forEach((text, i) => {
            const line = i + 1;
            // In Twig only style attributes and <style> blocks hold CSS.
            let code = text;
            if (!isCss) {
                const styleOpen = /<style[\s>]/i.test(text);
                const styleClose = /<\/style>/i.test(text);
                const attributes = [...text.matchAll(/style="([^"]*)"/g)].map((m) => m[1]).join(';');
                code = inStyle || styleOpen ? text : attributes;
                if (styleOpen) inStyle = true;
                if (styleClose) inStyle = false;
            }

            if (/var\(--[\w-]+\s*,\s*#/.test(code)) {
                report(check, 'warning', `var() with a hardcoded fallback colour: ${text.trim().slice(0, 80)}`, { file, line, hint: 'declare the setting in theme.json; its default is the fallback' });
            } else if (colour.test(code)) {
                report(check, 'warning', `hardcoded colour: ${text.trim().slice(0, 80)}`, { file, line, hint: 'add a colour setting to theme.json and use var(--key)' });
            }
            const font = code.match(/font-family\s*:\s*([^;}"]+)/);
            if (font && !/^\s*(var\(--(heading|body)-font\)|inherit)/.test(font[1])) {
                report(check, 'warning', `own font-family: ${font[1].trim().slice(0, 60)}`, { file, line, hint: 'the merchant picks the fonts; use var(--heading-font), var(--body-font) or inherit' });
            }
            for (const [, name] of code.matchAll(/var\(--([\w-]+)/g)) {
                if (!declared.has(name)) {
                    report(check, 'warning', `var(--${name}) is not a colour, pixels or font setting in theme.json`, { file, line });
                }
            }
            if (!isCss) {
                for (const [tag] of text.matchAll(/<img\b[^>]*>/g)) {
                    if (!/\balt\s*=/.test(tag)) report(check, 'warning', '<img> without alt text', { file, line });
                }
            }
        });
    }
}

/**
 * The theme's files as forward-slash paths relative to its root, minus what theme:publish
 * never uploads (.git, node_modules, .sitepackignore entries).
 */
function listFiles(root) {
    const ig = ignore().add(['.git', 'node_modules', '.sitepackignore', '.DS_Store']);
    const ignoreFile = path.join(root, '.sitepackignore');
    if (fs.existsSync(ignoreFile)) ig.add(fs.readFileSync(ignoreFile, 'utf8'));

    const out = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            const rel = path.relative(root, full).split(path.sep).join('/');
            if (entry.isDirectory() && entry.name.startsWith('.')) continue; // .git, .claude, .idea
            if (ig.ignores(entry.isDirectory() ? `${rel}/` : rel)) continue;
            if (entry.isDirectory()) walk(full);
            else out.push(rel);
        }
    };
    walk(root);

    return out.sort();
}

function read(root, file) {
    return fs.readFileSync(path.join(root, file), 'utf8');
}

/** Blanks Twig comments but keeps their newlines, so line numbers stay right. */
function stripTwigComments(source) {
    return source.replace(/\{#[\s\S]*?#\}/g, (comment) => comment.replace(/[^\n]/g, ' '));
}

/** Blanks string literals, so their content is not read as filters or calls. */
function stripStrings(expression) {
    return expression.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, "''");
}

/** Every {% tag %} and {{ output }} in a template, with the line it starts on. */
function twigBlocks(source) {
    const blocks = [];
    for (const match of source.matchAll(/\{%-?([\s\S]*?)-?%\}|\{\{-?([\s\S]*?)-?\}\}/g)) {
        blocks.push({
            type: match[1] !== undefined ? 'tag' : 'output',
            body: match[1] ?? match[2],
            line: source.slice(0, match.index).split('\n').length,
        });
    }

    return blocks;
}

function flatten(data, prefix = '') {
    const out = {};
    for (const [key, value] of Object.entries(data)) {
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            Object.assign(out, flatten(value, `${prefix}${key}.`));
        } else {
            out[`${prefix}${key}`] = value;
        }
    }

    return out;
}
