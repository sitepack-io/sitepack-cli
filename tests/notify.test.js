import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('child_process', () => ({ spawn: vi.fn() }));

const { spawn } = await import('child_process');
const { notifyFailure } = await import('../src/utils/notify.js');

const originalPlatform = process.platform;
const originalIsTTY = process.stdout.isTTY;

/** process.platform is read-only, so swap it out for the duration of a test. */
const setPlatform = (value) => {
    Object.defineProperty(process, 'platform', { value, configurable: true });
};

/** The spawn arguments of the notification process, as { command, args, options }. */
const spawned = () => {
    const [command, args, options] = spawn.mock.calls.at(-1);
    return { command, args, options };
};

describe('notifyFailure', () => {
    let bell;

    beforeEach(() => {
        bell = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

        spawn.mockReset();
        spawn.mockImplementation(() => ({ on: vi.fn(), unref: vi.fn() }));

        // A developer sitting at a terminal.
        process.stdout.isTTY = true;
        setPlatform('darwin');
    });

    afterEach(() => {
        setPlatform(originalPlatform);
        process.stdout.isTTY = originalIsTTY;
    });

    /**
     * CI and test runs must not ring bells or pop up windows on the machine
     * that happens to be running them.
     */
    it('stays quiet when there is no interactive terminal', () => {
        process.stdout.isTTY = false;

        notifyFailure('SitePack sync failed', 'Failed to sync templates/index.twig');

        expect(bell).not.toHaveBeenCalled();
        expect(spawn).not.toHaveBeenCalled();
    });

    it('rings the terminal bell', () => {
        notifyFailure('SitePack sync failed', 'Failed to sync templates/index.twig');

        expect(bell).toHaveBeenCalledWith('\x07');
    });

    it('raises a desktop notification on macOS', () => {
        notifyFailure('SitePack sync failed', 'Failed to sync templates/index.twig');

        const { command, args } = spawned();
        expect(command).toBe('osascript');
        expect(args[0]).toBe('-e');
        expect(args[1]).toContain('display notification "Failed to sync templates/index.twig"');
        expect(args[1]).toContain('with title "SitePack sync failed"');
    });

    /**
     * An unescaped quote in a file name would break the AppleScript — or worse,
     * smuggle in another statement.
     */
    it('escapes quotes and backslashes in the AppleScript', () => {
        notifyFailure('SitePack "sync" failed', 'Failed to sync assets\\css\\"main".css');

        const { args } = spawned();
        expect(args[1]).toContain('with title "SitePack \\"sync\\" failed"');
        expect(args[1]).toContain('display notification "Failed to sync assets\\\\css\\\\\\"main\\".css"');
    });

    it('raises a desktop notification on linux', () => {
        setPlatform('linux');

        notifyFailure('SitePack sync failed', 'Failed to sync templates/index.twig');

        const { command, args } = spawned();
        expect(command).toBe('notify-send');
        expect(args).toEqual(['SitePack sync failed', 'Failed to sync templates/index.twig']);
    });

    it('falls back to the bell alone on windows', () => {
        setPlatform('win32');

        notifyFailure('SitePack sync failed', 'Failed to sync templates/index.twig');

        expect(bell).toHaveBeenCalledWith('\x07');
        expect(spawn).not.toHaveBeenCalled();
    });

    it('detaches the notification so it never holds the CLI open', () => {
        const child = { on: vi.fn(), unref: vi.fn() };
        spawn.mockReturnValue(child);

        notifyFailure('SitePack sync failed', 'Failed to sync templates/index.twig');

        const { options } = spawned();
        expect(options).toMatchObject({ detached: true, stdio: 'ignore' });
        expect(child.unref).toHaveBeenCalled();
    });

    /**
     * The notification is a nicety: a machine without osascript / notify-send
     * must not see the sync itself blow up.
     */
    it('swallows a missing notifier binary', () => {
        spawn.mockImplementation(() => ({
            on: vi.fn((event, handler) => {
                if (event === 'error') handler(new Error('spawn notify-send ENOENT'));
            }),
            unref: vi.fn(),
        }));

        expect(() => notifyFailure('SitePack sync failed', 'Failed to sync a.twig')).not.toThrow();
    });

    it('swallows a spawn that throws outright', () => {
        spawn.mockImplementation(() => { throw new Error('EPERM'); });

        expect(() => notifyFailure('SitePack sync failed', 'Failed to sync a.twig')).not.toThrow();
    });

    it('still notifies when the terminal stream is already closed', () => {
        bell.mockImplementation(() => { throw new Error('EPIPE'); });

        expect(() => notifyFailure('SitePack sync failed', 'Failed to sync a.twig')).not.toThrow();
        expect(spawn).toHaveBeenCalled();
    });
});
