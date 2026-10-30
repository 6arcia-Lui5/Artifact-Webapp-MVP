import { useEffect, useRef, useState } from "react";
import ArtifactImage from "./ArtifactImage";
import { applicationImageUrl, getPrivateImageBlob, safeHttpUrl } from "../../lib/ingestApi";

function PrimaryImage({ source, name, className }) {
  const privateUrl = applicationImageUrl(source);
  const [objectUrl, setObjectUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  const [decoded, setDecoded] = useState(false);
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    let allocatedUrl;
    if (privateUrl) {
      getPrivateImageBlob(privateUrl, controller.signal).then(blob => {
        if (controller.signal.aborted || !active.current) return;
        allocatedUrl = URL.createObjectURL(blob);
        setObjectUrl(allocatedUrl);
      }).catch(() => {
        if (!controller.signal.aborted && active.current) setFailed(true);
      });
    }
    return () => {
      active.current = false;
      controller.abort();
      if (allocatedUrl) URL.revokeObjectURL(allocatedUrl);
    };
  }, [privateUrl]);

  const src = privateUrl ? objectUrl : safeHttpUrl(source);
  const loading = !failed && (privateUrl ? !objectUrl : !!src);
  if (failed || !src) {
    const message = loading ? "Loading photograph…" : "Image unavailable";
    return <div className={`flex items-center justify-center bg-base-200 p-4 text-center text-base-content/70 ${className}`}
      role={loading ? "status" : "img"} aria-label={`${name}: ${message}`}><span>{message}</span></div>;
  }
  return <>
    <img src={src} alt={name} className={className} loading="lazy" referrerPolicy="no-referrer"
      aria-busy={!decoded}
      onLoad={() => { if (active.current) setDecoded(true); }}
      onError={() => { if (active.current) setFailed(true); }} />
    {!decoded ? <span role="status" className="sr-only">Loading photograph for {name}…</span> : null}
  </>;
}

export default function ResearchImage({ record, className = "" }) {
  const image = record.primaryImage;
  const source = image?.thumbnailUrl || image?.url;
  if (!source) return <ArtifactImage source={record.imageSourceUrl} name={record.itemName} className={className} />;
  // A new primary or URL gets its own lifecycle, so old image callbacks cannot replace it.
  return <PrimaryImage key={`${record.id}:${image.id}:${source}`} source={source}
    name={image.caption || record.itemName || "Artifact photograph"} className={className} />;
}
