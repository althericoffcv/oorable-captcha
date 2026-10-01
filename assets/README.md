# Puzzle assets

This directory holds the meme-puzzle source images and their processed tiles. Neither is committed to version control (see `.gitignore`) -- both are generated locally.

## Layout

- `manifest.json` -- the catalogue of source images (id + URL). Edit this to add your own.
- `source/` -- full downloaded images, named `<id>.jpg` (created by `npm run assets:setup`).
- `processed/<id>/<grid>/r<row>c<col>.jpg` -- pre-cropped tiles per grid size (created by `npm run assets:process`).

## Setup

```bash
npm run assets:setup     # downloads manifest.json's URLs into source/
npm run assets:process   # requires `sharp`: npm install --save-dev sharp
```

Then point a `LocalPreprocessedAssetProvider` at `assets/processed` (see `docs/asset-management.md`).

## Licensing

Make sure you have the rights to use, and to let end users see and interact with, any image you add here. If the four supplied images are meant to be shipped as this project's default puzzle set, confirm their license/attribution requirements before distributing them -- this repository does not vouch for the licensing of third-party image URLs supplied in a project brief.
