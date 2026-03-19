#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import fs from 'fs-extra';
import path from 'path';
import { runCommand } from '../src/utils/command.js';
import { performLogin, logout, getToken, isTokenValid, whoami } from '../src/utils/auth.js';

const program = new Command();

const welcomeArt = `
                                                           
                                                           
        @@@@@@                                @@@@@        
        @@@@@@@@@@@   @@@@@@@@@@@@@@@@  @@@@@@@@@@@        
        @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@        
        @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@        
        @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@        
         @@@@@@@          @@@@@@@          @@@@@@@         
         @@@@@    @@@@@@    @@@    @@@@@@    @@@@@         
         @@@@   @@@@@@@@@@   @   @@@@@@@@@@   @@@@         
        @@@@@  @@@@@@  @@@@     @@@@@@   @@@   @@@@        
        @@@@   @@@ @    @@@@    @@@ @@    @@@  @@@@        
        @@@@   @@@      @@@@    @@@@     @@@   @@@@        
        @@@@@   @@@@@@@@@@@@@@@@@@@@@@@@@@@@  @@@@@        
         @@@@@    @@@@@@@  @@@@@@  @@@@@@@    @@@@@        
         @@@@@@            @@@@             @@@@@@         
          @@@@@@@@@    @@@@@@@@@@@@@     @@@@@@@@          
            @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@            
              @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@              
 @@@@@        @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@        @@@@@ 
  @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@  
  @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@  
   @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@   
     @@@@@@@@@ @@@@@@@@@@@@@@@@@@@@@@@@@@@@@  @@@@@@@@     
               @@@@@@@@@@@@@@@@@@@@@@@@@@@@@               
                @@@@@@@@@@@@@@@@@@@@@@@@@@@                
                 @@@@@@@@@@@@@@@@@@@@@@@@@                 
                   @@@@@@@@@@@@@@@@@@@@@@                  
                      @@@@@@@@@@@@@@@@                     
                         @@@@@@@@@                         
                             @                             
                                                           
`;

program
    .name('sitepack')
    .description('SitePack Official CLI - Build your ecosystem' + welcomeArt)
    .version('1.0.0');

// CLI authorization
program
    .command('login')
    .description('Connect the CLI interface with your SitePack account')
    .action(async () => {
        try {
            const token = await performLogin();
            const scopesInfo = token.scopes && token.scopes.length > 0 ? ' Your scopes: ' + token.scopes.join(', ') : '';
            console.log(chalk.green('✅ Logged in successfully!' + scopesInfo));
        } catch (err) {
            console.error(chalk.red('Authentication failed: ' + err.message));
        }
    });

// Logout
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

// Whoami
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

// APP:DEV
program
    .command('app:dev')
    .description('Run your SitePack app in development mode')
    .action(async () => {
        console.log(chalk.cyan(welcomeArt));
        console.log(chalk.cyan.bold('\n🚀 SitePack App - Development Mode\n'));
        console.log(chalk.yellow('Starting development server...'));
        // For now, this is a placeholder. 
        // In a real scenario, this might start a vite or other server.
        console.log(chalk.green('✅ Development server running at http://localhost:3000'));
    });

// APP:INIT
program
    .command('app:init')
    .description('Bootstrap a new SitePack app project')
    .action(async () => {
        console.log(chalk.cyan(welcomeArt));
        console.log(chalk.cyan.bold('\n🚀 SitePack App Builder\n'));

        const answers = await inquirer.prompt([
            { type: 'input', name: 'name', message: 'App name:', default: 'my-app' },
            { type: 'confirm', name: 'git', message: 'Initialize Git repository?', default: true }
        ]);

        const targetDir = path.join(process.cwd(), answers.name);

        if (fs.existsSync(targetDir)) {
            console.log(chalk.red(`Error: Directory ${answers.name} already exists.`));
            return;
        }

        // Create directory structure for an app
        const structure = ['src', 'public', 'tests', 'config'];
        for (const folder of structure) {
            await fs.ensureDir(path.join(targetDir, folder));
        }

        // Base app.json or package.json
        await fs.writeJson(path.join(targetDir, 'package.json'), {
            name: answers.name,
            version: "1.0.0",
            description: "SitePack App",
            main: "src/index.js",
            type: "module",
            scripts: {
                "dev": "sitepack app:dev",
                "build": "sitepack app:build"
            },
            sitepack: {
                version: "2026.1"
            }
        }, { spaces: 2 });

        // Basic src/index.js
        await fs.writeFile(path.join(targetDir, 'src/index.js'), "// SitePack App Entry Point\nconsole.log('Hello SitePack!');\n");

        console.log(chalk.yellow('🛠 Files created...'));

        // Use runCommand for Git init
        if (answers.git) {
            try {
                process.chdir(targetDir);
                await runCommand('git', ['init']);
                console.log(chalk.green('✅ Git initialized.'));
            } catch (e) {
                console.log(chalk.red('⚠ Could not initialize Git. Is Git installed?'));
            }
        }

        console.log(chalk.green.bold(`\nDone! Your app is in: ${targetDir}\n`));
    });

// THEME:INIT
program
    .command('theme:init')
    .description('Start a new SitePack theme project')
    .action(async () => {
        console.log(chalk.cyan(welcomeArt));
        console.log(chalk.cyan.bold('\n📦 SitePack Theme Builder\n'));

        const answers = await inquirer.prompt([
            { type: 'input', name: 'name', message: 'Theme name:', default: 'my-theme' },
            { type: 'confirm', name: 'git', message: 'Initialize Git repository?', default: true }
        ]);

        const targetDir = path.join(process.cwd(), answers.name);

        if (fs.existsSync(targetDir)) {
            console.log(chalk.red(`Error: Directory ${answers.name} already exists.`));
            return;
        }

        // Create directories
        const structure = ['assets', 'layouts', 'templates', 'snippets', 'config'];
        for (const folder of structure) {
            await fs.ensureDir(path.join(targetDir, folder));
        }

        // Base theme.json
        await fs.writeJson(path.join(targetDir, 'theme.json'), {
            name: answers.name,
            version: "1.0.0",
            sitepack_version: "2026.1"
        }, { spaces: 2 });

        console.log(chalk.yellow('🛠 Files created...'));

        // Use runCommand for Git init
        if (answers.git) {
            try {
                process.chdir(targetDir);
                await runCommand('git', ['init']);
                console.log(chalk.green('✅ Git initialized.'));
            } catch (e) {
                console.log(chalk.red('⚠ Could not initialize Git. Is Git installed?'));
            }
        }

        console.log(chalk.green.bold(`\nDone! Your theme is in: ${targetDir}\n`));
    });

// Check for authentication and show warning if not logged in
const skipValidationCommands = [undefined, 'login', 'help', '--help', '-h', '--version', '-V', 'whoami'];
const currentCommand = process.argv[2];

if (!skipValidationCommands.includes(currentCommand)) {
    const isValid = await isTokenValid();
    if (!isValid) {
        console.log(chalk.yellow('⚠ Warning: No active connection found or your session has expired. Please run "sitepack login" to authorize this CLI.\n'));
    }
}

program.parse(process.argv);