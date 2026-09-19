'use strict';

const { z } = require('zod');
const { PAYMENT_MODE, values } = require('../../domain/constants');
const { MAX_BOX_QTY } = require('../../domain/variants');

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid identifier');

/*
 * The client sends box ids and how many of each, and nothing else. Prices are
 * looked up server side. Accepting a client total is the oldest bug in commerce.
 *
 * One line is one box: two eleven-kilo boxes and three six-kilo boxes of the
 * same mango are two lines, which is why the product id alone is not the key.
 * See docs/adr/0021.
 */
const orderItem = z.object({
  product: objectId,
  variant: objectId,
  // Whole boxes.
  quantity: z.number().int().positive().max(MAX_BOX_QTY),
});

const createOrder = z.object({
  submissionId: z.string().uuid().optional(),
  paymentMode: z.enum(values(PAYMENT_MODE)),
  customer: z.object({
    name: z.string().trim().min(2, 'Name is required').max(120),
    phone: z.string().min(6, 'Phone number is required').max(20),
    altPhone: z.string().max(20).optional(),
    address: z.string().trim().min(5, 'Address is required').max(500),
    district: z.string().trim().min(2, 'District is required').max(80),
    note: z.string().max(1000).optional(),
  }),
  items: z.array(orderItem).min(1, 'Choose at least one product').max(20),
});

const trackQuery = z.object({
  phone: z.string().min(6, 'Enter the phone number used on the order').max(20),
});

module.exports = { createOrder, trackQuery, objectId };
