import { Link, useNavigate, useParams } from "react-router";
import { useAuth } from "@clerk/react";
import { useRecord, useUpdateRecord } from "../../hooks/useRecords";
import ArtifactForm from "../components/ArtifactForm";
import LoadingSpinner from "../components/LoadingSpinner";

export default function EditRecordPage() {
  const { id } = useParams();
  const { userId } = useAuth();
  const navigate = useNavigate();
  const record = useRecord(id);
  const save = useUpdateRecord(id);
  if (id && record.isLoading) return <LoadingSpinner />;
  if (!record.data || record.isError) return <div role="alert" className="max-w-lg mx-auto space-y-4">
    <h1 className="text-2xl font-semibold">{id ? "Could not load this artifact" : "Choose an artifact to edit"}</h1>
    <p>{id ? "The artifact may be unavailable. Retry or return to your records." : "Open one of your records, then choose Edit."}</p>
    {id && <button className="btn btn-outline" onClick={() => record.refetch()}>Try again</button>}
    <Link className="btn btn-primary" to="/profile">My records</Link>
  </div>;
  if (record.data.userId !== userId) return <div className="max-w-lg mx-auto space-y-4">
    <h1 className="text-2xl font-semibold">Only the creator can edit this artifact</h1>
    <p>You can view this record, but changes must be made by its creator.</p>
    <Link className="btn btn-primary" to={`/record/${id}`}>View artifact</Link>
  </div>;
  return <div className="max-w-3xl mx-auto space-y-5">
    <Link to={`/record/${id}`} className="link">Back to artifact</Link>
    <section className="card bg-base-200"><div className="card-body p-5 sm:p-8">
      <h1 className="text-2xl font-semibold mb-4">Edit artifact</h1>
      <ArtifactForm key={record.data.id} record={record.data} submitLabel="Save changes" cancelTo={`/record/${id}`}
        pending={save.isPending} error={save.error} onSubmit={async values => {
          await save.mutateAsync(values);
          navigate(`/record/${id}`);
        }} />
    </div></section>
  </div>;
}
