import chalk from 'chalk';
import { performLogin } from '../utils/auth.js';
import { selectPartner } from '../utils/partners.js';

export default function(program) {
    program
        .command('login')
        .description('Connect the CLI interface with your SitePack account')
        .action(async () => {
            try {
                const token = await performLogin();
                const scopesInfo = token.scopes && token.scopes.length > 0 ? ' Your scopes: ' + token.scopes.join(', ') : '';
                console.log(chalk.green('✅ Logged in successfully!' + scopesInfo));

                // After successful login, directly show the choice to select the partner organisation
                await selectPartner();
            } catch (err) {
                console.error(chalk.red('Authentication failed: ' + err.message));
            }
        });
}
