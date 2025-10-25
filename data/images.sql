CREATE TABLE IF NOT EXISTS images (
    id SERIAL PRIMARY KEY,
    image_key TEXT NOT NULL UNIQUE, -- Or UUID UNIQUE
    mime_type TEXT NOT NULL, -- e.g., 'image/jpeg', 'image/png'
    image_data BYTEA NOT NULL, -- Stores the raw binary data of the image
    original_filename TEXT NULL, -- Optional: Store the original filename
    uploaded_at TIMESTAMP
    WITH
        TIME ZONE DEFAULT NOW ()
);

COMMENT ON TABLE images IS 'Stores image binary data and metadata.';

COMMENT ON COLUMN images.image_key IS 'Unique identifier for the image. It can be the relative path to the image file.';

COMMENT ON COLUMN images.mime_type IS 'The MIME type of the image (e.g., image/jpeg).';

COMMENT ON COLUMN images.image_data IS 'The raw binary data of the image file.';

COMMENT ON COLUMN images.original_filename IS 'The original filename during upload (optional).';

CREATE INDEX IF NOT EXISTS idx_images_image_key ON images (image_key);
