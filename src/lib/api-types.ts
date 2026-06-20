export interface Agent {
  id: string;
  name: string;
  state: string;
  city: string;
  address: string;
  building: string;
  phone: string;
  postal_code: string;
  created_at: string;
  updated_at: string;
}

export interface Owner {
  id: string;
  agent_id: string | null;
  name: string;
  state: string;
  city: string;
  address: string;
  building: string;
  phone: string;
  postal_code: string;
  full_address: string;
  gbp_account_name: string | null;
  created_at: string;
  updated_at: string;
  agent: Agent | null;
  shops?: Shop[];
}

export interface Shop {
  id: string;
  owner_id: string;
  name: string;
  postal_code: string;
  state?: string;
  city?: string;
  address?: string;
  building?: string;
  phone?: string;
  full_address: string;
  gbp_location_name: string | null;
  gbp_shop_name: string | null;
  gbp_latitude?: number;
  gbp_longitude?: number;
  previous_gbp_location_name: string | null;
  priority: number | null;
  use_review_auto_reply?: boolean;
  website_click_rate: number | null;
  direction_route_rate: number | null;
  call_click_rate: number | null;
  business_booking_rate: number | null;
  food_order_rate: number | null;
  customers_per_group: number | null;
  average_spending: number | null;
  created_at: string;
  updated_at: string;
  owner?: Owner;
  fixed_messages?: FixedMessage[];
  is_instagram_connected: boolean;
}

export interface FixedMessage {
  id: string;
  title: string;
  message: string;
}

// ── Supabase DB Row Types ──

export interface DbShopRow {
  id: string;
  name: string;
  owner_id: string;
  gbp_location_name: string | null;
  gbp_shop_name: string | null;
  gbp_main_category: string | null;
  gbp_main_category_id: string | null;
  state: string;
  city: string;
  address: string;
  phone: string;
  postal_code: string;
  cancelled_at: string | null;
  business_group_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbReviewRow {
  id: string;
  shop_name: string;
  shop_id: string | null;
  reviewer_name: string;
  star_rating: string;
  comment: string;
  create_time: string;
  reply_comment: string | null;
  reply_time: string | null;
  review_id: string | null;
  location_name: string | null;
}

export interface DbOAuthTokenRow {
  account_id: string;
  access_token: string;
  refresh_token: string;
  expiry: string;
}

export interface DbPerformanceCacheRow {
  shop_id: string;
  shop_name: string;
  month: string;
  metrics: Record<string, unknown>;
  updated_at: string;
}

export interface DbReportAnalysisRow {
  id: string;
  shop_name: string;
  month: string;
  summary: string;
  comments: string[];
  positive_words: string[];
  negative_words: string[];
  created_at: string;
}

export interface DbGridRankingLogRow {
  id: string;
  shop_id: string;
  keyword: string;
  grid_size: number;
  interval_m: number;
  results: { lat: number; lng: number; rank: number; row: number; col: number }[];
  measured_at: string;
}

export interface DbUserProfileRow {
  id: string;
  auth_uid: string;
  name: string;
  username: string;
  email: string;
  role: string;
  password_display: string | null;
  created_at: string;
}

// ── API Response Types ──

export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data?: T;
}

export interface ApiErrorResponse {
  success?: false;
  error: string;
  details?: string[];
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;

export interface CronResult {
  success: boolean;
  processed?: number;
  errors?: number;
  skipped?: number;
  message?: string;
}

export interface GoApiShop {
  id?: string;
  ID?: string;
  name?: string;
  Name?: string;
  owner_id?: string;
  OwnerID?: string;
  gbp_location_name?: string;
  GbpLocationName?: string;
  gbp_shop_name?: string;
  GbpShopName?: string;
  state?: string;
  State?: string;
  city?: string;
  City?: string;
  address?: string;
  Address?: string;
  phone?: string;
  Phone?: string;
  postal_code?: string;
  PostalCode?: string;
}
