/** Shapes the API actually returns. Money arrives as taka, quantity as decimals. */

export type Role = 'owner' | 'reseller';

export type KycStatus = 'not_submitted' | 'pending' | 'approved' | 'rejected';

export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'accepted'
  | 'packed'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'returned';

export type PaymentMode = 'prepaid' | 'cod';

export type ReviewStatus = 'pending' | 'approved' | 'rejected';

export type DepositMethod = 'bkash' | 'nagad' | 'rocket' | 'bank' | 'cash';

export type User = {
  _id: string;
  name: string;
  phoneE164: string;
  role: Role;
  isActive: boolean;
  /** When the owner deactivated this account; null while active. */
  deactivatedAt?: string | null;
  lastLoginAt?: string;
  /** Set after the owner issued a temporary password. The shell sends them to Account. */
  mustChangePassword?: boolean;
};

/**
 * What `/auth/login` returns: a session, or, for the owner on a device not
 * trusted yet, a challenge that needs the SMS code first. See docs/adr/0014.
 */
export type LoginChallenge = {
  requiresOtp: true;
  challengeId: string;
  /** The number the code went to, masked, e.g. 017*****678. */
  phoneHint: string;
  expiresAt: string;
};

export type LoginResult = { user: User; requiresOtp?: undefined } | LoginChallenge;

/** Every endpoint that sends a code answers with when it stops working. */
export type OtpSent = { sent: true; expiresAt?: string };

/**
 * A publicly visible image, as the API presents it.
 *
 * `id` is the handle used to remove it; `key` is the same value under the name
 * the product form originally shipped with. `thumbUrl` is a smaller rendition
 * when the host makes one, which is what a grid of tiles should be pulling.
 */
export type ProductImage = {
  id: string;
  key: string;
  url: string;
  thumbUrl?: string;
};

export type ResellerProfile = {
  _id: string;
  shopName: string;
  slug: string;
  logoUrl?: string;
  address?: string;
  /* The shopfront: everything the reseller publishes to their own customers. */
  about?: string;
  publicPhone?: string;
  whatsappNumber?: string;
  facebookUrl?: string;
  payment?: { bkash?: string; nagad?: string };
  /** The public page design. The content itself is the owner's. */
  landingTemplate?: LandingTemplate;
  kycStatus: KycStatus;
  balancePoisha: number;
  creditLimitPoisha: number;
  smsCredits: number;
  formActive: boolean;
  channelPrefs: { webPush: boolean; telegram: boolean; sms: boolean };
};

/** One value a buyer has used, with how often. */
export type CustomerVariant = { value: string; count: number; lastUsedAt?: string };

/**
 * A buyer, recognised by phone across every order they have placed.
 *
 * The owner's version counts every shop; a reseller's counts only their own
 * orders, so the same person shows different totals to each. That is on
 * purpose: one reseller must not see another's sales.
 */
export type Customer = {
  /** The owner addresses a customer by id, a reseller by phone number. */
  id: string;
  phone: string;
  name: string | null;
  /** The owner gets counts per variant; a reseller gets the plain values. */
  names: (CustomerVariant | string)[];
  addresses: (CustomerVariant | string)[];
  altPhones?: string[];
  latestAddress?: string;
  orderCount: number;
  deliveredCount: number;
  cancelledCount: number;
  returnedCount: number;
  totalSpend: number;
  firstOrderAt?: string;
  lastOrderAt?: string;
  /** Owner only: how many different shops this number has bought from. */
  shopCount?: number;
};

export type Features = { sms: boolean; telegram: boolean; webPush: boolean };

export type Session = {
  user: User;
  profile?: ResellerProfile;
  features: Features;
};

export type OrderItem = {
  id: string;
  product: string;
  productName: string;
  unit: string;
  quantity: number;
  costPrice: number;
  sellPrice: number;
  lineCost: number;
  lineSell: number;
  /**
   * Where this line is collected from, decided when the owner accepts and null
   * before that. `sourceName` is the snapshot and is what every screen renders:
   * the id only survives as a link to a source that may since have been retired.
   */
  source: string | null;
  sourceName: string | null;
};

