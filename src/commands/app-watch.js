import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';
import ora from 'ora';
import chokidar from 'chokidar';
import ignore from 'ignore';
import FormData from 'form-data';
import { getToken, isTokenValid, getAppCdnUrl } from '../utils/auth.js';
import { validateJsonFile } from '../utils/json.js';

export default function(program) {
    program
        .command('app:watch')
        .description('Watch for changes in the app directory and sync to SitePack')
        .option('--debug', 'Output full server response')
        .action(async (options) => {
            const isDebug = !!options.debug;
            // 1. Check if user is logged in
            const isValid = await isTokenValid();
            if (!isValid) {
                console.log(chalk.red('You must be logged in to watch an app. Run "sitepack login" first.'));
                return;
            }

            // 2. Check if app.json exists
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

            const token = await getToken();
            const appCdnUrl = await getAppCdnUrl();

            console.log(chalk.cyan(`Watching app: ${appConfig.name || uuid} (${uuid})`));

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

                const url = `${appCdnUrl}/${uuid}/${relativePath}`.replace(/\\/g, '/');

                try {
                    const form = new FormData();
                    form.append('file', fs.createReadStream(filePath));

                    const response = await axios.post(url, form, {
                        headers: {
                            ...form.getHeaders(),
                            'X-SitePack-Access-Token': token.access_token,
                            'X-App-Uuid': uuid
                        }
                    });

                    if (isDebug) {
                        console.log(chalk.gray(`[DEBUG] Response for ${relativePath}:`));
                        console.log(chalk.gray(JSON.stringify(response.data, null, 2)));
                    }

                    console.log(chalk.green(`✓ Synced: ${relativePath}`));
                } catch (err) {
                    const serverData = err.response?.data;
                    const serverMessage = serverData?.message || serverData?.error || (typeof serverData === 'string' ? serverData : '');
                    console.log(chalk.red(`✗ Failed to sync ${relativePath}: ${serverMessage || err.message}`));
                    if (isDebug && err.response) {
                        console.log(chalk.gray(`[DEBUG] Error response for ${relativePath}:`));
                        console.log(chalk.gray(JSON.stringify(err.response.data, null, 2)));
                    }
                }
            };

            const deleteFile = async (filePath) => {
                const relativePath = path.relative(process.cwd(), filePath);
                if (ig.ignores(relativePath)) return;

                const url = `${appCdnUrl}/${uuid}/${relativePath}`.replace(/\\/g, '/');

                try {
                    await axios.delete(url, {
                        headers: {
                            'X-SitePack-Access-Token': token.access_token,
                            'X-App-Uuid': uuid
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

            const watcher = chokidar.watch('.', {
                ignored: (filePath) => {
                    if (!filePath || filePath === '.') return false;
                    const relativePath = path.relative(process.cwd(), filePath);
                    return ig.ignores(relativePath);
                },
                persistent: true,
                ignoreInitial: true
            });

            watcher
                .on('add', filePath => uploadFile(filePath))
                .on('change', filePath => uploadFile(filePath))
                .on('unlink', filePath => deleteFile(filePath));

            console.log(chalk.yellow('Watching for changes... (Press Ctrl+C to stop)'));
        });
}
