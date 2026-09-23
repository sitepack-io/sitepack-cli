import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import ora from 'ora';
import inquirer from 'inquirer';
import { isTokenValid, getBaseUrl, callApi } from '../utils/auth.js';
import { ensurePartnerSelected } from '../utils/partners.js';
import { describeApiError } from '../utils/response.js';

const CREATE_NEW = '__create_new__';

/**
 * Links an app directory that already has its source (an app.json and its
 * templates/assets) to an app in the partner dashboard, without cloning the
 * skeleton like app:init does.
 *
 * When the uuid in app.json is not an app of the selected organisation, the
 * developer either registers a new app (a fresh uuid is issued by SitePack) or
 * picks one of the organisation's existing apps. The uuid is then written back
 * into app.json, so app:publish targets that app.
 */
export default function(program) {
    program
        .command('app:link')
        .argument('[directory]', 'The app directory to link', '.')
        .description('Link an existing app directory to an app in SitePack (registers a new uuid when needed)')
        .option('--new', 'Always register a new app in SitePack, even when the directory is already linked')
        .action(async (directory, options) => {
            const isValid = await isTokenValid();
            if (!isValid) {
                console.log(chalk.red('You must be logged in to link an app. Run "sitepack login" first.'));
                return;
            }

            const appDir = path.resolve(process.cwd(), directory);
            const appJsonPath = path.join(appDir, 'app.json');
            if (!(await fs.pathExists(appJsonPath))) {
                console.log(chalk.red(`Error: no app.json found in ${appDir}. Point app:link at an app directory, or start a new app with "sitepack app:init".`));
                return;
            }

            let appConfig;
            try {
                appConfig = await fs.readJson(appJsonPath);
            } catch (err) {
                console.log(chalk.red('Error reading app.json: ' + err.message));
                return;
            }

            const appName = (appConfig.name || '').trim() || path.basename(appDir);

            let partnerUuid;
            try {
                partnerUuid = await ensurePartnerSelected();
            } catch (err) {
                console.log(chalk.red('Error: ' + err.message));
                return;
            }

            const baseUrl = await getBaseUrl();

            const listSpinner = ora('Fetching apps...').start();
            let apps;
            try {
                const response = await callApi({
                    method: 'get',
                    url: `${baseUrl}/api/console/apps/list`,
                    headers: { 'X-SitePack-Partner': partnerUuid }
                });
                apps = response.data.apps || [];
                listSpinner.stop();
            } catch (err) {
                listSpinner.fail(chalk.red('Failed to fetch apps: ' + describeApiError(err)));
                return;
            }

            const linkedApp = appConfig.uuid ? apps.find(app => app.uuid === appConfig.uuid) : null;

            if (linkedApp && !options.new) {
                console.log(chalk.green(`✅ "${appName}" is already linked to "${linkedApp.name}" (${linkedApp.uuid}).`));
                console.log(chalk.gray('Use --new to register it as a new app with a new uuid.'));
                return;
            }

            if (appConfig.uuid && !linkedApp) {
                console.log(chalk.yellow(`The uuid in app.json (${appConfig.uuid}) is not an app of the selected organization.`));
            }

            let target = CREATE_NEW;
            if (!options.new && apps.length > 0) {
                ({ target } = await inquirer.prompt([
                    {
                        type: 'list',
                        name: 'target',
                        message: `Link "${appName}" to:`,
                        choices: [
                            { name: `A new app "${appName}" (new uuid)`, value: CREATE_NEW },
                            new inquirer.Separator(),
                            ...apps.map(app => ({ name: `${app.name} (${app.uuid})`, value: app.uuid }))
                        ]
                    }
                ]));
            }

            let uuid = target;
            if (target === CREATE_NEW) {
                const spinner = ora(`Registering app "${appName}" in SitePack...`).start();
                try {
                    const response = await callApi({
                        method: 'post',
                        url: `${baseUrl}/api/console/apps/init`,
                        data: {
                            dirname: path.basename(appDir),
                            name: appName,
                            partner: partnerUuid
                        },
                        headers: { 'X-SitePack-Partner': partnerUuid }
                    });

                    uuid = response.data.app?.uuid;
                    if (!uuid) {
                        throw new Error('No UUID received from the SitePack API.');
                    }
                    spinner.succeed(chalk.green(`App "${appName}" registered.`));
                } catch (err) {
                    spinner.fail(chalk.red('Failed to register app: ' + describeApiError(err)));
                    return;
                }
            }

            // Keep an existing uuid key in place; a missing one goes on top, like app:init writes it.
            const linkedConfig = 'uuid' in appConfig ? { ...appConfig, uuid } : { uuid, ...appConfig };
            await fs.writeJson(appJsonPath, linkedConfig, { spaces: 2 });

            console.log(chalk.green(`✅ Linked ${path.relative(process.cwd(), appDir) || '.'} to app ${uuid}.`));
            console.log(chalk.yellow('\nNext step:'));
            console.log(chalk.white('  sitepack app:publish\n'));
        });
}
