import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchQuestionBankFiles } from '../api';
import { useLocation, useNavigate } from 'react-router-dom';
import { ImagePicker } from '../components/ImagePicker';

const AdminImageManagerPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const adminPassword = location.state?.adminPassword;

  const [selectedQuizFile, setSelectedQuizFile] = useState<string>('');
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  // Fetch available quiz files
  const { data: quizFilesData, isLoading } = useQuery({
    queryKey: ['questionBankFiles', adminPassword],
    queryFn: () => fetchQuestionBankFiles(adminPassword || ''),
    enabled: !!adminPassword,
  });

  const quizFiles = quizFilesData?.files || [];

  const showNotification = (message: string) => {
    setNotification(message);
    setTimeout(() => setNotification(null), 3000);
  };

  const copyToClipboard = async (text: string) => {
    try {
      // First try the modern Clipboard API
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      } else {
        // Fallback for older browsers or non-HTTPS contexts
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);

        return successful;
      }
    } catch (error) {
      console.error('Copy failed:', error);
      return false;
    }
  };

  if (!adminPassword) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <h2>Authentication Required</h2>
        <p>Please access this page through the admin interface</p>
        <button
          onClick={() => navigate('/admin')}
          style={{
            padding: '10px 20px',
            fontSize: '16px',
            cursor: 'pointer',
            backgroundColor: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
          }}
        >
          Go to Admin
        </button>
      </div>
    );
  }

  const handleQuizSelect = (filename: string) => {
    setSelectedQuizFile(filename);
    setShowImagePicker(true);
  };

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Image Manager</h1>
        <button
          onClick={() => navigate('/admin/dashboard', { state: { adminPassword } })}
          style={{
            padding: '10px 20px',
            backgroundColor: '#6c757d',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Back to Admin
        </button>
      </div>

      <div style={{ marginBottom: '20px', padding: '16px', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
        <p style={{ margin: 0, color: '#666' }}>
          Select a quiz to manage its images. Images are stored in{' '}
          <code>/banks/question_bank/&#123;quiz_name&#125;_images/</code>
        </p>
      </div>

      {isLoading && <div>Loading quiz files...</div>}

      {!isLoading && quizFiles.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
          No quiz files found in the question bank
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: '16px',
        }}
      >
        {quizFiles.map((filename) => (
          <div
            key={filename}
            style={{
              border: '1px solid #ddd',
              borderRadius: '8px',
              padding: '16px',
              backgroundColor: 'white',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: '8px', fontSize: '16px', wordBreak: 'break-word' }}>
              {filename}
            </h3>
            <button
              onClick={() => handleQuizSelect(filename)}
              style={{
                width: '100%',
                padding: '8px',
                backgroundColor: '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Manage Images
            </button>
          </div>
        ))}
      </div>

      {showImagePicker && selectedQuizFile && (
        <ImagePicker
          quizFilename={selectedQuizFile}
          password={adminPassword}
          onSelect={async (imagePath) => {
            const success = await copyToClipboard(imagePath);
            if (success) {
              showNotification(`✓ Image path copied: ${imagePath}`);
            } else {
              showNotification(`⚠ Could not copy. Path: ${imagePath}`);
            }
          }}
          onClose={() => {
            setShowImagePicker(false);
            setSelectedQuizFile('');
          }}
        />
      )}

      {/* Notification Toast */}
      {notification && (
        <div
          style={{
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            backgroundColor: '#28a745',
            color: 'white',
            padding: '16px 24px',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            zIndex: 2000,
            maxWidth: '400px',
            animation: 'slideIn 0.3s ease-out',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '20px' }}>✓</span>
            <span style={{ wordBreak: 'break-all' }}>{notification}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminImageManagerPage;
