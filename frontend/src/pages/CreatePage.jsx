import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useCreateRecord, useImportRecords } from "../../hooks/useRecords";
import ArtifactForm from "../components/ArtifactForm";

export default function CreatePage() {
  const navigate = useNavigate();
  const create = useCreateRecord();
  const upload = useImportRecords();
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState("");
  return <div className="max-w-3xl mx-auto space-y-8">
    <Link to="/" className="link">Back to artifacts</Link>
    <section className="card bg-base-200">
      <div className="card-body p-5 sm:p-8">
        <h1 className="text-2xl font-semibold mb-4">Manually enter a new record</h1>
        <ArtifactForm pending={create.isPending} error={create.error} onSubmit={async values => {
          const saved = await create.mutateAsync(values);
          navigate(`/record/${saved.id}`);
        }} />
      </div>
    </section>
    <section className="card border border-base-300">
      <div className="card-body p-5 sm:p-8">
        <h2 className="text-xl font-semibold">Upload multiple records from spreadsheet</h2>
        <p className="text-sm">For a preview, literal inscription mappings, missing source facts and duplicate checks, use <Link to="/import" className="link">the staged import workflow</Link>.</p>
        <p className="text-sm text-base-content/70">Excel or CSV files, up to 4 MB. Spreadsheet import currently saves artifact metadata; add transcription text through the editor.</p>
        <form className="space-y-4 mt-3" onSubmit={async event => {
          event.preventDefault();
          if (!file) return;
          try { await upload.mutateAsync(file); navigate("/profile"); } catch { /* Preserve the selected file and show the mutation error. */ }
        }}>
          <label className="block" htmlFor="artifact-spreadsheet">Spreadsheet file</label>
          <input id="artifact-spreadsheet" type="file" accept=".xlsx,.xls,.csv" className="file-input file-input-bordered w-full" required onChange={event => {
            const selected = event.target.files[0];
            setFile(selected && selected.size <= 4 * 1024 * 1024 ? selected : null);
            setFileError(selected && selected.size > 4 * 1024 * 1024 ? "Choose a file smaller than 4 MB." : "");
          }} />
          <button type="submit" className="btn btn-primary" disabled={upload.isPending || !file}>{upload.isPending ? "Uploading..." : "Upload File"}</button>
          {(fileError || upload.error) && <p role="alert" className="text-error">{fileError || upload.error?.response?.data?.error || "Could not import this file. Try again."}</p>}
        </form>
      </div>
    </section>
  </div>;
}
