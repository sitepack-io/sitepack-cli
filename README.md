<img src="https://github.com/sitepack-io/sitepack-cli/blob/main/assets/sitepack-cli-256x256.webp?raw=true" alt="SitePack cli" width="128"/>

# SitePack CLI
<img src="https://img.shields.io/badge/License-MIT-green.svg" alt="License">
<img src="https://img.shields.io/badge/Node.js-%3E%3D18.0.0-blue.svg" alt="Node.js version">

With the SitePack command line interface (SitePack CLI), you can:
- initialize, build, and manage SitePack themes
- bootstrap, develop, and manage SitePack apps
- build and manage your ecosystem

Learn more in the [development docs](https://sitepack.dev) and [help docs on help.sitepack.eu](https://help.sitepack.eu).

<p>&nbsp;</p>

## Installation

Install the SitePack CLI globally using npm or yarn:

```bash
npm install -g sitepack-cli
```

Or using yarn:

```bash
yarn global add sitepack-cli
```

Or run it directly using npx:

```bash
npx sitepack-cli
```

Or using yarn dlx:

```bash
yarn dlx sitepack-cli
```

<p>&nbsp;</p>

## Authentication

Before you can use most features of the SitePack CLI, you need to authenticate your account.

To log in, run:

```bash
sitepack login
```

Follow the link displayed in your terminal to authorize the CLI in your browser.

To check your current authentication status, run:

```bash
sitepack whoami
```

To log out and disconnect your account, run:

```bash
sitepack logout
```

<p>&nbsp;</p>

## Organizations

Most resources in SitePack (like apps and themes) are owned by an organization (partner). You can register your company as a partner for free in our [partner dashboard](https://admin.sitepack.eu/partners).

To list all organizations you have access to, run:

```bash
sitepack partner:organisations
```

To change the active organization you are working with, run:

```bash
sitepack partner:change-organisation
```

To create a new organization, run:

```bash
sitepack partner:create-organisation
```

<p>&nbsp;</p>

## Getting Started

### Initialize a new theme

To start a new SitePack theme project, run:

```bash
sitepack theme:init
```

Follow the prompts to name your theme and initialize a Git repository.

### Link an existing theme directory

`theme:init` starts a new theme from the skeleton. Already have the source of a theme (a `theme.json` with its templates and assets), for example one you cloned or copied, but no theme for it in the partner dashboard? Link the directory instead:

```bash
sitepack theme:link path/to/my-theme
```

When the uuid in `theme.json` is empty or not a theme of your selected organization, you choose between registering a new theme (SitePack issues a new uuid) or linking it to one of your existing themes. The uuid is written back to `theme.json` (and an empty `author` is filled in), so `sitepack theme:watch` and `sitepack theme:publish` target that theme. Add `--new` to always register a new theme.

### Develop your theme

To watch for changes in the theme directory and sync to SitePack, navigate to your theme directory and run:

```bash
sitepack theme:watch
```

### Verify your theme

Before you publish, check the theme against the SitePack requirements. It runs offline and needs no login:

```bash
sitepack theme:verify
```

It checks:
- **Directory structure**: only the files and folders SitePack accepts on upload.
- **theme.json**: settings, custom templates and fields that core can read (core silently drops invalid ones), `platform_colors` pointing at colour settings.
- **Templates**: every page type the storefront renders, a home template (`index`), and the platform functions apps rely on (`sitepack_head()`, `sitepack_account()`, ...).
- **App blocks**: every standard `{% app_block %}` hook, so installed apps show up.
- **Translations**: `en`, `nl`, `de` and `es` with the same keys, and every key the templates use.
- **Twig sandbox**: only tags, filters and functions that both publishing and rendering allow.
- **Design rules** (warnings): no hardcoded colours or fonts, every CSS variable declared, `alt` on images.

Pass a path to verify another directory (`sitepack theme:verify path/to/theme`). Errors exit with code 1; add `--strict` to fail on warnings too, or `--json` for CI and scripts.

### Find unpublished changes

Working on several themes at once? Run this in the folder that holds them to see which ones have changes that are not published to SitePack yet:

```bash
sitepack themes:diff
```

For every theme directory (a sub-folder with a `theme.json`) it hashes the files `sitepack theme:publish` would upload and compares them with the version that is live, file by file:

```text
  atelier    ✔ in sync  v4  9aa4aa7
  cadence    ● 2 changed, 1 new  since v3  local 76df076 ≠ published 315b624  staging ✔
  supper     ○ never published
  trailhead  – no uuid in theme.json (run "sitepack theme:link")
```

`staging ✔` means `sitepack theme:watch` already synced the local files, but they are not published yet. Themes of another organisation are skipped. Add `--files` to list the changed files, `--json` for scripts, and `--exit-code` to exit with code 1 when a theme differs (for CI). Run it inside a single theme directory to check only that theme.

### Bootstrap a new app

To bootstrap a new SitePack app, run:

```bash
sitepack app:init
```

This will create a new app structure and a `package.json` file.

### Link an existing app directory

Already have the source of an app (an `app.json` with its templates and assets), but no app for it in the partner dashboard yet? Link the directory instead of bootstrapping a new app:

```bash
sitepack app:link path/to/my-app
```

When the uuid in `app.json` is not an app of your selected organization, you choose between registering a new app (SitePack issues a new uuid) or linking it to one of your existing apps. The uuid is written back to `app.json`, so `sitepack app:publish` publishes to that app. Add `--new` to always register a new app.

### Publish your app

To publish your app to SitePack, run:

```bash
sitepack app:publish
```

### Checkout an app

To pull an app from SitePack, run:

```bash
sitepack app:checkout
```

<p>&nbsp;</p>

## Commands

| Command | Description |
| --- | --- |
| `sitepack login` | Connect the CLI interface with your SitePack account |
| `sitepack logout` | Disconnect the CLI from your SitePack account |
| `sitepack whoami` | Show the currently logged in user |
| `sitepack app:init` | Start a new SitePack app project |
| `sitepack app:publish` | Publish the app to SitePack (full sync and release) |
| `sitepack app:checkout` | Pull an app from SitePack to edit files locally |
| `sitepack app:link [directory]` | Link an existing app directory to SitePack (registers a new uuid when needed) |
| `sitepack theme:init` | Start a new SitePack theme project |
| `sitepack theme:link [directory]` | Link an existing theme directory to SitePack (registers a new uuid when needed) |
| `sitepack theme:watch` | Watch for changes in the theme directory and sync to SitePack |
| `sitepack theme:verify [directory]` | Check the theme against the SitePack requirements (offline) |
| `sitepack theme:publish` | Publish the theme to SitePack (full sync and release) |
| `sitepack themes:diff [directory]` | Show which themes in a folder have changes that are not published |
| `sitepack partner:organisations` | List all organizations you have access to |
| `sitepack partner:change-organisation` | Select a different organization to work with |
| `sitepack partner:create-organisation` | Open the browser to create a new organization |
| `sitepack --version` | Check the current version of the CLI |
| `sitepack --help` | Show help for all commands |

For more detailed information, visit [sitepack.dev](https://sitepack.dev).
