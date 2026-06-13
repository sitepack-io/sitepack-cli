<img src="https://github.com/sitepack-io/sitepack-cli/blob/main/assets/sitepack-cli-256x256.webp?raw=true" alt="SitePack cli" width="128"/>

# SitePack CLI
<img src="https://img.shields.io/badge/License-MIT-green.svg" alt="License">
<img src="https://img.shields.io/badge/Node.js-%3E%3D18.0.0-blue.svg" alt="Node.js version">

With the SitePack command line interface (SitePack CLI), you can:
- initialize, build, and manage SitePack themes
- bootstrap, develop, and manage SitePack apps
- build and manage your ecosystem

Learn more in the docs: [sitepack.dev](https://sitepack.dev)

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

Most resources in SitePack (like apps and themes) are owned by an organization (partner). You can register your company as a partner for free in our [partner dashboard](https://sitepack.eu/partners).

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
| `sitepack partner:organisations` | List all organizations you have access to |
| `sitepack partner:change-organisation` | Select a different organization to work with |
| `sitepack partner:create-organisation` | Open the browser to create a new organization |
| `sitepack --version` | Check the current version of the CLI |
| `sitepack --help` | Show help for all commands |

For more detailed information, visit [sitepack.dev](https://sitepack.dev).
