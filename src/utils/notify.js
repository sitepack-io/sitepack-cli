/**
 * Draws the developer's attention when a sync fails while they are working in
 * another window: it rings the terminal bell (which bumps the dock/taskbar icon
 * in most terminals) and, best-effort, raises a native desktop notification.
 */

import { spawn } from 'child_process';

/**
 * @param {string} value
 * @returns {string} value escaped for use inside an AppleScript double-quoted string
 */
function escapeForAppleScript(value) {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Fires a native desktop notification without ever throwing: a failed
 * notification must never take the sync down with it. Only attempted in an
 * interactive terminal, so it stays quiet in CI and test runs.
 *
 * @param {string} title
 * @param {string} message
 */
function showDesktopNotification(title, message) {
    let command;
    let args;

    if (process.platform === 'darwin') {
        const script = `display notification "${escapeForAppleScript(message)}" with title "${escapeForAppleScript(title)}" sound name "Basso"`;
        command = 'osascript';
        args = ['-e', script];
    } else if (process.platform === 'linux') {
        command = 'notify-send';
        args = [title, message];
    } else {
        // Windows and everything else fall back to the terminal bell only.
        return;
    }

    try {
        const child = spawn(command, args, { stdio: 'ignore', detached: true });
        // Never let a missing binary (no osascript / notify-send) surface.
        child.on('error', () => {});
        child.unref();
    } catch {
        // Ignore — the bell already did its job.
    }
}

/**
 * Alerts the developer that a file failed to sync.
 *
 * @param {string} title - short headline, e.g. "SitePack sync failed"
 * @param {string} message - the detail, e.g. "translations/nl.json"
 */
export function notifyFailure(title, message) {
    // Non-interactive runs (CI, tests) get nothing — no bell, no popup.
    if (!process.stdout.isTTY) {
        return;
    }

    // Terminal bell: bumps the dock/taskbar icon in most terminals.
    try {
        process.stderr.write('');
    } catch {
        // Ignore a closed stream.
    }

    showDesktopNotification(title, message);
}
