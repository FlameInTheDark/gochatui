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
- `PUBLIC_BASE_PATH` — optional path prefix when serving the UI from a subdirectory (e.g. `/chat`). Set this before running `npm run build` so the static output emits assets under `<prefix>/_app`.
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
  -t gochatui .
```

Run the container:

```bash
docker run -p 3000:80 gochatui
```

The application will be available at http://localhost:3000.

When deploying behind a reverse proxy, make sure unknown paths fall back to the SPA entry point. The bundled `nginx.conf` already rewrites requests under `/` to `index.html`. If you must serve the UI from a subdirectory, build with `PUBLIC_BASE_PATH` set to that prefix and configure your proxy to forward both the prefix and its `_app` assets to the container.

## License

This project is proprietary and does not yet specify a license.
