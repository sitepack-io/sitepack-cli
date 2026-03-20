import chalk from 'chalk';
import inquirer from 'inquirer';
import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';
import ora from 'ora';
import { runCommand } from '../utils/command.js';
import { getToken, getBaseUrl, isTokenValid, whoami } from '../utils/auth.js';

export default function(program) {
    program
        .command('theme:init')
        .description('Start a new SitePack theme project')
        .action(async () => {
            // 1. Check if user is logged in
            const isValid = await isTokenValid();
            if (!isValid) {
                console.log(chalk.red('You must be logged in to initialize a theme. Run "sitepack login" first.'));
                return;
            }

            const answers = await inquirer.prompt([
                { type: 'input', name: 'dirname', message: 'Directory name:', default: 'my-theme' },
                { type: 'input', name: 'themeName', message: 'Theme name:', default: 'My Theme' }
            ]);

            const { dirname, themeName } = answers;
            const spinner = ora('Initializing theme...').start();
            try {
                const token = await getToken();
                const baseUrl = await getBaseUrl();
                const user = await whoami();
                const targetDir = path.resolve(process.cwd(), dirname);

                if (await fs.pathExists(targetDir)) {
                    spinner.fail(chalk.red(`Error: Directory "${dirname}" already exists.`));
                    return;
                }

                // 2. Request a new theme in the api
                spinner.text = 'Requesting new theme from SitePack...';
                const response = await axios.post(`${baseUrl}/api/console/themes/init`, {
                    dirname: dirname,
                    name: themeName
                }, {
                    headers: {
                        'X-SitePack-Access-Token': token.access_token
                    }
                });

                const { uuid } = response.data.theme || {};
                if (!uuid) {
                    throw new Error('No UUID received from the SitePack API.');
                }
                const name = response.data.theme?.name || themeName;
                const author = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : null;

                // 3. Clone the skeleton repository
                spinner.text = 'Cloning theme skeleton...';
                await runCommand('git', ['clone', 'https://github.com/sitepack-io/sitepack-theme-skeleton.git', targetDir]);

                // 4. Modify the theme.json file and set the uuid and theme name
                const themeJsonPath = path.join(targetDir, 'theme.json');
                if (await fs.pathExists(themeJsonPath)) {
                    const themeJson = await fs.readJson(themeJsonPath);
                    themeJson.uuid = uuid;
                    themeJson.name = name;
                    if (author) {
                        themeJson.author = author;
                    }
                    await fs.writeJson(themeJsonPath, themeJson, { spaces: 2 });
                } else {
                    // If theme.json doesn't exist in the skeleton (unexpected, but handle it)
                    const themeData = {
                        name: name,
                        uuid: uuid,
                        version: "1.0.0",
                        sitepack_version: "2026.1"
                    };
                    if (author) {
                        themeData.author = author;
                    }
                    await fs.writeJson(themeJsonPath, themeData, { spaces: 2 });
                }

                // Cleanup git history if it was cloned with history
                try {
                    await fs.remove(path.join(targetDir, '.git'));
                    await runCommand('git', ['init'], { cwd: targetDir });
                } catch (e) {
                    // Ignore if git operations fail
                }

                spinner.succeed(chalk.green(`✅ Theme initialized successfully in ${dirname}!`));
                console.log(chalk.cyan(`\nYour new theme UUID is: ${uuid}`));
                console.log(chalk.yellow(`\nNext steps:`));
                console.log(chalk.white(`  cd ${dirname}`));
                console.log(chalk.white(`  sitepack theme:watch\n`));

            } catch (err) {
                spinner.fail(chalk.red('Failed to initialize theme: ' + (err.response?.data?.message || err.message)));
            }
        });
}
