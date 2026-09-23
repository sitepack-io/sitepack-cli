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

### Develop your theme

To watch for changes in the theme directory and sync to SitePack, navigate to your theme directory and run:

```bash
sitepack theme:watch
```

### Bootstrap a new app

To bootstrap a new SitePack app, run:

```bash
sitepack app:init
```

This will create a new app structure and a `package.json` file.

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

## Building pages with AI

`sitepack theme:watch` opens a development session on the site you picked, and asks
SitePack for a token scoped to that one site. `sitepack mcp` serves that session to an AI
editor over MCP, so an agent can fill in the design you are building — create pages, put
them in a menu, and manage the online store's categories and products — and check that
what it built actually renders.

Pages default to **staging**: served by `staging-<your-domain>` and by nothing else, which
is the safe way to build on a live site. The agent can publish a page when you ask it to
(it is a choice made per page, not something the session forbids), so going live stays a
decision you make rather than one that happens by accident. A menu entry pointing at a
staging page is hidden on the live site until that page is published. The store's
categories and products have no staging, so those are written to the live shop straight
away.

Start the watch in one terminal:

```bash
sitepack theme:watch
```

Then point your editor at the server. For Claude Code:

```bash
claude mcp add sitepack -- sitepack mcp
```

Any MCP client works — the command to run is `sitepack mcp`, with the theme directory as
the working directory. Started elsewhere, it falls back to the most recent watch session;
`--theme <uuid>` picks one when several are running.

The session ends with the watch, and its token expires after eight hours.

## Commands

| Command | Description |
| --- | --- |
| `sitepack login` | Connect the CLI interface with your SitePack account |
| `sitepack logout` | Disconnect the CLI from your SitePack account |
| `sitepack whoami` | Show the currently logged in user |
| `sitepack app:init` | Start a new SitePack app project |
| `sitepack app:publish` | Publish the app to SitePack (full sync and release) |
| `sitepack app:checkout` | Pull an app from SitePack to edit files locally |
| `sitepack theme:init` | Start a new SitePack theme project |
| `sitepack theme:watch` | Watch for changes in the theme directory and sync to SitePack |
| `sitepack theme:publish` | Publish the theme to SitePack (full sync and release) |
| `sitepack mcp` | Run the MCP server for the watched theme, so an AI editor can build staging pages |
| `sitepack partner:organisations` | List all organizations you have access to |
| `sitepack partner:change-organisation` | Select a different organization to work with |
| `sitepack partner:create-organisation` | Open the browser to create a new organization |
| `sitepack --version` | Check the current version of the CLI |
| `sitepack --help` | Show help for all commands |

For more detailed information, visit [sitepack.dev](https://sitepack.dev).
