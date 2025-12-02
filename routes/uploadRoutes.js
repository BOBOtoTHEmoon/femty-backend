const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { protect, admin } = require('../middleware/auth');

// POST /api/upload - Upload image to Supabase
router.post('/', protect, admin, async (req, res) => {
  try {
    const { image } = req.body;

    if (!image) {
      return res.status(400).json({
        success: false,
        message: 'No image provided',
      });
    }

    // Extract base64 data and file type
    const matches = image.match(/^data:image\/(\w+);base64,(.+)$/);
    
    if (!matches) {
      return res.status(400).json({
        success: false,
        message: 'Invalid image format. Please upload a valid image.',
      });
    }

    const fileType = matches[1]; // png, jpg, jpeg, webp, etc.
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');

    // Generate unique filename
    const fileName = `product-${Date.now()}-${Math.random().toString(36).substring(7)}.${fileType}`;

    // Upload to Supabase Storage (bucket: product-images)
    const { data, error } = await supabase.storage
      .from('product-images')
      .upload(fileName, buffer, {
        contentType: `image/${fileType}`,
        upsert: false,
      });

    if (error) {
      console.error('Supabase upload error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to upload image',
        error: error.message,
      });
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('product-images')
      .getPublicUrl(fileName);

    res.status(200).json({
      success: true,
      message: 'Image uploaded successfully',
      data: {
        url: urlData.publicUrl,
        publicId: fileName,
      },
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Error uploading image',
      error: error.message,
    });
  }
});

// DELETE /api/upload - Delete image from Supabase
router.delete('/', protect, admin, async (req, res) => {
  try {
    const { publicId } = req.body;

    if (!publicId) {
      return res.status(400).json({
        success: false,
        message: 'No publicId provided',
      });
    }

    const { error } = await supabase.storage
      .from('product-images')
      .remove([publicId]);

    if (error) {
      console.error('Supabase delete error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to delete image',
        error: error.message,
      });
    }

    res.status(200).json({
      success: true,
      message: 'Image deleted successfully',
    });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting image',
      error: error.message,
    });
  }
});

module.exports = router;