import chalk from 'chalk';
import { getToken, isTokenValid, whoami } from '../utils/auth.js';

export default function(program) {
    program
        .command('whoami')
        .description('Show the currently logged in user')
        .action(async () => {
            const token = await getToken();
            if (!token) {
                console.log(chalk.yellow('Not logged in. Use: sitepack login'));
                return;
            }

            const isValid = await isTokenValid();
            if (!isValid) {
                console.log(chalk.red(`Your session has expired. Please run "sitepack login" to re-authorize.`));
                return;
            }

            try {
                const userInfo = await whoami();
                if (userInfo) {
                    console.log(chalk.cyan.bold('\n👤 SitePack User Profile\n'));
                    console.log(`${chalk.gray('Name:')} ${chalk.white(userInfo.first_name || 'N/A')} ${chalk.white(userInfo.last_name || 'N/A')}`);
                    console.log(`${chalk.gray('Email:')} ${chalk.white(userInfo.email || 'N/A')}`);
                    if (userInfo.organization) {
                        console.log(`${chalk.gray('Organization:')} ${chalk.white(userInfo.organization)}`);
                    }
                    console.log('');
                } else {
                    console.log(chalk.red('Could not retrieve user information from the server.'));
                }
            } catch (err) {
                console.error(chalk.red('Error retrieving user info: ' + err.message));
            }
        });
}
