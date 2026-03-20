import {spawn} from 'child_process';

export function runCommand(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        // Passing arguments when shell: true is deprecated. We check if on Windows or if shell is explicitly set to true.
        const isWindows = process.platform === 'win32';
        const useShell = options.shell !== undefined ? options.shell : isWindows;

        let cmd = command;
        let cmdArgs = args;

        if (useShell) {
            // If shell is true, arguments should be concatenated with the command
            // We use an empty array for args to comply with the deprecation warning
            cmd = `${command}${args.length > 0 ? ' ' + args.join(' ') : ''}`;
            cmdArgs = [];
        }

        const child = spawn(cmd, cmdArgs, {
            ...options,
            stdio: ['inherit', 'pipe', 'pipe'],
            shell: useShell
        });

        let output = '';
        let errorOutput = '';

        child.stdout.on('data', (data) => {
            output += data.toString();
        });

        child.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        child.on('close', (code) => {
            if (code !== 0) {
                const commandString = args.length > 0 ? `${command} ${args.join(' ')}` : command;
                reject(new Error(`Command failed: ${commandString}\n${errorOutput}`));
            } else {
                resolve(output.trim());
            }
        });
    });
}