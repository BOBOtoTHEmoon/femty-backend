const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Resend } = require('resend');
const { protect } = require('../middleware/auth');
const Order = require('../models/Order');
const User = require('../models/User');

// Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY);

// POST /api/payments/create-checkout-session
router.post('/create-checkout-session', protect, async (req, res) => {
  try {
    const { items, shippingAddress, deliveryFee = 5 } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No items provided',
      });
    }

    // Create line items for Stripe (products)
    const lineItems = items.map((item) => ({
      price_data: {
        currency: 'usd',
        product_data: {
          name: item.name,
          images: item.image && item.image.startsWith('http') ? [item.image] : [],
        },
        unit_amount: Math.round(item.price * 100), // Stripe uses cents
      },
      quantity: item.quantity,
    }));

    // Add delivery fee as a line item
    if (deliveryFee > 0) {
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Delivery Fee',
          },
          unit_amount: Math.round(deliveryFee * 100),
        },
        quantity: 1,
      });
    }

    // Calculate totals for order
    const itemsTotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const totalAmount = itemsTotal + deliveryFee;

    // Create order in database first - matching Order model schema exactly
    const order = await Order.create({
      user: req.user.id,
      orderItems: items.map(item => ({
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        image: item.image || '',
        // product field is optional now
      })),
      shippingAddress: {
        street: shippingAddress?.address || shippingAddress?.street || 'Not provided',
        city: shippingAddress?.city || shippingAddress?.state || 'Not provided',
        state: shippingAddress?.state || 'Not provided',
        zipCode: shippingAddress?.zipCode || '00000',
        country: shippingAddress?.country || 'USA'
      },
      paymentMethod: 'stripe',
      itemsPrice: itemsTotal,
      shippingPrice: deliveryFee,
      taxPrice: 0,
      totalPrice: totalAmount,
      status: 'pending'
    });

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/cart`,
      customer_email: req.user.email,
      metadata: {
        orderId: order._id.toString(),
        userId: req.user.id,
      },
    });

    // Update order with Stripe session ID
    order.stripeSessionId = session.id;
    await order.save();

    res.status(200).json({
      success: true,
      sessionId: session.id,
      url: session.url,
      orderId: order._id,
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

// POST /api/payments/verify-session
router.post('/verify-session', protect, async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID required',
      });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['line_items']
    });

    if (session.payment_status === 'paid') {
      // Find and update order
      let order = null;
      if (session.metadata.orderId) {
        order = await Order.findByIdAndUpdate(
          session.metadata.orderId,
          {
            isPaid: true,
            paidAt: new Date(),
            status: 'processing',
            paymentResult: {
              id: session.payment_intent,
              status: session.payment_status,
              email_address: session.customer_details?.email,
            },
          },
          { new: true }
        );
      }

      // Get user details
      const user = await User.findById(session.metadata.userId);

      // Send confirmation email
      if (user && order && process.env.RESEND_API_KEY) {
        try {
          await sendOrderConfirmationEmail(user, order, session);
        } catch (emailError) {
          console.error('Error sending confirmation email:', emailError);
          // Don't fail the request if email fails
        }
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

// Helper function to send order confirmation email
async function sendOrderConfirmationEmail(user, order, session) {
  const orderItemsHtml = order.orderItems.map(item => `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #eee;">
        ${item.name}
      </td>
      <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: center;">
        ${item.quantity}
      </td>
      <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right;">
        $${(item.price * item.quantity).toFixed(2)}
      </td>
    </tr>
  `).join('');

  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Order Confirmation</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #AA4A1E 0%, #8D3A18 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 28px;">Order Confirmed! 🎉</h1>
      </div>
      
      <div style="background: #fff; padding: 30px; border: 1px solid #eee; border-top: none;">
        <p style="font-size: 16px;">Hi <strong>${user.name}</strong>,</p>
        
        <p>Thank you for your order! We're excited to get your items ready.</p>
        
        <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #AA4A1E;">Order Details</h3>
          <p><strong>Order ID:</strong> #${order._id.toString().slice(-8).toUpperCase()}</p>
          <p><strong>Date:</strong> ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
        
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <thead>
            <tr style="background: #f5f5f5;">
              <th style="padding: 12px; text-align: left;">Item</th>
              <th style="padding: 12px; text-align: center;">Qty</th>
              <th style="padding: 12px; text-align: right;">Price</th>
            </tr>
          </thead>
          <tbody>
            ${orderItemsHtml}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="2" style="padding: 12px; text-align: right;"><strong>Subtotal:</strong></td>
              <td style="padding: 12px; text-align: right;">$${order.itemsPrice?.toFixed(2) || '0.00'}</td>
            </tr>
            <tr>
              <td colspan="2" style="padding: 12px; text-align: right;"><strong>Delivery:</strong></td>
              <td style="padding: 12px; text-align: right;">$${order.shippingPrice?.toFixed(2) || '0.00'}</td>
            </tr>
            <tr style="background: #AA4A1E; color: white;">
              <td colspan="2" style="padding: 12px; text-align: right;"><strong>Total:</strong></td>
              <td style="padding: 12px; text-align: right;"><strong>$${order.totalPrice?.toFixed(2) || (session.amount_total / 100).toFixed(2)}</strong></td>
            </tr>
          </tfoot>
        </table>
        
        ${order.shippingAddress ? `
        <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #AA4A1E;">Shipping Address</h3>
          <p style="margin: 0;">
            ${order.shippingAddress.street || ''}<br>
            ${order.shippingAddress.city || ''}, ${order.shippingAddress.state || ''} ${order.shippingAddress.zipCode || ''}<br>
            ${order.shippingAddress.country || 'USA'}
          </p>
        </div>
        ` : ''}
        
        <div style="background: #FFF5F0; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #AA4A1E;">
          <h3 style="margin-top: 0; color: #AA4A1E;">What's Next?</h3>
          <ul style="margin: 0; padding-left: 20px;">
            <li>We'll start preparing your order right away</li>
            <li>You'll receive a notification when it ships</li>
            <li>Delivery typically takes 3-5 business days</li>
          </ul>
        </div>
        
        <p>If you have any questions, feel free to contact us at <a href="mailto:contact@femtyafricangrocerystore.com" style="color: #AA4A1E;">contact@femtyafricangrocerystore.com</a></p>
        
        <p>Thank you for shopping with us!</p>
        
        <p style="margin-bottom: 0;">
          Best regards,<br>
          <strong style="color: #AA4A1E;">The Femty African Grocery Store Team</strong>
        </p>
      </div>
      
      <div style="text-align: center; padding: 20px; color: #888; font-size: 12px;">
        <p>© ${new Date().getFullYear()} Femty African Grocery Store. All rights reserved.</p>
      </div>
    </body>
    </html>
  `;

  await resend.emails.send({
    from: 'Femty Grocery <onboarding@resend.dev>',
    to: user.email,
    subject: `Order Confirmed! #${order._id.toString().slice(-8).toUpperCase()}`,
    html: emailHtml,
  });

  console.log('Order confirmation email sent to:', user.email);
}

// POST /api/payments/webhook (Stripe webhook)
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

  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      console.log('Payment successful for session:', session.id);
      
      if (session.metadata.orderId) {
        const order = await Order.findByIdAndUpdate(
          session.metadata.orderId,
          {
            isPaid: true,
            paidAt: new Date(),
            status: 'processing',
            paymentResult: {
              id: session.payment_intent,
              status: 'completed',
              email_address: session.customer_details?.email,
            },
          },
          { new: true }
        );

        // Send email via webhook as backup
        if (order && process.env.RESEND_API_KEY) {
          const user = await User.findById(session.metadata.userId);
          if (user) {
            try {
              await sendOrderConfirmationEmail(user, order, session);
            } catch (emailError) {
              console.error('Webhook email error:', emailError);
            }
          }
        }
      }
      break;

    case 'payment_intent.payment_failed':
      console.log('Payment failed:', event.data.object.id);
      break;

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
});

module.exports = router;