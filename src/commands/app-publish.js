import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';
import ora from 'ora';
import { glob } from 'glob';
import FormData from 'form-data';
import ignore from 'ignore';
import inquirer from 'inquirer';
import { getToken, isTokenValid, getAppCdnUrl, getSelectedPartner, callApi } from '../utils/auth.js';
import { validateJsonFile } from '../utils/json.js';
import { ensurePartnerSelected } from '../utils/partners.js';
import { describeApiError, readPublishedVersion } from '../utils/response.js';

export default function(program) {
    program
        .command('app:publish')
        .description('Publish the app to SitePack (full sync and release)')
        .option('--debug', 'Output full server response')
        .action(async (options) => {
            const isDebug = !!options.debug;

            // 1. Check if user is logged in
            const isValid = await isTokenValid();
            if (!isValid) {
                console.log(chalk.red('You must be logged in to publish an app. Run "sitepack login" first.'));
                return;
            }

            // 2. Check if app.json exists (Validation step)
            const appJsonPath = path.resolve(process.cwd(), 'app.json');
            if (!(await fs.pathExists(appJsonPath))) {
                console.log(chalk.red('Error: app.json not found. This command must be run inside an app directory.'));
                return;
            }

            let appConfig;
            try {
                appConfig = await fs.readJson(appJsonPath);
            } catch (err) {
                console.log(chalk.red('Error reading app.json: ' + err.message));
                return;
            }

            const { uuid } = appConfig;
            if (!uuid) {
                console.log(chalk.red('Error: app.json is missing a "uuid".'));
                return;
            }

            // 3. Ask user to publish now
            const answers = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'confirmPublish',
                    message: `Are you sure you want to publish app "${appConfig.name || uuid}"?`,
                    default: false
                }
            ]);

            if (!answers.confirmPublish) {
                console.log(chalk.yellow('Publish cancelled.'));
                return;
            }

            const token = await getToken();
            const appCdnUrl = await getAppCdnUrl();

            // 4. Ensure partner is selected
            await ensurePartnerSelected();
            const partnerUuid = await getSelectedPartner();

            if (!partnerUuid) {
                console.log(chalk.red('Error: No partner organization selected. Use "sitepack partner:select" to select one.'));
                return;
            }

            // 5. Execute a full file sync
            const spinner = ora('Performing full file sync...').start();
            
            const ig = ignore();
            ig.add('.git');
            ig.add('node_modules');
            ig.add('.sitepackignore');
            
            const ignorePath = path.resolve(process.cwd(), '.sitepackignore');
            if (await fs.pathExists(ignorePath)) {
                const ignoreContent = await fs.readFile(ignorePath, 'utf8');
                ig.add(ignoreContent);
            }

            const allowedTypes = {
                'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
                'gif': 'image/gif', 'svg': 'image/svg+xml', 'webp': 'image/webp',
                'css': 'text/css', 'js': 'application/javascript', 'json': 'application/json',
                'ttf': 'font/ttf', 'otf': 'font/otf', 'md': 'text/plain', 'twig': 'text/plain',
                'html': 'text/html'
            };

            // The server only accepts these directories, and only app.json at the
            // app root; anything else is rejected and aborts the whole publish.
            const allowedFolders = ['templates', 'assets'];
            const allowedRootFiles = ['app.json'];

            const uploadFile = async (filePath) => {
                const relativePath = path.relative(process.cwd(), filePath);
                if (ig.ignores(relativePath)) return;

                const ext = path.extname(filePath).slice(1).toLowerCase();
                if (!allowedTypes[ext]) return;

                const url = `${appCdnUrl}/${uuid}/${relativePath}`.replace(/\\/g, '/');

                const form = new FormData();
                form.append('file', fs.createReadStream(filePath));

                await callApi({
                    method: 'post',
                    url: url,
                    data: form,
                    headers: {
                        ...form.getHeaders(),
                        'X-App-Uuid': uuid,
                        'X-Partner-Uuid': partnerUuid,
                        'X-SitePack-Partner': partnerUuid
                    }
                });
            };

            try {
                // Mark start of fresh session (full sync)
                const freshUrl = `${appCdnUrl}/${uuid}/`.replace(/([^:]\/)\/+/g, "$1");
                await callApi({
                    method: 'post',
                    url: freshUrl,
                    headers: {
                        'X-App-Uuid': uuid,
                        'X-Partner-Uuid': partnerUuid,
                        'X-SitePack-Partner': partnerUuid,
                        'X-Fresh': 'true'
                    }
                });

                const files = await glob('**/*', { 
                    nodir: true, 
                    dot: true,
                    ignore: ['node_modules/**', '.git/**'] 
                });

                const filteredFiles = files.filter(file => {
                    if (ig.ignores(file)) return false;
                    const parts = file.split(path.sep);
                    if (parts.length === 1) return allowedRootFiles.includes(parts[0]);
                    return allowedFolders.includes(parts[0]);
                });

                // Validate JSON files before starting
                for (const file of filteredFiles) {
                    if (path.extname(file).toLowerCase() === '.json') {
                        const filePath = path.resolve(process.cwd(), file);
                        const validation = await validateJsonFile(filePath);
                        if (!validation.isValid) {
                            spinner.fail(chalk.red(`Publish aborted. Syntax error in ${file}: ${validation.error}`));
                            return;
                        }
                    }
                }

                for (const file of filteredFiles) {
                    spinner.text = `Syncing ${file}...`;
                    const filePath = path.resolve(process.cwd(), file);
                    await uploadFile(filePath);
                }
                spinner.succeed(chalk.green('Full file sync completed.'));
            } catch (err) {
                spinner.fail(chalk.red('Sync failed: ' + describeApiError(err)));
                return;
            }

            // 6. Call publish endpoint
            const publishSpinner = ora('Publishing new version...').start();
            try {
                const publishUrl = `${appCdnUrl}/${uuid}/publish`.replace(/([^:]\/)\/+/g, "$1");
                const publishResponse = await callApi({
                    method: 'post',
                    url: publishUrl,
                    headers: {
                        'X-App-Uuid': uuid,
                        'X-Partner-Uuid': partnerUuid,
                        'X-SitePack-Partner': partnerUuid
                    }
                });

                if (isDebug) {
                    console.log(chalk.gray('[DEBUG] Publish response:'));
                    console.log(chalk.gray(JSON.stringify(publishResponse.data, null, 2)));
                }

                const version = readPublishedVersion(publishResponse.data);
                if (version) {
                    publishSpinner.succeed(chalk.green(`✅ App published successfully! New version: ${version}`));
                } else {
                    publishSpinner.succeed(chalk.green('✅ App published successfully!'));
                }
            } catch (err) {
                publishSpinner.fail(chalk.red('Publishing failed: ' + describeApiError(err)));
                if (isDebug && err.response) {
                    console.log(chalk.gray('[DEBUG] Publish error response:'));
                    console.log(chalk.gray(JSON.stringify(err.response.data, null, 2)));
                }
            }
        });
}