export type OrderTotals = {
  costSubtotal: number;
  sellSubtotal: number;
  walletDebit: number;
  resellerMargin: number;
  customerTotal: number;
};

export type Order = {
  id: string;
  orderCode: string;
  reseller: string | { _id: string; shopName: string; slug: string };
  origin: 'form' | 'manual';
  paymentMode: PaymentMode;
  businessDate: string;
  customer: {
    name: string;
    phoneE164: string;
    altPhoneE164?: string;
    address: string;
    district: string;
    note?: string;
  };
  items: OrderItem[];
  deliveryZoneName?: string;
  deliveryCharge: number;
  totals: OrderTotals;
  status: OrderStatus;
  statusHistory: StatusHistoryEntry[];
  courier?: { name?: string; trackingNumber?: string };
  confirmedAt?: string;
  acceptedAt?: string;
  packedAt?: string;
  shippedAt?: string;
  deliveredAt?: string;
  cancelReason?: string;
  /** Set on a return: whether the owner ticked "put back in stock". See docs/adr/0008. */
  restockedOnReturn: boolean;
  createdAt: string;
  /**
   * What the current role may do to this order right now: the transitions
   * (`confirm`, `accept`, ...) and the edits (`changeDeliveryCharge`,
   * `editCustomer`). The API derives both from its state machine, so a screen
   * asks this list rather than keeping its own copy of which statuses allow what.
   */
  actions: string[];
};

/** The names `Order.actions` may carry today. */
export type OrderAction =
  | 'confirm'
  | 'accept'
  | 'pack'
  | 'ship'
  | 'deliver'
  | 'cancel'
  | 'return'
  | 'changeDeliveryCharge'
  | 'editCustomer';

/** The answer to correcting an order's customer details. PLAN-2 decision 9. */
export type CustomerEditResult = {
  order: Order;
  /** Which of name, phone, address and district actually changed. */
  changed: ('name' | 'phone' | 'address' | 'district')[];
  /** The new district belongs to a different delivery zone than the order's. */
  deliveryZoneChanged: boolean;
  /** That zone and its charge, which the owner may apply. Null when unchanged. */
  suggestedZone: { id: string; name: string; charge: number } | null;
};

/**
 * One step in an order's life.
 *
 * `paymentModeFrom` and `paymentModeTo` appear only on the confirm step, and
 * only when the reseller changed what the customer chose (docs/adr/0007). The
 * `note` alongside them is the server's English sentence and is not shown; on
 * any other step it is what the person typed, such as a cancel reason.
 */
export type StatusHistoryEntry = {
  status: OrderStatus;
  at: string;
  note?: string;
  paymentModeFrom?: PaymentMode;
  paymentModeTo?: PaymentMode;
  /**
   * Set on a step that is not a status change. `customer_edited` records a
   * correction to the delivery details; its status is simply the status the
   * order was in at the time.
   */
  event?: string;
};

export type CatalogItem = {
  id: string;
  name: string;
  description?: string;
  images: ProductImage[];
  unit: string;
  step: number;
  minOrderQty: number;
  costPrice: number;
  maxSellPrice: number | null;
  inStock: boolean;
  stockQty: number | null;
  isAvailable: boolean;
  activated: boolean;
  sellPrice: number | null;
  /** The struck-through "was" price on the public page, if any. */
  regularPrice: number | null;
  hidePrice: boolean;
  isListed: boolean;
};

export type OwnerProduct = {
  id: string;
  name: string;
  description?: string;
  images: ProductImage[];
  unit: string;
  step: number;
  minOrderQty: number;
  costPrice: number;
  maxSellPrice: number | null;
  trackStock: boolean;
  stockQty: number | null;
  isAvailable: boolean;
  sortOrder: number;
};

export type Source = {
  _id: string;
  name: string;
  address?: string;
  phoneE164?: string;
  note?: string;
  isArchived: boolean;
};

