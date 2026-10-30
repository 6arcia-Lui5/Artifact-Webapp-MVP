import path from "node:path";
import { promises as fs } from "node:fs";
import { ApiError } from "./validation";
export interface Storage {
    driver: "local" | "r2" | "disabled";
    put(key: string, bytes: Buffer, mime: string, signal?: AbortSignal): Promise<void>;
    get(key: string, signal?: AbortSignal): Promise<Buffer>;
    delete(key: string, signal?: AbortSignal): Promise<void>;
}
export function objectKey(key: string) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/(original|thumbnail)$/.test(key))
        throw new ApiError(400, "Invalid storage key");
    return key;
}
export class LocalStorage implements Storage {
    driver = "local" as const;
    constructor(private root: string, mode = process.env.NODE_ENV) {
        if (mode !== "development" && mode !== "test")
            throw new ApiError(503, "Local storage is development only");
        this.root = path.resolve(root);
    }
    private file(key: string) {
        objectKey(key);
        const file = path.resolve(this.root, ...key.split("/"));
        if (!file.startsWith(this.root + path.sep))
            throw new ApiError(400, "Invalid storage key");
        return file;
    }
    async put(key: string, bytes: Buffer, _mime: string, signal?: AbortSignal) {
        signal?.throwIfAborted();
        const file = this.file(key);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, bytes, { flag: "wx", signal });
    }
    async get(key: string, signal?: AbortSignal) {
        return fs.readFile(this.file(key), { signal });
    }
    async delete(key: string) {
        await fs.rm(this.file(key), { force: true });
    }
}
export interface S3Bindings {
    client: {
        send(command: any, options?: {
            abortSignal?: AbortSignal;
        }): Promise<any>;
    };
    PutObjectCommand: new (input: any) => any;
    GetObjectCommand: new (input: any) => any;
    DeleteObjectCommand: new (input: any) => any;
}
export class R2Storage implements Storage {
    driver = "r2" as const;
    constructor(private bucket: string, private sdk: S3Bindings) {
    }
    async put(key: string, bytes: Buffer, mime: string, signal?: AbortSignal) {
        objectKey(key);
        await this.sdk.client.send(new this.sdk.PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentLength: bytes.length, ContentType: mime }), { abortSignal: signal });
    }
    async get(key: string, signal?: AbortSignal) {
        objectKey(key);
        const r = await this.sdk.client.send(new this.sdk.GetObjectCommand({ Bucket: this.bucket, Key: key }), { abortSignal: signal });
        if (r.ContentLength > 4 * 1024 * 1024) {
            r.Body?.destroy?.();
            throw new ApiError(502, "Stored object exceeds limit");
        }
        const chunks: Buffer[] = [];
        let size = 0;
        try {
            for await (const part of r.Body) {
                signal?.throwIfAborted();
                const b = Buffer.from(part);
                size += b.length;
                if (size > 4 * 1024 * 1024)
                    throw new ApiError(502, "Stored object exceeds limit");
                chunks.push(b);
            }
            return Buffer.concat(chunks);
        }
        finally {
            r.Body?.destroy?.();
        }
    }
    async delete(key: string, signal?: AbortSignal) {
        objectKey(key);
        await this.sdk.client.send(new this.sdk.DeleteObjectCommand({ Bucket: this.bucket, Key: key }), { abortSignal: signal });
    }
}
const disabled: Storage = { driver: "disabled", async put() {
        throw new ApiError(503, "Image storage disabled");
    }, async get() {
        throw new ApiError(503, "Image storage disabled");
    }, async delete() {
        throw new ApiError(503, "Image storage disabled");
    } };
export function createStorage(env: NodeJS.ProcessEnv = process.env): Storage {
    if (env.IMAGE_STORAGE_DRIVER === "local")
        return env.NODE_ENV === "development" ? new LocalStorage(env.IMAGE_LOCAL_DIRECTORY ?? path.resolve(".local/research-images"), "development") : disabled;
    if (env.IMAGE_STORAGE_DRIVER === "r2" && env.R2_ENDPOINT && env.R2_BUCKET && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY) {
        const endpoint = new URL(env.R2_ENDPOINT);
        if (endpoint.protocol !== "https:" || !endpoint.hostname.endsWith(".r2.cloudflarestorage.com") || endpoint.username || endpoint.password || endpoint.port || endpoint.pathname !== "/")
            throw new ApiError(503, "Invalid R2 endpoint");
        // The regular SDK dependency is loaded only when R2 is configured.
        let sdk: any;
        try {
            sdk = require("@aws-sdk/client-s3");
        }
        catch {
            throw new ApiError(503, "R2 storage dependency is unavailable in this server build");
        }
        const client = new sdk.S3Client({ region: env.R2_REGION ?? "auto", endpoint: endpoint.href, credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY }, maxAttempts: 2 });
        return new R2Storage(env.R2_BUCKET, { ...sdk, client });
    }
    return disabled;
}
export function storageLimit(env: NodeJS.ProcessEnv = process.env) {
    const value = env.IMAGE_STORAGE_MAX_BYTES ?? String(5 * 1024 ** 3);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1)
        throw new ApiError(503, "Invalid storage quota");
    return Number(value);
}
