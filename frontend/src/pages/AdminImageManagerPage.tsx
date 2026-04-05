import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchQuestionBankFiles } from '../api';
import { useLocation, useNavigate } from 'react-router-dom';
import { ImagePicker } from '../components/ImagePicker';
import AdminLayout from '../layouts/AdminLayout';

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
      <div className="p-5 text-center">
        <h2 className="text-on-surface font-body text-lg mb-2">Authentication Required</h2>
        <p className="text-on-surface-variant font-body mb-6">Please access this page through the admin interface</p>
        <button
          onClick={() => navigate('/admin')}
          className="px-5 py-2.5 bg-primary text-on-primary font-body font-medium rounded-lg hover:bg-primary/90 transition-colors cursor-pointer"
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
    <AdminLayout activePath="/admin/questions" adminPassword={adminPassword} pageTitle="Image Manager">
      <div className="mb-5 p-4 bg-surface-container border border-outline-variant/20 rounded-xl">
        <p className="m-0 text-on-surface-variant font-body text-sm">
          Select a quiz to manage its images. Images are stored in{' '}
          <code className="text-primary">/banks/question_bank/&#123;quiz_name&#125;_images/</code>
        </p>
      </div>

      {isLoading && (
        <div className="text-on-surface-variant font-body">Loading quiz files...</div>
      )}

      {!isLoading && quizFiles.length === 0 && (
        <div className="text-on-surface-variant text-center py-12 font-body">
          No quiz files found in the question bank
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {quizFiles.map((filename) => (
          <div
            key={filename}
            className="bg-surface-container border border-outline-variant/20 rounded-xl p-4 hover:bg-surface-container-high hover:border-primary/30 transition-all cursor-pointer"
          >
            <h3 className="mt-0 mb-2 text-on-surface font-body font-medium text-sm break-words">
              {filename}
            </h3>
            <button
              onClick={() => handleQuizSelect(filename)}
              className="w-full px-3 py-2 bg-primary text-on-primary font-body font-medium text-sm border-none rounded-lg cursor-pointer hover:bg-primary/90 transition-colors"
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

      {notification && (
        <div className="fixed bottom-5 right-5 bg-tertiary/15 border border-tertiary/30 text-tertiary px-6 py-4 rounded-xl shadow-[0_0_20px_rgba(194,255,153,0.15)] z-[2000]">
          <div className="flex items-center gap-3">
            <span className="text-lg">✓</span>
            <span className="break-all font-body">{notification}</span>
          </div>
        </div>
      )}
    </AdminLayout>
  );
};

export default AdminImageManagerPage;