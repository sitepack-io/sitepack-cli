<img src="https://github.com/sitepack-io/sitepack-cli/blob/main/assets/sitepack-cli-128x128.webp?raw=true" alt="SitePack cli" width="128"/>

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

Install the SitePack CLI globally using npm:

```bash
npm install -g sitepack-cli
```

Or run it directly using npx:

```bash
npx sitepack-cli
```

<p>&nbsp;</p>

## Getting Started

### Initialize a new theme

To start a new SitePack theme project, run:

```bash
sitepack theme:init
```

Follow the prompts to name your theme and initialize a Git repository.

### Bootstrap a new app

To bootstrap a new SitePack app, run:

```bash
sitepack app:init
```

This will create a new app structure and a `package.json` file.

### Develop your app

To run your app in development mode, navigate to your app directory and run:

```bash
sitepack app:dev
```

<p>&nbsp;</p>

## Commands

| Command | Description |
| --- | --- |
| `sitepack app:dev` | Run your app in development mode |
| `sitepack app:init` | Bootstrap a new SitePack app project |
| `sitepack theme:init` | Start a new SitePack theme project |
| `sitepack --version` | Check the current version of the CLI |
| `sitepack --help` | Show help for all commands |

For more detailed information, visit [sitepack.dev](https://sitepack.dev).
