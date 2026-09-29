import { LoaderIcon } from "lucide-react";

const LoadingSpinner = () => (
    <div role="status" className="flex flex-col items-center justify-center py-20 gap-4">
        <LoaderIcon aria-hidden="true" className="size-10 text-primary animate-spin motion-reduce:animate-none" />
        <p className="text-sm text-base-content">Loading...</p>
    </div>
);

export default LoadingSpinner;