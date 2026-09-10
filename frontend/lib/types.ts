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
  lastLoginAt?: string;
};

export type ResellerProfile = {
  _id: string;
  shopName: string;
  slug: string;
  logoUrl?: string;
  address?: string;
  kycStatus: KycStatus;
  balancePoisha: number;
  creditLimitPoisha: number;
  smsCredits: number;
  formActive: boolean;
  channelPrefs: { webPush: boolean; telegram: boolean; sms: boolean };
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
  statusHistory: { status: OrderStatus; at: string; note?: string }[];
  courier?: { name?: string; trackingNumber?: string };
  confirmedAt?: string;
  deliveredAt?: string;
  cancelReason?: string;
  createdAt: string;
  /** What the current role may do to this order right now. */
  actions: string[];
};

export type CatalogItem = {
  id: string;
  name: string;
  description?: string;
  images: { key: string; url: string }[];
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
  hidePrice: boolean;
  isListed: boolean;
};

export type OwnerProduct = {
  id: string;
  name: string;
  description?: string;
  images: { key: string; url: string }[];
  unit: string;
  step: number;
  minOrderQty: number;
  costPrice: number;
  maxSellPrice: number | null;
  trackStock: boolean;
  stockQty: number | null;
  isAvailable: boolean;
  source?: { _id: string; name: string } | string;
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

/** The customer-facing shop, which never carries a cost price. */
export type PublicShop = {
  shop: { slug: string; name: string; logoUrl?: string; poweredBy: string };
  products: {
    id: string;
    name: string;
    description?: string;
    images: { key: string; url: string }[];
    unit: string;
    step: number;
    minOrderQty: number;
    inStock: boolean;
    priceHidden: boolean;
    price?: number;
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

export type OwnerDashboard = {
  today: string;
  ordersToday: number;
  byStatus: Partial<Record<OrderStatus, number>>;
  awaitingAcceptance: number;
  agingOrders: number;
  agingThresholdHours: number;
  totalReceivable: number;
  pendingDeposits: number;
  pendingWithdrawals: number;
};

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

export type Paged<K extends string, T> = { page: number; limit: number; total: number } & {
  [P in K]: T[];
};
