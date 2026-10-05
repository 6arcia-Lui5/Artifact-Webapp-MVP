import { Link } from "react-router";

const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

const RecordCard = ({ record }) => {
    const isNew = new Date(record.createdAt) > oneWeekAgo;

    return (
        <Link
            to={`/record/${record.id}`}
            className="card bg-base-300 hover:bg-base-200 transition-colors"
        >
            <figure className="px-4 pt-4">
                {record.imageSourceUrl ? (
                    <img
                        src={record.imageSourceUrl}
                        alt={record.itemName}
                        className="rounded-xl h-40 w-full object-cover"
                    />
                ) : (
                    <div className="rounded-xl h-40 w-full bg-base-200 flex items-center justify-center text-base-content/50">
                        No image
                    </div>
                )}
            </figure>

            <div className="card-body p-4">
                <h2 className="card-title text-base">
                    {record.itemName}

                    {isNew && (
                        <span className="badge badge-secondary badge-sm">
                            NEW
                        </span>
                    )}
                </h2>

                {record.museumDescription && (
                    <p className="text-sm text-base-content/70 line-clamp-2">
                        {record.museumDescription}
                    </p>
                )}

                <div className="divider my-1"></div>

                <div className="flex items-center justify-between">
                    {record.user && (
                        <div className="flex items-center gap-2">
                            <div className="avatar">
                                <div className="w-6 rounded-full ring-1 ring-primary">
                                    {record.user.imageUrl ? (
                                        <img
                                            src={record.user.imageUrl}
                                            alt={record.user.name}
                                        />
                                    ) : null}
                                </div>
                            </div>

                            <span className="text-xs text-base-content/60">
                                {record.user.name}
                            </span>
                        </div>
                    )}

                    {record.objectType?.name && (
                        <span className="badge badge-outline badge-sm">
                            {record.objectType.name}
                        </span>
                    )}
                </div>
            </div>
        </Link>
    );
};

export default RecordCard;
