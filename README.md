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
docker build -t gochatui .
```

Run the container:

```bash
docker run -p 3000:80 gochatui
```

The application will be available at http://localhost:3000.

### Runtime configuration

At container start an entrypoint script writes `/usr/share/nginx/html/runtime-env.js` with the values of `PUBLIC_API_BASE_URL`, `PUBLIC_WS_URL` and `PUBLIC_BASE_PATH`. The page includes this script before the Svelte bundle loads, so browser code can discover deployment-specific endpoints without rebuilding the image.

- Leave a variable unset (or empty) to fall back to the build-time value baked into the static bundle.
- Override the defaults by passing environment variables to `docker run` (or your orchestrator):

  ```bash
  docker run -p 3000:80 \
    -e PUBLIC_API_BASE_URL=https://api.example.com/v1 \
    -e PUBLIC_WS_URL=wss://ws.example.com/subscribe \
    -e PUBLIC_BASE_PATH=/app \
    gochatui
  ```

The generated script is served as a static asset (`/runtime-env.js`), so the configuration is cached by browsers and CDNs just like other files. Restart the container after changing environment variables to refresh the runtime configuration.

When deploying behind a reverse proxy that only forwards a sub-path, ensure that:

- `PUBLIC_BASE_PATH` is set to the forwarded prefix **at build time**.
- Your proxy forwards that prefix (and its static assets) to the UI container. The provided `nginx.conf` serves the app at `/` and issues redirects for legacy `/app` URLs so existing bookmarks continue to work.

## License

This project is proprietary and does not yet specify a license.
