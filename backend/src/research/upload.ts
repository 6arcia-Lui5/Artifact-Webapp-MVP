import type { RequestHandler } from "express";
import multer from "multer";
import { ApiError } from "./validation";
// Per-process admission cap bounds decoder/multipart memory; persistent quota is separate.
export function boundedUpload(field: string, fields: number): RequestHandler {
    const parse = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 1, fields, parts: fields + 1, fieldSize: 16000 } }).single(field);
    let active = 0;
    return (req, res, next) => {
        if (!req.is("multipart/form-data"))
            return next();
        if (active >= 2)
            return next(new ApiError(429, "Uploads busy; retry shortly"));
        const announced = Number(req.headers["content-length"]);
        const max = 4 * 1024 * 1024 + 64 * 1024;
        if (announced > max)
            return next(new ApiError(413, "Multipart body too large"));
        active++;
        let finished = false, bytes = 0;
        const cleanup = () => {
            if (finished)
                return;
            finished = true;
            active--;
            clearTimeout(timer);
            req.off("data", count);
            req.off("aborted", aborted);
            res.off("close", cleanup);
        };
        const fail = (error: Error) => {
            if (finished)
                return;
            cleanup();
            req.unpipe();
            res.once("finish", () => req.destroy());
            next(error);
            req.resume();
        };
        const count = (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > max)
                fail(new ApiError(413, "Multipart body too large"));
        };
        const aborted = () => fail(new ApiError(408, "Upload cancelled"));
        const timer = setTimeout(() => fail(new ApiError(408, "Upload timed out")), 20000);
        req.on("data", count);
        req.on("aborted", aborted);
        res.on("close", cleanup);
        parse(req, res, error => {
            if (finished)
                return;
            if (error) {
                cleanup();
                return next(error);
            }
            res.once("finish", cleanup);
            next();
        });
    };
}
