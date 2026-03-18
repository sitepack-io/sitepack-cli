#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import fs from 'fs-extra';
import path from 'path';
import { runCommand } from '../src/utils/command.js';

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

program.parse(process.argv);