export type DeliveryZone = {
  id: string;
  _id?: string;
  name: string;
  districts: string[];
  charge: number;
  isActive: boolean;
};

export type Wallet = {
  balance: number;
  creditLimit: number;
  available: number;
  smsCredits: number;
};

export type LedgerEntry = {
  id: string;
  seq: number;
  kind: string;
  amount: number;
  balanceAfter: number;
  refType: string;
  refId?: string;
  reversalOf?: string;
  note?: string;
  createdAt: string;
};

/**
 * The answer to changing a delivery charge. `adjustment` is the ledger entry
 * that posted when the order had already been charged, and null otherwise.
 * Its amount is signed taka: negative for a raise, positive for a cut.
 */
export type DeliveryChargeChange = {
  order: Order;
  adjustment: LedgerEntry | null;
};

export type Deposit = {
  id: string;
  amount: number;
  method: DepositMethod;
  transactionId?: string;
  status: ReviewStatus;
  note?: string;
  rejectionReason?: string;
  createdAt: string;
};

export type Withdrawal = {
  id: string;
  amount: number;
  method: DepositMethod;
  destinationNumber: string;
  status: ReviewStatus;
  rejectionReason?: string;
  payoutReference?: string;
  createdAt: string;
};

/** A public page design. See backend domain/landing.js. */
export type LandingTemplate = 'bagan' | 'krishok' | 'offer';

/** A named glyph, mapped to an icon by the page. Never an uploaded image. */
export type LandingIcon =
  | 'leaf'
  | 'shield'
  | 'truck'
  | 'star'
  | 'heart'
  | 'package'
  | 'clock'
  | 'sun'
  | 'check'
  | 'gift'
  | 'snowflake'
  | 'wallet';

/** The owner-written content every design is drawn from. */
export type LandingContent = {
  headline: string;
  subtitle: string;
  heroImages: ProductImage[];
  videoUrl: string;
  rating: number | null;
  customerCount: string;
  deliveryNote: string;
  guaranteeNote: string;
  badges: { icon: LandingIcon; label: string }[];
  whyUs: string[];
  features: string[];
  tips: { icon: LandingIcon; title: string; text: string }[];
  reviews: { id: string; name: string; text: string; image: ProductImage | null }[];
  faqs: { q: string; a: string }[];
};

/** The customer-facing shop, which never carries a cost price. */
export type PublicShop = {
  shop: {
    slug: string;
    name: string;
    logoUrl?: string;
    about?: string;
    phone?: string;
    whatsapp?: string;
    facebookUrl?: string;
    address?: string;
    payment?: { bkash?: string; nagad?: string };
    poweredBy: string;
    brandLogoUrl?: string;
  };
  /** The design the reseller chose, and the owner's content it draws on. */
  template: LandingTemplate;
  landing: LandingContent;
  /** False when the shop is closed; the page then shows no form. See docs/adr/0011. */
  acceptingOrders?: boolean;
  reason?: string | null;
  products: {
    id: string;
    name: string;
    description?: string;
    images: ProductImage[];
    unit: string;
    step: number;
    minOrderQty: number;
    inStock: boolean;
    priceHidden: boolean;
    price?: number;
    /** The struck-through price. Only present when above `price`. */
    regularPrice?: number;
  }[];
};

export type PublicOrder = {
  orderCode: string;
  status: OrderStatus;
  placedAt: string;
  paymentMode: PaymentMode;
  items: {
    productName: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }[];
  deliveryCharge: number;
  total: number;
  courier?: { name?: string; trackingNumber?: string } | null;
  deliveredAt?: string;
};

/**
 * What an order was worth, to each party.
 *
 * `ownerRevenue` is the wallet debit: goods at cost price plus delivery. It is
 * the owner's top line, and it is deliberately not `customerTotal`, which
 * includes the reseller's margin and is therefore somebody else's money.
 */
export type TradeMoney = {
  orders: number;
  ownerRevenue: number;
  goods: number;
  delivery: number;
  customerTotal: number;
  resellerMargin: number;
};

