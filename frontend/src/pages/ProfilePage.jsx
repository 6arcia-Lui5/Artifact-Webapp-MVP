import { Link, useNavigate } from "react-router";
import { useMyRecords, useDeleteRecord } from "../../hooks/useRecords";
import LoadingSpinner from "../components/LoadingSpinner";
import {
  PlusIcon,
  PackageIcon,
  EyeIcon,
  EditIcon,
  Trash2Icon,
} from "lucide-react";

const ProfilePage = () => {
  const navigate = useNavigate();
  const { data: records, isLoading } = useMyRecords();
  const deleteRecord = useDeleteRecord();

  const handleDelete = (id) => {
    if (confirm("Delete this record?")) {
      deleteRecord.mutate(id);
    }
  };

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">My Records</h1>
          <p className="text-base-content/60 text-sm">
            Manage your records
          </p>
        </div>

        <Link to="/create" className="btn btn-primary btn-sm gap-1">
          <PlusIcon className="size-4" />
          New
        </Link>
      </div>

      {/* Stats */}
      <div className="stats bg-base-300 w-full">
        <div className="stat">
          <div className="stat-title">Total Records</div>
          <div className="stat-value text-primary">
            {records?.length || 0}
          </div>
        </div>
      </div>

      {/* Records */}
      {records?.length === 0 ? (
        <div className="card bg-base-300">
          <div className="card-body items-center text-center py-16">
            <PackageIcon className="size-16 text-base-content/20" />

            <h3 className="card-title text-base-content/50">
              No records yet
            </h3>

            <p className="text-base-content/40 text-sm">
              Start by creating your first record
            </p>

            <Link
              to="/create"
              className="btn btn-primary btn-sm mt-4"
            >
              Create Record
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
          {records?.map((record) => (
            <div
              key={record.id}
              className="card card-side bg-base-300"
            >
              {/* Image */}
              <figure className="w-32 shrink-0">
                {record.imageSourceUrl ? (
                  <img
                    src={record.imageSourceUrl}
                    alt={record.itemName}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="h-full min-h-32 w-full bg-base-200 flex items-center justify-center text-base-content/40">
                    No image
                  </div>
                )}
              </figure>

              {/* Record information */}
              <div className="card-body p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="card-title text-base">
                      {record.itemName}
                    </h2>

                    {record.objectType?.name && (
                      <span className="badge badge-outline badge-sm mt-1">
                        {record.objectType.name}
                      </span>
                    )}
                  </div>
                </div>

                {record.museumDescription && (
                  <p className="text-sm text-base-content/60 line-clamp-2">
                    {record.museumDescription}
                  </p>
                )}

                {record.museumName && (
                  <p className="text-xs text-base-content/50">
                    {record.museumName}
                  </p>
                )}

                {/* Actions */}
                <div className="card-actions justify-end mt-2">
                  <button
                    onClick={() =>
                      navigate(`/record/${record.id}`)
                    }
                    className="btn btn-ghost btn-xs gap-1"
                  >
                    <EyeIcon className="size-3" />
                    View
                  </button>

                  <button
                    onClick={() =>
                      navigate(`/edit/${record.id}`)
                    }
                    className="btn btn-ghost btn-xs gap-1"
                  >
                    <EditIcon className="size-3" />
                    Edit
                  </button>

                  <button
                    onClick={() => handleDelete(record.id)}
                    className="btn btn-ghost btn-xs text-error gap-1"
                    disabled={deleteRecord.isPending}
                  >
                    {deleteRecord.isPending ? (
                      <span className="loading loading-spinner loading-xs" />
                    ) : (
                      <Trash2Icon className="size-3" />
                    )}
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ProfilePage;
