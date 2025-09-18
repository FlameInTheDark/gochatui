# gochatui

A SvelteKit-based UI for the GoChat service. The project uses Svelte 5, TypeScript and Tailwind CSS to deliver a modern chat experience with real-time updates.

## Features

- Channels and direct messages
- REST and WebSocket clients
- Internationalisation with Paraglide
- Built with the SvelteKit static adapter

## Getting Started

### Prerequisites

- Node.js 20+
- npm

### Installation

```bash
npm install
```

Copy `.env.example` to `.env` and set the required environment variables:

```env
PUBLIC_WS_URL=
PUBLIC_BASE_PATH=
PUBLIC_API_BASE_URL=
```

- `PUBLIC_WS_URL` — websocket endpoint for real-time updates.
- `PUBLIC_BASE_PATH` — optional path prefix when serving the UI from a subdirectory (e.g. `/app`). Set this before running `npm run build` so the static output emits assets under `<prefix>/_app`.
- `PUBLIC_API_BASE_URL` — base URL for REST API calls from the browser.

### Development

Start the development server:

```bash
npm run dev
```

Run linting and type checks:

```bash
npm run lint
npm run check
```

### Building

Create an optimized production build:

```bash
npm run build
```

Preview the built app locally:

```bash
npm run preview
```

## Docker

The repository includes a multi-stage `Dockerfile` that builds the static site and serves it with Nginx.

Build the image:

```bash
docker build \
  --build-arg PUBLIC_BASE_PATH=/app \
  -t gochatui .
```

Run the container:

```bash
docker run -p 3000:80 gochatui
```

The application will be available at http://localhost:3000.

When deploying behind a reverse proxy that only forwards a sub-path (for example Traefik routing `/app` to the UI container), ensure that:

- `PUBLIC_BASE_PATH` is set to the forwarded prefix **at build time**.
- The proxy forwards both `/app` and `/app/_app/*` to the UI container so static assets resolve correctly. The provided `nginx.conf` already serves `/app` with an SPA fallback to `/app/index.html` for deep links.

## License

This project is proprietary and does not yet specify a license.