export type OwnerDashboard = {
  today: string;
  ordersToday: number;
  money: TradeMoney;
  /** Open statuses only. What closed today is `closedToday`. */
  byStatus: Partial<Record<OrderStatus, number>>;
  closedToday: { delivered: number; cancelled: number; returned: number };
  /** Shipped and paid on delivery: cash the couriers are still carrying. */
  codInFlight: { orders: number; amount: number };
  awaitingAcceptance: number;
  agingOrders: number;
  agingThresholdHours: number;
  totalReceivable: number;
  pendingDeposits: number;
  pendingWithdrawals: number;
  pendingKyc: number;
  activeResellers: number;
  health: { lowStock: number; deadLetters: number; smsEnabled: boolean };
};

/** Counts and money for exactly the orders a filter selects. */
export type OrdersSummary = {
  byStatus: Partial<Record<OrderStatus, number>>;
  total: number;
  /** Stale confirmed orders within the same dates. Its own query, not a slice. */
  aging: number;
  money: TradeMoney;
};

export type SalesReport = {
  from: string;
  to: string;
  totals: TradeMoney;
  days: ({ date: string } & TradeMoney)[];
  products: {
    product: string;
    name: string;
    unit: string;
    quantity: number;
    goods: number;
    customerTotal: number;
    orders: number;
  }[];
  paymentModes: ({ mode: PaymentMode } & TradeMoney)[];
  cancelled: { orders: number; customerTotal: number };
  returned: { orders: number; customerTotal: number };
};

export type ResellerReport = {
  from: string;
  to: string;
  totals: TradeMoney;
  resellers: ({
    id: string;
    shopName: string;
    slug: string;
    user?: User;
    isActive: boolean;
    cancelled: number;
    /** Signed: negative owes the owner. */
    balance: number;
    owed: number;
    creditLimit: number;
  } & TradeMoney)[];
};

/**
 * What to collect and from where. A source is null until the order is accepted,
 * because that is when an orchard is chosen. See docs/adr/0006.
 */
export type PickList = {
  from: string;
  to: string;
  products: {
    product: string;
    name: string;
    unit: string;
    quantity: number;
    orders: number;
    sources: { sourceName: string | null; quantity: number; orders: number }[];
  }[];
};

export type ProductsReport = {
  from: string;
  to: string;
  /** Inclusive day count of the range, which `perDay` is divided by. */
  days: number;
  products: {
    product: string;
    name: string;
    unit: string;
    isAvailable: boolean;
    trackStock: boolean;
    /** Null when stock is not tracked; a zero there would read as "sold out". */
    stock: number | null;
    costPrice: number;
    quantity: number;
    perDay: number;
    daysLeft: number | null;
    goods: number;
    customerTotal: number;
    orders: number;
  }[];
};

export type CustomerReportRow = {
  id: string;
  phone: string;
  /** The most-used name on this number. Names are not identity here. */
  name: string;
  nameCount: number;
  orders: number;
  delivered: number;
  cancelled: number;
  returned: number;
  /** Delivered orders only: money collected, not money hoped for. */
  spend: number;
  lastOrderAt?: string;
};

export type CustomersReport = {
  totals: {
    customers: number;
    orders: number;
    delivered: number;
    cancelled: number;
    returned: number;
    spend: number;
  };
  top: CustomerReportRow[];
  risky: CustomerReportRow[];
};

/** Every order matching a filter, unpaged, for the printable sheet. */
export type OrderSheet = { orders: Order[]; total: number; truncated: boolean };

export type ResellerSummary = {
  id: string;
  user: User;
  shopName: string;
  slug: string;
  kycStatus: KycStatus;
  formActive: boolean;
  balance: number;
  creditLimit: number;
  available: number;
  smsCredits: number;
  createdAt: string;
};

/** A list paged by an opaque cursor. `nextCursor` is null on the last page. */
export type CursorPaged<K extends string, T> = { nextCursor: string | null } & {
  [P in K]: T[];
};

