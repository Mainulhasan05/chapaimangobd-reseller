import { common } from './areas/common';
import { shell } from './areas/shell';
import { orders } from './areas/orders';
import { catalog } from './areas/catalog';
import { people } from './areas/people';
import { cost } from './areas/cost';
import { reseller } from './areas/reseller';

/**
 * Every user-facing string lives here.
 *
 * Flat dotted keys with `as const` so that `t()` takes a union of real keys and a
 * typo is a compile error rather than `undefined` rendered on screen. No locale
 * routing: adding English later means a second file and a swap, not a restructure.
 */
const core = {
  'app.name': 'চাঁপাই ম্যাঙ্গো',
  'app.loading': 'লোড হচ্ছে...',
  'app.saving': 'সংরক্ষণ হচ্ছে...',
  'app.save': 'সংরক্ষণ করুন',
  'app.cancel': 'বাতিল',
  'app.confirm': 'নিশ্চিত করুন',
  'app.close': 'বন্ধ করুন',
  'app.back': 'ফিরে যান',
  'app.search': 'খুঁজুন',
  'app.retry': 'আবার চেষ্টা করুন',
  'app.none': 'কিছু নেই',
  'app.yes': 'হ্যাঁ',
  'app.no': 'না',
  'app.actions': 'কার্যক্রম',
  'app.edit': 'সম্পাদনা',
  'app.error': 'কিছু একটা সমস্যা হয়েছে',
  'app.required': 'এই ঘরটি পূরণ করুন',
  'app.copy': 'কপি করুন',
  'app.copied': 'কপি হয়েছে',
  'app.all': 'সব',
  'app.total': 'মোট',
  'app.date': 'তারিখ',
  'app.status': 'অবস্থা',
  'app.notes': 'মন্তব্য',
  'app.optional': 'ঐচ্ছিক',
  'app.more': 'আরও',
  'app.menu': 'মেনু',
  'app.share': 'শেয়ার করুন',
  'app.filter': 'ফিল্টার',
  'app.sortBy': 'সাজান',
  'app.columns': 'কলাম',
  'app.selected': 'নির্বাচিত',
  'app.selectRow': 'সারি নির্বাচন করুন',
  'app.selectAll': 'সব নির্বাচন করুন',
  'app.viewAll': 'সব দেখুন',
  'app.profile': 'প্রোফাইল',
  'app.clear': 'মুছে দিন',
  'app.remove': 'সরান',
  'app.loadMore': 'আরও দেখুন',
  'app.allLoaded': 'সব দেখানো হয়েছে',
  'app.offline': 'ইন্টারনেট সংযোগ নেই',
  'app.offlineHelp': 'সংযোগ ফিরে এলে তথ্য আবার আসবে',
  'app.errorTitle': 'তথ্য আনা যায়নি',
  'app.errorHelp': 'ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন',
  'app.saved': 'সংরক্ষণ হয়েছে',
  'app.discard': 'বাদ দিয়ে বেরিয়ে যান',
  'app.keepEditing': 'লেখা চালিয়ে যান',
  'app.unsavedTitle': 'এখনো সংরক্ষণ হয়নি',
  'app.unsavedHelp': 'বেরিয়ে গেলে আপনার লেখা তথ্য হারিয়ে যাবে',
  'app.copyFailed': 'কপি করা যায়নি, লিংকটি নিজে বেছে নিন',
  'app.searchOrders': 'কোড, নাম বা মোবাইল নম্বর',
  'app.noResults': 'কিছু পাওয়া যায়নি',
  'app.install': 'ফোনে ইনস্টল করুন',
  'app.installHelp': 'হোম স্ক্রিনে যোগ করলে বিজ্ঞপ্তি পাবেন',
  'app.markAllRead': 'সব পড়া হয়েছে',
  'app.unread': 'নতুন',

  'auth.login': 'লগইন',
  'auth.logout': 'লগআউট',
  'role.owner': 'মালিক',
  'role.reseller': 'রিসেলার',
  'auth.register': 'নিবন্ধন',
  'auth.name': 'আপনার নাম',
  'auth.shopName': 'দোকানের নাম',
  'auth.phone': 'মোবাইল নম্বর',
  'auth.password': 'পাসওয়ার্ড',
  'auth.loginTitle': 'আপনার অ্যাকাউন্টে প্রবেশ করুন',
  'auth.loginHelp': 'ফোন নম্বর ও পাসওয়ার্ড দিন',
  'auth.registerTitle': 'রিসেলার হিসেবে যুক্ত হোন',
  'auth.noAccount': 'অ্যাকাউন্ট নেই?',
  'auth.hasAccount': 'আগে থেকেই অ্যাকাউন্ট আছে?',
  'auth.phoneHint': 'যেমন ০১৭XXXXXXXX',
  'auth.passwordHint': 'কমপক্ষে ৬ অক্ষর',
  'auth.showPassword': 'পাসওয়ার্ড দেখুন',
  'auth.hidePassword': 'পাসওয়ার্ড লুকান',
  'auth.phoneValid': 'নম্বরটি ঠিক আছে',
  'auth.phoneRemaining': 'আর {n}টি সংখ্যা বাকি',
  'auth.phonePrefix': 'বাংলাদেশি নম্বর ০১৩ থেকে ০১৯ দিয়ে শুরু হয়',
  'auth.phoneCounter': '{n}/১১ সংখ্যা',

  /* phase d: identity */
  'auth.forgotPassword': 'পাসওয়ার্ড ভুলে গেছেন?',
  'auth.invalidCredentials': 'মোবাইল নম্বর বা পাসওয়ার্ড সঠিক নয়',
  'auth.suspended': 'এই অ্যাকাউন্টটি বন্ধ রাখা হয়েছে',
  'auth.sendCode': 'কোড পাঠান',
  'auth.otp': 'SMS কোড',
  'auth.otpHint': 'SMS-এ আসা ৬ সংখ্যার কোড',
  'auth.otpSentTo': '{phone} নম্বরে একটি কোড পাঠানো হয়েছে',
  'auth.resendCode': 'আবার কোড পাঠান',
  'auth.resendIn': '{n} সেকেন্ড পর আবার পাঠানো যাবে',
  'auth.changeNumber': 'নম্বর বদলান',
  'auth.registerStepPhone': 'প্রথমে আপনার মোবাইল নম্বরে একটি কোড পাঠিয়ে নম্বরটি যাচাই করা হবে',
  'auth.registerStepDetails': 'কোড আর আপনার তথ্য দিন',
  'auth.deviceTitle': 'নতুন ডিভাইস যাচাই',
  'auth.deviceHelp':
    'এই ডিভাইস থেকে আগে লগইন করা হয়নি। {phone} নম্বরে পাঠানো কোডটি দিন। এরপর ৩০ দিন এই ডিভাইসে কোড লাগবে না।',
  'auth.verify': 'যাচাই করুন',
  'auth.backToLogin': 'লগইনে ফিরে যান',
  'auth.forgotTitle': 'নতুন পাসওয়ার্ড সেট করুন',
  'auth.forgotHelp': 'অ্যাকাউন্টের মোবাইল নম্বর দিন। নম্বরটি নিবন্ধিত থাকলে SMS-এ একটি কোড যাবে।',
  'auth.forgotCodeHelp': 'নম্বরটি নিবন্ধিত থাকলে SMS-এ একটি কোড গেছে। কোড আর নতুন পাসওয়ার্ড দিন।',
  'auth.newPassword': 'নতুন পাসওয়ার্ড',
  'auth.currentPassword': 'বর্তমান পাসওয়ার্ড',
  'auth.resetSubmit': 'পাসওয়ার্ড সেট করুন',
  'auth.resetDone': 'পাসওয়ার্ড বদলানো হয়েছে। নতুন পাসওয়ার্ড দিয়ে লগইন করুন।',

  'nav.account': 'অ্যাকাউন্ট',
  'account.title': 'আমার অ্যাকাউন্ট',
  'account.subtitle': 'পাসওয়ার্ড আর লগইনের মোবাইল নম্বর',
  'account.passwordTitle': 'পাসওয়ার্ড বদলান',
  'account.passwordHelp': 'বদলালে এই ডিভাইস ছাড়া অন্য সব ফোন ও ব্রাউজার থেকে লগআউট হয়ে যাবে',
  'account.passwordSubmit': 'পাসওয়ার্ড বদলান',
  'account.passwordChanged': 'পাসওয়ার্ড বদলানো হয়েছে',
  'account.phoneTitle': 'মোবাইল নম্বর বদলান',
  'account.phoneCurrent': 'বর্তমান নম্বর',
  'account.phoneHelp':
    'নতুন নম্বরে একটি কোড যাবে। বদলানোর পর সব জায়গা থেকে লগআউট হবে, নতুন নম্বর দিয়ে আবার লগইন করতে হবে।',
  'account.newPhone': 'নতুন মোবাইল নম্বর',
  'account.passwordForPhone': 'নিশ্চিত করতে পাসওয়ার্ড দিন',
  'account.phoneSubmit': 'নম্বর বদলান',
  'account.phoneChanged': 'নম্বর বদলানো হয়েছে। নতুন নম্বর দিয়ে লগইন করুন।',
  'account.mustChangeTitle': 'নিজের পাসওয়ার্ড সেট করুন',
  'account.mustChangeHelp':
    'মালিক আপনার জন্য একটি অস্থায়ী পাসওয়ার্ড দিয়েছেন। কাজ চালিয়ে যেতে আগে নিজের একটি পাসওয়ার্ড সেট করুন।',
  'account.temporaryPassword': 'অস্থায়ী পাসওয়ার্ড',

  'reseller.resetPassword': 'পাসওয়ার্ড রিসেট',
  'reseller.resetPasswordHint': 'রিসেলার SMS কোড না পেলে এটি ব্যবহার করুন',
  'reseller.resetPasswordTitle': 'পাসওয়ার্ড রিসেট করবেন?',
  'reseller.resetPasswordHelp':
    'একটি অস্থায়ী পাসওয়ার্ড তৈরি হবে, রিসেলারের সব ডিভাইস থেকে লগআউট হবে, আর পরের লগইনে নিজের পাসওয়ার্ড দিতে হবে।',
  'reseller.resetPasswordConfirm': 'রিসেট করুন',
  'reseller.temporaryPassword': 'অস্থায়ী পাসওয়ার্ড',
  'reseller.temporaryPasswordHelp': 'এটি শুধু একবার দেখানো হবে। রিসেলারকে জানিয়ে দিন।',

  'sms.purposeOtp': 'ওটিপি কোড',
  'sms.purposeOwnerAlert': 'মালিকের সতর্কতা',
  'sms.purposeCustomer': 'গ্রাহকের SMS',

  'nav.dashboard': 'ড্যাশবোর্ড',
  'nav.orders': 'অর্ডার',
  'nav.catalog': 'পণ্য তালিকা',
  'nav.products': 'পণ্য',
  'nav.sources': 'সংগ্রহের উৎস',
  'nav.resellers': 'রিসেলার',
  'nav.kyc': 'কেওয়াইসি',
  'nav.wallet': 'ওয়ালেট',
  'nav.deposits': 'জমা',
  'nav.withdrawals': 'উত্তোলন',
  'nav.zones': 'ডেলিভারি এলাকা',
  'zone.active': 'এই এলাকায় ডেলিভারি চালু',
  'zone.activeHint': 'বন্ধ রাখলে অর্ডারের সময় এই এলাকা দেখা যাবে না',
  'nav.reports': 'রিপোর্ট',
  'nav.settings': 'সেটিংস',
  'nav.sms': 'SMS',
  'nav.customers': 'ক্রেতা',
  'settings.brandLogo': 'ব্র্যান্ডের লোগো',
  'settings.brandLogoHint': 'প্রতিটি দোকান ও ট্র্যাকিং পাতায় এই লোগো দেখাবে',
  'nav.myShop': 'আমার দোকান',
  'nav.notifications': 'বিজ্ঞপ্তি',
  'nav.more': 'আরও',
  'nav.groupDaily': 'প্রতিদিনের কাজ',
  'nav.groupMoney': 'হিসাব',
  'nav.groupSetup': 'সেটআপ',

  'dash.morning': 'শুভ সকাল',
  'dash.afternoon': 'শুভ দুপুর',
  'dash.evening': 'শুভ সন্ধ্যা',
  'dash.night': 'শুভ রাত্রি',
  'dash.last7Days': 'গত ৭ দিন',
  'dash.earnings': 'আপনার লাভ',
  'dash.earningsHelp': 'দিনে দিনে জমা হওয়া লাভ',
  'dash.noActivity': 'এই সময়ে কোনো অর্ডার হয়নি',
  'dash.pipeline': 'অর্ডার কোন ধাপে আছে',
  'dash.pipelineEmpty': 'এখন কোনো অর্ডার চলমান নেই',
  'dash.creditUsed': 'ক্রেডিট ব্যবহার হয়েছে',
  'dash.dataTable': 'সংখ্যায় দেখুন',
  'dash.day': 'দিন',
  'dash.busiestDay': 'সবচেয়ে ভালো দিন',
  'dash.queue': 'সিদ্ধান্তের অপেক্ষায়',
  'dash.queueHelp': 'আপনার অনুমোদন দরকার',
  'dash.actions': 'দ্রুত কাজ',
  'dash.actionOrders': 'সারি দেখুন ও এগিয়ে নিন',
  'dash.actionProducts': 'পণ্য যোগ করুন বা দাম বদলান',
  'dash.actionFinance': 'জমা ও উত্তোলন অনুমোদন',
  'dash.actionReports': 'হিসাব দেখুন ও ডাউনলোড করুন',
  'dash.queueEmpty': 'এই মুহূর্তে কিছু অপেক্ষা করছে না',
  'dash.topDebtors': 'সবচেয়ে বেশি বকেয়া',
  'dash.recentOrders': 'সাম্প্রতিক অর্ডার',
  'dash.thisWeek': 'এই সপ্তাহে',

  'order.pending': 'অপেক্ষমাণ',
  'order.confirmed': 'নিশ্চিত',
  'order.accepted': 'গৃহীত',
  'order.packed': 'প্যাক করা',
  'order.shipped': 'পাঠানো হয়েছে',
  'order.delivered': 'ডেলিভারি সম্পন্ন',
  'order.cancelled': 'বাতিল',
  'order.returned': 'ফেরত',

  'order.code': 'অর্ডার কোড',
  'order.customer': 'ক্রেতা',
  'order.address': 'ঠিকানা',
  'order.district': 'জেলা',
  'order.items': 'পণ্যসমূহ',
  'order.quantity': 'পরিমাণ',
  'order.unitPrice': 'একক দাম',
  'order.deliveryCharge': 'ডেলিভারি চার্জ',
  'order.customerTotal': 'ক্রেতার মোট',
  'order.walletDebit': 'ওয়ালেট থেকে কাটা',
  'order.yourProfit': 'আপনার লাভ',
  'order.paymentMode': 'পেমেন্ট পদ্ধতি',
  'order.prepaid': 'অগ্রিম পরিশোধিত',
  'order.cod': 'ক্যাশ অন ডেলিভারি',
  'order.courier': 'কুরিয়ার',
  'order.trackingNumber': 'ট্র্যাকিং নম্বর',
  'order.placedAt': 'অর্ডারের সময়',
  'order.confirmOrder': 'অর্ডার নিশ্চিত করুন',
  'order.cancelOrder': 'অর্ডার বাতিল করুন',
  'order.cancelReason': 'বাতিলের কারণ',
  'order.manualOrder': 'নিজে অর্ডার তৈরি করুন',
  'order.noOrders': 'এখনো কোনো অর্ডার নেই',
  'order.confirmHelp':
    'নিশ্চিত করার সময় আপনার বিক্রয়মূল্য ঠিক করুন। আপনার ওয়ালেট থেকে শুধু ক্রয়মূল্য ও ডেলিভারি চার্জ কাটা হবে।',
  'order.aging': 'পুরনো হয়ে যাচ্ছে',
  'order.inProgress': 'চলমান',
  'order.moreItems': 'আরও {n}টি পণ্য',

  /*
   * The six units the catalog sells in. Stored in English, because the unit is
   * a domain value the server validates against a fixed list; only the label a
   * person reads is Bengali.
   */
  'unit.kg': 'কেজি',
  'unit.gram': 'গ্রাম',
  'unit.litre': 'লিটার',
  'unit.pcs': 'পিস',
  'unit.dozen': 'ডজন',
  'unit.box': 'বাক্স',
  'unit.sheet': 'শিট',
  'unit.roll': 'রোল',
  'unit.metre': 'মিটার',
  'unit.packet': 'প্যাকেট',
  'unit.bundle': 'বান্ডিল',
  'order.stage': 'ধাপ',
  'order.repeatBuyer': 'পুরনো ক্রেতা',
  'order.accept': 'গ্রহণ করুন',
  'order.acceptTitle': 'অর্ডার গ্রহণ করুন',
  'order.sourceHelp': 'প্রতিটি পণ্য কোন উৎস থেকে যাবে তা বেছে নিন',
  'order.chooseSource': 'উৎস বেছে নিন',
  'order.sameSourceAll': 'সবগুলোর জন্য একই উৎস',
  'order.sourceMissing': 'প্রতিটি পণ্যের জন্য উৎস বেছে নিন',
  'order.noSources': 'আগে একটি সংগ্রহের উৎস যোগ করুন',
  'order.acceptedToast': 'অর্ডার গ্রহণ করা হয়েছে',
  'order.pack': 'প্যাক করুন',
  'order.ship': 'পাঠান',
  'order.deliver': 'ডেলিভারি হয়েছে',
  'order.return': 'ফেরত এসেছে',
  'order.confirmedToast': 'অর্ডার নিশ্চিত হয়েছে',
  'order.cancelledToast': 'অর্ডার বাতিল হয়েছে',
  'order.statusUpdated': 'অর্ডারের অবস্থা বদলেছে',
  'order.shippedToast': 'কুরিয়ারে পাঠানো হয়েছে',
  'order.createdToast': 'অর্ডার তৈরি হয়েছে',
  'order.minQtyHelp': 'সর্বনিম্ন অর্ডারের চেয়ে কম দেওয়া যাবে না',
  'order.searchHelp': 'অর্ডার কোড, ক্রেতার নাম বা মোবাইল নম্বর দিয়ে খুঁজুন',
  'order.viewDetail': 'বিস্তারিত দেখুন',

  /* Returns: whole order, from shipped only, stock back only when ticked. */
  'order.returnTitle': 'অর্ডার ফেরত এসেছে',
  'order.returnHelp':
    'কুরিয়ার পুরো পার্সেলটি ফেরত দিয়েছে। অর্ডারটি ফেরত হিসেবে বন্ধ হবে এবং রিসেলারের ওয়ালেটের হিসাব উল্টে দেওয়া হবে। এটি পরে আর বদলানো যাবে না।',
  'order.returnReason': 'ফেরতের কারণ',
  'order.restock': 'পণ্য আবার স্টকে তুলুন',
  'order.restockHint':
    'চালু করলে এই অর্ডারের পরিমাণ আবার স্টকে যোগ হবে। পথে ঘুরে আসা আম সাধারণত বিক্রির মতো থাকে না, তাই ভালো অবস্থায় থাকলে তবেই চালু করুন।',
  'order.returnedToast': 'অর্ডার ফেরত হিসেবে চিহ্নিত হয়েছে',
  'order.restocked': 'পণ্য স্টকে ফেরত তোলা হয়েছে',
  'order.notRestocked': 'পণ্য স্টকে ফেরত তোলা হয়নি',
  'order.paymentModeChanged': 'পেমেন্ট পদ্ধতি {from} থেকে {to} করা হয়েছে',

  /* The delivery charge, editable until the parcel ships. See docs/adr/0010. */
  'order.deliveryChargeEdit': 'ডেলিভারি চার্জ বদলান',
  'order.deliveryChargeHint': 'বর্তমান চার্জ {amount}। কুরিয়ারের আসল খরচ জানলে বদলে দিন।',
  'order.deliveryAdjustNotice':
    'অর্ডারটি আগেই নিশ্চিত হয়েছে, তাই রিসেলারের ওয়ালেটে {amount} ডেলিভারি সমন্বয় আলাদা করে যোগ হবে। আগের কাটা টাকা বদলাবে না।',
  'order.deliveryChargeSaved': 'ডেলিভারি চার্জ বদলানো হয়েছে',
  'order.deliveryAdjustPosted': 'ডেলিভারি চার্জ বদলানো হয়েছে, ওয়ালেটে {amount} সমন্বয় হয়েছে',

  /* Ledger entry kinds, as a person reads them. Keys match the API exactly. */
  'ledger.kind.ORDER_COST_DEBIT': 'অর্ডারের ক্রয়মূল্য',
  'ledger.kind.DELIVERY_DEBIT': 'ডেলিভারি চার্জ',
  'ledger.kind.DELIVERY_ADJUSTMENT': 'ডেলিভারি চার্জ সমন্বয়',
  'ledger.kind.COD_COLLECTION_CREDIT': 'ক্যাশ অন ডেলিভারির আদায়',
  'ledger.kind.DEPOSIT_CREDIT': 'টাকা জমা',
  'ledger.kind.WITHDRAWAL_DEBIT': 'টাকা উত্তোলন',
  'ledger.kind.SMS_PURCHASE_DEBIT': 'SMS ক্রেডিট কেনা',
  'ledger.kind.MANUAL_CREDIT': 'হাতে সমন্বয় (যোগ)',
  'ledger.kind.MANUAL_DEBIT': 'হাতে সমন্বয় (কাটা)',
  'ledger.kind.REVERSAL': 'আগের হিসাব ফেরত',

  'finance.withdrawalShort':
    'রিসেলারের ব্যালেন্সে এখন এই পরিমাণ টাকা নেই। উত্তোলনের অনুরোধটি অপেক্ষায় থাকল: বাতিল করুন, অথবা ব্যালেন্স বাড়লে আবার অনুমোদন দিন।',
  'finance.withdrawalApproved': 'উত্তোলন অনুমোদিত হয়েছে',

  'reports.drift': 'হিসাবে গরমিল',
  'reports.driftHint': 'ওয়ালেটের ব্যালেন্স লেজারের সাথে মিলছে না। হিসাব মিলিয়ে দেখুন।',

  'catalog.sellPrice': 'আপনার বিক্রয়মূল্য',
  'catalog.costPrice': 'ক্রয়মূল্য',
  'catalog.maxSellPrice': 'সর্বোচ্চ বিক্রয়মূল্য',
  'catalog.minOrderQty': 'সর্বনিম্ন অর্ডার',
  'catalog.unit': 'একক',
  'catalog.unitHint': 'বক্সের ভেতরে কী পরিমাণ থাকবে তা এই এককে মাপা হবে',

  /*
   * Boxes. A mango leaves in a six-kilo box or an eleven-kilo box, and those
   * are two things with two prices rather than one thing with a minimum and a
   * step. See docs/adr/0021.
   */
  'catalog.boxes': 'বক্স',
  'catalog.boxesHint': 'যে যে সাইজের বক্সে এই পণ্য বিক্রি হবে। দাম ও স্টক প্রতি বক্স হিসেবে।',
  'catalog.addBox': 'নতুন বক্স',
  'catalog.newBox': 'নতুন বক্স',
  'catalog.boxContent': 'বক্সে কতটুকু',
  'catalog.boxLabel': 'বক্সের নাম',
  'catalog.perBox': 'প্রতি বক্স',
  'catalog.boxCount': '{n} বক্স',
  'catalog.boxAvailableHint': 'বন্ধ করলে এই সাইজের বক্স কেউ অর্ডার করতে পারবে না',
  'catalog.stockHint': 'কয়টি বক্স আছে',
  'catalog.fromPrice': '{amount} থেকে',
  'catalog.chooseBox': 'বক্স বাছাই করুন',
  'catalog.outOfStockBox': 'এই বক্স শেষ',
  'catalog.noBoxes': 'এখনো কোনো বক্স যোগ করা হয়নি',
  'catalog.pricedBoxes': '{done}/{total} বক্সের দাম দেওয়া আছে',
  'order.boxes': 'বক্স সংখ্যা',
  'catalog.hidePrice': 'দাম লুকিয়ে রাখুন',
  'catalog.hidePriceHelp': 'ক্রেতা দাম দেখবে না, আপনি ফোনে জানাবেন',
  'catalog.listed': 'দোকানে দেখানো হচ্ছে',
  'catalog.activate': 'দাম দিয়ে চালু করুন',
  'catalog.notActivated': 'এখনো চালু করা হয়নি',
  'catalog.inStock': 'স্টকে আছে',
  'catalog.outOfStock': 'স্টক শেষ',
  'catalog.stockQty': 'স্টকের পরিমাণ',
  'catalog.trackStock': 'স্টক হিসাব রাখুন',
  'catalog.priceFloorHelp': 'ক্রয়মূল্যের কম দামে বিক্রি করা যাবে না',
  'catalog.savedToast': 'দাম সংরক্ষণ হয়েছে',
  'catalog.activatedToast': 'পণ্যটি আপনার দোকানে চালু হয়েছে',
  'catalog.decrease': 'কমান',
  'catalog.increase': 'বাড়ান',
  'catalog.images': 'পণ্যের ছবি',
  'catalog.viewImages': 'ছবি দেখুন',
  'catalog.imagesHint': 'প্রথম ছবিটি দোকানে ও ক্রেতার অর্ডার পাতায় দেখানো হবে',
  'catalog.available': 'ক্রেতারা অর্ডার করতে পারবে',
  'catalog.availableHint': 'বন্ধ রাখলে পণ্যটি স্টক শেষ হিসেবে দেখাবে',
  'catalog.trackStockHint': 'বন্ধ রাখলে স্টক সীমাহীন ধরা হবে',

  'wallet.balance': 'ব্যালেন্স',
  'wallet.creditLimit': 'ক্রেডিট সীমা',
  'wallet.available': 'ব্যবহারযোগ্য',
  'wallet.owed': 'বকেয়া',
  'wallet.ledger': 'লেনদেনের হিসাব',
  'wallet.noEntries': 'এখনো কোনো লেনদেন নেই',
  'wallet.depositRequest': 'টাকা জমার অনুরোধ',
  'wallet.withdrawRequest': 'টাকা উত্তোলনের অনুরোধ',
  'wallet.amount': 'পরিমাণ',
  'wallet.method': 'মাধ্যম',
  'wallet.transactionId': 'ট্রানজেকশন আইডি',
  'wallet.senderNumber': 'যে নম্বর থেকে পাঠিয়েছেন',
  'wallet.destinationNumber': 'যে নম্বরে পাঠাতে হবে',

  /*
   * A bank transfer is paid on an account, not a number. Asked for only when
   * the reseller picks Bank, because four more fields on every withdrawal would
   * be four more things to skip past. See docs/adr/0018.
   */
  'wallet.payoutDestination': 'যেখানে টাকা পাঠাতে হবে',
  'wallet.bankDetails': 'ব্যাংক অ্যাকাউন্টের তথ্য',
  'wallet.bankDetailsHelp': 'ব্যাংকে টাকা পাঠাতে এই তথ্যগুলো লাগবে, পাসবই বা চেক বই দেখে লিখুন',
  'wallet.bankName': 'ব্যাংকের নাম',
  'wallet.branchName': 'শাখার নাম',
  'wallet.accountName': 'অ্যাকাউন্টের নাম',
  'wallet.accountNameHint': 'পাসবইয়ে যে নামে অ্যাকাউন্ট',
  'wallet.accountNumber': 'অ্যাকাউন্ট নম্বর',
  'wallet.routingNumber': 'রাউটিং নম্বর',
  'wallet.routingNumberHint': 'জানা থাকলে দিন, ৯ সংখ্যা',
  'wallet.screenshot': 'স্ক্রিনশট',
  'wallet.negativeHelp': 'ব্যালেন্স ঋণাত্মক হলে সেটি আপনার বকেয়া',
  'wallet.depositSubmitted': 'জমার অনুরোধ পাঠানো হয়েছে',
  'wallet.withdrawSubmitted': 'উত্তোলনের অনুরোধ পাঠানো হয়েছে',

  'kyc.title': 'পরিচয় যাচাই',
  'kyc.notSubmitted': 'জমা দেওয়া হয়নি',
  'kyc.pending': 'যাচাই চলছে',
  'kyc.approved': 'অনুমোদিত',
  'kyc.rejected': 'নামঞ্জুর',
  'kyc.nidFront': 'এনআইডি সামনের দিক',
  'kyc.nidBack': 'এনআইডি পেছনের দিক',
  'kyc.selfie': 'আপনার ছবি',
  'kyc.tradeLicense': 'ট্রেড লাইসেন্স',
  'kyc.submit': 'কাগজপত্র জমা দিন',
  'kyc.gateHelp': 'কেওয়াইসি অনুমোদনের পর আপনার দোকান চালু হবে এবং অর্ডার নিশ্চিত করতে পারবেন',
  'kyc.approve': 'অনুমোদন',
  'kyc.reject': 'বাতিল',
  'kyc.rejectReason': 'বাতিলের কারণ',
  'kyc.viewDocuments': 'কাগজপত্র দেখুন',
  'kyc.progress': '{done}/{total} কাগজ যোগ করা হয়েছে',
  'kyc.readyToSubmit': 'সব প্রয়োজনীয় কাগজ যোগ হয়েছে',
  'kyc.needRequired': 'তারকা চিহ্ন দেওয়া কাগজগুলো দিতেই হবে',

  /*
   * Why someone is being asked for their national ID, said before the upload
   * buttons rather than in a policy page nobody opens. A reseller handing over
   * a scan of their NID to a shop they joined last week is entitled to know
   * what happens to it, and the answer here is the one the code actually gives:
   * a private bucket, signed links for the owner alone, and the retention rule
   * in docs/adr/0016.
   */
  'kyc.privacyTitle': 'আপনার কাগজপত্র ১০০% নিরাপদ',
  'kyc.privacyNote':
    'এই কাগজপত্র শুধুমাত্র আপনার পরিচয় যাচাইয়ের জন্য নেওয়া হচ্ছে। আপনার অ্যাকাউন্ট যতদিন থাকবে ততদিন এগুলো সুরক্ষিত ও গোপন সার্ভারে জমা থাকবে, শুধু যাচাইয়ের সময় মালিক দেখতে পাবেন। কারও সাথে শেয়ার করা হয় না, কোনো পাবলিক লিংকে যায় না, এবং অ্যাকাউন্ট বন্ধ হওয়ার পর নির্দিষ্ট সময়ে স্থায়ীভাবে মুছে ফেলা হয়।',

  /* The module is off for this reseller and they reached the page anyway. */
  'kyc.notRequired': 'এখন কেওয়াইসি লাগছে না',
  'kyc.notRequiredHelp':
    'আপনার অ্যাকাউন্টের জন্য এখন কোনো কাগজপত্র চাওয়া হয়নি। প্রয়োজন হলে মালিক এটি চালু করবেন, তখন এখানে জানানো হবে। ততক্ষণ পর্যন্ত আপনি স্বাভাবিকভাবে দোকান চালাতে পারবেন।',

  'file.camera': 'ক্যামেরা',
  'file.gallery': 'গ্যালারি',
  'file.choose': 'ছবি যোগ করুন',
  'file.dropHere': 'ছবিটি এখানে ছেড়ে দিন',
  'file.change': 'বদলান',
  'file.remove': 'সরান',
  'file.added': 'যোগ হয়েছে',
  'file.tooLarge': 'ছবিটি অনেক বড়। ৫ এমবি-র কম ছবি দিন।',
  'file.notImage': 'শুধু ছবি দেওয়া যাবে',
  'file.kb': 'কেবি',
  'file.mb': 'এমবি',
  'file.seconds': 'সেকেন্ড',
  'file.addMore': 'আরও ছবি',
  'file.cover': 'দোকানে দেখাবে',
  'file.new': 'নতুন',
  'file.maxReached': 'সর্বোচ্চ {n}টি ছবি দেওয়া যাবে',
  'file.upload': 'আপলোড করুন',
  'file.optimizing': 'ছবি ছোট করা হচ্ছে...',
  'file.optimized': 'ছবি ছোট করা হয়েছে',
  'file.previewOnly': 'এখনো আপলোড হয়নি',
  'file.uploaded': 'ছবি আপলোড হয়েছে',
  'file.removed': 'ছবি সরানো হয়েছে',

  'shop.yourLink': 'আপনার দোকানের লিংক',
  'shop.shareHelp': 'এই লিংক ক্রেতাদের সাথে শেয়ার করুন',
  'shop.open': 'দোকান খোলা',
  'shop.closed': 'দোকান বন্ধ',
  'shop.orderNow': 'অর্ডার করুন',
  'shop.yourName': 'আপনার নাম',
  'shop.yourPhone': 'আপনার মোবাইল নম্বর',
  'shop.deliveryAddress': 'ডেলিভারি ঠিকানা',
  'shop.placeOrder': 'অর্ডার নিশ্চিত করুন',
  'shop.orderPlaced': 'আপনার অর্ডার গৃহীত হয়েছে',
  'shop.orderPlacedHelp': 'আমরা শীঘ্রই ফোনে যোগাযোগ করব',
  'shop.emptyCart': 'অন্তত একটি পণ্য নির্বাচন করুন',
  'shop.priceOnCall': 'দাম জানতে ফোন করুন',
  'shop.notOpen': 'এই দোকানটি এখন বন্ধ আছে',
  'shop.trackOrder': 'অর্ডার ট্র্যাক করুন',
  'shop.trackHelp': 'অর্ডার কোড ও মোবাইল নম্বর দিন',
  'shop.shareLink': 'লিংক শেয়ার করুন',
  'shop.shareMessage': 'আমার দোকান থেকে সরাসরি অর্ডার করুন',
  'shop.linkCopied': 'লিংক কপি হয়েছে',
  'shop.savedToast': 'দোকানের তথ্য সংরক্ষণ হয়েছে',
  'shop.logo': 'দোকানের ছবি',
  'shop.logoHint': 'ক্রেতারা আপনার অর্ডার ফর্মে এই ছবিটি দেখবে',
  'shop.contact': 'যোগাযোগের তথ্য',
  'shop.contactHelp': 'ক্রেতারা আপনার অর্ডার ফর্মে এসব দেখতে পাবে',
  'shop.publicPhone': 'যোগাযোগের মোবাইল নম্বর',
  'shop.whatsapp': 'হোয়াটসঅ্যাপ নম্বর',
  'shop.facebook': 'ফেসবুক পেজের লিংক',
  // No format is demanded of a link any more (docs/adr/0020), so the hint shows
  // the easiest thing to type rather than the strictest thing that was accepted.
  'shop.facebookHint': 'যেমন facebook.com/amarshop — পুরো লিংক লেখার দরকার নেই',
  'shop.about': 'দোকান সম্পর্কে',
  'shop.aboutHint': 'দুই এক লাইনে আপনার দোকানের পরিচয়',
  'shop.payment': 'পেমেন্ট নম্বর',
  'shop.paymentHelp': 'অগ্রিম পেমেন্টের অর্ডারে ক্রেতা এই নম্বরে টাকা পাঠাবে',
  'shop.bkash': 'বিকাশ নম্বর',
  'shop.nagad': 'নগদ নম্বর',
  'shop.callUs': 'ফোন করুন',

  /* Setting a new reseller up, and the gaps that keep a shop from selling. */
  'setup.title': 'দোকান চালু করার ধাপ',
  'setup.help': 'ধাপগুলো শেষ করলেই আপনি অর্ডার নেওয়া শুরু করতে পারবেন',
  'setup.done': 'সব ধাপ শেষ হয়েছে',
  'setup.stepsLeft': '{n}টি ধাপ বাকি',
  'setup.kyc': 'কেওয়াইসি জমা দিন',
  'setup.kycHelp': 'এনআইডি ও ছবি দিয়ে পরিচয় যাচাই করুন',
  'setup.kycWaiting': 'কেওয়াইসি যাচাই চলছে',
  'setup.shop': 'দোকানের তথ্য দিন',
  'setup.shopHelp': 'নাম, ছবি ও যোগাযোগের নম্বর যোগ করুন',
  'setup.price': 'পণ্যের দাম ঠিক করুন',
  'setup.priceHelp': 'যে পণ্য বিক্রি করবেন তার দাম বসান',
  'setup.open': 'দোকান খুলুন',
  'setup.openHelp': 'দোকান চালু করলে ক্রেতারা অর্ডার করতে পারবে',
  'setup.share': 'লিংক শেয়ার করুন',
  'setup.shareHelp': 'ক্রেতাদের কাছে আপনার দোকানের লিংক পাঠান',
  'setup.goStep': 'এখনই করুন',

  'catalog.unpricedTitle': 'দাম বসানো হয়নি এমন পণ্য আছে',
  'catalog.unpricedHelp':
    'মালিক {n}টি নতুন পণ্য যোগ করেছেন। দাম না বসানো পর্যন্ত এগুলো আপনার দোকানে দেখাবে না।',
  'catalog.setPriceNow': 'দাম বসান',
  'shop.messageUs': 'মেসেজ করুন',
  'shop.itemsSelected': 'পণ্য নির্বাচিত',
  'shop.reviewOrder': 'অর্ডার দেখে নিন',

  /* Buyers, tracked by phone number across every order they have placed. */
  'cust.title': 'ক্রেতাদের তালিকা',
  'cust.help': 'মোবাইল নম্বর দিয়ে প্রত্যেক ক্রেতার সব অর্ডার একসাথে দেখা যায়',
  'cust.search': 'নাম বা মোবাইল নম্বর',
  'cust.orders': 'মোট অর্ডার',
  'cust.delivered': 'ডেলিভারি হয়েছে',
  'cust.cancelled': 'বাতিল হয়েছে',
  'cust.returned': 'ফেরত এসেছে',
  'cust.spend': 'মোট কেনাকাটা',
  'cust.firstOrder': 'প্রথম অর্ডার',
  'cust.lastOrder': 'শেষ অর্ডার',
  'cust.namesUsed': 'যেসব নামে অর্ডার করেছেন',
  'cust.addressesUsed': 'যেসব ঠিকানায় নিয়েছেন',
  'cust.altPhones': 'অন্য নম্বর',
  'cust.shops': 'যতগুলো দোকানে',
  'cust.orderHistory': 'অর্ডারের ইতিহাস',
  'cust.repeat': 'পুরনো ক্রেতা',
  'cust.firstTime': 'নতুন ক্রেতা',
  'cust.nthOrder': 'এই নম্বরের {n} নম্বর অর্ডার',
  'cust.riskyTitle': 'বাতিল ও ফেরতের হার বেশি',
  'cust.riskyHelp': 'এই নম্বর থেকে আগের অর্ডারগুলোর অনেকগুলো বাতিল বা ফেরত হয়েছে',
  'cust.timesUsed': '{n} বার',
  'cust.none': 'এখনো কোনো ক্রেতা নেই',

  'owner.receivable': 'মোট বকেয়া',
  'owner.ordersToday': 'আজকের অর্ডার',
  'owner.awaitingAcceptance': 'গ্রহণের অপেক্ষায়',
  'owner.agingOrders': 'পুরনো অর্ডার',
  'owner.pendingDeposits': 'জমার অনুরোধ',
  'owner.pendingWithdrawals': 'উত্তোলনের অনুরোধ',
  'owner.export': 'ডাউনলোড করুন',
  'owner.reconcile': 'হিসাব মিলিয়ে দেখুন',
  'owner.manualEntry': 'হাতে হিসাব সমন্বয়',
  'owner.creditLimit': 'ক্রেডিট সীমা নির্ধারণ',
  'owner.approve': 'অনুমোদন করুন',
  'owner.reject': 'নামঞ্জুর করুন',

  /*
   * The public landing page. The only marketing copy in the app, and the only
   * place that speaks to someone who is not a user yet.
   *
   * Every number quoted here is the worked example from the README, unchanged:
   * cost 55 a kilo, sold at 62, ten kilos, 80 delivery. Marketing that invents a
   * better-looking margin than the software actually produces is the fastest way
   * to lose the first reseller who checks.
   */
  'landing.navJoin': 'রিসেলার হিসেবে যোগ দিন',
  'landing.navLogin': 'লগইন',

  'landing.eyebrow': 'চাঁপাইনবাবগঞ্জের বাগান থেকে সরাসরি',
  'landing.title': 'চাকরির পাশাপাশি বাড়তি আয়',
  'landing.titleAccent': 'রিসেলার হিসেবে',
  'landing.subtitle':
    'নিজের দাম আপনি ঠিক করবেন, শুধু লিংকটা শেয়ার করবেন। অর্ডার এলে আম আমরা বাগান থেকে সংগ্রহ করে ক্রেতার ঠিকানায় পাঠিয়ে দেব। আপনার লাভ ওয়ালেটে জমা হবে।',
  'landing.ctaPrimary': 'ফ্রি রেজিস্ট্রেশন করুন',
  'landing.ctaSecondary': 'আগে থেকেই অ্যাকাউন্ট আছে?',

  'landing.proofCapital': 'পুঁজি লাগে না',
  'landing.proofCapitalHelp': 'আগে টাকা দিতে হয় না',
  'landing.proofStock': 'স্টক রাখতে হয় না',
  'landing.proofStockHelp': 'আম আমাদের কাছেই থাকে',
  'landing.proofLedger': 'প্রতিটি টাকার হিসাব',
  'landing.proofLedgerHelp': 'কেউ বদলাতে পারে না',

  'landing.stepsTitle': 'শুরু করবেন যেভাবে',
  'landing.stepsSubtitle': 'চারটি ধাপ, একদিনেই শেষ',
  'landing.step1': 'রেজিস্ট্রেশন করুন',
  'landing.step1Help': 'নাম, মোবাইল নম্বর আর পাসওয়ার্ড। এরপর এনআইডি দিয়ে কেওয়াইসি জমা দিন।',
  'landing.step2': 'নিজের দাম ঠিক করুন',
  'landing.step2Help': 'কোন আম বিক্রি করবেন আর কত দামে, সেটা আপনার সিদ্ধান্ত। ক্রয়মূল্যের নিচে নামানো যাবে না।',
  'landing.step3': 'লিংক শেয়ার করুন',
  'landing.step3Help': 'আপনার নামে একটি অর্ডার ফরম পাবেন। হোয়াটসঅ্যাপ বা ফেসবুকে শেয়ার করুন।',
  'landing.step4': 'অর্ডার নিশ্চিত করুন',
  'landing.step4Help': 'ক্রেতা অর্ডার দিলে আপনি নিশ্চিত করবেন। প্যাক করা আর পাঠানো আমাদের কাজ।',

  'landing.mathTitle': 'আয় কীভাবে হয়',
  'landing.mathSubtitle': 'একটি সত্যিকারের অর্ডারের হিসাব',
  'landing.mathCost': 'আমাদের ক্রয়মূল্য',
  'landing.mathYourPrice': 'আপনার বিক্রয়মূল্য',
  'landing.mathQty': 'ক্রেতার অর্ডার',
  'landing.mathProfit': 'আপনার লাভ',
  'landing.mathPerKg': 'প্রতি কেজি',
  'landing.mathNote':
    'ডেলিভারি চার্জ আলাদা, সেটি ক্রেতা দেয়। ক্যাশ অন ডেলিভারিতে কুরিয়ার টাকা তুলে আমাদের দেয়, আর আপনার লাভ ওয়ালেটে জমা হয়। দিনে দশটি অর্ডার মানে সাতশো টাকা।',

  'landing.whyTitle': 'কেন চাঁপাই ম্যাঙ্গো',
  'landing.why1': 'আম আমরা সংগ্রহ করি',
  'landing.why1Help':
    'কানসাট, ভোলাহাট আর আশপাশের বাগান থেকে প্রতিদিন সংগ্রহ করা হয়। কোন অর্ডার কোন বাগান থেকে গেছে, তার হিসাব থাকে।',
  'landing.why2': 'প্যাকিং ও ডেলিভারি আমাদের',
  'landing.why2Help':
    'আপনাকে আম ধরতে হবে না, কুরিয়ারে যেতে হবে না। প্রতিটি পার্সেল আমরা ক্রেতার ঠিকানায় পাঠাই।',
  'landing.why3': 'হিসাব নিয়ে ঝামেলা নেই',
  'landing.why3Help':
    'প্রতিটি লেনদেন ওয়ালেটে লেখা থাকে এবং কখনো মোছা বা বদলানো যায় না। কে কত পাবে, কে কত দেবে, স্ক্রিনেই দেখা যায়।',
  'landing.why4': 'টাকা তুলে নিন যখন খুশি',
  'landing.why4Help':
    'ক্যাশ অন ডেলিভারির লাভ ওয়ালেটে জমে। উত্তোলনের অনুরোধ দিলে আমরা পাঠিয়ে দিই।',

  'landing.faqTitle': 'সাধারণ প্রশ্ন',
  'landing.faq1': 'শুরু করতে কত টাকা লাগে?',
  'landing.faq1Help':
    'কিছু লাগে না। রেজিস্ট্রেশন ফ্রি, আর আম কেনার জন্য আগে টাকা দিতে হয় না। অর্ডার নিশ্চিত করার সময় ক্রয়মূল্য আপনার ওয়ালেট থেকে হিসাব হয়।',
  /* ------------------------------------------------------------------ sms -- */

  'sms.title': 'SMS প্যানেল',
  'sms.help': 'এখান থেকে পুরো প্ল্যাটফর্মের SMS চালু বা বন্ধ করুন, আর কোন SMS কী হলো দেখুন',
  'sms.master': 'SMS পাঠানো চালু',
  'sms.masterOnHint': 'রিসেলারদের অর্ডার ও টাকার ঘটনায় SMS যাবে',
  'sms.masterOffHint': 'বন্ধ আছে, কোনো রিসেলারের কোনো কাজে SMS যাবে না',
  'sms.offNotice': 'SMS এখন বন্ধ',
  'sms.offNoticeHelp':
    'রিসেলারদের কোনো কাজেই SMS যাচ্ছে না। ক্রেডিট থাকলেও যাবে না। চালু করলে সঙ্গে সঙ্গে আবার যাওয়া শুরু হবে।',
  'sms.notConfigured': 'গেটওয়ে যুক্ত করা হয়নি',
  'sms.notConfiguredHelp':
    'সার্ভারে AUTOMAS_API_KEY আর AUTOMAS_SENDER_ID বসানোর পর SMS পাঠানো যাবে।',
  'sms.gateway': 'গেটওয়ে',
  'sms.senderId': 'সেন্ডার আইডি',
  'sms.balance': 'গেটওয়ে ব্যালেন্স',
  'sms.balanceFailed': 'ব্যালেন্স জানা যায়নি',
  'sms.sentToday': 'আজ পাঠানো',
  'sms.sent30': 'গত ৩০ দিনে পাঠানো',
  'sms.failed30': 'গত ৩০ দিনে ব্যর্থ',
  'sms.blocked30': 'গত ৩০ দিনে আটকানো',
  'sms.creditsOut': 'রিসেলারদের হাতে ক্রেডিট',
  'sms.pricePerCredit': 'প্রতি ক্রেডিটের দাম',

  'sms.log': 'SMS রেকর্ড',
  'sms.logHelp': 'এই প্ল্যাটফর্ম থেকে যাওয়া প্রতিটি SMS এখানে লেখা থাকে',
  'sms.none': 'এখনো কোনো SMS নেই',
  'sms.noneHelp': 'SMS পাঠানো শুরু হলে প্রতিটি মেসেজ এখানে দেখা যাবে',
  'sms.search': 'নম্বর বা মেসেজের লেখা',

  'sms.statusSent': 'পৌঁছেছে',
  'sms.statusFailed': 'ব্যর্থ',
  'sms.statusBlocked': 'আটকানো',

  'sms.purposeNotification': 'বিজ্ঞপ্তি',
  'sms.purposeTest': 'পরীক্ষা',
  'sms.purposeManual': 'নিজে লেখা',

  'sms.reasonFeatureOff': 'SMS বন্ধ ছিল',
  'sms.reasonNotConfigured': 'গেটওয়ে যুক্ত ছিল না',
  'sms.reasonNoCredits': 'রিসেলারের ক্রেডিট ছিল না',
  'sms.reasonNoRecipient': 'নম্বর ছিল না',
  'sms.reasonEmptyText': 'মেসেজ খালি ছিল',

  'sms.detail': 'SMS-এর বিস্তারিত',
  'sms.message': 'মেসেজ',
  'sms.recipient': 'প্রাপক',
  'sms.shop': 'দোকান',
  'sms.segments': 'অংশ',
  'sms.encoding': 'অক্ষর',
  'sms.encodingUnicode': 'বাংলা (৭০ অক্ষরে এক অংশ)',
  'sms.encodingGsm': 'ইংরেজি (১৬০ অক্ষরে এক অংশ)',
  'sms.credits': 'ক্রেডিট',
  'sms.refunded': 'ফেরত',
  'sms.providerId': 'গেটওয়ে আইডি',
  'sms.providerCode': 'গেটওয়ে কোড',
  'sms.providerReply': 'গেটওয়ে যা বলেছে',
  'sms.duration': 'সময় লেগেছে',
  'sms.event': 'ঘটনা',
  'sms.resend': 'আবার পাঠান',
  'sms.resendHelp': 'নতুন একটি মেসেজ যাবে, আর নতুন ক্রেডিট কাটবে',
  'sms.resent': 'আবার পাঠানো হয়েছে',

  'sms.test': 'পরীক্ষামূলক SMS',
  'sms.testHelp': 'গেটওয়ে ঠিকমতো কাজ করছে কি না নিজের নম্বরে দেখে নিন',
  'sms.testWhileOff': 'SMS বন্ধ থাকলেও এই পরীক্ষাটি যাবে। কোনো রিসেলারের ক্রেডিট কাটবে না।',
  'sms.testSend': 'পাঠান',
  'sms.testText': 'যা লিখবেন',
  'sms.costHint': 'অংশ, অর্থাৎ এতটি SMS-এর খরচ',

  'landing.faq2': 'আমার নিজের ক্রেতা না থাকলে?',
  'landing.faq2Help':
    'নিজের ফেসবুক, হোয়াটসঅ্যাপ বা পরিচিতদের মধ্যেই শুরু করা যায়। আপনার অর্ডার ফরমের লিংক যে কেউ খুলে অর্ডার দিতে পারে।',
  'landing.faq3': 'দাম কি আমি ঠিক করতে পারব?',
  'landing.faq3Help':
    'হ্যাঁ। ক্রয়মূল্যের নিচে নামানো যাবে না, আর কিছু পণ্যে সর্বোচ্চ দাম বেঁধে দেওয়া থাকতে পারে। এর মাঝে দাম আপনার।',
  'landing.faq4': 'কেওয়াইসি কেন লাগে?',
  'landing.faq4Help':
    'টাকার লেনদেন হয় বলে পরিচয় নিশ্চিত করা দরকার। কেওয়াইসি অনুমোদনের আগেও আপনি দাম ঠিক করে রাখতে পারবেন, শুধু অর্ডার নেওয়া চালু হবে অনুমোদনের পর।',

  'landing.finalTitle': 'আজই শুরু করুন',
  'landing.finalHelp': 'রেজিস্ট্রেশনে দুই মিনিট লাগে। আমের মৌসুম অপেক্ষা করে না।',
  'landing.footerNote': 'রিসেলারদের জন্য অর্ডার ব্যবস্থাপনা',
  'landing.track': 'অর্ডার ট্র্যাক করুন',

  'app.description': 'রিসেলার অর্ডার ম্যানেজমেন্ট সিস্টেম',

  'order.notFound': 'অর্ডারটি পাওয়া যায়নি',
  'order.notFoundHelp': 'লিংকটি ভুল হতে পারে, অথবা এই অর্ডারটি আপনার নয়',

  /* Correcting an order's customer details. PLAN-2 decision 9. */
  'customerEdit.action': 'সংশোধন',
  'customerEdit.title': 'ক্রেতার তথ্য সংশোধন',
  'customerEdit.name': 'ক্রেতার নাম',
  'customerEdit.phone': 'ক্রেতার মোবাইল নম্বর',
  'customerEdit.help':
    'পার্সেল পাঠানোর আগ পর্যন্ত নাম, মোবাইল, ঠিকানা ও জেলা ঠিক করা যায়। পণ্য বা পরিমাণ বদলাতে অর্ডার বাতিল করে নতুন অর্ডার দিন।',
  'customerEdit.saved': 'ক্রেতার তথ্য সংরক্ষণ হয়েছে',
  'customerEdit.zoneChangedTitle': 'ডেলিভারি এলাকা বদলেছে',
  'customerEdit.zoneChangedOwner':
    'নতুন জেলাটি "{zone}" এলাকায় পড়ে, যার ডেলিভারি চার্জ {amount}। অর্ডারে এখন {current} আছে।',
  'customerEdit.zoneChangedReseller':
    'নতুন জেলাটি অন্য ডেলিভারি এলাকায় পড়ে। প্রয়োজনে মালিক ডেলিভারি চার্জ সমন্বয় করতে পারেন।',
  'customerEdit.applyCharge': 'চার্জ {amount} করুন',
  'customerEdit.keepCharge': 'যেমন আছে রাখুন',
  'customerEdit.chargeApplied': 'ডেলিভারি চার্জ {amount} করা হয়েছে',
  'customerEdit.historyRow': 'ক্রেতার তথ্য সংশোধন',
  'customerEdit.changedFields': 'বদলেছে: {fields}',
  'customerEdit.fieldName': 'নাম',
  'customerEdit.fieldPhone': 'মোবাইল',
  'customerEdit.fieldAddress': 'ঠিকানা',
  'customerEdit.fieldDistrict': 'জেলা',

  /* A deactivated reseller's read-only account. docs/adr/0011. */
  'inactive.bannerTitle': 'অ্যাকাউন্ট নিষ্ক্রিয়',
  'inactive.bannerBody':
    'আপনার অ্যাকাউন্ট নিষ্ক্রিয় করা হয়েছে। আপনি সব হিসাব ও অর্ডার দেখতে পারবেন, কিন্তু নতুন কিছু করতে পারবেন না। ব্যালেন্সে টাকা থাকলে তোলার অনুরোধ করতে পারবেন।',
  'inactive.bannerWithdraw': 'টাকা তোলার অনুরোধ করুন',
  'inactive.noNewOrders': 'নিষ্ক্রিয় অ্যাকাউন্ট থেকে নতুন অর্ডার নেওয়া যায় না।',

  'shop.notAcceptingTitle': 'এই দোকান এখন অর্ডার নিচ্ছে না',
  'shop.notAcceptingHelp': 'এই মুহূর্তে অর্ডার নেওয়া বন্ধ আছে। জানতে উপরের নম্বরে দোকানের সাথে যোগাযোগ করুন।',

  'kyc.pendingHelp': 'আপনার কাগজপত্র যাচাই করা হচ্ছে। সিদ্ধান্ত জানানো পর্যন্ত নতুন করে জমা দেওয়ার দরকার নেই।',

  'reseller.deactivatedAt': 'নিষ্ক্রিয় করা হয়েছে {at}',
  'reports.payable': 'রিসেলারদের পাওনা',
  'reseller.deactivatedResult': 'রিসেলার নিষ্ক্রিয় করা হয়েছে',
  'reseller.deactivatedNoPending': 'অপেক্ষমাণ কোনো অর্ডার ছিল না, তাই কিছু বাতিল হয়নি।',
  'reseller.deactivatedCancelled': 'অপেক্ষমাণ {n}টি অর্ডার বাতিল হয়েছে:',

  /* The owner's audit log. */
  'nav.audit': 'অডিট লগ',
  'audit.title': 'অডিট লগ',
  'audit.subtitle': 'কে কখন কী বদলেছে',
  'audit.action': 'কাজ',
  'audit.target': 'কীসের উপর',
  'audit.actor': 'কে করেছেন',
  'audit.actorMe': 'আমি (মালিক)',
  'audit.system': 'সিস্টেম',
  'audit.changes': 'পরিবর্তন',
  'audit.showChanges': '{n}টি পরিবর্তন দেখুন',
  'audit.clearFilters': 'ফিল্টার মুছুন',
  'audit.empty': 'এখনো কিছু লেখা হয়নি',
  'audit.emptyFiltered': 'ফিল্টার বদলে বা তারিখের সীমা বাড়িয়ে দেখুন',
  'audit.yes': 'হ্যাঁ',
  'audit.no': 'না',
  'audit.group.order': 'অর্ডার',
  'audit.group.reseller': 'রিসেলার',
  'audit.group.kyc': 'KYC',
  'audit.group.deposit': 'টাকা জমা',
  'audit.group.withdrawal': 'টাকা উত্তোলন',
  'audit.group.ledger': 'হিসাব সমন্বয়',
  'audit.group.product': 'পণ্য',
  'audit.group.source': 'উৎস',
  'audit.group.zone': 'ডেলিভারি এলাকা',
  'audit.group.settings': 'সেটিংস',
  'audit.group.user': 'অ্যাকাউন্ট',
  'audit.target.Order': 'অর্ডার',
  'audit.target.ResellerProfile': 'রিসেলার',
  'audit.target.User': 'অ্যাকাউন্ট',
  'audit.target.KycSubmission': 'KYC জমা',
  'audit.target.Deposit': 'টাকা জমা',
  'audit.target.Withdrawal': 'টাকা উত্তোলন',
  'audit.target.Product': 'পণ্য',
  'audit.target.ResellerProduct': 'রিসেলারের পণ্য',
  'audit.target.Source': 'উৎস',
  'audit.target.DeliveryZone': 'ডেলিভারি এলাকা',
  'audit.target.Setting': 'সেটিংস',
  'audit.action.order.cancel': 'অর্ডার বাতিল',
  'audit.action.order.return': 'অর্ডার ফেরত',
  'audit.action.order.delivery_charge': 'ডেলিভারি চার্জ পরিবর্তন',
  'audit.action.order.edit_customer': 'ক্রেতার তথ্য সংশোধন',
  'audit.action.reseller.credit_limit': 'ক্রেডিট সীমা পরিবর্তন',
  'audit.action.reseller.deactivate': 'রিসেলার নিষ্ক্রিয়',
  'audit.action.reseller.reactivate': 'রিসেলার আবার সক্রিয়',
  'audit.action.reseller.sms_enabled': 'রিসেলারের SMS চালু/বন্ধ',
  'audit.action.reseller.password_reset': 'রিসেলারের পাসওয়ার্ড রিসেট',
  'audit.action.reseller.listing_create': 'রিসেলারের পণ্য চালু',
  'audit.action.reseller.listing_update': 'রিসেলারের দাম পরিবর্তন',
  'audit.action.reseller.listing_remove': 'রিসেলারের পণ্য সরানো',
  'audit.action.reseller.kyc_required': 'কেওয়াইসি চাওয়া হলো/বাতিল',
  'audit.action.kyc.approve': 'KYC অনুমোদন',
  'audit.action.kyc.reject': 'KYC বাতিল',
  'audit.action.kyc.view_documents': 'KYC কাগজ দেখা',
  'audit.action.deposit.approve': 'জমা অনুমোদন',
  'audit.action.deposit.reject': 'জমা বাতিল',
  'audit.action.withdrawal.approve': 'উত্তোলন অনুমোদন',
  'audit.action.withdrawal.reject': 'উত্তোলন বাতিল',
  'audit.action.ledger.manual': 'হাতে হিসাব সমন্বয়',
  'audit.action.product.create': 'নতুন পণ্য',
  'audit.action.product.reprice': 'পণ্যের দাম পরিবর্তন',
  'audit.action.product.archive': 'পণ্য আর্কাইভ',
  'audit.action.product.unarchive': 'পণ্য আর্কাইভ থেকে ফেরত',
  'audit.action.source.archive': 'উৎস আর্কাইভ',
  'audit.action.source.unarchive': 'উৎস আর্কাইভ থেকে ফেরত',
  'audit.action.zone.activate': 'ডেলিভারি এলাকা চালু',
  'audit.action.zone.deactivate': 'ডেলিভারি এলাকা বন্ধ',
  'audit.action.zone.delete': 'ডেলিভারি এলাকা মুছে ফেলা',
  'audit.action.settings.update': 'সেটিংস পরিবর্তন',
  'audit.action.settings.sms_toggle': 'মূল SMS সুইচ',
  'audit.action.settings.brand_logo': 'ব্র্যান্ড লোগো পরিবর্তন',
  'audit.action.user.password_change': 'পাসওয়ার্ড পরিবর্তন',
  'audit.action.user.password_reset_otp': 'কোড দিয়ে পাসওয়ার্ড রিসেট',
  'audit.action.user.phone_change': 'মোবাইল নম্বর পরিবর্তন',

  'push.title': 'ফোনে নোটিফিকেশন',
  'push.subtitle': 'ফোনে সাথে সাথে জানতে চালু করুন',
  'push.enable': 'নোটিফিকেশন চালু করুন',
  'push.notConfigured': 'সার্ভারে পুশ নোটিফিকেশন চালু করা হয়নি',
  'push.iosInstall':
    'আইফোনে নোটিফিকেশন পেতে সাফারির শেয়ার মেনু থেকে "Add to Home Screen" চাপুন, তারপর ইনস্টল করা অ্যাপ থেকে খুলুন',
  'push.denied': 'ব্রাউজারের সেটিংস থেকে এই সাইটের নোটিফিকেশন অনুমতি দিন',
  'push.stateUnsupported': 'এই ব্রাউজারে চলে না',
  'push.stateIosInstall': 'আগে ইনস্টল করুন',
  'push.stateDefault': 'চালু হয়নি',
  'push.stateGranted': 'চালু আছে',
  'push.stateDenied': 'অনুমতি নেই',

  'telegram.title': 'টেলিগ্রাম',
  'telegram.subtitle': 'বিনামূল্যে এবং নির্ভরযোগ্য',
  'telegram.connect': 'টেলিগ্রাম যুক্ত করুন',
  'telegram.open': 'টেলিগ্রাম খুলুন',

  /* ------------------------------------------------ phase f: messaging -- */

  'telegram.linked': 'যুক্ত আছে',
  'telegram.notLinked': 'যুক্ত নেই',
  'telegram.linkedSince': 'যুক্ত হয়েছে',
  'telegram.unlink': 'সংযোগ বিচ্ছিন্ন করুন',
  'telegram.unlinked': 'টেলিগ্রামের সংযোগ বিচ্ছিন্ন হয়েছে',
  'telegram.openHelp': 'টেলিগ্রাম খুলে Start চাপুন। লিংকটি ১৫ মিনিট কাজ করবে।',
  'telegram.checkStatus': 'যুক্ত হলো কি না দেখুন',
  'telegram.notConfigured': 'সার্ভারে টেলিগ্রাম চালু করা হয়নি',
  'telegram.noBotUsername': 'বটের নাম পাওয়া যায়নি। বটকে এই বার্তা পাঠান:',
  'telegram.featureOff': 'টেলিগ্রাম নোটিফিকেশন এখন বন্ধ রাখা আছে',

  'prefs.title': 'কোন খবর কোথায় পাবেন',
  'prefs.subtitle': 'অ্যাপের ভেতরের তালিকায় সব খবর সব সময় থাকবে। বাকিগুলো আপনার পছন্দমতো।',
  'prefs.link': 'নোটিফিকেশন সেটিংস',
  'prefs.group.orders': 'অর্ডার',
  'prefs.group.wallet': 'টাকা',
  'prefs.group.kyc': 'কেওয়াইসি',
  'prefs.group.alerts': 'সতর্কতা',
  'prefs.channel.push': 'ফোনে',
  'prefs.channel.telegram': 'টেলিগ্রাম',
  'prefs.channel.sms': 'SMS',
  'prefs.smsUnavailableReseller': 'SMS এখন আপনার জন্য চালু নেই, তাই SMS-এর ঘরগুলো কাজ করবে না',
  'prefs.smsUnavailableOwner': 'SMS গেটওয়ে যুক্ত নেই, তাই SMS-এর ঘরগুলো কাজ করবে না',
  'prefs.smsCostReseller': 'প্রতিটি SMS-এ আপনার ক্রেডিট কাটবে',
  'prefs.smsCostOwner': 'SMS-এর খরচ ব্যবসার গেটওয়ে ব্যালেন্স থেকে যাবে',
  'prefs.locked': 'নিরাপত্তার জন্য সব সময় চালু',
  'prefs.telegramNotLinked': 'টেলিগ্রাম যুক্ত না করা পর্যন্ত টেলিগ্রামে কিছু যাবে না',
  'prefs.pushOff': 'ফোনের নোটিফিকেশন সার্ভারে বা মালিকের সেটিংসে বন্ধ আছে',

  'event.order.pending': 'নতুন অর্ডার এসেছে',
  'event.order.confirmed': 'রিসেলার অর্ডার নিশ্চিত করেছেন',
  'event.order.accepted': 'অর্ডার গ্রহণ',
  'event.order.shipped': 'অর্ডার পাঠানো',
  'event.order.delivered': 'ডেলিভারি হয়েছে',
  'event.order.cancelled': 'অর্ডার বাতিল',
  'event.order.returned': 'অর্ডার ফেরত',
  'event.order.customer_edited': 'ঠিকানা বা ফোন বদল',
  'event.kyc.approved': 'কেওয়াইসি অনুমোদন',
  'event.kyc.rejected': 'কেওয়াইসি ফেরত',
  'event.deposit.approved': 'জমা অনুমোদন',
  'event.deposit.rejected': 'জমা গ্রহণ হয়নি',
  'event.withdrawal.approved': 'উত্তোলন অনুমোদন',
  'event.withdrawal.rejected': 'উত্তোলন গ্রহণ হয়নি',
  'event.balance.near_limit': 'ব্যালেন্স সীমার কাছে',
  'event.reseller.deactivated': 'অ্যাকাউন্ট বন্ধ',
  'event.reseller.reactivated': 'অ্যাকাউন্ট আবার চালু',
  'event.alert.ledger_drift': 'লেজারে গরমিল',
  'event.alert.daily_digest': 'সকালের সতর্কতা',
  'event.alert.new_device': 'নতুন ডিভাইসে লগইন',

  'customerSms.send': 'গ্রাহককে SMS পাঠান',
  'customerSms.sendHint': 'ইংরেজিতে, ব্যবসার খরচে। ঠিক যে লেখাটি যাবে তা নিচে দেখুন',
  'customerSms.unavailable': 'SMS গেটওয়ে যুক্ত নেই, তাই গ্রাহককে SMS পাঠানো যাবে না',
  'customerSms.preview': 'যে মেসেজ যাবে',
  'customerSms.to': 'প্রাপক',
  'customerSms.chars': 'অক্ষর',
  'customerSms.segments': 'অংশ',
  'customerSms.loading': 'মেসেজ তৈরি হচ্ছে...',

  'settings.customerSms': 'গ্রাহকের SMS',
  'settings.customerSmsHint':
    'অর্ডার গ্রহণ, পাঠানো আর বাতিলের সময় চাইলে গ্রাহককে এই লেখা যাবে। শুধু ইংরেজি অক্ষর, সর্বোচ্চ ৩ অংশ।',
  'settings.templateAccept': 'অর্ডার গ্রহণের সময়',
  'settings.templateShip': 'অর্ডার পাঠানোর সময়',
  'settings.templateCancel': 'অর্ডার বাতিলের সময়',
  'settings.placeholders': 'চাপলে ঘরটি লেখায় বসবে',
  'settings.templateInvalidChars': 'শুধু ইংরেজি অক্ষর চলবে। এগুলো বাদ দিন:',
  'settings.templateUnknownPlaceholder': 'অচেনা ঘর:',
  'settings.templateTooLong': 'মেসেজটি ৩ অংশের বেশি হয়ে গেছে',
  'settings.templateRequired': 'লেখা খালি রাখা যাবে না',
  'settings.noTrackUrl': 'ওয়েবসাইটের ঠিকানা (PUBLIC_APP_URL) সেট করা নেই, তাই ট্র্যাক লিংক বাদ যাবে',
  'settings.templateBeforeFill': 'ঘরগুলো পূরণের আগে',

  'placeholder.customer': 'গ্রাহকের নাম',
  'placeholder.shop': 'দোকান',
  'placeholder.code': 'অর্ডার কোড',
  'placeholder.courier': 'কুরিয়ার',
  'placeholder.trackingId': 'ট্র্যাকিং নম্বর',
  'placeholder.trackUrl': 'ট্র্যাক লিংক',
  'placeholder.reason': 'কারণ',
  'placeholder.total': 'মোট দাম',

  'smsCredits.title': 'SMS ক্রেডিট',
  'smsCredits.subtitle': 'জরুরি খবর SMS-এ পেতে ক্রেডিট কিনুন। দাম ওয়ালেট থেকে কাটবে।',
  'smsCredits.balance': 'হাতে আছে',
  'smsCredits.price': 'প্রতি ক্রেডিট',
  'smsCredits.buy': 'ক্রেডিট কিনুন',
  'smsCredits.quantity': 'কতটি ক্রেডিট',
  'smsCredits.cost': 'মোট খরচ',
  'smsCredits.bought': 'ক্রেডিট কেনা হয়েছে',
  'smsCredits.notEnabled': 'মালিক এখনো আপনার জন্য SMS চালু করেননি। কেনা ক্রেডিট চালু হলে কাজে লাগবে।',
  'smsCredits.invalidQuantity': '১ থেকে ১০,০০০ এর মধ্যে একটি পূর্ণ সংখ্যা দিন',

  'money.required': 'টাকার পরিমাণ লিখুন',
  'money.invalid': 'শুধু ইংরেজি অঙ্কে লিখুন, দশমিকের পর সর্বোচ্চ দুই ঘর',
  'money.positive': 'পরিমাণ শূন্যের বেশি হতে হবে',
  'money.tooLarge': 'পরিমাণ অনেক বেশি',
  'money.overAvailable': 'ব্যবহারযোগ্য ব্যালেন্সের চেয়ে বেশি',

  'reseller.manage': 'পরিচালনা',
  'reseller.account': 'অ্যাকাউন্ট',
  'reseller.active': 'সক্রিয়',
  'reseller.inactive': 'নিষ্ক্রিয়',
  'reseller.activeHint': 'এই রিসেলার এখন অর্ডার নিতে পারছেন',
  'reseller.inactiveHint': 'এই রিসেলার নিষ্ক্রিয় আছেন। চালু করলে আবার কাজ করতে পারবেন',
  'reseller.deactivate': 'নিষ্ক্রিয় করুন',
  'reseller.deactivateTitle': 'রিসেলারকে নিষ্ক্রিয় করবেন?',
  'reseller.deactivateHelp':
    'নিষ্ক্রিয় করলে এই রিসেলারের দোকানে নতুন অর্ডার নেওয়া বন্ধ হবে। ব্যালেন্স ও লেনদেনের হিসাব যেমন আছে তেমনই থাকবে।',
  /*
   * The one switch that puts the KYC module on a reseller's screens. Off for
   * everyone by default, so the warning matters: turning it on for a reseller
   * who is not approved yet closes their public form the moment it is saved.
   */
  'reseller.kycRequired': 'কেওয়াইসি চাওয়া হবে',
  'reseller.kycRequiredHint': 'চালু করলে এই রিসেলার কেওয়াইসি পাতা দেখতে ও কাগজ জমা দিতে পারবেন',
  'reseller.kycRequiredOff': 'বন্ধ আছে — এই রিসেলারের কাছে কোনো কাগজপত্র চাওয়া হচ্ছে না',
  'reseller.kycRequiredWarn':
    'অনুমোদন না হওয়া পর্যন্ত এই রিসেলারের দোকান বন্ধ থাকবে এবং নতুন অর্ডার নিতে পারবেন না।',
  'reseller.smsEnabled': 'SMS পাঠানো চালু',
  'reseller.smsEnabledHint': 'এই রিসেলারের ক্রেডিট থেকে SMS যাবে। মূল SMS সুইচ বন্ধ থাকলে কিছুই যাবে না',

  'ledger.direction': 'ধরন',
  'ledger.manualCredit': 'ব্যালেন্সে যোগ (হাতে সমন্বয়)',
  'ledger.manualDebit': 'ব্যালেন্স থেকে কাটা (হাতে সমন্বয়)',

  'reconcile.matched': 'হিসাব মিলেছে',
  'reconcile.checkedOk': '{n}টি হিসাব মিলেছে',
  'reconcile.drifted': '{n}টিতে গরমিল',

  'catalog.step': 'ধাপ',
  'catalog.stepHint': 'যত পরিমাণের গুণিতকে অর্ডার নেওয়া হবে',

  'settings.poweredBy': 'ফর্মের নিচের লেখা',
  'settings.poweredByHint': 'ক্রেতার ফর্মের নিচে দেখানো হবে',
  'settings.defaultCreditLimitHint': 'নতুন রিসেলারের জন্য শুরুতে যত',
  'settings.agingHoursHint': 'কত ঘণ্টা পর অর্ডার পুরনো ধরা হবে',
  'settings.reverseDeliveryCharge': 'ফেরত এলে ডেলিভারি চার্জও ফেরত দিন',
  'settings.reverseDeliveryChargeHint': 'বন্ধ রাখলে কুরিয়ার খরচ রিসেলারের কাছেই থাকবে',
  'settings.smsBalance': 'SMS ব্যালেন্স',
  'settings.smsNotConfigured': 'SMS গেটওয়ে যুক্ত করা হয়নি',
  'settings.featureSms': 'SMS',
  'settings.featureSmsHint': 'চালু করলে রিসেলাররা SMS ক্রেডিট কিনতে পারবে',
  'settings.featureTelegram': 'টেলিগ্রাম',
  'settings.featureWebPush': 'ব্রাউজার নোটিফিকেশন',
  'settings.smsPricePerCredit': 'প্রতি SMS ক্রেডিটের দাম',

  'reports.atLimit': 'সীমা শেষ',
  'reports.from': 'শুরু',
  'reports.to': 'শেষ',

  'shop.metaTitle': 'দোকান',
  'shop.metaDescription': 'সরাসরি অর্ডার করুন',
  'shop.slugHint': 'a-z, 0-9 এবং হাইফেন',

  /* public landing page */
  'landing.orderNow': 'এখনই অর্ডার করুন',
  'landing.callNow': 'কল করুন',
  'landing.whatsapp': 'হোয়াটসঅ্যাপ',
  'landing.facebook': 'ফেসবুক পেজ',
  'landing.customers': 'সন্তুষ্ট ক্রেতা',
  'landing.rating': 'রেটিং',
  'landing.whyUs': 'কেন আমাদের থেকে কিনবেন?',
  'landing.features': 'পণ্যের বৈশিষ্ট্য',
  'landing.tips': 'আম সংরক্ষণ ও খাওয়ার নিয়ম',
  'landing.reviews': 'ক্রেতাদের মতামত',
  'landing.faq': 'সাধারণ জিজ্ঞাসা',
  'landing.video': 'ভিডিওতে দেখুন',
  'landing.packages': 'প্যাকেজ বেছে নিন',
  'landing.orderTitle': 'অর্ডার করতে নিচের ফর্মটি পূরণ করুন',
  'landing.orderHelp': 'পরিমাণ বেছে নিয়ে নাম, মোবাইল নম্বর ও ঠিকানা দিন',
  'landing.contactTitle': 'যেকোনো প্রশ্নে যোগাযোগ করুন',
  'landing.contactHelp': 'অর্ডার বা আম নিয়ে জানতে সরাসরি কল বা মেসেজ করুন',
  'landing.offerPrice': 'অফার মূল্য',
  'landing.regularPrice': 'নিয়মিত মূল্য',
  'landing.save': 'সাশ্রয়',
  'landing.off': 'ছাড়',
  'landing.cod': 'ক্যাশ অন ডেলিভারি',
  'landing.chooseProducts': 'পণ্য বেছে নিতে এখানে চাপুন',
  'landing.previewBanner': 'এটি ডিজাইনের প্রিভিউ। ক্রেতারা আপনার বেছে নেওয়া ডিজাইন দেখবে।',
  'landing.template.bagan': 'বাগান প্রিমিয়াম',
  'landing.template.baganHelp': 'গাঢ় সবুজ, ছবির স্লাইড, রেটিং ও প্যাকেজ কার্ড। কম পণ্যের প্রিমিয়াম দোকানে মানায়।',
  'landing.template.krishok': 'কৃষক গাইড',
  'landing.template.krishokHelp': 'সাদামাটা সবুজ, বিস্তারিত বর্ণনা, সংরক্ষণের টিপস ও রিভিউ। বেশি তথ্য চাওয়া ক্রেতার জন্য।',
  'landing.template.offer': 'অফার ভিডিও',
  'landing.template.offerHelp': 'উজ্জ্বল রং, ভিডিও আগে, ছাড় ও সাশ্রয় বড় করে দেখায়। সিজনের অফারে মানায়।',

  /* reseller: design picker */
  'shop.design': 'ল্যান্ডিং পেজের ডিজাইন',
  'shop.designHelp': 'ক্রেতারা আপনার লিংকে এই ডিজাইন দেখবে। লেখা ও ছবি মালিক দেন, যোগাযোগের তথ্য আপনার।',
  'shop.designPreview': 'প্রিভিউ দেখুন',
  'shop.designChosen': 'বেছে নেওয়া হয়েছে',
  'shop.designSaved': 'ডিজাইন বদলানো হয়েছে',
  'catalog.regularPrice': 'নিয়মিত দাম (ঐচ্ছিক)',
  'catalog.regularPriceHint': 'পেজে কেটে দেখানো হবে, আপনার দামের চেয়ে বেশি হতে হবে',

  /* owner: landing content editor */
  'nav.landing': 'ল্যান্ডিং পেজ',
  'landingEdit.subtitle': 'সব রিসেলারের পেজে এই লেখা ও ছবি দেখাবে। যোগাযোগের তথ্য প্রত্যেক রিসেলারের নিজের।',
  'landingEdit.hero': 'প্রথম অংশ (হিরো)',
  'landingEdit.headline': 'শিরোনাম',
  'landingEdit.subtitleField': 'উপশিরোনাম',
  'landingEdit.heroImages': 'বড় ছবি (সর্বোচ্চ ৬টি)',
  'landingEdit.heroImagesHint': 'খালি থাকলে পণ্যের ছবি দেখানো হবে',
  'landingEdit.uploadImages': 'ছবি আপলোড করুন',
  'landingEdit.videoUrl': 'ভিডিও লিংক',
  'landingEdit.videoUrlHint': 'ইউটিউব লিংক বা MP4 ফাইলের লিংক, যেভাবে খুশি লিখুন',
  'landingEdit.rating': 'রেটিং (০-৫)',
  'landingEdit.customerCount': 'ক্রেতার সংখ্যা',
  'landingEdit.trustHint': 'শুধু সত্য তথ্য দিন। খালি রাখলে দেখানো হবে না।',
  'landingEdit.deliveryNote': 'ডেলিভারির কথা',
  'landingEdit.guaranteeNote': 'গ্যারান্টির কথা',
  'landingEdit.badges': 'বিশ্বাসের ব্যাজ',
  'landingEdit.whyUs': 'কেন আমাদের থেকে কিনবেন',
  'landingEdit.features': 'পণ্যের বৈশিষ্ট্য',
  'landingEdit.tips': 'সংরক্ষণ ও খাওয়ার টিপস',
  'landingEdit.faqs': 'সাধারণ জিজ্ঞাসা',
  'landingEdit.question': 'প্রশ্ন',
  'landingEdit.answer': 'উত্তর',
  'landingEdit.title': 'শিরোনাম',
  'landingEdit.text': 'বর্ণনা',
  'landingEdit.icon': 'আইকন',
  'landingEdit.add': 'যোগ করুন',
  'landingEdit.remove': 'মুছুন',
  'landingEdit.reviews': 'ক্রেতাদের রিভিউ',
  'landingEdit.reviewsHint': 'লেখা, স্ক্রিনশট বা দুটোই দিতে পারেন',
  'landingEdit.reviewName': 'ক্রেতার নাম',
  'landingEdit.reviewText': 'রিভিউ',
  'landingEdit.reviewImage': 'স্ক্রিনশট (ঐচ্ছিক)',
  'landingEdit.addReview': 'রিভিউ যোগ করুন',
  'landingEdit.saved': 'ল্যান্ডিং পেজ সংরক্ষণ হয়েছে',
  'landingEdit.max': 'সর্বোচ্চ',
  'landingEdit.icon.leaf': 'পাতা',
  'landingEdit.icon.shield': 'ঢাল',
  'landingEdit.icon.truck': 'ট্রাক',
  'landingEdit.icon.star': 'তারা',
  'landingEdit.icon.heart': 'হৃদয়',
  'landingEdit.icon.package': 'প্যাকেট',
  'landingEdit.icon.clock': 'ঘড়ি',
  'landingEdit.icon.sun': 'সূর্য',
  'landingEdit.icon.check': 'টিক',
  'landingEdit.icon.gift': 'উপহার',
  'landingEdit.icon.snowflake': 'ঠান্ডা',
  'landingEdit.icon.wallet': 'টাকা',

  'dash.agingHint': '{n}+ ঘণ্টা',

  'zone.help': 'ক্রেতা জেলা বাছাই করলে এই চার্জ যোগ হবে',
  'zone.districtsHint': 'এই জোনে যে জেলাগুলো থাকবে সেগুলো বেছে নিন',

  /*
   * The sixty-four districts. The list is too long to scroll on a phone, so
   * every one of these screens is a search box first. See lib/districts.ts.
   */
  'district.choose': 'জেলা বাছাই করুন',
  'district.search': 'জেলার নাম লিখে খুঁজুন',
  'district.noMatch': 'এই নামে কোনো জেলা পাওয়া যায়নি',
  'district.noDelivery': 'এই জেলায় এখনো ডেলিভারি নেই',
  'district.selectedCount': '{n}টি জেলা বাছাই করা হয়েছে',
  'source.help': 'যেখান থেকে পণ্য সংগ্রহ করা হয়',

  /*
   * Reports and printing.
   *
   * Every report in the owner panel is a page that prints, so the wording has to
   * carry the one thing the button cannot: that a PDF comes out of the browser's
   * own print sheet, under "Save as PDF", rather than landing in Downloads by
   * itself. Said once, on the button's hint, rather than in a dialog nobody reads.
   */
  // On a dispatch block: the courier collects nothing here.
  'order.paid': 'টাকা নেওয়া হয়েছে',
  // A deactivated reseller, on a report row. See docs/adr/0011.
  'app.inactive': 'বন্ধ',
  // Written in by hand in the orchard: what actually came back.
  'report.actual': 'পাওয়া গেল',
  'report.products': 'স্টক ও বিক্রয় রিপোর্ট',
  'report.productsHint': 'হাতে কত আছে, কত যাচ্ছে',
  'report.customers': 'কাস্টমার রিপোর্ট',
  'report.customersHint': 'কে বেশি কেনে, কে পার্সেল ফেরত দেয়',
  'report.stock': 'স্টক',
  'report.perDay': 'দিনে গড়',
  'report.daysLeft': 'চলবে (দিন)',
  'report.topCustomers': 'সেরা ক্রেতা',
  'report.riskyCustomers': 'ঝুঁকিপূর্ণ নম্বর',
  'report.riskyHint': 'যারা পার্সেল নেয়নি বা ফেরত দিয়েছে',
  'report.delivered': 'পৌঁছেছে',
  'report.spend': 'মোট কিনেছে',
  'report.lastOrder': 'শেষ অর্ডার',
  'report.untracked': 'হিসাব নেই',
  /*
   * Complaints, and the orchard record they add up to.
   *
   * The wording stays away from "review": a review is something a customer
   * writes on a landing page, and this is the owner writing down what somebody
   * said on the phone so that the orchard behind it can be counted.
   */
  'complaint.title': 'অভিযোগ',
  'complaint.plural': 'অভিযোগ',
  'complaint.add': 'অভিযোগ লিখুন',
  'complaint.addHint': 'কাস্টমার কী বলল, আর কোন পণ্যে সমস্যা',
  'complaint.none': 'এই অর্ডারে কোনো অভিযোগ নেই',
  'complaint.noneAll': 'কোনো অভিযোগ নেই',
  'complaint.kind': 'কী সমস্যা',
  'complaint.note': 'বিস্তারিত',
  'complaint.notePlaceholder': 'কাস্টমার ঠিক কী বলেছে',
  'complaint.items': 'কোন পণ্যে সমস্যা',
  'complaint.itemsHint': 'যে পণ্যে সমস্যা সেটি বাছুন — তাহলেই বোঝা যাবে কোন বাগান থেকে এসেছিল',
  'complaint.noItems': 'কোনো পণ্যের সমস্যা নয় (যেমন ডেলিভারি)',
  'complaint.open': 'খোলা',
  'complaint.resolved': 'সমাধান হয়েছে',
  'complaint.resolve': 'সমাধান হয়েছে চিহ্নিত করুন',
  'complaint.resolution': 'কী করা হলো',
  'complaint.resolvedOn': 'সমাধান',
  'complaint.saved': 'অভিযোগ লেখা হয়েছে',
  'complaint.openCount': '{n} টি খোলা অভিযোগ',
  'complaint.noSource': 'বাগান জানা নেই',
  'complaint.noSourceHint': 'অর্ডারটি গ্রহণ করার আগেই অভিযোগ এসেছে, তাই কোন বাগান তা জানা যায়নি',
  'complaint.forOrder': 'অর্ডার',
  'complaint.all': 'সব',

  /* The kinds. Kept short: this is picked on a phone, mid phone call. */
  'complaint.kind.quality': 'মান খারাপ',
  'complaint.kind.damaged': 'পচা / নষ্ট',
  'complaint.kind.short_weight': 'ওজনে কম',
  'complaint.kind.wrong_item': 'ভুল পণ্য',
  'complaint.kind.late': 'দেরিতে পৌঁছেছে',
  'complaint.kind.other': 'অন্যান্য',

  /* The orchard's record. */
  'source.record': 'এই বাগানের রেকর্ড',
  'source.supplied': 'সরবরাহ করেছে',
  'source.suppliedOrders': 'যত অর্ডারে',
  'source.complaintRate': 'অভিযোগের হার',
  'source.returnRate': 'ফেরতের হার',
  'source.noRecord': 'এখনো কিছু নেওয়া হয়নি',
  'source.recentOrders': 'সাম্প্রতিক অর্ডার',
  'source.viewOrders': 'সব অর্ডার দেখুন',
  'source.detail': 'বিস্তারিত',
  'source.avoid': 'এই বাগান এড়িয়ে চলুন',
  'source.avoidHint': 'অভিযোগের হার বেশি',
  'source.clean': 'রেকর্ড ভালো',
  'source.archivedNote': 'এই বাগান আর ব্যবহার হচ্ছে না',
  'report.sources': 'বাগান রিপোর্ট',
  'report.sourcesHint': 'কোন বাগানে কত অভিযোগ, কোনটা এড়াতে হবে',
  'report.print': 'প্রিন্ট / PDF',
  'report.download': 'ডাউনলোড',
  'report.downloadHint': 'প্রিন্ট বক্সে "Save as PDF" বেছে নিন',
  'report.generatedAt': 'তৈরি:',
  'report.reports': 'রিপোর্ট',
  'report.orderSheet': 'অর্ডার শিট',
  'report.orderSheetHint': 'কুরিয়ার ও প্যাকিংয়ের জন্য পূর্ণ ঠিকানাসহ',
  'report.sales': 'বিক্রয় রিপোর্ট',
  'report.salesHint': 'দিন, পণ্য ও পেমেন্ট অনুযায়ী',
  'report.resellers': 'রিসেলার রিপোর্ট',
  'report.resellersHint': 'কে কত বিক্রি করল, কার কত বাকি',
  'report.due': 'বাকি রিপোর্ট',
  'report.dueHint': 'রিসেলারদের বকেয়া ও ক্রেডিট সীমা',
  'report.pickList': 'সংগ্রহ তালিকা',
  'report.pickListHint': 'আজ কোন বাগান থেকে কত আনতে হবে',
  'report.noRows': 'এই সময়ে কিছু নেই',
  'report.truncated': 'অনেক বেশি অর্ডার। প্রথম {n} টি দেখানো হচ্ছে — তারিখ ছোট করুন।',
  'report.orderCount': '{n} টি অর্ডার',
  'report.rowCount': '{n} টি সারি',
  'report.openReports': 'সব রিপোর্ট',
  'report.pickChoose': 'কোন রিপোর্ট লাগবে?',
  'report.forDate': 'তারিখ',
  'report.summary': 'সারসংক্ষেপ',
  'report.byDay': 'দিন অনুযায়ী',
  'report.byProduct': 'পণ্য অনুযায়ী',
  'report.byPayment': 'পেমেন্ট অনুযায়ী',
  'report.notTraded': 'বাতিল ও ফেরত',
  'report.signature': 'স্বাক্ষর',
  'report.checkedBy': 'যাচাই করলেন',
  'report.total': 'সর্বমোট',
  'report.preparedBy': 'প্রস্তুত করলেন',
  'report.period': 'সময়কাল',
  'report.asOf': 'হিসাবের তারিখ',
  'report.generated': 'তৈরির সময়',
  'report.contents': 'বিবরণ',
  'report.computerGenerated': 'কম্পিউটারে তৈরি রিপোর্ট',
  'report.groupSales': 'বিক্রি ও অর্ডার',
  'report.groupPeople': 'রিসেলার, কাস্টমার ও বাগান',
  'report.groupCost': 'খরচ ও লাভ',
  'report.ranged': 'তারিখ অনুযায়ী',
  'report.snapshot': 'এখনকার অবস্থা',
  'report.export': 'ডেটা এক্সপোর্ট',
  'report.exportHint': 'Excel বা Google Sheets-এ খোলার জন্য CSV ফাইল',
  'report.glance': 'এক নজরে',

  /* The date filter above a list. */
  'range.label': 'তারিখ',
  'range.today': 'আজ',
  'range.yesterday': 'গতকাল',
  'range.last7': '৭ দিন',
  'range.last30': '৩০ দিন',
  'range.thisMonth': 'এই মাস',
  'range.all': 'সব সময়',
  'range.custom': 'নিজে বাছুন',
  'range.from': 'শুরু',
  'range.to': 'শেষ',
  'range.apply': 'দেখান',
  'range.invalid': 'শুরুর তারিখ শেষের পরে হতে পারে না',

  /* The owner dashboard's added figures. */
  'owner.salesToday': 'আজকের বিক্রি',
  'owner.ownerRevenue': 'আমার আয়',
  'owner.ownerRevenueHint': 'পণ্যের দাম + ডেলিভারি চার্জ',
  'owner.goodsValue': 'পণ্যের দাম',
  'owner.deliveryCollected': 'ডেলিভারি চার্জ',
  'owner.customerValue': 'কাস্টমার মোট',
  'owner.resellerMargin': 'রিসেলারদের লাভ',
  'owner.codInFlight': 'কুরিয়ারে টাকা',
  'owner.codInFlightHint': 'পাঠানো হয়েছে, এখনো হাতে আসেনি',
  'owner.closedToday': 'আজ শেষ হয়েছে',
  'owner.pendingKyc': 'KYC অপেক্ষায়',
  'owner.activeResellers': 'চালু রিসেলার',
  'owner.lowStock': 'স্টক শেষ',
  'owner.deadLetters': 'নোটিফিকেশন ব্যর্থ',
  'owner.smsOff': 'SMS বন্ধ আছে',
  'owner.health': 'সিস্টেম',
  'owner.healthOk': 'সব ঠিক আছে',
  'owner.trend': '৭ দিনের ধারা',
  'owner.pickToday': 'আজ আনতে হবে',
  'owner.pickUndecided': 'বাগান ঠিক হয়নি',
  'owner.noMoneyToday': 'আজ এখনো কোনো বিক্রি হয়নি',

  /* ------------------------------------------------------------- cost side */
  /* PLAN-3: inventory, payees, purchases, expenses and the profit report. */

  'nav.supplies': 'মালামাল',
  'nav.payees': 'পার্টি',
  'nav.purchases': 'মাল কেনা',
  'nav.expenses': 'খরচ',

  /* supplies */
  'supply.title': 'মালামাল',
  'supply.help': 'পার্সেল পাঠাতে যা যা লাগে — ক্যারেট, কাগজ, সুই। এগুলো বিক্রি হয় না, খরচ হয়ে যায়।',
  'supply.new': 'নতুন মাল',
  'supply.edit': 'তথ্য বদলান',
  'supply.name': 'কী জিনিস',
  'supply.unit': 'কীভাবে গোনেন',
  'supply.onHand': 'এখন আছে',
  'supply.avgCost': 'প্রতিটা পড়েছে',
  'supply.value': 'সব মিলিয়ে দাম',
  'supply.reorderLevel': 'কত কমলে জানাবো',
  'supply.reorderHint': 'এই সংখ্যায় নেমে গেলে লাল দেখাবে, যাতে কিনে রাখার কথা মনে থাকে। দরকার না হলে ০ রাখুন।',
  'supply.low': 'ফুরিয়ে আসছে',
  'supply.negative': 'হিসাবে গরমিল',
  'supply.negativeHint': 'খাতায় যা কেনা লেখা, তার চেয়ে বেশি খরচ হয়ে গেছে। কোনো কেনা লিখতে ভুলে গেছেন সম্ভবত। গুনে দেখে ঠিক করে নিন।',
  'supply.itemCount': 'কয় ধরনের মাল',
  'supply.movements': 'কী এলো, কী গেলো',
  'supply.movementsEmpty': 'এখনো কিছু আসেনি, কিছু যায়নি',
  'supply.purchaseHistory': 'কার কাছ থেকে কেনা হয়েছে',
  'supply.usedBy': 'কোন বক্সে লাগে',
  'supply.perBox': 'এক বক্সে লাগে',
  'supply.adjust': 'হাতে হিসাব ঠিক করুন',
  'supply.stockTake': 'গুনে দেখুন',
  'supply.stockTakeHelp': 'গুদামে গিয়ে গুনুন, তারপর যত পেলেন সেই সংখ্যাটা লিখুন। খাতার সাথে কত পার্থক্য সেটা নিজে থেকেই বসে যাবে — আপনাকে বিয়োগ করতে হবে না।',
  'supply.counted': 'গুনে কতটা পেলেন',
  'supply.countedAgreed': 'খাতার সাথে মিলে গেছে — কিছু বদলানোর দরকার হয়নি',
  'supply.adjustKind': 'কী হয়েছে',
  'supply.quantity': 'কতটা',
  'supply.unitCost': 'প্রতিটার দাম',
  'supply.onHandAfter': 'এরপর রইলো',
  'supply.estimated': 'ধরে নেওয়া',
  'supply.counted2': 'গুনে দেখা',
  'supply.estimatedHint': 'কেউ গুনে দেখেনি — বক্সে কী লাগে সেই হিসাব থেকে ধরে নেওয়া হয়েছে',
  'supply.archived': 'আর ব্যবহার হয় না',
  'supply.healthBad': 'এই মালের হিসাবে সফটওয়্যারের গরমিল ধরা পড়েছে — আমাদের জানান',

  /* movement kinds */
  'movement.OPENING': 'শুরুতে যা ছিল',
  'movement.PURCHASE': 'কেনা হয়েছে',
  'movement.CONSUMED': 'পার্সেলে গেছে',
  'movement.DAMAGED': 'নষ্ট হয়েছে',
  'movement.LOST': 'হারিয়ে গেছে',
  'movement.RETURN_TO_PAYEE': 'দোকানে ফেরত',
  'movement.ADJUSTMENT': 'গুনে ঠিক করা',
  'movement.REVERSAL': 'বাতিল হয়েছে',

  /* packaging recipe */
  'recipe.title': 'এই বক্সে কী কী লাগে',
  'recipe.help': 'একটা বক্স পাঠাতে কী কী লাগে লিখে দিন। তাহলে ডেলিভারি হলেই এই মালগুলো নিজে থেকে স্টক থেকে কমবে, আর অর্ডারে খরচ বসে যাবে। আধা-আধিও লেখা যায় — যেমন ১.৫ শিট কাগজ।',
  'recipe.add': 'আরেকটা মাল',
  'recipe.empty': 'কিছু লেখা নেই — এই বক্স পাঠালে কোনো মাল কমবে না',
  'recipe.perBox': 'কোন মাল',
  'recipe.estimateNote': 'এটা ধরে নেওয়া হিসাব, কেউ গুনে দেখবে না। মাসে একবার গুদাম গুনে দেখলে বোঝা যাবে সংখ্যাটা ঠিক আছে কিনা।',
  'recipe.duplicate': 'এই আইটেম আগেই যোগ করা হয়েছে',

  /* packaging estimate on an order */
  'packaging.title': 'প্যাকেজিং',
  'packaging.estimate': 'ধরে নেওয়া',
  'packaging.estimateHint': 'ডেলিভারি হলে এতটা মাল স্টক থেকে কমবে',
  'packaging.recorded': 'কমে গেছে',
  'packaging.cost': 'প্যাকেজিং খরচ',
  'packaging.none': 'এই অর্ডারের বক্সে কী কী লাগে সেটা বলা নেই',
  'packaging.shortage': 'স্টকে এতটা নেই',
  'packaging.shortageHint': 'ডেলিভারি আটকাবে না, তবে কিনে রাখা দরকার',
  'packaging.need': 'দরকার',
  'packaging.short': 'কম',

  /* payees */
  'payee.title': 'পার্টি',
  'payee.help': 'যাদের টাকা দিতে হয় — ক্যারেট বিক্রেতা, লেবার, কুরিয়ার, ভ্যানওয়ালা।',
  'payee.new': 'নতুন পার্টি',
  'payee.edit': 'তথ্য বদলান',
  'payee.name': 'নাম',
  'payee.kind': 'কী কাজ করে',
  'payee.due': 'দিতে হবে',
  'payee.dueHint': 'এই টাকাটা তার পাওনা',
  'payee.advance': 'অগ্রিম দেওয়া আছে',
  'payee.advanceHint': 'আগেই টাকা দিয়ে রেখেছেন — তার কাছে মাল পাওনা',
  'payee.totalDue': 'সব মিলিয়ে দিতে হবে',
  'payee.totalAdvance': 'অগ্রিম দেওয়া আছে',
  'payee.pay': 'টাকা দিন',
  'payee.payAmount': 'কত টাকা দিলেন',
  'payee.paidFrom': 'কীভাবে দিলেন',
  'payee.ledger': 'লেনদেনের খাতা',
  'payee.ledgerEmpty': 'এখনো কোনো লেনদেন হয়নি',
  'payee.manualEntry': 'হাতে হিসাব লিখুন',
  'payee.manualHelp': 'সফটওয়্যারে আসার আগের বাকি তুলতে, বা কোনো ভুল ঠিক করতে।',
  'payee.dueAfter': 'এরপর দাঁড়ালো',
  'payee.purchases': 'ক্রয়',
  'payee.expenses': 'খরচ',
  'payee.healthBad': 'এই পার্টির হিসাবে সফটওয়্যারের গরমিল ধরা পড়েছে — আমাদের জানান',
  'payee.owingOnly': 'শুধু যাদের টাকা দিতে হবে',
  /*
   * Which way a hand-typed entry moves the due, in the payee's own terms. The
   * reseller wallet's `ledger.manualCredit`/`manualDebit` say "ব্যালেন্স" and run
   * the opposite way, so borrowing them here would be exactly the confusion
   * docs/adr/0025 exists to prevent.
   */
  'payee.dueUp': 'বাকি বাড়বে',
  'payee.dueDown': 'বাকি কমবে',

  'payeeKind.supplier': 'মাল বিক্রেতা',
  'payeeKind.labour': 'লেবার',
  'payeeKind.courier': 'কুরিয়ার',
  'payeeKind.transport': 'পরিবহন',
  'payeeKind.landlord': 'বাড়িভাড়া',
  'payeeKind.other': 'অন্যান্য',

  'payeeLedger.PURCHASE': 'মাল কেনা',
  'payeeLedger.EXPENSE': 'খরচ বাকি',
  'payeeLedger.PAYMENT': 'টাকা দেওয়া',
  'payeeLedger.RETURN': 'মাল ফেরত',
  'payeeLedger.DISCOUNT': 'ছাড় দিয়েছে',
  'payeeLedger.OPENING': 'আগের বাকি',
  'payeeLedger.ADJUSTMENT': 'হিসাব ঠিক করা',
  'payeeLedger.REVERSAL': 'বাতিল হয়েছে',

  /* purchases */
  'purchase.title': 'মাল কেনা',
  'purchase.help': 'কার কাছ থেকে কী কিনলেন, আর সব খরচ ধরে প্রতিটা কত করে পড়ল।',
  'purchase.new': 'কেনা লিখুন',
  'purchase.code': 'কেনার নম্বর',
  'purchase.payee': 'কার কাছ থেকে কিনলেন',
  'purchase.date': 'তারিখ',
  'purchase.invoiceNo': 'তার মেমো নম্বর',
  'purchase.lines': 'কী কী কিনলেন',
  'purchase.addLine': 'আরেকটা মাল',
  'purchase.item': 'কোন মাল',
  'purchase.quantity': 'কতটা',
  'purchase.rate': 'দর কত',
  'purchase.lineCost': 'দাম',
  'purchase.charges': 'আনতে আর কী খরচ হলো',
  'purchase.addCharge': 'খরচ যোগ করুন',
  'purchase.chargeKind': 'কীসের খরচ',
  'purchase.chargeAmount': 'কত টাকা',
  'purchase.paidTo': 'এই টাকাটা কাকে দিলেন',
  'purchase.paidToPayee': 'যার কাছ থেকে কিনলাম',
  'purchase.paidToOther': 'অন্য কাউকে, হাতে হাতে',
  'purchase.paidToHint': 'বিক্রেতাকে দিলে তার খাতায় বাকি বাড়বে। ভ্যানওয়ালাকে হাতে হাতে দিলে বিক্রেতার কিছু বাড়বে না — কিন্তু মালের দাম দুই ক্ষেত্রেই বাড়বে।',
  'purchase.payeeName': 'কার নাম',
  'purchase.allocate': 'মালের দামে যোগ হবে',
  'purchase.allocateHint': 'বন্ধ রাখলে খরচটা হিসাবে থাকবে, কিন্তু প্রতিটার দাম বাড়বে না।',
  'purchase.basis': 'খরচটা কীভাবে ভাগ হবে',
  'purchase.basisValue': 'যেটার দাম বেশি, তার উপর বেশি',
  'purchase.basisQuantity': 'যেটা বেশি, তার উপর বেশি',
  'purchase.goodsCost': 'শুধু মালের দাম',
  'purchase.chargeTotal': 'আনার খরচ',
  'purchase.landedUnitCost': 'প্রতিটা পড়েছে',
  'purchase.landedHint': 'দর যা দিয়েছেন সেটা না — ভ্যান, লোডিং সব ধরে আসল দাম',
  'purchase.payeeTotal': 'বিক্রেতাকে দিতে হবে',
  'purchase.otherCharge': 'হাতে হাতে দেওয়া',
  'purchase.total': 'সব মিলিয়ে খরচ',
  'purchase.spent': 'মোট কত গেলো',
  'purchase.cancel': 'কেনাটা বাতিল করুন',
  'purchase.cancelHelp': 'বাতিল করলে মাল আর বাকি — দুটোই ফিরে যাবে। ভুল হলে ঠিক করা যায় না, বাতিল করে নতুন করে লিখতে হয়।',
  'purchase.received': 'মাল বুঝে নেওয়া হয়েছে',
  'purchase.cancelled': 'বাতিল করা',
  'purchase.cancelReason': 'কেন বাতিল করছেন',
  'purchase.recorded': 'কেনা লেখা হয়েছে',

  'charge.transport': 'পরিবহন',
  'charge.labour': 'লেবার',
  'charge.loading': 'ওঠানো-নামানো',
  'charge.commission': 'দালালি',
  'charge.other': 'অন্যান্য',

  /* expenses */
  'expense.title': 'খরচ',
  'expense.help': 'যে টাকা বেরিয়ে যায় — লেবার, ভ্যান ভাড়া, কুরিয়ার, দোকান ভাড়া।',
  'expense.new': 'খরচ লিখুন',
  'expense.category': 'কীসের খরচ',
  'expense.amount': 'কত টাকা',
  'expense.date': 'তারিখ',
  'expense.scope': 'কার খরচ',
  'expense.scopeOrder': 'একটা অর্ডারের',
  'expense.scopePeriod': 'সাধারণ খরচ',
  'expense.scopeOrderHint': 'কোন অর্ডারের পিছনে গেছে সেটা জানা আছে — কুরিয়ার বিল, হোম ডেলিভারি।',
  'expense.scopePeriodHint': 'কোন অর্ডারের পিছনে গেছে বলা যায় না — লেবারের মজুরি, ভ্যান ভাড়া। এটা কোনো এক অর্ডারে ভাগ করা হবে না।',
  'expense.order': 'অর্ডার',
  'expense.orderHint': 'অর্ডারের নম্বর লিখে খুঁজুন',
  'expense.payee': 'কাকে দিতে হবে',
  'expense.paymentStatus': 'টাকা দেওয়া হয়েছে?',
  'expense.paid': 'দিয়ে দিয়েছি',
  'expense.unpaid': 'এখনো দিইনি',
  'expense.unpaidHint': 'বাকি রাখলে ওই পার্টির খাতায় যোগ হবে, পরে একসাথে শোধ করতে পারবেন।',
  'expense.paidFrom': 'কীভাবে দিলেন',
  'expense.void': 'বাতিল করুন',
  'expense.voided': 'বাতিল করা',
  'expense.voidReason': 'কেন বাতিল করছেন',
  'expense.voidHelp': 'মুছে যাবে না, বাতিল লেখা থাকবে — আগে ছাপানো হিসাব যাতে পাল্টে না যায়।',
  'expense.includeVoided': 'বাতিলগুলোও দেখান',
  'expense.note': 'বিস্তারিত',
  'expense.totalOrder': 'অর্ডারের পিছনে',
  'expense.totalPeriod': 'সাধারণ খরচ',
  'expense.totalAll': 'সব মিলিয়ে',
  'expense.totalUnpaid': 'এখনো দেওয়া হয়নি',
  'expense.categories': 'খরচের ধরন',
  'expense.newCategory': 'নতুন ধরন',
  'expense.categoryName': 'কী নাম দিবেন',
  'expense.categoryScope': 'এটা কার খরচ',
  'expense.scopeBoth': 'দুটোই হতে পারে',
  'expense.seedCategories': 'সাধারণ ধরনগুলো যোগ করে দিন',

  'paidFrom.cash': 'নগদ',
  'paidFrom.bkash': 'বিকাশ',
  'paidFrom.nagad': 'নগদ (Nagad)',
  'paidFrom.rocket': 'রকেট',
  'paidFrom.bank': 'ব্যাংক',

  /* cost on an order */
  'cost.title': 'এই অর্ডারে কত খরচ হলো',
  'cost.goods': 'আমের দাম',
  'cost.packaging': 'প্যাকেজিং',
  'cost.expenses': 'অন্যান্য খরচ',
  'cost.total': 'সব মিলিয়ে খরচ',
  'cost.revenue': 'রিসেলারকে বিল করেছি',
  'cost.margin': 'লাভ',
  'cost.loss': 'ক্ষতি',
  'cost.deliveryCharged': 'ডেলিভারি চার্জ নিয়েছি',
  'cost.addExpense': 'খরচ যোগ করুন',

  /* reports */
  'report.supplies': 'ইনভেন্টরি রিপোর্ট',
  'report.suppliesHint': 'কী আছে, কত দাম, কী ফুরিয়ে আসছে',
  'report.purchases': 'ক্রয় রিপোর্ট',
  'report.purchasesHint': 'কার কাছ থেকে কত কেনা হলো, কত করে পড়ল',
  'report.payables': 'পাওনা রিপোর্ট',
  'report.payablesHint': 'এখন কাকে কত দিতে হবে',
  'report.expenses': 'খরচ রিপোর্ট',
  'report.expensesHint': 'কোন খাতে কত খরচ হলো',
  'report.profit': 'লাভ-ক্ষতি',
  'report.profitHint': 'আয় বাদ সব খরচ',
  'report.variance': 'রেসিপি যাচাই',
  'report.varianceHint': 'রেসিপির অনুমান আর গণনা কতটা মিলছে',

  'profit.revenue': 'যা বিল করেছি',
  'profit.revenueHint': 'রিসেলারদের কাছে যা চেয়েছি — ক্রেতার দাম নয়',
  'profit.orderCost': 'অর্ডারের পিছনে খরচ',
  'profit.grossMargin': 'খরচ বাদের আগে',
  'profit.grossMarginHint': 'এটাকে এখনো লাভ বলা যায় না — নিচের খরচগুলো এখনো বাদ যায়নি',
  'profit.periodExpenses': 'সাধারণ খরচ',
  'profit.periodHint': 'কোন অর্ডারের পিছনে গেছে বলা যায় না, তাই ভাগ করা হয়নি',
  'profit.net': 'শেষ পর্যন্ত লাভ',
  'profit.netLoss': 'শেষ পর্যন্ত ক্ষতি',
  'profit.perOrder': 'কোন অর্ডারে কত',
  'profit.worstFirst': 'সবচেয়ে খারাপগুলো আগে',
  'profit.deliveryGap': 'ডেলিভারি বাবদ নিয়েছি',
  'profit.deliveryGapHint': 'কুরিয়ারকে যা দিয়েছেন তার সাথে মিলিয়ে দেখুন — পার্থক্যটাই ডেলিভারিতে লাভ',

  'variance.estimated': 'হিসাব বলছে লেগেছে',
  'variance.counted': 'গুনে যা সংশোধন হলো',
  'variance.actual': 'সত্যিই লেগেছে',
  'variance.ratio': 'কতটা মিলছে',
  'variance.noData': 'এখনো গুনে দেখা হয়নি, তাই মেলানোর কিছু নেই',
  'variance.understates': 'হিসাবের চেয়ে বেশি লাগছে',
  'variance.overstates': 'হিসাবের চেয়ে কম লাগছে',
  'variance.accurate': 'ঠিকঠাক মিলছে',

  /* position */
  /* --- where a number came from. See supplies.controller.js provenance. --- */
  'dash.income': 'আয়',
  'dash.spend': 'খরচ',
  'dash.incomeVsSpend': 'দিনে কত এলো, কত গেলো',
  'dash.hoverDay': 'কোনো দিনের উপর ধরলে বিস্তারিত দেখাবে',
  'dash.todaySales': 'আজকের বিক্রি',
  'dash.todaySalesHint': 'আজ রিসেলারদের যা বিল করা হয়েছে',
  'dash.monthProfit': 'এই মাসে লাভ',
  'dash.monthLoss': 'এই মাসে ক্ষতি',
  'dash.recentHint': 'শেষ যেগুলো এসেছে',
  'dash.stuckOrders': 'অর্ডার কোথায় আটকে',
  'dash.stuckHint': 'যেগুলোতে আপনার হাত লাগবে',
  'dash.needsYou': 'আপনার সিদ্ধান্ত লাগবে',
  'dash.allClear': 'এই মুহূর্তে কিছু আটকে নেই',
  'dash.profitBreakdown': 'এই মাসের হিসাব',
  'why.title': 'এই সংখ্যাটা কোথা থেকে এলো',
  'why.show': 'কীভাবে?',
  'why.close': 'বুঝেছি',
  'why.onHand': 'এখন যা আছে, সেটা কীভাবে দাঁড়ালো',
  'why.onHandNote': 'শুরুর হিসাব, কেনা, আর যা খরচ হয়েছে — সব যোগ-বিয়োগ করে এই সংখ্যা।',
  'why.avgCost': 'প্রতিটার দাম কীভাবে বেরোলো',
  'why.avgCostNote': 'দর যা দিয়েছেন সেটাই আসল দাম না — ভ্যান ভাড়া, লোডিং সবও মালের দামে যোগ হয়।',
  'why.rate': 'দর দিয়েছেন',
  'why.goods': 'মালের দাম',
  'why.divide': 'ভাগ করলে প্রতিটা',
  'why.blended': 'আগের মাল আর নতুন মাল মিশে আছে, তাই উপরের সংখ্যাটা এই একটা কেনার সাথে হুবহু মিলবে না।',
  'why.noPurchase': 'এখনো কোনো কেনা লেখা হয়নি, তাই দাম বসেনি।',
  'why.notAllocated': 'দামে যোগ হয়নি',
  'why.paidToOther': 'অন্যকে দেওয়া',

  /* --- teaching an empty screen, and saying what comes next --- */
  'costSetup.title': 'কোনটার পর কোনটা',
  'costSetup.supplyFirst': 'প্রথমে মালামাল যোগ করুন — ক্যারেট, কাগজ, সুই।',
  'costSetup.thenPayee': 'তারপর কার কাছ থেকে কেনেন সেটা লিখুন।',
  'costSetup.thenPurchase': 'তারপর কেনা লিখুন — তখনই দাম আর স্টক বসবে।',
  'costSetup.thenRecipe': 'শেষে কোন বক্সে কী লাগে বলে দিন — তাহলে ডেলিভারিতে নিজে থেকে কমবে।',
  'costSetup.done': 'হয়ে গেছে',
  'costSetup.next': 'এখন এটা করুন',
  'costSetup.emptySupply': 'এখনো কোনো মাল যোগ করা হয়নি। ক্যারেট দিয়ে শুরু করুন — যে ক্যারেটে আম ভরে কুরিয়ার করেন।',
  'costSetup.noPurchaseYet': 'এখনো কেনা লেখা হয়নি, তাই স্টক আর দাম দুটোই খালি।',
  'costSetup.noRecipeYet': 'কোনো বক্সে এই মাল লাগে বলে দেওয়া হয়নি, তাই ডেলিভারিতে নিজে থেকে কমবে না।',
  'costSetup.recordPurchase': 'কেনা লিখুন',
  'costSetup.setRecipe': 'বক্সে কী লাগে ঠিক করুন',
  'costSetup.goToProducts': 'পণ্যের পাতায় যান',

  'position.receivable': 'পাওয়া যাবে',
  'position.receivableHint': 'রিসেলারদের কাছে আটকে আছে',
  'position.payable': 'দিতে হবে',
  'position.payableHint': 'পার্টিদের পাওনা',
} as const;

