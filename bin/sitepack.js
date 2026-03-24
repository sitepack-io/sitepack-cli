#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { isTokenValid } from '../src/utils/auth.js';
import loginCommand from '../src/commands/login.js';
import logoutCommand from '../src/commands/logout.js';
import whoamiCommand from '../src/commands/whoami.js';
import appDevCommand from '../src/commands/app-dev.js';
import appInitCommand from '../src/commands/app-init.js';
import appWatchCommand from '../src/commands/app-watch.js';
import themeInitCommand from '../src/commands/theme-init.js';
import themeWatchCommand from '../src/commands/theme-watch.js';

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
    .description('SitePack Official CLI - Build your ecosystem\n\nDocumentation & Examples: https://sitepack.dev/')
    .version('1.0.0')
    .addHelpText('before', welcomeArt);

program.helpInformation = function() {
    return `
Usage: sitepack [command]

${chalk.bold('apps')}
    ${chalk.cyan('app:init')}    - Start a new SitePack app project
    ${chalk.cyan('app:dev')}     - Run your SitePack app in development mode
    ${chalk.cyan('app:watch')}   - Watch for changes in the app directory and sync to SitePack

${chalk.bold('themes')}
    ${chalk.cyan('theme:init')}  - Start a new SitePack theme project
    ${chalk.cyan('theme:watch')} - Watch for changes in the theme directory and sync to SitePack

${chalk.bold('account')}
    ${chalk.cyan('login')}       - Connect the CLI interface with your SitePack account
    ${chalk.cyan('logout')}      - Disconnect the CLI from your SitePack account
    ${chalk.cyan('whoami')}      - Show the currently logged in user

Documentation & Examples: https://sitepack.dev/

Options:
    -V, --version   output the version number
    -h, --help      display help for command
`;
};

// Register Commands
loginCommand(program);
logoutCommand(program);
whoamiCommand(program);
appDevCommand(program);
appInitCommand(program);
appWatchCommand(program);
themeInitCommand(program);
themeWatchCommand(program);

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
