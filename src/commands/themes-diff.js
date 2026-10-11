import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import ora from 'ora';
import { isTokenValid, getThemeCdnUrl, getSelectedPartner, callApi } from '../utils/auth.js';
import { ensurePartnerSelected } from '../utils/partners.js';
import { describeApiError } from '../utils/response.js';
import { hashThemeFiles, combinedHash, compareFiles } from '../utils/theme-files.js';

/** How many themes are compared at the same time. */
const CONCURRENCY = 4;

export default function(program) {
    program
        .command('themes:diff [dir]')
        .description('Show which themes in a folder have changes that are not published to SitePack')
        .option('--files', 'List the changed files per theme')
        .option('--json', 'Print the result as JSON')
        .option('--exit-code', 'Exit with code 1 when a theme differs from what is published')
        .action(async (dir, options) => {
            const root = path.resolve(process.cwd(), dir ?? '.');

            if (!(await isTokenValid())) {
                console.log(chalk.red('You must be logged in to compare themes. Run "sitepack login" first.'));
                process.exitCode = 1;
                return;
            }

            const themeDirs = await findThemes(root);
            if (themeDirs.length === 0) {
                console.log(chalk.red(`Error: no theme directories (with a theme.json) found in ${root}.`));
                process.exitCode = 1;
                return;
            }

            await ensurePartnerSelected();
            const partnerUuid = await getSelectedPartner();
            const themeCdnUrl = await getThemeCdnUrl();

            const spinner = options.json ? null : ora(`Comparing ${themeDirs.length} theme(s) with SitePack...`).start();
            const results = await mapWithConcurrency(themeDirs, CONCURRENCY, (themeDir) => compareTheme(themeDir, root, themeCdnUrl, partnerUuid));
            spinner?.stop();

            if (options.json) {
                console.log(JSON.stringify({ path: root, themes: results }, null, 2));
            } else {
                printResults(root, results, !!options.files);
            }

            const drifted = results.some((r) => r.status === 'changed' || r.status === 'unpublished');
            if (results.some((r) => r.status === 'error') || (options.exitCode && drifted)) {
                process.exitCode = 1;
            }
        });
}

/**
 * The folder itself when it is a theme, otherwise its sub-folders that are.
 *
 * @param {string} root
 * @returns {Promise<string[]>}
 */
async function findThemes(root) {
    if (await fs.pathExists(path.join(root, 'theme.json'))) {
        return [root];
    }

    const entries = await fs.readdir(root, { withFileTypes: true });
    const dirs = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
        .map((e) => path.join(root, e.name));

    const themes = [];
    for (const dir of dirs) {
        if (await fs.pathExists(path.join(dir, 'theme.json'))) themes.push(dir);
    }

    return themes.sort();
}

/**
 * Compares one theme directory with the manifest devcdn keeps for its uuid.
 *
 * @returns {Promise<object>} status: in-sync | changed | unpublished | unregistered | no-access | unsupported | error
 */