/*
 * Strings added per area live in ./areas/*.ts, so work on one part of the app
 * never edits the same lines as work on another. An area may only ADD keys: the
 * check below fails to compile if an area redefines a key that already exists,
 * because a silent override would change wording on screens nobody looked at.
 */
type Overlap<A, B> = Extract<keyof A, keyof B>;
type NoOverlap<A, B> = [Overlap<A, B>] extends [never] ? true : Overlap<A, B>;
const noOverlap: {
  common: NoOverlap<typeof core, typeof common>;
  shell: NoOverlap<typeof core & typeof common, typeof shell>;
  orders: NoOverlap<typeof core & typeof common & typeof shell, typeof orders>;
  catalog: NoOverlap<typeof core & typeof common & typeof shell & typeof orders, typeof catalog>;
  people: NoOverlap<
    typeof core & typeof common & typeof shell & typeof orders & typeof catalog,
    typeof people
  >;
  cost: NoOverlap<
    typeof core & typeof common & typeof shell & typeof orders & typeof catalog & typeof people,
    typeof cost
  >;
  reseller: NoOverlap<
    typeof core &
      typeof common &
      typeof shell &
      typeof orders &
      typeof catalog &
      typeof people &
      typeof cost,
    typeof reseller
  >;
} = { common: true, shell: true, orders: true, catalog: true, people: true, cost: true, reseller: true };
void noOverlap;

