# Catalog frontend

React/Vite interface for the Handheld Words artifact catalog. It includes search, artifact editing, research collections, import previews, submission review, photographs and optional ML tools.

Follow the [project setup](../README.md#run-the-catalog-locally) to configure Clerk and the backend before starting this app.

From this directory:

```sh
npm ci
npm run dev
```

The development server uses [localhost:5173](http://localhost:5173). Set `VITE_API_URL` and `VITE_CLERK_PUBLISHABLE_KEY` in `.env` as described in the project README.

Checks: `npm run build`, `npm run lint`, and `npm run test:unit`. Browser tests require the accounts and services described in the [development checks](../README.md#development-checks).
