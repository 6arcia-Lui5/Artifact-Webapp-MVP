import React, { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { useCreateRecord } from '../../hooks/useRecords';
import { useObjectTypes, useCreateObjectType } from '../../hooks/useObjectTypes';
import { ArrowLeftIcon, FileTextIcon, SparklesIcon, TypeIcon } from 'lucide-react';
import { useUser } from '@clerk/react';
import { recordFields } from "../components/recordFields";
import { importRecords as importRecordsApi } from "../../lib/api";
import { useMutation } from "@tanstack/react-query";

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
    objectType.name
      .toLowerCase()
      .includes(query.toLowerCase())
  );

  const handleSelect = (objectType) => {
    // Store the UUID
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

      // Store the newly created UUID
      onChange(newObjectType.id);

      setQuery("");
      setIsOpen(false);
    } catch (error) {
      console.error(
        "Error creating object type:",
        error
      );
    }
  };

  return (
    <div className="relative">
      <input
        type="text"
        className="input input-bordered w-full bg-base-200"
        value={
          selectedType
            ? selectedType.name
            : query
        }
        placeholder={
          loading
            ? "Loading object types..."
            : "Search or enter object type..."
        }
        disabled={
          loading ||
          createObjectType.isPending
        }
        onChange={(e) => {
          setQuery(e.target.value);
          onChange("");
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
      />

      {isOpen && query && (
        <div className="absolute z-50 mt-1 w-full rounded-box border border-base-300 bg-base-200 shadow-lg">
          
          {filteredTypes.map((objectType) => (
            <button
              type="button"
              key={objectType.id}
              className="block w-full px-4 py-2 text-left hover:bg-base-300"
              onClick={() =>
                handleSelect(objectType)
              }
            >
              {objectType.name}
            </button>
          ))}

          <div className="border-t border-base-300 p-2">
            <button
              type="button"
              className="btn btn-sm btn-primary w-full"
              onClick={handleCreate}
              disabled={
                createObjectType.isPending
              }
            >
              {createObjectType.isPending
                ? "Creating..."
                : `+ Create "${query}"`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


function CreatePage() {
  const { user } = useUser();
  const navigate = useNavigate();
  const createRecord = useCreateRecord();
  const importRecords = useMutation({
    mutationFn: async ({ file }) => {
      return await importRecordsApi(file);
    },
  });
  const [formData, setFormData] = useState(
    Object.fromEntries(
      recordFields.map(({ key, type }) => [
        key,
        type === "checkbox" ? false : "",
      ])
    )
  );
  const { data: objectTypes = [], isLoading: objectTypesLoading } =
  useObjectTypes();

  const createObjectType = useCreateObjectType();




  const shouldShowField = (field) => {
  if (!field.condition) {
    return true;
  }

    return formData[field.condition.field] === field.condition.value;
  };


  const [file, setFile] = useState(null)

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
      console.log(formData)

      navigate("/");
    } catch (error) {
      console.error("Error creating record:", error);
    }
  };

  const handleImport = async (e) => {
    e.preventDefault();

    if(!user || !file) {
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
  
  return <div className='max-w-lg mx-auto'>
    <Link to="/" className='btn btn-ghost btn-sm gap-1 mb-4'>
      <ArrowLeftIcon className='size-4' /> Back
    </Link>

    <div className='card bg-base-300'>
      <div className='card-body'>
        <h1 className='card-title'>
          <SparklesIcon className='size-5 text-primary' />
          Manually enter a new record
        </h1>

        <p className="text-sm text-base-content/60">
          Fields marked with <span className="text-error">*</span> are required.
        </p>


        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          {recordFields
          .filter(shouldShowField)
          .map(({ key, label, type, required, options, placeholder }) => (
            <div key={key} className="form-control">
              <label className="label">
              <span className="label-text">
                {label}
                {required ? (
                  <span className="text-error ml-1" aria-hidden="true">
                    *
                  </span>
                ) : (
                  <span className="text-base-content/60 ml-1 text-sm">
                    (optional)
                  </span>
                )}
                </span>
              </label>


              {type === "object-type" ? (
              <ObjectTypeInput
                value={formData[key]}
                objectTypes={objectTypes}
                loading={objectTypesLoading}
                createObjectType={createObjectType}
                onChange={(value) =>
                  setFormData({
                    ...formData,
                    [key]: value,
                  })
                }
              />

              ) : type === "select" ? (
                <select
                  className="select select-bordered w-full bg-base-200"
                  value={formData[key] || ""}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      [key]: e.target.value,
                    })
                  }
                  required={required}
                >
                  <option value="">Select...</option>

                  {options?.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : type === "textarea" ? (
                <textarea
                  className="textarea textarea-bordered bg-base-200"
                  value={formData[key] || ""}
                  placeholder={placeholder}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      [key]: e.target.value,
                    })
                  }
                  required={required}
                />
              ) : type === "checkbox" ? (
                <input
                  type="checkbox"
                  className="checkbox checkbox-primary"
                  checked={!!formData[key]}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      [key]: e.target.checked,
                    })
                  }
                  required={required}
                />
              ) : (
                <input
                  type={type}
                  className="input input-bordered w-full bg-base-200"
                  value={formData[key] || ""}
                  placeholder={placeholder}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      [key]: e.target.value,
                    })
                  }
                  required={required}
                />
              )}
            </div>
          ))}


          <button type="submit" className="btn btn-primary w-full">
            Create Record
          </button>
        </form>
        <div className="px-10">
          <div className="flex items-center">
            {/* Left line */}
            <div className="flex-grow border-t border-gray-400"></div>

            {/* Text */}
            <span className="mx-4 text-gray-700 font-medium">OR</span>

            {/* Right line */}
            <div className="flex-grow border-t border-gray-400"></div>
          </div>
        </div>
        <h1 className='card-title'>
          <SparklesIcon className='size-5 text-primary' />
          Upload multiple records from spreadsheet
        </h1>
        <form onSubmit={handleImport} className='space-y-4'>
            <input
              type="file"
              accept='.xlsx, .xls, .csv'
              className="file-input file-input-bordered w-full bg-base-200"
              onChange={(e) => setFile(e.target.files[0])}
              required
            />
            <button
              type="submit"
              className='btn btn-primary w-full'
              disabled={importRecords.isPending}
            >
              {importRecords.isPending ? (
                <span className='loading loading-spinner' />
              ) : (
                "Upload File"
              )}
          </button>
        </form>
      </div>
    </div>
  </div>
};

export default CreatePage