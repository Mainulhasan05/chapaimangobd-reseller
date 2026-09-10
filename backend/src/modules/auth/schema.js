'use strict';

const { z } = require('zod');

const phone = z.string().min(6, 'Phone number is required').max(20);
const password = z.string().min(8, 'Use at least 8 characters').max(200);

const register = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  phone,
  password,
  shopName: z.string().trim().min(2).max(120).optional(),
});

const login = z.object({ phone, password });

module.exports = { register, login };