export const bn = {
  ...core,
  ...common,
  ...shell,
  ...orders,
  ...catalog,
  ...people,
  ...cost,
  ...reseller,
} as const;

export type DictKey = keyof typeof bn;

/** The only way strings reach the UI. An unknown key will not compile. */
export function t(key: DictKey): string {
  return bn[key];
}

/** Order and review statuses arrive from the API as English identifiers. */
/**
 * A unit, as a person reads it.
 *
 * Units were rendered raw, so a Bengali order form priced mangoes "৳২৫০ / kg".
 * An unknown unit falls back to itself rather than to nothing: a stray value is
 * better shown as it is than silently dropped from a quantity.
 */
export function tUnit(unit: string): string {
  const key = `unit.${unit}` as DictKey;
  return key in bn ? bn[key] : unit;
}

export function tStatus(status: string): string {
  const key = `order.${status}` as DictKey;
  return key in bn ? bn[key] : status;
}

/** What a customer said was wrong. Unknown kinds show as they are. */
/** A stock movement kind: why the count moved. */
export function tMovementKind(kind: string): string {
  const key = `movement.${kind}` as DictKey;
  return key in bn ? bn[key] : kind;
}

/** What a payee is to the business. Changes the label only, never the machinery. */
export function tPayeeKind(kind: string): string {
  const key = `payeeKind.${kind}` as DictKey;
  return key in bn ? bn[key] : kind;
}

