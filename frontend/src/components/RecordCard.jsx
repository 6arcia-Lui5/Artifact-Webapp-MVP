
import { Link } from "react-router";

const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

const RecordCard = ({ record }) => {
    const isNew = new Date(record.createdAt) > oneWeekAgo;

    return (
        <Link
            to={`/record/${record.id}`}
            className="card bg-base-300 hover:bg-base-200 transition-colors h-full"
        >
            {/* Image */}
            <figure className="px-4 pt-4">
                {record.imageSourceUrl ? (
                    <img
                        src={record.imageSourceUrl}
                        alt={record.itemName || "Artifact"}
                        className="rounded-xl h-40 w-full object-cover"
                    />
                ) : (
                    <div className="rounded-xl h-40 w-full bg-base-200 flex items-center justify-center text-base-content/50">
                        No image
                    </div>
                )}
            </figure>

            {/* Card information */}
            <div className="card-body p-4 gap-3">

                {/* Title and NEW badge */}
                <div className="flex items-start justify-between gap-2">
                    <h2 className="card-title text-base line-clamp-2">
                        {record.itemName || "Untitled item"}
                    </h2>

                    {isNew && (
                        <span className="badge badge-secondary badge-sm shrink-0">
                            NEW
                        </span>
                    )}
                </div>

                {/* HHW */}
                {record.hhw && (
                    <p className="text-sm font-medium text-base-content line-clamp-2">
                        {record.hhw}
                    </p>
                )}

                {/* Museum information */}
                {record.museumName && (
                    <p className="text-sm text-base-content/70 line-clamp-1">
                        {record.museumName}
                    </p>
                )}

                {/* Museum ID */}
                {record.museumId && (
                    <p className="text-xs text-base-content/60">
                        Museum ID: {record.museumId}
                    </p>
                )}

                <div className="divider my-0"></div>

                {/* Contributor and object type */}
                <div className="flex items-center justify-between gap-2">

                    {record.user && (
                        <div className="flex items-center gap-2 min-w-0">
                            <div className="avatar shrink-0">
                                <div className="w-6 rounded-full ring-1 ring-primary">
                                    {record.user.imageUrl ? (
                                        <img
                                            src={record.user.imageUrl}
                                            alt={record.user.name || "Contributor"}
                                        />
                                    ) : (
                                        <div className="bg-base-200 w-full h-full" />
                                    )}
                                </div>
                            </div>

                            <span className="text-xs text-base-content/60 truncate">
                                {record.user.name}
                            </span>
                        </div>
                    )}

                    {record.objectType?.name && (
                        <span className="badge badge-outline badge-sm shrink-0">
                            {record.objectType.name}
                        </span>
                    )}
                </div>
            </div>
        </Link>
    );
};

export default RecordCard;
