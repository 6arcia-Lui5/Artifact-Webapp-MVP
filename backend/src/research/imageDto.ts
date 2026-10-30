// Shared gallery and catalog URL rules. Stored keys and local paths never enter a DTO.
const filePrefix = "/api/research/records/";

export function imageLocation(image: any) {
    const appUrl = filePrefix + image.record_id + "/images/" + image.id + "/file";
    return {
        id: image.id,
        url: image.blob_id ? appUrl : image.source_url,
        thumbnailUrl: image.blob_id ? appUrl + "?thumbnail=1" : image.source_url,
        storageKind: image.driver ?? "external",
        caption: image.caption,
    };
}

// A scalar, indexed subquery returns only the explicitly selected primary image.
// No fallback selection or gallery join can multiply catalog rows.
export const primaryImageSelect = `(SELECT json_build_object(
    'id', i.id,
    'url', CASE WHEN i.blob_id IS NULL THEN i.source_url
        ELSE '${filePrefix}' || i.record_id::text || '/images/' || i.id::text || '/file' END,
    'thumbnailUrl', CASE WHEN i.blob_id IS NULL THEN i.source_url
        ELSE '${filePrefix}' || i.record_id::text || '/images/' || i.id::text || '/file?thumbnail=1' END,
    'storageKind', coalesce(b.driver, 'external'),
    'caption', i.caption
) FROM research_images i LEFT JOIN research_blobs b ON b.id=i.blob_id
WHERE i.record_id=r.id AND i.is_primary AND (i.blob_id IS NULL OR b.state='ready')
LIMIT 1) AS "primaryImage"`;
