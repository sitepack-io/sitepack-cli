import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';
import ora from 'ora';
import chokidar from 'chokidar';
import ignore from 'ignore';
import { glob } from 'glob';
import FormData from 'form-data';
import { getToken, isTokenValid, getBaseUrl, getThemeCdnUrl, getSelectedPartner, callApi } from '../utils/auth.js';
import { validateJsonFile } from '../utils/json.js';
import { ensurePartnerSelected } from '../utils/partners.js';
import { getSites, selectSite } from '../utils/sites.js';

export default function(program) {
    program
        .command('theme:watch')
        .description('Watch for changes in the theme directory and sync to SitePack')
        .option('--debug', 'Output full server response')
        .action(async (options) => {
            const isDebug = !!options.debug;
            // 1. Check if user is logged in
            const isValid = await isTokenValid();
            if (!isValid) {
                console.log(chalk.red('You must be logged in to watch a theme. Run "sitepack login" first.'));
                return;
            }

            // 2. Check if theme.json exists
            const themeJsonPath = path.resolve(process.cwd(), 'theme.json');
            if (!(await fs.pathExists(themeJsonPath))) {
                console.log(chalk.red('Error: theme.json not found. This command must be run inside a theme directory.'));
                return;
            }

            let themeConfig;
            try {
                themeConfig = await fs.readJson(themeJsonPath);
            } catch (err) {
                console.log(chalk.red('Error reading theme.json: ' + err.message));
                return;
            }

            const { uuid } = themeConfig;
            if (!uuid) {
                console.log(chalk.red('Error: theme.json is missing a "uuid".'));
                return;
            }

            const token = await getToken();
            const themeCdnUrl = await getThemeCdnUrl();

            // 3. Ensure partner is selected
            await ensurePartnerSelected();
            const partnerUuid = await getSelectedPartner();

            if (!partnerUuid) {
                console.log(chalk.red('Error: No partner organization selected. Use "sitepack partner:select" to select one.'));
                return;
            }

            // 4. Ask which site to preview the custom theme on
            const sites = await getSites(partnerUuid);
            if (sites.length === 0) {
                console.log(chalk.yellow('This organization has no sites yet — skipping preview site selection.'));
            } else {
                const siteUuid = await selectSite(sites);
                const selectedSite = sites.find(s => s.uuid === siteUuid);

                try {
                    const baseUrl = await getBaseUrl();
                    await callApi({
                        method: 'post',
                        url: `${baseUrl}/api/console/themes/watch-site`,
                        data: { theme_uuid: uuid, site_uuid: siteUuid },
                        headers: { 'X-SitePack-Partner': partnerUuid }
                    });
                    console.log(chalk.green(`Previewing on: ${selectedSite.name} (${selectedSite.domain})`));
                } catch (err) {
                    const serverData = err.response?.data;
                    const serverMessage = serverData?.message || serverData?.error || (typeof serverData === 'string' ? serverData : '');
                    console.log(chalk.red(`Failed to set preview site: ${serverMessage || err.message}`));
                }
            }

            console.log(chalk.cyan(`Watching theme: ${themeConfig.name || uuid} (${uuid})`));

            // Load .sitepackignore
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
                'png': 'image/png',
                'jpg': 'image/jpeg',
                'jpeg': 'image/jpeg',
                'gif': 'image/gif',
                'svg': 'image/svg+xml',
                'webp': 'image/webp',
                'css': 'text/css',
                'js': 'application/javascript',
                'json': 'application/json',
                'pdf': 'application/pdf',
                'woff': 'font/woff',
                'woff2': 'font/woff2',
                'ttf': 'font/ttf',
                'otf': 'font/otf',
                'md': 'text/plain',
                'twig': 'text/plain'
            };

            const uploadFile = async (filePath) => {
                const relativePath = path.relative(process.cwd(), filePath);
                if (ig.ignores(relativePath)) return;

                const ext = path.extname(filePath).slice(1).toLowerCase();
                if (!allowedTypes[ext]) {
                    console.log(chalk.yellow(`! Skipping ${relativePath}: file type .${ext} is not supported.`));
                    return;
                }

                if (ext === 'json') {
                    const validation = await validateJsonFile(filePath);
                    if (!validation.isValid) {
                        console.log(chalk.red(`✗ Syntax error in ${relativePath}: ${validation.error}`));
                        return;
                    }
                }

                // POST each file with the access token and x-theme-uuid header (CamelCase)
                // theme_cdn_url / uuid / folder / file.ext
                
                const url = `${themeCdnUrl}/${uuid}/${relativePath}`.replace(/\\/g, '/');

                try {
                    const form = new FormData();
                    form.append('file', fs.createReadStream(filePath));

                    const response = await callApi({
                        method: 'post',
                        url: url,
                        data: form,
                        headers: {
                            ...form.getHeaders(),
                            'X-Theme-Uuid': uuid,
                            'X-SitePack-Partner': partnerUuid
                        }
                    });

                    if (isDebug) {
                        console.log(chalk.gray(`[DEBUG] Response for ${relativePath}:`));
                        console.log(chalk.gray(JSON.stringify(response.data, null, 2)));
                    }

                    const feedback = response.data?.message || '';
                    console.log(chalk.green(`✓ Synced: ${relativePath}${feedback ? ` (${feedback})` : ''}`));
                } catch (err) {
                    if (isDebug && err.response) {
                        console.log(chalk.gray(`[DEBUG] Error response for ${relativePath}:`));
                        console.log(chalk.gray(JSON.stringify(err.response.data, null, 2)));
                    }
                    const serverData = err.response?.data;
                    const serverMessage = serverData?.message || serverData?.error || (typeof serverData === 'string' ? serverData : '');
                    console.log(chalk.red(`✗ Failed to sync ${relativePath}: ${serverMessage || err.message}`));
                }
            };

            const deleteFile = async (filePath) => {
                const relativePath = path.relative(process.cwd(), filePath);
                if (ig.ignores(relativePath)) return;

                const url = `${themeCdnUrl}/${uuid}/${relativePath}`.replace(/\\/g, '/');

                try {
                    await callApi({
                        method: 'delete',
                        url: url,
                        headers: {
                            'X-Theme-Uuid': uuid,
                            'X-SitePack-Partner': partnerUuid
                        }
                    });

                    if (isDebug) {
                        console.log(chalk.gray(`[DEBUG] Response for deleting ${relativePath}:`));
                    }

                    console.log(chalk.blue(`✓ Deleted: ${relativePath}`));
                } catch (err) {
                    if (isDebug && err.response) {
                        console.log(chalk.gray(`[DEBUG] Error response for deleting ${relativePath}:`));
                        console.log(chalk.gray(JSON.stringify(err.response.data, null, 2)));
                    }
                    const serverData = err.response?.data;
                    const serverMessage = serverData?.message || serverData?.error || (typeof serverData === 'string' ? serverData : '');
                    console.log(chalk.red(`✗ Failed to delete ${relativePath}: ${serverMessage || err.message}`));
                }
            };

            const allowedFolders = ['assets', 'config', 'layouts', 'snippets', 'templates', 'translations'];

            // Initial sync
            const spinner = ora('Performing initial sync...').start();
            try {
                // One-time call to mark start of fresh session
                const freshUrl = `${themeCdnUrl}/${uuid}/`.replace(/([^:]\/)\/+/g, "$1");
                const freshResponse = await callApi({
                    method: 'post',
                    url: freshUrl,
                    headers: {
                        'X-Theme-Uuid': uuid,
                        'X-SitePack-Partner': partnerUuid,
                        'X-Fresh': 'true'
                    }
                });

                if (isDebug) {
                    console.log(chalk.gray('[DEBUG] Initial sync response:'));
                    console.log(chalk.gray(JSON.stringify(freshResponse.data, null, 2)));
                }

                const files = await glob('**/*', { 
                    nodir: true, 
                    dot: true,
                    ignore: ['node_modules/**', '.git/**'] 
                });

                const filteredFiles = files.filter(file => {
                    if (ig.ignores(file)) return false;
                    if (file === 'theme.json') return true;
                    const parts = file.split(path.sep);
                    if (parts.length === 1) return true;
                    const rootFolder = parts[0];
                    return allowedFolders.includes(rootFolder);
                });
                
                for (const file of filteredFiles) {
                    const filePath = path.resolve(process.cwd(), file);
                    await uploadFile(filePath);
                }
                spinner.succeed(chalk.green('Initial sync completed.'));
            } catch (err) {
                if (isDebug && err.response) {
                    console.log(chalk.gray('[DEBUG] Initial sync error response:'));
                    console.log(chalk.gray(JSON.stringify(err.response.data, null, 2)));
                }
                const serverData = err.response?.data;
                const serverMessage = serverData?.message || serverData?.error || (typeof serverData === 'string' ? serverData : '');
                spinner.fail(chalk.red('Initial sync failed: ' + (serverMessage || err.message)));
            }

            // Watch for changes
            console.log(chalk.blue('Monitoring for local changes...'));
            
            const queue = new Map();
            const watcher = chokidar.watch('.', {
                ignored: (filePath, stats) => {
                    if (!filePath || filePath === '.') return false;
                    const relativePath = path.relative(process.cwd(), filePath);
                    if (relativePath === '.sitepackignore') return true;
                    if (ig.ignores(relativePath)) return true;

                    if (relativePath === 'theme.json') return false;

                    const rootFolder = relativePath.split(path.sep)[0];
                    if (allowedFolders.includes(rootFolder)) return false;

                    const parts = relativePath.split(path.sep);
                    return parts.length > 1;
                },
                persistent: true,
                ignoreInitial: true
            });

            const processQueue = async () => {
                if (queue.size === 0) return;
                
                const now = Date.now();
                for (const [filePath, timeout] of queue.entries()) {
                    if (now >= timeout) {
                        queue.delete(filePath);
                        if (await fs.pathExists(filePath)) {
                            await uploadFile(filePath);
                        }
                    }
                }
            };

            // Run queue processor
            setInterval(processQueue, 100);

            watcher.on('add', (filePath) => {
                queue.set(path.resolve(filePath), Date.now() + 300);
            });

            watcher.on('change', (filePath) => {
                queue.set(path.resolve(filePath), Date.now() + 300);
            });

            watcher.on('unlink', (filePath) => {
                queue.delete(path.resolve(filePath));
                deleteFile(filePath);
            });

            // Keep alive
            process.on('SIGINT', () => {
                watcher.close();
                console.log(chalk.yellow('\nStopping watch...'));
                process.exit();
            });
        });
}
