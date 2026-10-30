import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { metObjectId, resolveMetImage, sourceUrl } from "../../lib/artifactImages";

export default function ArtifactImage({ source, name, className = "" }) {
  const [failedSource, setFailedSource] = useState(null);
  const objectId = metObjectId(source);
  const museumImage = useQuery({
    queryKey: ["museumImage", "met", objectId],
    queryFn: ({ signal }) => resolveMetImage(objectId, signal),
    enabled: !!objectId,
    staleTime: 24 * 60 * 60 * 1000,
    retry: false,
  });
  const imageUrl = objectId ? museumImage.data : sourceUrl(source);
  if (imageUrl && failedSource !== imageUrl) {
    return <img src={imageUrl} alt={name} className={className}
      onError={() => setFailedSource(imageUrl)} />;
  }
  const message = objectId && museumImage.isPending
    ? "Loading image…" : source?.trim() ? "Image unavailable" : "No image";
  return (
    <div className={`flex items-center justify-center bg-base-200 p-4 text-center text-base-content/70 ${className}`}
      role="img" aria-label={`${name}: ${message}`}>
      <span>{message}</span>
    </div>
  );
}
