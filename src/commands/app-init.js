import chalk from 'chalk';
import inquirer from 'inquirer';
import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';
import ora from 'ora';
import { runCommand } from '../utils/command.js';
import { getToken, getBaseUrl, isTokenValid, whoami } from '../utils/auth.js';
import { selectPartner } from '../utils/partners.js';

export default function(program) {
    program
        .command('app:init')
        .description('Start a new SitePack app project')
        .action(async () => {
            // 1. Check if user is logged in
            const isValid = await isTokenValid();
            if (!isValid) {
                console.log(chalk.red('You must be logged in to initialize an app. Run "sitepack login" first.'));
                return;
            }

            const partnerUuid = await selectPartner();

            const answers = await inquirer.prompt([
                { type: 'input', name: 'dirname', message: 'Directory name:', default: 'my-app' },
                { type: 'input', name: 'appName', message: 'App name:', default: 'My App' }
            ]);

            const { dirname, appName } = answers;
            const spinner = ora('Initializing app...').start();
            try {
                const token = await getToken();
                const baseUrl = await getBaseUrl();
                const user = await whoami();
                const targetDir = path.resolve(process.cwd(), dirname);

                if (await fs.pathExists(targetDir)) {
                    spinner.fail(chalk.red(`Error: Directory "${dirname}" already exists.`));
                    return;
                }

                // 2. Request a new app in the api
                spinner.text = 'Requesting new app from SitePack...';
                const response = await axios.post(`${baseUrl}/api/console/apps/init`, {
                    dirname: dirname,
                    name: appName,
                    partner: partnerUuid
                }, {
                    headers: {
                        'X-SitePack-Access-Token': token.access_token,
                        'X-SitePack-Partner': partnerUuid
                    }
                });

                const { uuid } = response.data.app || {};
                if (!uuid) {
                    throw new Error('No UUID received from the SitePack API.');
                }
                const name = response.data.app?.name || appName;
                const author = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : null;

                // 3. Clone the skeleton repository
                spinner.text = 'Cloning app skeleton...';
                await runCommand('git', ['clone', 'https://github.com/sitepack-io/sitepack-app-skeleton.git', targetDir]);

                // 4. Modify the app.json file and set the uuid and app name
                const appJsonPath = path.join(targetDir, 'app.json');
                if (await fs.pathExists(appJsonPath)) {
                    const appJson = await fs.readJson(appJsonPath);
                    appJson.uuid = uuid;
                    appJson.name = name;
                    if (author) {
                        appJson.author = author;
                    }
                    await fs.writeJson(appJsonPath, appJson, { spaces: 2 });
                } else {
                    // If app.json doesn't exist in the skeleton (unexpected, but handle it)
                    const appData = {
                        name: name,
                        uuid: uuid,
                        version: "1",
                        sitepack_version: "2026.6"
                    };
                    if (author) {
                        appData.author = author;
                    }
                    await fs.writeJson(appJsonPath, appData, { spaces: 2 });
                }

                // Cleanup git history if it was cloned with history
                try {
                    await fs.remove(path.join(targetDir, '.git'));
                    await runCommand('git', ['init'], { cwd: targetDir });
                } catch (e) {
                    // Ignore if git operations fail
                }

                spinner.succeed(chalk.green(`✅ App initialized successfully in ${dirname}!`));
                console.log(chalk.cyan(`\nYour new app UUID is: ${uuid}`));
                console.log(chalk.yellow(`\nNext steps:`));
                console.log(chalk.white(`  cd ${dirname}`));
                console.log(chalk.white(`  sitepack app:watch\n`));
            } catch (err) {
                spinner.fail(chalk.red('Failed to initialize app: ' + (err.response?.data?.message || err.message)));
            }
        });
}
