English | [中文](./README.md)

# Litemora

Turn Minecraft schematics into worlds you can walk into, right in the browser.

Upload a `.litematic`, `.schem` or `.schematic` file and Litemora renders it with vanilla block models and textures as an explorable 3D world. You can walk, fly and collide in first or third person, place and break blocks from the hotbar, and share your builds from your own space.

Live site: <https://litemora.art>

## Features

- **Schematic worlds**: native block models and resource-pack rendering, with chunk streaming so large builds stay smooth.
- **Player and camera**: walk, sprint, sneak and fly, with first-person, third-person and bird's-eye views and switchable Minecraft skins.
- **Personal spaces**: manage your projections under `litemora.art/<space>`, with GitHub / Google sign-in, RSS, and public or private worlds.
- **Redstone Archive**: plays deterministic redstone replays computed by [redstone-rs](https://github.com/azazo1/redstone-rs). You can play, pause, step tick by tick, change speed and scrub the timeline. See [docs/redstone-archive.md](./docs/redstone-archive.md) (Chinese).
- **Chinese and English** UI.

## Controls

| Key | Action |
| --- | --- |
| `W A S D` / arrow keys | Move |
| `Space` | Jump (ascend while flying) |
| `Shift` / `V` | Sneak (descend while flying) |
| `Ctrl` | Sprint |
| `F` | Toggle flight |
| `Y` | Switch perspective |
| `Tab` | Swap third-person shoulder |
| `Q` | Toggle block edit mode (add / remove) |
| `1`–`9` / mouse wheel | Select hotbar slot |
| `R` | Respawn |
| `Esc` | Pause menu |

## Local development

Requires Node.js and pnpm.

```powershell
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # outputs to dist/
pnpm preview
pnpm lint
```

The dev server includes a local API middleware that serves spaces and projections from `public/spaces/`. You can work on the world list and world pages without a Cloudflare environment.

## Project layout

```
src/
  js/          Three.js world, camera, player, rendering and redstone replay
  vue/         Vue UI: home, space pages, menus, HUD, admin
  pinia/       State stores
  styles/      Global styles and the deepslate + redstone design system (_redstone.scss)
  locales/     zh / en strings
functions/     Cloudflare Pages Functions (/api/*)
public/        Resource pack, schematics, redstone replays, world thumbnails
scripts/       Schematic generators, replay converter, thumbnail capture
docs/          Topic docs
```

## Deployment

The site runs on Cloudflare Pages and builds automatically when the deploy branch is pushed.

- Build command: `pnpm build`, output directory `dist`
- The `/api/*` endpoints in `functions/` run as Pages Functions
- KV binding: `LITEMORA_SPACE_KV` (spaces, projections and gallery data)
- Secrets: `LITEMORA_SESSION_SECRET`, `OAUTH_GITHUB_CLIENT_ID`, `OAUTH_GITHUB_CLIENT_SECRET`, `OAUTH_GOOGLE_CLIENT_ID`, `OAUTH_GOOGLE_CLIENT_SECRET`
- Optional: `VITE_OAUTH_CALLBACK_ORIGIN` (build-time variable for the OAuth callback origin)

## Scripts

| Command | Description |
| --- | --- |
| `pnpm thumbnails:capture [space/routeId]` | Capture isometric thumbnails of public worlds with a headless browser into `public/thumbnails/` |
| `pnpm redstone:registry` | Generate the official block-state table for a Minecraft version |
| `pnpm redstone:replay` | Convert a redstone-rs trace into a browser replay file |
| `pnpm kv:seed` | Build the KV seed data |

## Acknowledgements

- [**azazo1/redstone-rs**](https://github.com/azazo1/redstone-rs): a deterministic, JVM-free redstone simulator for Minecraft Java Edition. The Redstone Archive's triple piston extender, flying machine array, digital clock and 8-bit redstone computer, and every replay of them, come from this project. Many thanks to azazo1!
- [Cubane](https://www.npmjs.com/package/cubane) and [schematic-renderer](https://www.npmjs.com/package/schematic-renderer) for block models and schematic rendering.
- [Three.js](https://threejs.org/), [Vue](https://vuejs.org/), [Pinia](https://pinia.vuejs.org/), [Vite](https://vitejs.dev/).
- Skin authors hibiki_ekko and holland0519.
- This project is related to [Third-Person-MC](https://github.com/Shichien/Third-Person-MC).

Minecraft is a trademark of Mojang Studios. Litemora is not an official Minecraft product and is not affiliated with Mojang or Microsoft.

## License

AGPL-3.0-only. See [LICENSE](./LICENSE).