/** A movement of what the owner owes a payee. */
export function tPayeeLedgerKind(kind: string): string {
  const key = `payeeLedger.${kind}` as DictKey;
  return key in bn ? bn[key] : kind;
}

/** An extra cost on a purchase. */
export function tChargeKind(kind: string): string {
  const key = `charge.${kind}` as DictKey;
  return key in bn ? bn[key] : kind;
}

/** How something was paid. A label, not an account: there is no cash book. */
export function tPaidFrom(method: string): string {
  const key = `paidFrom.${method}` as DictKey;
  return key in bn ? bn[key] : method;
}

export function tComplaintKind(kind: string): string {
  const key = `complaint.kind.${kind}` as DictKey;
  return key in bn ? bn[key] : kind;
}

/** A ledger entry kind, such as `DELIVERY_ADJUSTMENT`. Unknown kinds show as they are. */
export function tLedgerKind(kind: string): string {
  const key = `ledger.kind.${kind}` as DictKey;
  return key in bn ? bn[key] : kind;
}

/** A deposit or withdrawal status, never the raw `pending` the API sends. */
export function tRequestStatus(status: string): string {
  const key = `status.deposit.${status}` as DictKey;
  return key in bn ? bn[key] : status;
}

/** How money was sent: bKash, Nagad, Rocket, bank or cash. */
export function tMethod(method: string): string {
  const key = `method.${method.toLowerCase()}` as DictKey;
  return key in bn ? bn[key] : method;
}

/**
 * Fills `{name}` placeholders in a dictionary string. Numbers are passed already
 * formatted (Bengali digits) by the caller, so this never formats anything.
 */
export function tf(key: DictKey, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    t(key)
  );
}

/**
 * A key built at run time (`prefs.channel.${name}`), with a fallback when the
 * dictionary has no such entry. `t()` is typed for known keys only, and a cast
 * key it does not know rendered as nothing, or as "undefined" in a label.
 */
export function tMaybe(key: string, fallback = key): string {
  return key in bn ? bn[key as DictKey] : fallback;
}