/** One row of the owner's audit log. `before` and `after` are whatever the action recorded. */
export type AuditEntry = {
  id: string;
  at: string;
  action: string;
  targetType: string;
  targetId: string | null;
  actor: { id: string; name: string; role: Role } | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
};

export type Paged<K extends string, T> = { page: number; limit: number; total: number } & {
  [P in K]: T[];
};

/* -------------------------------------------------------------------- sms -- */

export type SmsStatus = 'sent' | 'failed' | 'blocked';
export type SmsPurpose = 'notification' | 'test' | 'manual' | 'otp' | 'owner_alert';
export type SmsBlockReason =
  | 'feature_off'
  | 'not_configured'
  | 'no_credits'
  | 'no_recipient'
  | 'empty_text';

/**
 * One attempted message. Every SMS this platform tries to send becomes one of
 * these, including the ones that never left: a message suppressed because the
 * owner switched SMS off is recorded as `blocked`, not as nothing at all.
 */
export type SmsLog = {
  id: string;
  phone: string;
  text: string;
  status: SmsStatus;
  blockedReason: SmsBlockReason | null;
  purpose: SmsPurpose;
  eventType: string | null;
  /** Bengali is Unicode, so the same sentence costs twice what Latin does. */
  segments: number;
  encoding: 'gsm' | 'unicode';
  resellerName: string | null;
  resellerId: string | null;
  creditsCharged: number;
  creditsRefunded: number;
  providerMessageId: string | null;
  providerStatusCode: number | null;
  error: string | null;
  durationMs: number | null;
  sentAt: string | null;
  createdAt: string;
};

/** The log row plus the evidence: what the gateway actually replied. */
export type SmsLogDetail = SmsLog & {
  senderId: string | null;
  toLocal: string | null;
  retryable: boolean | null;
  providerHttpStatus: number | null;
  providerResponse: unknown;
  providerRaw: string | null;
  outboxMessageId: string | null;
};

export type SmsOverview = {
  /** The owner's master switch. Off means off for every reseller action. */
  enabled: boolean;
  /** Whether the gateway credentials are set on the server at all. */
  configured: boolean;
  senderId: string | null;
  balance: number | null;
  /** Set when the gateway was unreachable. The page still renders. */
  balanceError: string | null;
  pricePerCredit: number;
  stats: {
    sentToday: number;
    last30: { sent: number; failed: number; blocked: number };
    segments: number;
    creditsSpent: number;
    resellerCredits: number;
  };
};

/* ------------------------------------------------------ phase f: messaging -- */

/** What a customer SMS would say. Rendered by the server; shown as is. */
export type CustomerSmsPreview = {
  text: string;
  chars: number;
  segments: number;
  encoding: 'GSM-7' | 'UCS-2';
  phone: string | null;
  /** False when no SMS gateway is configured, so nothing could be sent. */
  available: boolean;
};

export type CustomerSmsAction = 'accept' | 'ship' | 'cancel';

export type TelegramStatus = {
  configured: boolean;
  linked: boolean;
  linkedAt: string | null;
  botUsername: string | null;
};

export type TelegramLinkToken = {
  linkToken: string;
  expiresAt: string;
  botUsername: string | null;
  deepLink: string | null;
};

export type PreferenceChannel = 'push' | 'telegram' | 'sms';

export type NotificationPreferences = {
  inApp: true;
  smsAvailable: boolean;
  channels: {
    push: { available: boolean };
    telegram: { available: boolean; linked: boolean };
    sms: { available: boolean };
  };
  groups: {
    key: 'orders' | 'wallet' | 'kyc' | 'alerts';
    events: ({ eventType: string; locked: PreferenceChannel[] } & Record<PreferenceChannel, boolean>)[];
  }[];
};

export type SmsCreditsInfo = {
  featureEnabled: boolean;
  smsEnabled: boolean;
  available: boolean;
  smsCredits: number;
  pricePerCredit: number;
};
