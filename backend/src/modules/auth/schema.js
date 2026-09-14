'use strict';

const { z } = require('zod');

const phone = z.string().min(6, 'Phone number is required').max(20);
const password = z.string().min(6, 'Use at least 6 characters').max(200);
// Latin digits only. The form converts Bengali digits before sending.
const otp = z.string().trim().regex(/^\d{6}$/, 'Enter the 6 digit code');

const register = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  phone,
  password,
  otp,
  shopName: z.string().trim().min(2).max(120).optional(),
});

const login = z.object({ phone, password });

const phoneOnly = z.object({ phone });

const loginVerify = z.object({
  challengeId: z.string().min(20).max(200),
  otp,
});

const resetPassword = z.object({ phone, otp, newPassword: password });

const changePassword = z.object({
  currentPassword: z.string().min(1, 'Required').max(200),
  newPassword: password,
});

const phoneOtp = z.object({ newPhone: phone });

const changePhone = z.object({
  newPhone: phone,
  otp,
  password: z.string().min(1, 'Required').max(200),
});

module.exports = {
  register,
  login,
  phoneOnly,
  loginVerify,
  resetPassword,
  changePassword,
  phoneOtp,
  changePhone,
};
