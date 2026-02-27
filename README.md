# imagia

> Build what you can imagine – build, test, deploy, and market your Node.js app.

Imagia is a Node.js CLI tool that lets you **build**, **test**, and **deploy** apps, and generate
**marketing collateral** around your app – similar in spirit to replit.com.

## Installation

```bash
npm install -g imagia
```

## Commands

| Command | Description |
|---------|-------------|
| `imagia build` | Run the project's `build` npm script |
| `imagia test` | Run the project's `test` npm script |
| `imagia deploy` | Package and deploy the app (`local` \| `docker` \| `custom`) |
| `imagia market` | Generate `MARKETING_README.md`, `preview.html`, and `social.txt` |

## Quick Start

```bash
# Inside your project directory:
imagia build
imagia test
imagia deploy --target local
imagia market
```

### Marketing collateral

Running `imagia market` reads your `package.json` (including an optional
`imagia.features` array) and writes three ready-to-use assets into a
`marketing/` folder:

- **MARKETING_README.md** – polished markdown README
- **preview.html** – standalone HTML preview page with styled layout
- **social.txt** – social-media–ready snippet with hashtags

```jsonc
// package.json – optional custom features list
{
  "imagia": {
    "features": ["One-click deployment", "Real-time preview", "Instant scaling"]
  }
}
```

### Deploy targets

```bash
imagia deploy --target local     # runs "deploy" npm script, or creates npm pack tarball
imagia deploy --target docker    # builds a Docker image (requires Dockerfile)
imagia deploy --target custom --cmd "rsync -av dist/ user@host:/var/www"
```

## Development

```bash
npm test   # run the Jest test suite
```