async function compareTheme(themeDir, root, themeCdnUrl, partnerUuid) {
    const result = { directory: path.relative(root, themeDir) || path.basename(themeDir), path: themeDir };

    let theme;
    try {
        theme = await fs.readJson(path.join(themeDir, 'theme.json'));
    } catch (err) {
        return { ...result, status: 'error', message: `theme.json is not valid JSON: ${err.message}` };
    }

    result.name = theme.name ?? null;
    result.uuid = theme.uuid || null;
    if (!result.uuid) {
        return { ...result, status: 'unregistered' };
    }

    const local = await hashThemeFiles(themeDir);
    result.localHash = combinedHash(local);

    let manifest;
    try {
        const response = await callApi({
            method: 'post',
            url: `${themeCdnUrl}/${result.uuid}/manifest`.replace(/([^:]\/)\/+/g, '$1'),
            headers: {
                'X-Theme-Uuid': result.uuid,
                'X-Partner-Uuid': partnerUuid,
                'X-SitePack-Partner': partnerUuid,
            },
        });
        manifest = response.data;
    } catch (err) {
        const status = err?.response?.status;
        if (status === 404 || status === 403) {
            return { ...result, status: 'no-access', message: 'not a theme of the selected organisation' };
        }
        // A devcdn without the manifest command reads "manifest" as a file name.
        if (status === 422 && /manifest/.test(describeApiError(err))) {
            return { ...result, status: 'unsupported', message: 'SitePack does not support themes:diff yet' };
        }

        return { ...result, status: 'error', message: describeApiError(err) };
    }

    const published = manifest?.published ?? null;
    const staged = manifest?.staged?.files ?? null;
    result.stagingInSync = staged ? combinedHash(staged) === result.localHash : null;

    if (!published) {
        return { ...result, status: 'unpublished' };
    }

    const diff = compareFiles(local, published.files ?? {});
    return {
        ...result,
        version: published.version,
        publishedAt: published.published_at ?? manifest?.theme?.last_release ?? null,
        remoteHash: combinedHash(published.files ?? {}),
        // A version released before devcdn kept upload hashes: its SVGs went through
        // the sanitizer, so they can differ without anyone changing them.
        approximate: published.source === 'files',
        status: diff.changed.length + diff.added.length + diff.removed.length === 0 ? 'in-sync' : 'changed',
        ...diff,
    };
}

function printResults(root, results, showFiles) {
    console.log(`\n${chalk.bold('Comparing themes with SitePack')} ${chalk.gray(root)}\n`);

    const width = Math.max(...results.map((r) => r.directory.length));
    for (const r of results) {
        const name = r.directory.padEnd(width);
        console.log(`  ${name}  ${describe(r)}`);

        if (showFiles && r.status === 'changed') {
            for (const file of r.changed) console.log(chalk.yellow(`  ${''.padEnd(width)}    ~ ${file}`));
            for (const file of r.added) console.log(chalk.green(`  ${''.padEnd(width)}    + ${file}`));
            for (const file of r.removed) console.log(chalk.red(`  ${''.padEnd(width)}    - ${file}`));
        }
    }

    const count = (status) => results.filter((r) => r.status === status).length;
    const drifted = count('changed') + count('unpublished');
    console.log('');
    if (drifted === 0) {
        console.log(chalk.green.bold(`✔ Every registered theme matches what is published.`));
    } else {
        console.log(chalk.yellow.bold(`${drifted} of ${results.length} theme(s) differ from what is published.`)
            + chalk.gray(' Run "sitepack theme:publish" in those directories.'));
    }
    if (!showFiles && count('changed') > 0) {
        console.log(chalk.gray('Add --files to see which files changed.'));
    }
    if (results.some((r) => r.approximate && r.status === 'changed')) {
        console.log(chalk.gray('* Published before SitePack kept upload hashes: an SVG can show as changed until the next publish.'));
    }
}

function describe(r) {
    const short = (hash) => hash?.slice(0, 7);
    const staging = r.stagingInSync === true ? chalk.gray('  staging ✔') : '';

    switch (r.status) {
        case 'in-sync':
            return chalk.green('✔ in sync') + chalk.gray(`  v${r.version}  ${short(r.localHash)}`);
        case 'changed': {
            const parts = [];
            if (r.changed.length) parts.push(`${r.changed.length} changed`);
            if (r.added.length) parts.push(`${r.added.length} new`);
            if (r.removed.length) parts.push(`${r.removed.length} removed`);
            return chalk.yellow(`● ${parts.join(', ')}${r.approximate ? '*' : ''}`)
                + chalk.gray(`  since v${r.version}  local ${short(r.localHash)} ≠ published ${short(r.remoteHash)}`)
                + staging;
        }
        case 'unpublished':
            return chalk.yellow('○ never published') + staging;
        case 'unregistered':
            return chalk.gray('– no uuid in theme.json (run "sitepack theme:link")');
        case 'no-access':
            return chalk.gray(`– ${r.message}`);
        case 'unsupported':
            return chalk.gray(`– ${r.message}`);
        default:
            return chalk.red(`✖ ${r.message}`);
    }
}

async function mapWithConcurrency(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await fn(items[index]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));

    return results;
}
