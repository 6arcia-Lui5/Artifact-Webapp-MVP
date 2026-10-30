import { Link, useNavigate } from "react-router";
import { useAuth } from "@clerk/react";
import { useDeleteRecord } from "../../hooks/useRecords";
import { useCatalogLocation, useResearchRecords } from "../../hooks/useResearchCatalog";
import { CatalogPagination, CatalogSort, QueryError } from "../components/research/CatalogFeedback";
import RecordMetadata from "../components/research/RecordMetadata";
import LoadingSpinner from "../components/LoadingSpinner";
import ResearchImage from "../components/ResearchImage";
import {
  PlusIcon,
  PackageIcon,
  EyeIcon,
  EditIcon,
  Trash2Icon,
} from "lucide-react";

const ProfilePage = () => {
  const navigate = useNavigate();
  const { userId } = useAuth();
  const location = useCatalogLocation({ mine: 1 });
  const query = useResearchRecords(location.params, !!userId);
  const records = query.data?.items || [];
  const deleteRecord = useDeleteRecord();

  const handleDelete = (id) => {
    if (confirm("Delete this record?")) {
      deleteRecord.mutate(id);
    }
  };

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
            {query.data?.total ?? "—"}
          </div>
        </div>
      </div>

      {/* Records */}
      <div className="flex flex-wrap items-center justify-between gap-3"><Link to="/collections" className="link text-sm">Manage collections</Link><CatalogSort params={location.params} update={location.update} /></div>
      {deleteRecord.isError ? <QueryError error={deleteRecord.error} /> : null}
      {location.dateError ? <div role="alert" className="alert alert-error">{location.dateError}<button className="btn btn-sm" onClick={location.clear}>Clear filters</button></div> : query.isPending ? <LoadingSpinner /> : query.isError ? <QueryError error={query.error} retry={() => query.refetch()} /> : records.length === 0 ? (
        <div className="card bg-base-300">
          <div className="card-body items-center text-center py-16">
            <PackageIcon className="size-16 text-base-content/20" />

            <h3 className="card-title text-base-content/50">
              {query.data.total > 0 ? "No records on this page" : "No records yet"}
            </h3>

            <p className="text-base-content/40 text-sm">
              {query.data.total > 0 ? "Use Previous below to return to your records." : "Start by creating your first record"}
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
                <ResearchImage record={record}
                  className="h-full min-h-32 w-full object-cover" />
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

                <RecordMetadata record={record} />

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

                  {userId && record.userId === userId ? <><button
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
                  </> : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {!location.dateError && !query.isError ? <CatalogPagination data={query.data} params={location.params} update={location.update} /> : null}
    </div>
  );
};

export default ProfilePage;
