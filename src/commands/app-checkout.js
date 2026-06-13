import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';
import ora from 'ora';
import inquirer from 'inquirer';
import admZip from 'adm-zip';
import { getToken, isTokenValid, getBaseUrl, getSelectedPartner } from '../utils/auth.js';
import { ensurePartnerSelected } from '../utils/partners.js';

export default function(program) {
    program
        .command('app:checkout')
        .description('Pull an app zip from SitePack and extract it')
        .action(async () => {
            // 1. Check if user is logged in
            const isValid = await isTokenValid();
            if (!isValid) {
                console.log(chalk.red('You must be logged in to checkout an app. Run "sitepack login" first.'));
                return;
            }

            // 2. Ensure partner is selected
            let partnerUuid;
            try {
                partnerUuid = await ensurePartnerSelected();
            } catch (err) {
                console.log(chalk.red('Error: ' + err.message));
                return;
            }

            const token = await getToken();
            const baseUrl = await getBaseUrl();

            // 3. List apps for the selected partner
            const spinner = ora('Fetching apps...').start();
            let apps = [];
            try {
                const response = await axios.get(`${baseUrl}/api/console/apps/list`, {
                    headers: {
                        'X-SitePack-Access-Token': token.access_token,
                        'X-SitePack-Partner': partnerUuid
                    }
                });
                apps = response.data.apps || [];
                spinner.succeed(chalk.green(`Found ${apps.length} apps.`));
            } catch (err) {
                spinner.fail(chalk.red('Failed to fetch apps: ' + (err.response?.data?.message || err.message)));
                return;
            }

            if (apps.length === 0) {
                console.log(chalk.yellow('No apps found for this organization.'));
                return;
            }

            // 4. Select an app
            const { selectedAppUuid } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'selectedAppUuid',
                    message: 'Select an app to checkout:',
                    choices: apps.map(app => ({
                        name: `${app.name} (${app.uuid})`,
                        value: app.uuid
                    }))
                }
            ]);

            const selectedApp = apps.find(a => a.uuid === selectedAppUuid);

            // 5. Download the zip
            const downloadSpinner = ora(`Downloading app "${selectedApp.name}"...`).start();
            const zipPath = path.resolve(process.cwd(), `${selectedAppUuid}.zip`);
            
            try {
                const downloadUrl = `${baseUrl}/api/console/apps/${selectedAppUuid}/download`;
                const response = await axios({
                    method: 'get',
                    url: downloadUrl,
                    responseType: 'arraybuffer',
                    headers: {
                        'X-SitePack-Access-Token': token.access_token,
                        'X-SitePack-Partner': partnerUuid
                    }
                });

                await fs.writeFile(zipPath, response.data);
                downloadSpinner.succeed(chalk.green('Download completed.'));
            } catch (err) {
                downloadSpinner.fail(chalk.red('Download failed: ' + (err.response?.data?.message || err.message)));
                return;
            }

            // 6. Unzip to directory [app_uuid]
            const unzipSpinner = ora(`Extracting to directory ${selectedAppUuid}...`).start();
            try {
                const extractPath = path.resolve(process.cwd(), selectedAppUuid);
                await fs.ensureDir(extractPath);

                const zip = new admZip(zipPath);
                zip.extractAllTo(extractPath, true);

                unzipSpinner.succeed(chalk.green(`✅ App extracted to ${selectedAppUuid}`));
                
                // Cleanup zip file
                await fs.remove(zipPath);
            } catch (err) {
                unzipSpinner.fail(chalk.red('Extraction failed: ' + err.message));
            }
        });
}
