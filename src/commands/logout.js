import chalk from 'chalk';
import inquirer from 'inquirer';
import { logout, getToken } from '../utils/auth.js';

export default function(program) {
    program
        .command('logout')
        .description('Disconnect the CLI from your SitePack account')
        .action(async () => {
            const token = await getToken();
            if (!token) {
                console.log(chalk.yellow('You are not currently logged in.'));
                return;
            }

            const answers = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'confirm',
                    message: 'Are you sure you want to log out?',
                    default: false
                }
            ]);

            if (!answers.confirm) {
                console.log(chalk.yellow('Logout canceled.'));
                return;
            }

            try {
                await logout();
                console.log(chalk.green('✅ Logged out successfully. Your session has been terminated.'));
            } catch (err) {
                console.error(chalk.red('Logout failed: ' + err.message));
            }
        });
}
