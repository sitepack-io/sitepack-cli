import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { verifyTheme, CHECKS } from '../utils/theme-verify.js';

export default function(program) {
    program
        .command('theme:verify [dir]')
        .description('Check a theme against the SitePack requirements before you publish it')
        .option('--strict', 'Fail on warnings too')
        .option('--json', 'Print the findings as JSON')
        .action((dir, options) => {
            const themeDir = path.resolve(process.cwd(), dir ?? '.');
            if (!fs.existsSync(path.join(themeDir, 'theme.json'))) {
                console.log(chalk.red(`Error: no theme.json in ${themeDir}. Run this inside a theme directory or pass its path.`));
                process.exitCode = 1;
                return;
            }

            const { theme, findings } = verifyTheme(themeDir);
            const errors = findings.filter((f) => f.level === 'error');
            const warnings = findings.filter((f) => f.level === 'warning');
            const failed = errors.length > 0 || (options.strict && warnings.length > 0);

            if (options.json) {
                console.log(JSON.stringify({
                    theme: { name: theme?.name ?? null, version: theme?.version ?? null, path: themeDir },
                    passed: !failed,
                    errors: errors.length,
                    warnings: warnings.length,
                    findings,
                }, null, 2));
            } else {
                printReport(theme, themeDir, findings, errors.length, warnings.length, failed);
            }

            if (failed) process.exitCode = 1;
        });
}

function printReport(theme, themeDir, findings, errorCount, warningCount, failed) {
    const title = [theme?.name, theme?.version].filter(Boolean).join(' ');
    console.log(`\n${chalk.bold('Verifying theme')} ${chalk.cyan(title || path.basename(themeDir))} ${chalk.gray(themeDir)}\n`);

    for (const [check, label] of Object.entries(CHECKS)) {
        const items = findings.filter((f) => f.check === check);
        const hasErrors = items.some((f) => f.level === 'error');

        if (items.length === 0) {
            console.log(`${chalk.green('✔')} ${label}`);
            continue;
        }

        const icon = hasErrors ? chalk.red('✖') : chalk.yellow('⚠');
        console.log(`${icon} ${label} ${chalk.gray(`(${items.length})`)}`);
        for (const item of items) {
            const where = item.file ? chalk.gray(`${item.file}${item.line ? `:${item.line}` : ''}  `) : '';
            const text = item.level === 'error' ? chalk.red(item.message) : chalk.yellow(item.message);
            console.log(`    ${where}${text}`);
            if (item.hint) console.log(chalk.gray(`        → ${item.hint}`));
        }
    }

    const summary = `${errorCount} error(s), ${warningCount} warning(s)`;
    console.log('');
    if (failed) {
        console.log(chalk.red.bold(`✖ ${summary}. Fix these before you publish.`));
    } else if (warningCount > 0) {
        console.log(chalk.green.bold(`✔ Meets the SitePack requirements`) + chalk.yellow(` (${summary})`));
    } else {
        console.log(chalk.green.bold(`✔ Meets the SitePack requirements (${summary})`));
    }
}
