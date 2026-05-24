import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Upload, Check } from 'lucide-react';
import { listSnapshotImages, uploadSnapshotImage } from '../api';

interface Props {
  snapshotId: number;
  onSelect: (path: string) => void;
  onClose: () => void;
}

function ImagePicker({ snapshotId, onSelect, onClose }: Props) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const { data: images, isLoading } = useQuery({
    queryKey: ['snapshot-images', snapshotId],
    queryFn: () => listSnapshotImages(snapshotId),
    enabled: !!snapshotId,
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadSnapshotImage(snapshotId, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['snapshot-images', snapshotId] });
      setUploadError(null);
    },
    onError: (err: any) => setUploadError(err.message ?? 'Errore nel caricamento'),
  });

  const imageUrl = (img: { filename: string; url?: string }) => img.url ?? `/images/${snapshotId}/${img.filename}`;

  const handleConfirm = () => {
    const img = images?.find(item => item.filename === selected);
    if (img) onSelect(imageUrl(img));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl border border-outline-variant/30 shadow-2xl w-full max-w-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-outline-variant/20">
          <h2 className="text-base font-semibold text-on-surface">Seleziona immagine</h2>
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
              multiple
              onChange={e => {
                const files = e.target.files;
                if (!files) return;
                Array.from(files).forEach(f => uploadMutation.mutate(f));
                if (fileRef.current) fileRef.current.value = '';
              }}
              className="hidden"
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploadMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-outline-variant/40 text-on-surface rounded-lg hover:bg-surface-container disabled:opacity-40 transition-colors"
            >
              <Upload size={14} />
              {uploadMutation.isPending ? 'Caricamento...' : 'Carica'}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-on-surface-variant hover:text-on-surface transition-colors rounded-lg hover:bg-surface-container"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Image grid */}
        <div className="p-4 min-h-[200px] max-h-[400px] overflow-y-auto">
          {uploadError && (
            <p className="text-xs text-error mb-3">{uploadError}</p>
          )}

          {isLoading && (
            <p className="text-sm text-on-surface-variant text-center py-8">Caricamento...</p>
          )}

          {!isLoading && (!images || images.length === 0) && (
            <div className="text-center py-10 text-on-surface-variant border-2 border-dashed border-outline-variant/30 rounded-xl">
              <p className="text-sm">Nessuna immagine</p>
              <p className="text-xs mt-1">Clicca "Carica" per aggiungerne una.</p>
            </div>
          )}

          {images && images.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {images.map(img => {
                const isSelected = selected === img.filename;
                return (
                  <button
                    key={img.filename}
                    onClick={() => setSelected(isSelected ? null : img.filename)}
                    className={`relative rounded-lg overflow-hidden border-2 transition-all aspect-square ${
                      isSelected
                        ? 'border-primary shadow-md'
                        : 'border-outline-variant/30 hover:border-outline-variant'
                    }`}
                    title={img.filename}
                  >
                    <img
                      src={imageUrl(img)}
                      alt={img.filename}
                      className="w-full h-full object-cover"
                    />
                    {isSelected && (
                      <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                        <div className="bg-primary text-on-primary rounded-full p-1">
                          <Check size={14} />
                        </div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {selected && (
          <div className="px-4 pb-2">
            <p className="text-xs text-on-surface-variant truncate">
              Percorso: <code className="text-on-surface">{imageUrl(images?.find(item => item.filename === selected) ?? { filename: selected })}</code>
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t border-outline-variant/20">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-outline-variant/40 text-on-surface rounded-lg hover:bg-surface-container transition-colors"
          >
            Annulla
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selected}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-on-primary rounded-lg hover:bg-primary/90 disabled:opacity-40 transition-colors"
          >
            <Check size={14} />
            Inserisci
          </button>
        </div>
      </div>
    </div>
  );
}

export default ImagePicker;
