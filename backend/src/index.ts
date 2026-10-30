import express from "express"
import { ENV } from "./config/env"
import { clerkMiddleware } from '@clerk/express'
import cors  from "cors"

import userRoutes from "./routes/userRoutes"
import recordRoutes from "./routes/recordRoutes"
import collectionRoutes from "./routes/collectionRoutes"
import { requireSiteAccess } from "./middleware/requireSiteAccess"
import objectTypeRoutes from "./routes/objectTypeRoutes";
import mlRoutes from "./routes/mlRoutes";
import transcriptionRoutes from "./routes/transcriptionRoutes";
import museumPhotoRoutes from "./routes/museumPhotoRoutes";

import { pool } from './db';
import { createResearchRouter } from './research/router';
import { catalogContext } from './research/access';

const app = express()

app.use(cors({ origin: ENV.FRONTEND_URL, credentials: true })); //credentials:ture allows frontend to send cookies to backend so we can authenticate user
app.use(clerkMiddleware()); // auth obj will be attached to the req object
app.use(express.json()); // parses json body
app.use(express.urlencoded({ extended: true })); // parses data (like html forms)
app.use(requireSiteAccess);

// The client checks this before rendering any catalog content.
app.get("/api/access", (_req, res) => res.sendStatus(204));

app.get("/", (req, res) => {
    res.json({
        message: "Welcome",
        endpoints: {
            users: "/api/users",
            records: "/api/records",
            collections: "/api/collections",
            objectTypes: "/api/object-types",
        },
    });
});

app.use(catalogContext(pool));
app.use("/api/research", createResearchRouter(pool));
app.use("/api/users", userRoutes);
app.use("/api/collections", collectionRoutes);
app.use("/api/records", recordRoutes);
app.use("/api/object-types", objectTypeRoutes);
app.use("/api/ml", mlRoutes);
app.use("/api/transcription", transcriptionRoutes);
app.use("/api/transcription", museumPhotoRoutes);
app.use((error: any, _req: any, res: any, _next: any) => {
    const missingMigration = ['42P01', '42703'].includes(error?.code);
    const status = missingMigration ? 503 : error?.status ?? 500;
    res.status(status).json({ error: missingMigration ? 'Research catalog migrations are not applied to the configured schema.' : status === 500 ? 'Catalog operation failed' : error.message });
});


// Vercel imports the Express app as a function. Keep the local server for development.
if (!process.env.VERCEL) {
    const port = Number(ENV.PORT) || 3000;
    app.listen(port, () => console.log("Server is up on PORT:", port));
}

export default app;
