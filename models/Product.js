const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please add a product name'],
    trim: true
  },
  description: {
    type: String,
    required: [true, 'Please add a description']
  },
  price: {
    type: Number,
    required: [true, 'Please add a price'],
    min: 0
  },
category: {
  type: String,
  required: [true, 'Please add a category'],
  enum: ['grains', 'spices', 'vegetables', 'meats', 'snacks', 'beverages', 'oils', 'flours', 'specialities', 'others']
},
  stock: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  images: [{
    url: String,
    publicId: String // For Supabase or other storage
  }],
  unit: {
    type: String,
    default: 'piece', // piece, kg, lb, bag, etc.
  },
  weight: {
    value: Number,
    unit: String // kg, lb, g, oz
  },
  brand: String,
  origin: String, // Country of origin
  inStock: {
    type: Boolean,
    default: true
  },
  featured: {
    type: Boolean,
    default: false
  },
  rating: {
    average: {
      type: Number,
      default: 0,
      min: 0,
      max: 5
    },
    count: {
      type: Number,
      default: 0
    }
  }
}, {
  timestamps: true
});

// Index for search optimization
productSchema.index({ name: 'text', description: 'text' });

module.exports = mongoose.model('Product', productSchema);