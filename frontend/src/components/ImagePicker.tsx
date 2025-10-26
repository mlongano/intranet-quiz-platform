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
  const queryClient = useQueryClient();

  // Fetch images for this quiz
  const { data: images = [], isLoading, error } = useQuery({
    queryKey: ['quizImages', quizFilename],
    queryFn: () => listQuizImages(quizFilename, password),
    staleTime: 0,
  });

  // Upload mutation
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

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (imageFilename: string) => deleteImage(quizFilename, imageFilename, password),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quizImages', quizFilename] });
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        setUploadError('Please select an image file');
        return;
      }
      // Validate file size (max 5MB)
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

  const handleDelete = (imageFilename: string) => {
    if (window.confirm(`Delete ${imageFilename}?`)) {
      deleteMutation.mutate(imageFilename);
    }
  };

  const handleSelectImage = (imagePath: string) => {
    setSelectedImagePath(imagePath);
  };

  const handleConfirm = () => {
    if (selectedImagePath) {
      onSelect(selectedImagePath);
    }
    onClose();
  };

  const handleClear = () => {
    onSelect('');
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: 'white',
          borderRadius: '8px',
          padding: '24px',
          maxWidth: '800px',
          maxHeight: '80vh',
          overflow: 'auto',
          width: '90%',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ margin: 0 }}>Select Image</h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '24px',
              cursor: 'pointer',
              padding: '0 8px',
            }}
          >
            ×
          </button>
        </div>

        {/* Upload Section */}
        <div style={{ marginBottom: '24px', padding: '16px', backgroundColor: '#f5f5f5', borderRadius: '4px' }}>
          <h3 style={{ marginTop: 0 }}>Upload New Image</h3>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input type="file" accept="image/*" onChange={handleFileSelect} />
            <button
              onClick={handleUpload}
              disabled={!selectedFile || uploadMutation.isPending}
              style={{
                padding: '8px 16px',
                backgroundColor: selectedFile ? '#007bff' : '#ccc',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: selectedFile ? 'pointer' : 'not-allowed',
              }}
            >
              {uploadMutation.isPending ? 'Uploading...' : 'Upload'}
            </button>
          </div>
          {selectedFile && (
            <div style={{ marginTop: '8px', fontSize: '14px', color: '#666' }}>
              Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
            </div>
          )}
          {uploadError && (
            <div style={{ marginTop: '8px', color: '#dc3545', fontSize: '14px' }}>{uploadError}</div>
          )}
          {uploadMutation.isError && (
            <div style={{ marginTop: '8px', color: '#dc3545', fontSize: '14px' }}>
              {(uploadMutation.error as any)?.message || 'Upload failed'}
            </div>
          )}
        </div>

        {/* Image Gallery */}
        <div>
          <h3>Available Images</h3>
          {isLoading && <div>Loading images...</div>}
          {error && <div style={{ color: '#dc3545' }}>Error loading images: {(error as any).message}</div>}
          {!isLoading && images.length === 0 && <div style={{ color: '#666' }}>No images uploaded yet</div>}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
              gap: '16px',
              marginTop: '16px',
            }}
          >
            {images.map((image) => (
              <div
                key={image.filename}
                style={{
                  border: selectedImagePath === image.path ? '3px solid #007bff' : '1px solid #ddd',
                  borderRadius: '4px',
                  padding: '8px',
                  cursor: 'pointer',
                  position: 'relative',
                }}
                onClick={() => handleSelectImage(image.path)}
              >
                <img
                  src={image.path}
                  alt={image.filename}
                  style={{
                    width: '100%',
                    height: '120px',
                    objectFit: 'cover',
                    borderRadius: '4px',
                  }}
                />
                <div
                  style={{
                    marginTop: '8px',
                    fontSize: '12px',
                    wordBreak: 'break-word',
                    color: '#666',
                  }}
                >
                  {image.filename}
                </div>
                <div style={{ fontSize: '11px', color: '#999' }}>
                  {(image.size / 1024).toFixed(1)} KB
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(image.filename);
                  }}
                  disabled={deleteMutation.isPending}
                  style={{
                    position: 'absolute',
                    top: '12px',
                    right: '12px',
                    backgroundColor: '#dc3545',
                    color: 'white',
                    border: 'none',
                    borderRadius: '50%',
                    width: '24px',
                    height: '24px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ marginTop: '24px', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          {currentImage && (
            <button
              onClick={handleClear}
              style={{
                padding: '8px 16px',
                backgroundColor: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Clear Image
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              backgroundColor: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedImagePath}
            style={{
              padding: '8px 16px',
              backgroundColor: selectedImagePath ? '#28a745' : '#ccc',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: selectedImagePath ? 'pointer' : 'not-allowed',
            }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
};
