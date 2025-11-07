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
    setActionFeedback('Image selected - click "Use This Image" to confirm');
    setTimeout(() => setActionFeedback(null), 2000);
  };

  const handleConfirm = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    e?.preventDefault();

    console.log('Confirm clicked, selectedImagePath:', selectedImagePath);

    if (selectedImagePath) {
      // Format the output based on selected format
      let outputText = selectedImagePath;

      if (copyFormat === 'question_image') {
        outputText = `      "question_image": "${selectedImagePath}",`;
      } else if (copyFormat === 'option_image') {
        outputText = `      "image": "${selectedImagePath}",`;
      }

      setActionFeedback('✓ Image path copied!');
      onSelect(outputText);

      // Close after a short delay to show feedback
      setTimeout(() => {
        onClose();
      }, 500);
    } else {
      setActionFeedback('⚠ Please select an image first');
      setTimeout(() => setActionFeedback(null), 2000);
    }
  };

  const handleClear = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    e?.preventDefault();

    console.log('Clear clicked');
    setActionFeedback('✓ Image cleared');
    onSelect('');

    setTimeout(() => {
      onClose();
    }, 500);
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
          <h2 style={{ margin: 0 }}>Select Image for Quiz</h2>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
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

        {/* Action Feedback */}
        {actionFeedback && (
          <div
            style={{
              marginBottom: '16px',
              padding: '12px',
              backgroundColor: actionFeedback.includes('⚠') ? '#fff3cd' : '#d4edda',
              color: actionFeedback.includes('⚠') ? '#856404' : '#155724',
              border: `1px solid ${actionFeedback.includes('⚠') ? '#ffeeba' : '#c3e6cb'}`,
              borderRadius: '4px',
              fontSize: '14px',
              fontWeight: '500',
            }}
          >
            {actionFeedback}
          </div>
        )}

        {/* Copy Format Selection */}
        <div style={{ marginBottom: '20px', padding: '16px', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
          <h3 style={{ marginTop: 0, marginBottom: '12px', fontSize: '16px' }}>Copy Format</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              <input
                type="radio"
                name="copyFormat"
                value="path"
                checked={copyFormat === 'path'}
                onChange={(e) => setCopyFormat(e.target.value as any)}
                style={{ marginRight: '8px' }}
              />
              <span>
                <strong>Just path:</strong> <code style={{ fontSize: '12px', backgroundColor: '#fff', padding: '2px 4px', borderRadius: '2px' }}>/banks/question_bank/...</code>
              </span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              <input
                type="radio"
                name="copyFormat"
                value="question_image"
                checked={copyFormat === 'question_image'}
                onChange={(e) => setCopyFormat(e.target.value as any)}
                style={{ marginRight: '8px' }}
              />
              <span>
                <strong>Question image:</strong> <code style={{ fontSize: '12px', backgroundColor: '#fff', padding: '2px 4px', borderRadius: '2px' }}>"question_image": "/banks/...",</code>
              </span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              <input
                type="radio"
                name="copyFormat"
                value="option_image"
                checked={copyFormat === 'option_image'}
                onChange={(e) => setCopyFormat(e.target.value as any)}
                style={{ marginRight: '8px' }}
              />
              <span>
                <strong>Option image:</strong> <code style={{ fontSize: '12px', backgroundColor: '#fff', padding: '2px 4px', borderRadius: '2px' }}>"image": "/banks/...",</code>
              </span>
            </label>
          </div>
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
                padding: '10px 20px',
                backgroundColor: '#dc3545',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '500',
              }}
            >
              Remove Image
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            style={{
              padding: '10px 20px',
              backgroundColor: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedImagePath}
            style={{
              padding: '10px 20px',
              backgroundColor: selectedImagePath ? '#28a745' : '#ccc',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: selectedImagePath ? 'pointer' : 'not-allowed',
              fontSize: '14px',
              fontWeight: '500',
              opacity: selectedImagePath ? 1 : 0.6,
            }}
          >
            {selectedImagePath ? '✓ Use This Image' : 'Select an Image First'}
          </button>
        </div>
      </div>
    </div>
  );
};
