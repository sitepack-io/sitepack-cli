import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { Command } from 'commander';

vi.mock('../src/utils/auth.js', () => ({
    isTokenValid: vi.fn(async () => true),
    getThemeCdnUrl: vi.fn(async () => 'https://sync.test/themes'),
    getSelectedPartner: vi.fn(async () => 'partner-uuid'),
    callApi: vi.fn(),
}));
vi.mock('../src/utils/partners.js', () => ({ ensurePartnerSelected: vi.fn(async () => {}) }));
vi.mock('ora', () => ({ default: vi.fn(() => ({ start() { return this; }, stop() { return this; } })) }));

const { callApi, isTokenValid } = await import('../src/utils/auth.js');
const themesDiffCommand = (await import('../src/commands/themes-diff.js')).default;
const { listPublishableFiles } = await import('../src/utils/theme-files.js');

const sha = (content) => crypto.createHash('sha256').update(content).digest('hex');

function write(dir, file, content) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
}

function writeTheme(root, name, uuid) {
    const dir = path.join(root, name);
    write(dir, 'theme.json', JSON.stringify({ uuid, name }));
    write(dir, 'templates/page.twig', 'page');
    write(dir, 'README.md', 'never uploaded');
    return dir;
}

/** devcdn answering with the given published and staged files per uuid. */
function serve(manifests) {
    callApi.mockImplementation(async (config) => {
        const uuid = config.headers['X-Theme-Uuid'];
        const manifest = manifests[uuid];
        if (manifest instanceof Error) throw manifest;
        return { data: { status: 'ok', theme: { uuid, version: manifest.published?.version ?? 0 }, ...manifest } };
    });
}

function httpError(status, error) {
    return Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data: { error } } });
}

describe('sitepack themes:diff', () => {
    let root;
    let output;

    const run = async (args = []) => {
        const program = new Command();
        program.exitOverride();
        themesDiffCommand(program);
        await program.parseAsync(['node', 'sitepack', 'themes:diff', root, ...args]);
    };
    const json = async (args = []) => {
        await run([...args, '--json']);
        return JSON.parse(output.join('\n'));
    };

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'sitepack-themes-'));
        output = [];
        vi.spyOn(console, 'log').mockImplementation((line) => output.push(String(line)));
        callApi.mockReset();
        process.exitCode = undefined;
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
        process.exitCode = undefined;
    });

    it('reports per theme whether it matches the published version', async () => {
        writeTheme(root, 'atelier', 'uuid-a');
        const cadence = writeTheme(root, 'cadence', 'uuid-c');
        write(cadence, 'assets/css/theme.css', 'new');
        writeTheme(root, 'draft', '');
        writeTheme(root, 'fresh', 'uuid-f');
        fs.mkdirSync(path.join(root, 'not-a-theme'));

        const files = { 'templates/page.twig': sha('page') };
        serve({
            'uuid-a': { published: { version: 4, source: 'manifest', files: { ...files, 'theme.json': sha(JSON.stringify({ uuid: 'uuid-a', name: 'atelier' })) } } },
            'uuid-c': { published: { version: 2, source: 'manifest', files: { 'templates/page.twig': sha('old'), 'templates/gone.twig': 'x' } } },
            'uuid-f': { published: null, staged: null },
        });

        const result = await json();

        expect(result.themes.map((t) => [t.directory, t.status])).toEqual([
            ['atelier', 'in-sync'],
            ['cadence', 'changed'],
            ['draft', 'unregistered'],
            ['fresh', 'unpublished'],
        ]);
        const changed = result.themes[1];
        expect(changed.changed).toEqual(['templates/page.twig']);
        expect(changed.added).toEqual(['assets/css/theme.css', 'theme.json']);
        expect(changed.removed).toEqual(['templates/gone.twig']);
        expect(changed.localHash).not.toBe(changed.remoteHash);
        expect(result.themes[0].localHash).toBe(result.themes[0].remoteHash);
    });

    it('asks devcdn for the manifest of each registered theme', async () => {
        writeTheme(root, 'atelier', 'uuid-a');
        serve({ 'uuid-a': { published: null } });

        await json();

        expect(callApi).toHaveBeenCalledTimes(1);
        expect(callApi.mock.calls[0][0]).toEqual(expect.objectContaining({
            method: 'post',
            url: 'https://sync.test/themes/uuid-a/manifest',
            headers: expect.objectContaining({ 'X-Theme-Uuid': 'uuid-a', 'X-Partner-Uuid': 'partner-uuid' }),
        }));
    });

    it('hashes exactly the files theme:publish uploads', async () => {
        const dir = writeTheme(root, 'atelier', 'uuid-a');
        write(dir, '.sitepackignore', 'templates/drafts\n');
        write(dir, 'templates/drafts/x.twig', 'draft');
        write(dir, 'assets/video.mp4', 'skipped type');
        write(dir, 'notes/todo.twig', 'not a theme folder');

        expect(await listPublishableFiles(dir)).toEqual(['templates/page.twig', 'theme.json']);
    });

    it('notices when staging already has the local files', async () => {
        writeTheme(root, 'atelier', 'uuid-a');
        const local = {
            'templates/page.twig': sha('page'),
            'theme.json': sha(JSON.stringify({ uuid: 'uuid-a', name: 'atelier' })),
        };
        serve({ 'uuid-a': { published: { version: 1, source: 'manifest', files: {} }, staged: { files: local } } });

        const [theme] = (await json()).themes;
        expect(theme.status).toBe('changed');
        expect(theme.stagingInSync).toBe(true);
    });

    it('separates themes of another organisation and older servers from errors', async () => {
        writeTheme(root, 'other', 'uuid-o');
        writeTheme(root, 'old', 'uuid-x');
        writeTheme(root, 'broken', 'uuid-b');
        serve({
            'uuid-o': httpError(404, 'Theme not found for this organisation'),
            'uuid-x': httpError(422, "File 'manifest' is not allowed at the theme root"),
            'uuid-b': httpError(500, 'Internal server error'),
        });

        const result = await json();

        expect(result.themes.map((t) => [t.directory, t.status])).toEqual([
            ['broken', 'error'],
            ['old', 'unsupported'],
            ['other', 'no-access'],
        ]);
        expect(process.exitCode).toBe(1);
    });

    it('checks a single theme when pointed at one', async () => {
        root = writeTheme(root, 'atelier', 'uuid-a');
        serve({ 'uuid-a': { published: null } });

        const result = await json();
        expect(result.themes).toHaveLength(1);
    });

    it('fails on drift only with --exit-code', async () => {
        writeTheme(root, 'fresh', 'uuid-f');
        serve({ 'uuid-f': { published: null } });

        await run();
        expect(process.exitCode).toBeUndefined();
        expect(output.join('\n')).toContain('never published');

        await run(['--exit-code']);
        expect(process.exitCode).toBe(1);
    });

    it('lists the changed files with --files', async () => {
        writeTheme(root, 'atelier', 'uuid-a');
        serve({ 'uuid-a': { published: { version: 3, source: 'files', files: { 'templates/page.twig': 'old' } } } });

        await run(['--files']);

        const text = output.join('\n');
        expect(text).toContain('~ templates/page.twig');
        expect(text).toContain('+ theme.json');
        expect(text).toContain('an SVG can show as changed');
    });

    it('needs a login', async () => {
        isTokenValid.mockResolvedValueOnce(false);
        writeTheme(root, 'atelier', 'uuid-a');

        await run();

        expect(process.exitCode).toBe(1);
        expect(callApi).not.toHaveBeenCalled();
    });
});
