/**
 * @fileType component
 * @domain files
 * @pattern upload-zone
 * @ai-summary Drag-and-drop file upload zone with file picker support.
 *   Handles single and multiple file uploads via the GitHub Contents API.
 */
"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Upload, Loader2, File, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@kody-ade/base/ui/button";
import { Input } from "@kody-ade/base/ui/input";
import { cn } from "@kody-ade/base/utils/ui";
import { useFilesTransport } from "../lib/transport";
import {
  DEFAULT_FILE_UPLOAD_POLICY,
  type FileUploadPolicy,
  uploadInputAccept,
} from "../lib/file-upload-policy";
import { uploadRepositoryFiles } from "../lib/upload-repository-files";

interface UploadZoneProps {
  onUploadComplete?: (uploaded: {
    path: string;
    size: number;
    sha: string;
  }) => void;
  destinationDir?: string;
  workspaceRoot?: string;
  uploadPolicy?: FileUploadPolicy;
}

interface UploadingFile {
  file: File;
  progress: number;
  error?: string;
}

export function UploadZone({
  onUploadComplete,
  destinationDir = "",
  workspaceRoot = "",
  uploadPolicy = DEFAULT_FILE_UPLOAD_POLICY,
}: UploadZoneProps) {
  const transport = useFilesTransport();
  const [uploading, setUploading] = useState<UploadingFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [destination, setDestination] = useState(destinationDir);
  const [showDestinationInput, setShowDestinationInput] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDestination(destinationDir);
  }, [destinationDir]);

  const handleFiles = useCallback(
    async (files: FileList) => {
      if (!transport?.uploadFile) {
        toast.error("Uploads are not supported in this workspace");
        return;
      }

      const newUploading: UploadingFile[] = Array.from(files).map((file) => ({
        file,
        progress: 0,
      }));

      setUploading((prev) => [...prev, ...newUploading]);

      await uploadRepositoryFiles({
        files: newUploading.map(({ file }) => file),
        destinationDir: destination,
        workspaceRoot,
        policy: uploadPolicy,
        upload: async (path, file) => {
          const uploaded = await transport.uploadFile!(path, file);
          return { sha: uploaded?.version ?? "" };
        },
        onUploaded: ({ file, path, sha }) => {
          toast.success(`Uploaded ${file.name}`);
          setUploading((prev) =>
            prev.map((u) => (u.file === file ? { ...u, progress: 100 } : u)),
          );
          setTimeout(() => {
            setUploading((prev) => prev.filter((u) => u.file !== file));
          }, 1500);
          onUploadComplete?.({
            path,
            size: file.size,
            sha,
          });
        },
        onRejected: ({ file, path, error }) => {
          toast.error(`Failed to upload ${path}: ${error}`);
          setUploading((prev) =>
            prev.map((u) => (u.file === file ? { ...u, error } : u)),
          );
        },
      });
    },
    [transport, destination, onUploadComplete, uploadPolicy, workspaceRoot],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        handleFiles(files);
      }
    },
    [handleFiles],
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        handleFiles(files);
      }
      // Reset input
      e.target.value = "";
    },
    [handleFiles],
  );

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFolderUploadClick = () => {
    folderInputRef.current?.setAttribute("webkitdirectory", "");
    folderInputRef.current?.setAttribute("directory", "");
    folderInputRef.current?.click();
  };

  const hasActiveUploads = uploading.some((u) => u.progress < 100);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-4 border-b border-border px-4 py-2 shrink-0">
        <Upload className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm">Upload files</span>

        <Button
          variant="ghost"
          size="clear"
          onClick={() => setShowDestinationInput(!showDestinationInput)}
          className={cn(
            "text-xs font-normal px-2 py-1 rounded",
            "text-muted-foreground hover:bg-transparent hover:text-foreground",
          )}
        >
          {showDestinationInput ? "Hide" : "Set destination"}
        </Button>

        {hasActiveUploads && (
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground ml-auto" />
        )}
      </div>

      {showDestinationInput && (
        <div className="border-b border-border px-4 py-2">
          <Input
            type="text"
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
            placeholder="Destination directory (optional)"
            aria-label="Upload destination"
            className={cn(
              "h-auto w-full rounded border border-input bg-background px-3 py-1.5 text-sm",
              "text-foreground placeholder:text-muted-foreground",
            )}
          />
        </div>
      )}

      {/* Drop zone */}
      <div
        className={cn(
          "flex-1 min-h-0 flex flex-col items-center justify-center p-8 m-4",
          "border-2 border-dashed rounded-xl transition-colors",
          isDragging
            ? "border-emerald-500/50 bg-emerald-500/5"
            : "border-border hover:border-muted-foreground/40",
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <Upload
          className={cn(
            "w-10 h-10 mb-4",
            isDragging ? "text-emerald-400" : "text-muted-foreground",
          )}
        />
        <p className="mb-1 text-sm text-foreground">
          {isDragging ? "Drop files here" : "Drag and drop files here"}
        </p>
        <p className="mb-4 text-xs text-muted-foreground">or</p>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="clear"
            onClick={handleUploadClick}
            className={cn(
              "text-sm font-normal px-4 py-2 rounded",
              "bg-muted text-foreground hover:bg-muted/80",
            )}
          >
            Browse files
          </Button>
          <Button
            variant="secondary"
            size="clear"
            onClick={handleFolderUploadClick}
            className={cn(
              "text-sm font-normal px-4 py-2 rounded",
              "bg-muted text-foreground hover:bg-muted/80",
            )}
          >
            Browse folder
          </Button>
        </div>

        {/* eslint-disable-next-line react/forbid-elements -- hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={uploadInputAccept(uploadPolicy)}
          aria-label="Choose files to upload"
          className="hidden"
          onChange={handleFileInputChange}
        />
        {/* eslint-disable-next-line react/forbid-elements -- hidden file input */}
        <input
          ref={folderInputRef}
          type="file"
          multiple
          accept={uploadInputAccept(uploadPolicy)}
          aria-label="Choose folder to upload"
          className="hidden"
          onChange={handleFileInputChange}
        />
      </div>

      {/* Uploading files list */}
      {uploading.length > 0 && (
        <div className="max-h-40 shrink-0 overflow-y-auto border-t border-border">
          {uploading.map((uploadingFile, i) => (
            <div
              key={i}
              className="flex items-center gap-3 border-b border-border px-4 py-2"
            >
              <File className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="truncate text-xs text-foreground">
                  {uploadingFile.file.name}
                </div>
                {uploadingFile.error && (
                  <div className="flex items-center gap-1 text-xs text-red-400">
                    <AlertCircle className="w-3 h-3" />
                    {uploadingFile.error}
                  </div>
                )}
              </div>
              {uploadingFile.progress < 100 && !uploadingFile.error && (
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />
              )}
              {uploadingFile.progress === 100 && (
                <span className="text-xs text-emerald-400">Done</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
