import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';
import ora from 'ora';
import chokidar from 'chokidar';
import ignore from 'ignore';
import { glob } from 'glob';
import FormData from 'form-data';
import { getToken, isTokenValid, getThemeCdnUrl } from '../utils/auth.js';

export default function(program) {
    program
        .command('theme:watch')
        .description('Watch for changes in the theme directory and sync to SitePack')
        .action(async () => {
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

                // POST each file with the access token and x-theme-uuid header (CamelCase)
                // theme_cdn_url / uuid / folder / file.ext
                
                const url = `${themeCdnUrl}/${uuid}/${relativePath}`.replace(/\\/g, '/');

                try {
                    const form = new FormData();
                    form.append('file', fs.createReadStream(filePath));

                    const response = await axios.post(url, form, {
                        headers: {
                            ...form.getHeaders(),
                            'X-SitePack-Access-Token': token.access_token,
                            'X-Theme-Uuid': uuid
                        }
                    });

                    const feedback = response.data?.message || '';
                    console.log(chalk.green(`✓ Synced: ${relativePath}${feedback ? ` (${feedback})` : ''}`));
                } catch (err) {
                    const serverMessage = err.response?.data?.message || err.response?.data || '';
                    const errorDetail = typeof serverMessage === 'object' ? JSON.stringify(serverMessage) : serverMessage;
                    console.log(chalk.red(`✗ Failed to sync ${relativePath}: ${errorDetail || err.message}`));
                }
            };

            // Initial sync
            const spinner = ora('Performing initial sync...').start();
            try {
                // One-time call to mark start of fresh session
                const freshUrl = `${themeCdnUrl}/${uuid}/`.replace(/([^:]\/)\/+/g, "$1");
                await axios.post(freshUrl, {}, {
                    headers: {
                        'X-SitePack-Access-Token': token.access_token,
                        'X-Theme-Uuid': uuid,
                        'X-Fresh': 'true'
                    }
                });

                const files = await glob('**/*', { 
                    nodir: true, 
                    dot: true,
                    ignore: ['node_modules/**', '.git/**'] 
                });

                const filteredFiles = files.filter(file => !ig.ignores(file));
                
                for (const file of filteredFiles) {
                    const filePath = path.resolve(process.cwd(), file);
                    await uploadFile(filePath);
                }
                spinner.succeed(chalk.green('Initial sync completed.'));
            } catch (err) {
                spinner.fail(chalk.red('Initial sync failed: ' + err.message));
            }

            // Watch for changes
            console.log(chalk.blue('Monitoring for local changes...'));
            
            const queue = new Map();
            const watcher = chokidar.watch('.', {
                ignored: (path, stats) => {
                    if (!path || path === '.') return false;
                    const relativePath = path.startsWith('./') ? path.substring(2) : path;
                    if (relativePath === '.sitepackignore' || relativePath === 'theme.json') return true;
                    return ig.ignores(relativePath);
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
                // Handle deletion if needed by the API, but the requirements don't explicitly mention it.
                // For now, just remove from queue if it was there.
                queue.delete(path.resolve(filePath));
                console.log(chalk.yellow(`- File removed: ${filePath} (Syncing deletions not implemented)`));
            });

            // Keep alive
            process.on('SIGINT', () => {
                watcher.close();
                console.log(chalk.yellow('\nStopping watch...'));
                process.exit();
            });
        });
}
