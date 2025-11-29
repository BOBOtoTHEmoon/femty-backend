const express = require('express');
const router = express.Router();
const {
  createOrder,
  getMyOrders,
  getOrderById,
  getAllOrders,
  updateOrderStatus,
  updateOrderToPaid
} = require('../controllers/orderController');
const { protect, admin } = require('../middleware/auth');

// All routes are protected (need login)
router.post('/', protect, createOrder);
router.get('/myorders', protect, getMyOrders);
router.get('/:id', protect, getOrderById);

// Admin routes
router.get('/', protect, admin, getAllOrders);
router.put('/:id/status', protect, admin, updateOrderStatus);

// Payment update (can be user or payment webhook)
router.put('/:id/pay', protect, updateOrderToPaid);

module.exports = router;