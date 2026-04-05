import React, { useState } from 'react';
import { uploadImage, listQuizImages, deleteImage } from '../api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

interface ImagePickerProps {
  quizFilename: string;
  password: string;
  onSelect: (imagePath: string) => void;
  onClose: () => void;
  currentImage?: string | null;
}

export const ImagePicker: React.FC<ImagePickerProps> = ({
  quizFilename,
  password,
  onSelect,
  onClose,
  currentImage,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedImagePath, setSelectedImagePath] = useState<string | null>(currentImage || null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [copyFormat, setCopyFormat] = useState<'path' | 'question_image' | 'option_image'>('path');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: images = [], isLoading, error } = useQuery({
    queryKey: ['quizImages', quizFilename],
    queryFn: () => listQuizImages(quizFilename, password),
    staleTime: 0,
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadImage(quizFilename, file, password),
    onSuccess: () => {
      setSelectedFile(null);
      setUploadError(null);
      queryClient.invalidateQueries({ queryKey: ['quizImages', quizFilename] });
    },
    onError: (error: any) => {
      setUploadError(error.message || 'Failed to upload image');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (imageFilename: string) => deleteImage(quizFilename, imageFilename, password),
    onSuccess: () => {
      setConfirmDelete(null);
      queryClient.invalidateQueries({ queryKey: ['quizImages', quizFilename] });
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        setUploadError('Please select an image file');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        setUploadError('Image size must be less than 5MB');
        return;
      }
      setSelectedFile(file);
      setUploadError(null);
    }
  };

  const handleUpload = () => {
    if (selectedFile) {
      uploadMutation.mutate(selectedFile);
    }
  };

  const handleSelectImage = (imagePath: string) => {
    setSelectedImagePath(imagePath);
    setActionFeedback('Image selected — click "Use This Image" to confirm');
    setTimeout(() => setActionFeedback(null), 2000);
  };

  const handleConfirm = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    e?.preventDefault();

    if (selectedImagePath) {
      let outputText = selectedImagePath;
      if (copyFormat === 'question_image') {
        outputText = `      "question_image": "${selectedImagePath}",`;
      } else if (copyFormat === 'option_image') {
        outputText = `      "image": "${selectedImagePath}",`;
      }
      setActionFeedback('✓ Image path copied!');
      onSelect(outputText);
      setTimeout(() => { onClose(); }, 500);
    } else {
      setActionFeedback('⚠ Please select an image first');
      setTimeout(() => setActionFeedback(null), 2000);
    }
  };

  const handleClear = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    setActionFeedback('✓ Image cleared');
    onSelect('');
    setTimeout(() => { onClose(); }, 500);
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000]"
      onClick={onClose}
    >
      <div
        className="bg-surface-container rounded-xl p-6 max-w-3xl w-[90%] max-h-[80vh] overflow-auto border border-outline-variant/20"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-headline font-semibold text-on-surface">Select Image for Quiz</h2>
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="text-on-surface-variant hover:text-on-surface text-2xl leading-none px-2"
          >
            ×
          </button>
        </div>

        {actionFeedback && (
          <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium border ${
            actionFeedback.includes('⚠')
              ? 'bg-secondary/10 border-secondary/20 text-secondary'
              : 'bg-tertiary/10 border-tertiary/20 text-tertiary'
          }`}>
            {actionFeedback}
          </div>
        )}

        <div className="mb-5 p-4 bg-surface-container-high rounded-lg border border-outline-variant/20">
          <h3 className="text-sm font-semibold text-on-surface mb-3">Copy Format</h3>
          <div className="flex flex-col gap-2">
            {(['path', 'question_image', 'option_image'] as const).map((fmt) => (
              <label key={fmt} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="copyFormat"
                  value={fmt}
                  checked={copyFormat === fmt}
                  onChange={(e) => setCopyFormat(e.target.value as any)}
                  className="accent-primary"
                />
                <span className="text-sm text-on-surface-variant">
                  {fmt === 'path' && <><strong className="text-on-surface">Just path:</strong> <code className="text-xs bg-surface-container-low px-1 py-0.5 rounded text-primary">/banks/question_bank/…</code></>}
                  {fmt === 'question_image' && <><strong className="text-on-surface">Question image:</strong> <code className="text-xs bg-surface-container-low px-1 py-0.5 rounded text-primary">"question_image": "/banks/…",</code></>}
                  {fmt === 'option_image' && <><strong className="text-on-surface">Option image:</strong> <code className="text-xs bg-surface-container-low px-1 py-0.5 rounded text-primary">"image": "/banks/…",</code></>}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="mb-6 p-4 bg-surface-container-high rounded-lg border border-outline-variant/20">
          <h3 className="text-sm font-semibold text-on-surface mb-3">Upload New Image</h3>
          <div className="flex gap-2 items-center flex-wrap">
            <input
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="text-sm text-on-surface-variant file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:bg-surface-container file:text-on-surface-variant hover:file:bg-surface-bright cursor-pointer"
            />
            <button
              onClick={handleUpload}
              disabled={!selectedFile || uploadMutation.isPending}
              className="px-4 py-1.5 bg-primary text-on-primary text-sm font-medium rounded hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploadMutation.isPending ? 'Uploading…' : 'Upload'}
            </button>
          </div>
          {selectedFile && (
            <div className="mt-2 text-xs text-on-surface-variant">
              Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
            </div>
          )}
          {uploadError && (
            <div className="mt-2 text-xs text-error">{uploadError}</div>
          )}
          {uploadMutation.isError && (
            <div className="mt-2 text-xs text-error">
              {(uploadMutation.error as any)?.message || 'Upload failed'}
            </div>
          )}
        </div>

        <div>
          <h3 className="text-sm font-semibold text-on-surface mb-3">Available Images</h3>
          {isLoading && <div className="text-sm text-on-surface-variant">Loading images…</div>}
          {error && <div className="text-sm text-error">Error loading images: {(error as any).message}</div>}
          {!isLoading && images.length === 0 && (
            <div className="text-sm text-on-surface-variant">No images uploaded yet</div>
          )}

          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4 mt-2">
            {images.map((image) => (
              <div
                key={image.filename}
                className={`rounded-lg p-2 cursor-pointer relative border-2 transition-colors ${
                  selectedImagePath === image.path
                    ? 'border-primary bg-primary/5'
                    : 'border-outline-variant/30 hover:border-outline-variant/60'
                }`}
                onClick={() => handleSelectImage(image.path)}
              >
                <img
                  src={image.path}
                  alt={image.filename}
                  className="w-full h-28 object-cover rounded"
                />
                <div className="mt-2 text-xs text-on-surface-variant break-words">
                  {image.filename}
                </div>
                <div className="text-xs text-on-surface-variant/60">
                  {(image.size / 1024).toFixed(1)} KB
                </div>

                {confirmDelete === image.filename ? (
                  <div
                    className="absolute inset-0 bg-surface-container-high/95 rounded-lg flex flex-col items-center justify-center gap-2 p-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="text-xs text-on-surface font-medium text-center">Delete?</span>
                    <div className="flex gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(image.filename); }}
                        disabled={deleteMutation.isPending}
                        className="px-2 py-1 text-xs bg-error/20 border border-error/30 text-error rounded hover:bg-error/30 disabled:opacity-50"
                      >
                        Yes
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setConfirmDelete(null); }}
                        className="px-2 py-1 text-xs bg-surface-container border border-outline-variant/30 text-on-surface-variant rounded hover:bg-surface-bright"
                      >
                        No
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmDelete(image.filename); }}
                    disabled={deleteMutation.isPending}
                    className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full bg-error/20 border border-error/30 text-error hover:bg-error/30 text-sm leading-none disabled:opacity-50"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 flex gap-2 justify-end flex-wrap">
          {currentImage && (
            <button
              onClick={handleClear}
              className="px-5 py-2 text-sm font-medium bg-error/20 border border-error/30 text-error rounded-lg hover:bg-error/30"
            >
              Remove Image
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="px-5 py-2 text-sm font-medium bg-surface-container-high border border-outline-variant/30 text-on-surface-variant rounded-lg hover:bg-surface-bright"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedImagePath}
            className="px-5 py-2 text-sm font-medium bg-tertiary text-on-tertiary rounded-lg hover:bg-tertiary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {selectedImagePath ? '✓ Use This Image' : 'Select an Image First'}
          </button>
        </div>
      </div>
    </div>
  );
};
