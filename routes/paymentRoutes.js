const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { protect } = require('../middleware/auth');
const Order = require('../models/Order');

// POST /api/payments/create-checkout-session
// Creates a Stripe Checkout Session for the order
router.post('/create-checkout-session', protect, async (req, res) => {
  try {
    const { items, shippingAddress, orderId } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No items provided',
      });
    }

    // Create line items for Stripe
    const lineItems = items.map((item) => ({
      price_data: {
        currency: 'usd',
        product_data: {
          name: item.name,
          images: item.image ? [item.image] : [],
        },
        unit_amount: Math.round(item.price * 100), // Stripe uses cents
      },
      quantity: item.quantity,
    }));

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/cart`,
      metadata: {
        orderId: orderId || '',
        userId: req.user.id,
      },
      shipping_address_collection: {
        allowed_countries: ['US'],
      },
    });

    res.status(200).json({
      success: true,
      sessionId: session.id,
      url: session.url,
    });
  } catch (error) {
    console.error('Stripe session error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating payment session',
      error: error.message,
    });
  }
});

// POST /api/payments/create-payment-intent
// Alternative: Creates a Payment Intent for custom payment form
router.post('/create-payment-intent', protect, async (req, res) => {
  try {
    const { amount, orderId } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid amount',
      });
    }

    // Create Payment Intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency: 'usd',
      metadata: {
        orderId: orderId || '',
        userId: req.user.id,
      },
    });

    res.status(200).json({
      success: true,
      clientSecret: paymentIntent.client_secret,
    });
  } catch (error) {
    console.error('Payment intent error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating payment intent',
      error: error.message,
    });
  }
});

// POST /api/payments/verify-session
// Verify a completed checkout session
router.post('/verify-session', protect, async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID required',
      });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status === 'paid') {
      // Update order status if orderId exists
      if (session.metadata.orderId) {
        await Order.findByIdAndUpdate(session.metadata.orderId, {
          isPaid: true,
          paidAt: new Date(),
          paymentResult: {
            id: session.payment_intent,
            status: session.payment_status,
            email: session.customer_details?.email,
          },
        });
      }

      res.status(200).json({
        success: true,
        message: 'Payment verified',
        session: {
          id: session.id,
          paymentStatus: session.payment_status,
          customerEmail: session.customer_details?.email,
          amountTotal: session.amount_total / 100,
        },
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Payment not completed',
        paymentStatus: session.payment_status,
      });
    }
  } catch (error) {
    console.error('Verify session error:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying payment',
      error: error.message,
    });
  }
});

// POST /api/payments/webhook
// Stripe webhook for payment events (optional but recommended)
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      console.log('Payment successful for session:', session.id);
      
      // Update order if orderId in metadata
      if (session.metadata.orderId) {
        await Order.findByIdAndUpdate(session.metadata.orderId, {
          isPaid: true,
          paidAt: new Date(),
          paymentResult: {
            id: session.payment_intent,
            status: 'completed',
            email: session.customer_details?.email,
          },
        });
      }
      break;

    case 'payment_intent.payment_failed':
      const failedPayment = event.data.object;
      console.log('Payment failed:', failedPayment.id);
      break;

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
});

module.exports = router;