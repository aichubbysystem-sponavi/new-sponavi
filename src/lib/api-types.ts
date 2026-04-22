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
