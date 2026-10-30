import sharp from "sharp";
import { ApiError } from "./validation";
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export async function validateImage(buffer: Buffer, mime: string) {
    if (!buffer.length || buffer.length > MAX_FILE_BYTES)
        throw new ApiError(413, "Image must be at most 4 MiB");
    let expected: string | undefined;
    if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        expected = "png";
    else if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255)
        expected = "jpeg";
    else if (buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP")
        expected = "webp";
    if (expected === "png") {
        for (let offset = 8; offset + 12 <= buffer.length;) {
            const size = buffer.readUInt32BE(offset);
            const kind = buffer.subarray(offset + 4, offset + 8).toString("ascii");
            if (kind === "acTL")
                throw new ApiError(400, "Animated PNG is not supported");
            if (size > buffer.length - offset - 12)
                break;
            offset += size + 12;
        }
    }
    if (!expected || mime !== "image/" + expected)
        throw new ApiError(400, "Only matching JPEG, PNG or WebP signatures and MIME types are accepted");
    try {
        const image = sharp(buffer, { limitInputPixels: 20000000, failOn: "warning", animated: true });
        const metadata = await image.metadata();
        if (metadata.format !== expected || (metadata.pages ?? 1) !== 1 || !metadata.width || !metadata.height || metadata.width * metadata.height > 20000000)
            throw Error("Invalid dimensions or animated image");
        // Decode the whole original, not just metadata. Pixel count and channel count bound output.
        await image.clone().raw().toBuffer();
        const thumbnail = await sharp(buffer, { limitInputPixels: 20000000, failOn: "warning" }).rotate().resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
        if (thumbnail.length > 512 * 1024)
            throw Error("Thumbnail too large");
        return { mime: "image/" + expected, thumbnail };
    }
    catch {
        throw new ApiError(400, "Image must decode as one valid frame, at most 20 MP");
    }
}
