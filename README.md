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
PUBLIC_API_BASE_URL=
```

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

## License
This project is proprietary and does not yet specify a license.
