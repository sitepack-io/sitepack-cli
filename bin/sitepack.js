#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { isTokenValid } from '../src/utils/auth.js';
import loginCommand from '../src/commands/login.js';
import logoutCommand from '../src/commands/logout.js';
import whoamiCommand from '../src/commands/whoami.js';
import appDevCommand from '../src/commands/app-dev.js';
import appInitCommand from '../src/commands/app-init.js';
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
    .description('SitePack Official CLI - Build your ecosystem' + welcomeArt)
    .version('1.0.0');

// Register Commands
loginCommand(program);
logoutCommand(program);
whoamiCommand(program);
appDevCommand(program);
appInitCommand(program);
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
