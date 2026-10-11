import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import ora from 'ora';
import inquirer from 'inquirer';
import { isTokenValid, getBaseUrl, callApi, whoami } from '../utils/auth.js';
import { ensurePartnerSelected } from '../utils/partners.js';
import { describeApiError } from '../utils/response.js';

const CREATE_NEW = '__create_new__';

/**
 * Links a theme directory that already has its source (a theme.json and its
 * templates/assets) to a theme in the partner dashboard. theme:init only starts new
 * themes from the skeleton; this is for a theme you copied, cloned or built first.
 *
 * When the uuid in theme.json is not a theme of the selected organisation (or there
 * is none), the developer either registers a new theme (SitePack issues a uuid) or
 * picks one of the organisation's existing themes. The uuid is then written back into
 * theme.json, so theme:watch and theme:publish target that theme.
 */
export default function(program) {
    program
        .command('theme:link')
        .argument('[directory]', 'The theme directory to link', '.')
        .description('Link an existing theme directory to a theme in SitePack (registers a new uuid when needed)')
        .option('--new', 'Always register a new theme in SitePack, even when the directory is already linked')
        .action(async (directory, options) => {
            const isValid = await isTokenValid();
            if (!isValid) {
                console.log(chalk.red('You must be logged in to link a theme. Run "sitepack login" first.'));
                return;
            }

            const themeDir = path.resolve(process.cwd(), directory);
            const themeJsonPath = path.join(themeDir, 'theme.json');
            if (!(await fs.pathExists(themeJsonPath))) {
                console.log(chalk.red(`Error: no theme.json found in ${themeDir}. Point theme:link at a theme directory, or start a new theme with "sitepack theme:init".`));
                return;
            }

            let themeConfig;
            try {
                themeConfig = await fs.readJson(themeJsonPath);
            } catch (err) {
                console.log(chalk.red('Error reading theme.json: ' + err.message));
                return;
            }

            const themeName = (themeConfig.name || '').trim() || path.basename(themeDir);

            let partnerUuid;
            try {
                partnerUuid = await ensurePartnerSelected();
            } catch (err) {
                console.log(chalk.red('Error: ' + err.message));
                return;
            }

            const baseUrl = await getBaseUrl();

            const listSpinner = ora('Fetching themes...').start();
            let themes;
            try {
                const response = await callApi({
                    method: 'get',
                    url: `${baseUrl}/api/console/themes/list`,
                    headers: { 'X-SitePack-Partner': partnerUuid }
                });
                themes = response.data.themes || [];
                listSpinner.stop();
            } catch (err) {
                listSpinner.fail(chalk.red('Failed to fetch themes: ' + describeApiError(err)));
                return;
            }

            const linkedTheme = themeConfig.uuid ? themes.find(theme => theme.uuid === themeConfig.uuid) : null;

            if (linkedTheme && !options.new) {
                console.log(chalk.green(`✅ "${themeName}" is already linked to "${linkedTheme.name}" (${linkedTheme.uuid}).`));
                console.log(chalk.gray('Use --new to register it as a new theme with a new uuid.'));
                return;
            }

            if (themeConfig.uuid && !linkedTheme) {
                console.log(chalk.yellow(`The uuid in theme.json (${themeConfig.uuid}) is not a theme of the selected organization.`));
            }

            let target = CREATE_NEW;
            if (!options.new && themes.length > 0) {
                ({ target } = await inquirer.prompt([
                    {
                        type: 'list',
                        name: 'target',
                        message: `Link "${themeName}" to:`,
                        choices: [
                            { name: `A new theme "${themeName}" (new uuid)`, value: CREATE_NEW },
                            new inquirer.Separator(),
                            ...themes.map(theme => ({ name: `${theme.name} (${theme.uuid})`, value: theme.uuid }))
                        ]
                    }
                ]));
            }

            let uuid = target;
            if (target === CREATE_NEW) {
                const spinner = ora(`Registering theme "${themeName}" in SitePack...`).start();
                try {
                    const response = await callApi({
                        method: 'post',
                        url: `${baseUrl}/api/console/themes/init`,
                        data: {
                            dirname: path.basename(themeDir),
                            name: themeName,
                            partner: partnerUuid
                        },
                        headers: { 'X-SitePack-Partner': partnerUuid }
                    });

                    uuid = response.data.theme?.uuid;
                    if (!uuid) {
                        throw new Error('No UUID received from the SitePack API.');
                    }
                    spinner.succeed(chalk.green(`Theme "${themeName}" registered.`));
                } catch (err) {
                    spinner.fail(chalk.red('Failed to register theme: ' + describeApiError(err)));
                    return;
                }
            }

            // Keep an existing uuid key in place; a missing one goes on top, like theme:init writes it.
            const linkedConfig = 'uuid' in themeConfig ? { ...themeConfig, uuid } : { uuid, ...themeConfig };

            // An empty author is filled in the way theme:init does it.
            if (!linkedConfig.author) {
                const user = await whoami().catch(() => null);
                const author = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : '';
                if (author) linkedConfig.author = author;
            }

            await fs.writeJson(themeJsonPath, linkedConfig, { spaces: 2 });

            console.log(chalk.green(`✅ Linked ${path.relative(process.cwd(), themeDir) || '.'} to theme ${uuid}.`));
            console.log(chalk.yellow('\nNext steps:'));
            console.log(chalk.white('  sitepack theme:verify'));
            console.log(chalk.white('  sitepack theme:watch\n'));
        });
}
