# PDF Size Splitter

Browser-only web app for splitting large PDFs into smaller PDF chunks with a configurable size limit and overlapping page context.

## Development

```bash
npm install
npm run dev
```

## Production Build

```bash
npm run build
npm run preview
```

The deployable static site is generated in `dist/`.

## GitHub Pages Deployment

This repo includes `.github/workflows/deploy.yml`, which builds the app and publishes `dist/` to GitHub Pages.

In GitHub:

1. Go to **Settings > Pages**.
2. Set **Source** to **GitHub Actions**.
3. Push to the `main` branch.
4. Open the URL from the completed **Deploy to GitHub Pages** workflow.

Do not deploy the repository root as a static folder. Vite apps must be built first.
