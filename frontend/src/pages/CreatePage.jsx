
import React, { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useCreateRecord } from "../../hooks/useRecords";
import {
  useObjectTypes,
  useCreateObjectType,
} from "../../hooks/useObjectTypes";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BookOpenIcon,
  CheckCircle2Icon,
  FileSpreadsheetIcon,
  FileTextIcon,
  ImagePlusIcon,
  InfoIcon,
  LayersIcon,
  SparklesIcon,
  UploadCloudIcon,
} from "lucide-react";
import { useUser } from "@clerk/react";
import { recordFields } from "../components/recordFields";
import { importRecords as importRecordsApi } from "../../lib/api";
import { useMutation } from "@tanstack/react-query";

// Object Type Autocomplete
function ObjectTypeInput({
  value,
  objectTypes,
  loading,
  createObjectType,
  onChange,
}) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  const selectedType = objectTypes.find(
    (objectType) => objectType.id === value
  );

  const filteredTypes = objectTypes.filter((objectType) =>
    objectType.name.toLowerCase().includes(query.toLowerCase())
  );

  const handleSelect = (objectType) => {
    onChange(objectType.id);
    setQuery("");
    setIsOpen(false);
  };

  const handleCreate = async () => {
    const name = query.trim();

    if (!name) return;

    try {
      const newObjectType =
        await createObjectType.mutateAsync(name);

      onChange(newObjectType.id);
      setQuery("");
      setIsOpen(false);
    } catch (error) {
      console.error("Error creating object type:", error);
    }
  };

  return (
    <div className="relative">
      <input
        type="text"
        className="input input-bordered w-full bg-base-100"
        value={selectedType ? selectedType.name : query}
        placeholder={
          loading
            ? "Loading object types..."
            : "Search or enter object type..."
        }
        disabled={loading || createObjectType.isPending}
        onChange={(e) => {
          setQuery(e.target.value);
          onChange("");
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => {
          setTimeout(() => setIsOpen(false), 150);
        }}
      />

      {isOpen && query.trim() && (
        <div className="absolute z-50 mt-1 w-full rounded-box border border-base-300 bg-base-200 shadow-lg overflow-hidden">

          {filteredTypes.length > 0 && (
            <div className="max-h-48 overflow-y-auto">
              {filteredTypes.map((objectType) => (
                <button
                  type="button"
                  key={objectType.id}
                  className="block w-full px-4 py-3 text-left hover:bg-base-300"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelect(objectType)}
                >
                  {objectType.name}
                </button>
              ))}
            </div>
          )}

          <div className="border-t border-base-300 p-2">
            <button
              type="button"
              className="btn btn-sm btn-primary w-full"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleCreate}
              disabled={createObjectType.isPending}
            >
              {createObjectType.isPending
                ? "Creating..."
                : `+ Create "${query.trim()}"`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Create Page
function CreatePage() {
  const { user } = useUser();
  const navigate = useNavigate();

  const createRecord = useCreateRecord();

  const importRecords = useMutation({
    mutationFn: async ({ file }) => {
      return await importRecordsApi(file);
    },
  });

  // Selected contribution method
  const [selectedMethod, setSelectedMethod] = useState("manual");

  // Form state
  const [formData, setFormData] = useState(
    Object.fromEntries(
      recordFields.map(({ key, type }) => [
        key,
        type === "checkbox" ? false : "",
      ])
    )
  );

  const {
    data: objectTypes = [],
    isLoading: objectTypesLoading,
  } = useObjectTypes();

  const createObjectType = useCreateObjectType();

  const [file, setFile] = useState(null);

  // Conditional field visibility
  const shouldShowField = (field) => {
    if (!field.condition) {
      return true;
    }

    return (
      formData[field.condition.field] === field.condition.value
    );
  };

  // Update form fields
  const updateField = (key, value) => {
    setFormData((previous) => ({
      ...previous,
      [key]: value,
    }));
  };

  // Create individual record
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!user) {
      console.error("User not loaded");
      return;
    }

    try {
      await createRecord.mutateAsync({
        ...formData,
        userId: user.id,
      });

      navigate("/");
    } catch (error) {
      console.error("Error creating record:", error);
    }
  };

  // Import spreadsheet
  const handleImport = async (e) => {
    e.preventDefault();

    if (!user || !file) {
      return;
    }

    try {
      await importRecords.mutateAsync({
        file,
        userId: user.id,
      });

      navigate("/");
    } catch (error) {
      console.error("Error importing records:", error);
    }
  };

  const visibleFields = recordFields.filter(shouldShowField);

  return (
    <div className="max-w-6xl mx-auto space-y-7 pb-10">

      {/* Back Navigation */}
      <Link
        to="/"
        className="btn btn-ghost btn-sm gap-2"
      >
        <ArrowLeftIcon className="size-4" />
        Back to Collection
      </Link>

      {/* Page Introduction */}
      <section className="relative overflow-hidden rounded-2xl bg-base-300">
        <div className="absolute -right-20 -top-24 size-80 rounded-full bg-primary/10 blur-3xl" />

        <div className="relative grid grid-cols-1 md:grid-cols-5 gap-6 items-center p-6 sm:p-9">

          <div className="md:col-span-3">
            <span className="badge badge-primary badge-outline gap-2 mb-4">
              <SparklesIcon className="size-4" />
              Contribute to Handheld Words
            </span>

            <h1 className="text-3xl sm:text-4xl font-bold leading-tight">
              Every artifact has a story.
              <span className="text-primary block">
                Help us document it.
              </span>
            </h1>

            <p className="text-base-content/70 mt-4 max-w-2xl leading-relaxed">
              Add an artifact to the Handheld Words collection.
              Document its inscriptions, historical details,
              materials, and other identifying information to
              help preserve knowledge for others.
            </p>

            <div className="flex flex-wrap gap-3 mt-6">
              <div className="flex items-center gap-2 text-sm text-base-content/70">
                <CheckCircle2Icon className="size-4 text-primary" />
                Document artifacts
              </div>

              <div className="flex items-center gap-2 text-sm text-base-content/70">
                <CheckCircle2Icon className="size-4 text-primary" />
                Share research
              </div>
            </div>
          </div>

          <div className="md:col-span-2">
            <div className="rounded-xl bg-base-100/70 p-5 sm:p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary/10 text-primary p-3">
                  <BookOpenIcon className="size-6" />
                </div>

                <div>
                  <p className="font-bold">
                    Build the collection
                  </p>
                  <p className="text-xs text-base-content/60">
                    Your knowledge makes a difference.
                  </p>
                </div>
              </div>

              <div className="divider my-1" />

              <div className="space-y-3 text-sm">
                <div className="flex gap-3 items-start">
                  <ImagePlusIcon className="size-5 text-primary shrink-0" />
                  <span className="text-base-content/70">
                    Add images and identifying information.
                  </span>
                </div>

                <div className="flex gap-3 items-start">
                  <FileTextIcon className="size-5 text-primary shrink-0" />
                  <span className="text-base-content/70">
                    Record inscriptions and historical details.
                  </span>
                </div>

                <div className="flex gap-3 items-start">
                  <LayersIcon className="size-5 text-primary shrink-0" />
                  <span className="text-base-content/70">
                    Organize information for future discovery.
                  </span>
                </div>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* Contribution Method Selector */}
      <section className="space-y-3">

        <div>
          <h2 className="text-xl font-bold">
            How would you like to contribute?
          </h2>

          <p className="text-sm text-base-content/60 mt-1">
            Choose how you want to add artifacts to the collection.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

          {/* Manual Entry Option */}
          <button
            type="button"
            onClick={() => setSelectedMethod("manual")}
            aria-pressed={selectedMethod === "manual"}
            className={`card text-left transition-all border-2 ${
              selectedMethod === "manual"
                ? "border-primary bg-primary/10 shadow-md"
                : "border-base-300 bg-base-200 hover:border-primary/40"
            }`}
          >
            <div className="card-body flex-row items-center gap-4 p-5">

              <div
                className={`rounded-xl p-3 ${
                  selectedMethod === "manual"
                    ? "bg-primary text-primary-content"
                    : "bg-primary/10 text-primary"
                }`}
              >
                <FileTextIcon className="size-7" />
              </div>

              <div className="flex-1">
                <h3 className="font-bold">
                  Manual Entry
                </h3>

                <p className="text-sm text-base-content/60">
                  Create an individual artifact record.
                </p>
              </div>

              {selectedMethod === "manual" && (
                <CheckCircle2Icon className="size-5 text-primary" />
              )}

            </div>
          </button>

          {/* Spreadsheet Option */}
          <button
            type="button"
            onClick={() => setSelectedMethod("spreadsheet")}
            aria-pressed={selectedMethod === "spreadsheet"}
            className={`card text-left transition-all border-2 ${
              selectedMethod === "spreadsheet"
                ? "border-primary bg-primary/10 shadow-md"
                : "border-base-300 bg-base-200 hover:border-primary/40"
            }`}
          >
            <div className="card-body flex-row items-center gap-4 p-5">

              <div
                className={`rounded-xl p-3 ${
                  selectedMethod === "spreadsheet"
                    ? "bg-primary text-primary-content"
                    : "bg-primary/10 text-primary"
                }`}
              >
                <FileSpreadsheetIcon className="size-7" />
              </div>

              <div className="flex-1">
                <h3 className="font-bold">
                  CSV / Spreadsheet
                </h3>

                <p className="text-sm text-base-content/60">
                  Import multiple records from a file.
                </p>
              </div>

              {selectedMethod === "spreadsheet" && (
                <CheckCircle2Icon className="size-5 text-primary" />
              )}

            </div>
          </button>

        </div>
      </section>

      {/* Manual Record Form */}
      {selectedMethod === "manual" && (
        <section className="card bg-base-200 shadow-sm">
          <div className="card-body p-5 sm:p-8">

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
              <div>
                <div className="flex items-center gap-2">
                  <FileTextIcon className="size-5 text-primary" />

                  <h2 className="text-xl sm:text-2xl font-bold">
                    Create a New Record
                  </h2>
                </div>

                <p className="text-sm text-base-content/60 mt-2">
                  Enter the available information about your artifact.
                </p>
              </div>

              <span className="badge badge-outline">
                Manual Entry
              </span>
            </div>

            <div className="flex items-start gap-2 rounded-lg bg-base-300 p-3 text-sm text-base-content/70">
              <InfoIcon className="size-4 shrink-0 mt-0.5 text-primary" />

              <span>
                Fields marked with{" "}
                <span className="text-error font-bold">*</span>
                {" "}are required. Complete additional fields whenever
                information is available.
              </span>
            </div>

            <form
              onSubmit={handleSubmit}
              className="space-y-6 mt-5"
            >

              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-5">

                {visibleFields.map(
                  ({
                    key,
                    label,
                    type,
                    required,
                    options,
                    placeholder,
                  }) => (
                    <div
                      key={key}
                      className={`form-control ${
                        type === "textarea" ? "md:col-span-2" : ""
                      }`}
                    >

                      {type !== "checkbox" && (
                        <label className="label">
                          <span className="label-text font-medium">
                            {label}

                            {required && (
                              <span
                                className="text-error ml-1"
                                aria-hidden="true"
                              >
                                *
                              </span>
                            )}

                            {!required && (
                              <span className="text-base-content/50 ml-1 text-xs">
                                (optional)
                              </span>
                            )}
                          </span>
                        </label>
                      )}

                      {type === "object-type" ? (
                        <ObjectTypeInput
                          value={formData[key]}
                          objectTypes={objectTypes}
                          loading={objectTypesLoading}
                          createObjectType={createObjectType}
                          onChange={(value) =>
                            updateField(key, value)
                          }
                        />
                      ) : type === "select" ? (
                        <select
                          className="select select-bordered w-full bg-base-100"
                          value={formData[key] || ""}
                          onChange={(e) =>
                            updateField(key, e.target.value)
                          }
                          required={required}
                        >
                          <option value="">Select...</option>

                          {options?.map((option) => (
                            <option
                              key={option.value}
                              value={option.value}
                            >
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : type === "textarea" ? (
                        <textarea
                          className="textarea textarea-bordered w-full min-h-28 bg-base-100"
                          value={formData[key] || ""}
                          placeholder={placeholder}
                          onChange={(e) =>
                            updateField(key, e.target.value)
                          }
                          required={required}
                        />
                      ) : type === "checkbox" ? (
                        <label className="flex items-center gap-3 rounded-lg bg-base-100 border border-base-300 p-3 cursor-pointer">
                          <input
                            type="checkbox"
                            className="checkbox checkbox-primary"
                            checked={!!formData[key]}
                            onChange={(e) =>
                              updateField(key, e.target.checked)
                            }
                            required={required}
                          />

                          <span className="text-sm">
                            {label}

                            {required && (
                              <span className="text-error ml-1">
                                *
                              </span>
                            )}
                          </span>
                        </label>
                      ) : (
                        <input
                          type={type}
                          className="input input-bordered w-full bg-base-100"
                          value={formData[key] || ""}
                          placeholder={placeholder}
                          onChange={(e) =>
                            updateField(key, e.target.value)
                          }
                          required={required}
                        />
                      )}

                    </div>
                  )
                )}

              </div>

              <div className="border-t border-base-300 pt-5">

                <button
                  type="submit"
                  className="btn btn-primary w-full sm:w-auto sm:min-w-56 gap-2"
                  disabled={createRecord.isPending}
                >
                  {createRecord.isPending ? (
                    <>
                      <span className="loading loading-spinner loading-sm" />
                      Creating Record...
                    </>
                  ) : (
                    <>
                      Create Record
                      <ArrowRightIcon className="size-4" />
                    </>
                  )}
                </button>

                {createRecord.isError && (
                  <p
                    className="text-error text-sm mt-3"
                    role="alert"
                  >
                    Unable to create your record. Please check your
                    information and try again.
                  </p>
                )}

              </div>
            </form>
          </div>
        </section>
      )}

      {/* Spreadsheet Import */}
      {selectedMethod === "spreadsheet" && (
        <section className="card bg-base-300 shadow-sm">
          <div className="card-body p-5 sm:p-8">

            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-primary/10 text-primary p-3">
                <FileSpreadsheetIcon className="size-6" />
              </div>

              <div>
                <h2 className="text-xl sm:text-2xl font-bold">
                  Import Multiple Records
                </h2>

                <p className="text-sm text-base-content/60 mt-1">
                  Add multiple artifacts using a spreadsheet.
                </p>
              </div>
            </div>

            <div className="rounded-lg bg-base-200 p-4 mt-3">
              <div className="flex gap-3 items-start">
                <InfoIcon className="size-5 text-primary shrink-0 mt-0.5" />

                <div className="text-sm text-base-content/70">
                  Upload a supported spreadsheet containing
                  artifact records. Make sure your file follows
                  the expected import format.
                </div>
              </div>
            </div>

            <form
              onSubmit={handleImport}
              className="space-y-4 mt-3"
            >

              <label className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-base-content/20 bg-base-200 hover:border-primary/50 transition-colors p-7 text-center cursor-pointer">

                <div className="rounded-full bg-primary/10 text-primary p-4">
                  <UploadCloudIcon className="size-8" />
                </div>

                <div>
                  <p className="font-semibold">
                    {file
                      ? file.name
                      : "Choose a spreadsheet"}
                  </p>

                  <p className="text-xs text-base-content/60 mt-1">
                    {file
                      ? `${(file.size / 1024).toFixed(1)} KB`
                      : "CSV, XLS, or XLSX files"}
                  </p>
                </div>

                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) =>
                    setFile(e.target.files?.[0] || null)
                  }
                />

              </label>

              {file && (
                <div className="flex items-center justify-between gap-3 rounded-lg bg-base-200 p-3">

                  <div className="flex items-center gap-2 min-w-0">
                    <FileSpreadsheetIcon className="size-5 text-primary shrink-0" />

                    <span className="text-sm truncate">
                      {file.name}
                    </span>
                  </div>

                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={() => setFile(null)}
                  >
                    Remove
                  </button>

                </div>
              )}

              <button
                type="submit"
                className="btn btn-primary w-full sm:w-auto sm:min-w-56 gap-2"
                disabled={!file || importRecords.isPending}
              >
                {importRecords.isPending ? (
                  <>
                    <span className="loading loading-spinner loading-sm" />
                    Importing Records...
                  </>
                ) : (
                  <>
                    Import Spreadsheet
                    <ArrowRightIcon className="size-4" />
                  </>
                )}
              </button>

              {importRecords.isError && (
                <p
                  className="text-error text-sm"
                  role="alert"
                >
                  Unable to import your spreadsheet. Please check
                  the file format and try again.
                </p>
              )}

            </form>
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="text-center border-t border-base-300 pt-5">
        <p className="text-sm text-base-content/60">
          Thank you for helping preserve historical knowledge.
        </p>

        <p className="text-xs text-base-content/40 mt-1">
          Handheld Words
        </p>
      </footer>

    </div>
  );
}

export default CreatePage;
