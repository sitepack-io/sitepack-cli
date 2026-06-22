import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json');

const CONFIG_PATH = path.join(os.homedir(), '.sitepackconfig');
const UPDATE_CHECK_INTERVAL = 10 * 60 * 1000; // 10 minutes

export async function checkForUpdates() {
    try {
        let config = {};
        if (await fs.pathExists(CONFIG_PATH)) {
            try {
                config = await fs.readJson(CONFIG_PATH);
            } catch (err) {
                // Ignore broken config
            }
        }

        const now = Date.now();
        const lastCheck = config.last_update_check || 0;

        if (now - lastCheck < UPDATE_CHECK_INTERVAL) {
            return;
        }

        // Update last check time immediately to avoid concurrent checks
        config.last_update_check = now;
        await fs.writeJson(CONFIG_PATH, config, { mode: 0o600 });

        const response = await axios.get('https://registry.npmjs.org/sitepack-cli/latest', {
            timeout: 2000 // Short timeout to not block CLI
        });

        const latestVersion = response.data.version;
        if (latestVersion && isNewerVersion(pkg.version, latestVersion)) {
            console.log(chalk.yellow(`\n┌──────────────────────────────────────────────────────────┐`));
            console.log(chalk.yellow(`│`) + `  Update available: ` + chalk.green(latestVersion) + ` (current: ${pkg.version})` + chalk.yellow(`    │`));
            console.log(chalk.yellow(`│`) + `  Run ` + chalk.cyan(`npm install -g sitepack-cli`) + ` to update.      ` + chalk.yellow(`│`));
            console.log(chalk.yellow(`└──────────────────────────────────────────────────────────┘\n`));
        }
    } catch (error) {
        // Silently fail update check
    }
}

function isNewerVersion(current, latest) {
    const currentParts = current.split('.').map(Number);
    const latestParts = latest.split('.').map(Number);

    for (let i = 0; i < 3; i++) {
        if (latestParts[i] > currentParts[i]) return true;
        if (latestParts[i] < currentParts[i]) return false;
    }
    return false;
}
