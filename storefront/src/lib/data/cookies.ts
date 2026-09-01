import 'server-only';
import { cookies as nextCookies } from 'next/headers';

export const getAuthHeaders = async (): Promise<
  { Authorization: string } | null
> => {
  const cookies = await nextCookies();
  const token = cookies.get('_medusa_jwt')?.value;

  if (!token) {
    return null;
  }

  return { Authorization: `Bearer ${token}` };
};

export const getCacheTag = async (
  tag: string
): Promise<string> => {
  try {
    const cookies = await nextCookies();
    const cacheId = cookies.get('_medusa_cache_id')?.value;

    if (!cacheId) {
      return '';
    }

    return `${tag}-${cacheId}`;
  } catch (error) {
    return '';
  }
};

export const getCacheOptions = async (
  tag: string
): Promise<{ tags: string[] } | {}> => {
  if (typeof window !== 'undefined') {
    return {};
  }

  const cacheTag = await getCacheTag(tag);

  if (!cacheTag) {
    return {};
  }

  return { tags: [`${cacheTag}`] };
};

export const setAuthToken = async (token: string) => {
  const cookies = await nextCookies();
  cookies.set('_medusa_jwt', token, {
    maxAge: 60 * 60 * 24 * 7,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
};

export const removeAuthToken = async () => {
  const cookies = await nextCookies();
  cookies.set('_medusa_jwt', '', {
    maxAge: -1,
  });
};

/**
 * Seller session for the in-app vendor surface.
 *
 * Deliberately a SEPARATE cookie from `_medusa_jwt`: the same WebView can
 * hold a shopper session and a seller session at once (a vendor is also a
 * person who shops), and the two tokens authorize very different things.
 * httpOnly is non-negotiable here — a seller bearer reaches payout-capable
 * vendor endpoints, so it must never be readable from page JS on a
 * remotely-loaded WebView page. Every seller call goes out from a server
 * action instead.
 */
const SELLER_JWT_COOKIE = '_fbm_seller_jwt';

export const getSellerAuthHeaders = async (): Promise<
  { Authorization: string } | null
> => {
  const cookies = await nextCookies();
  const token = cookies.get(SELLER_JWT_COOKIE)?.value;

  if (!token) {
    return null;
  }

  return { Authorization: `Bearer ${token}` };
};

/** Raw seller token, for the refresh path that must inspect expiry. */
export const getSellerToken = async (): Promise<string | undefined> => {
  const cookies = await nextCookies();
  return cookies.get(SELLER_JWT_COOKIE)?.value;
};

export const setSellerAuthToken = async (token: string) => {
  const cookies = await nextCookies();
  cookies.set(SELLER_JWT_COOKIE, token, {
    // Medusa issues seller JWTs with a 1-day lifetime; the cookie matches
    // so a stale cookie never outlives the token it carries.
    maxAge: 60 * 60 * 24,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
};

export const removeSellerAuthToken = async () => {
  const cookies = await nextCookies();
  cookies.set(SELLER_JWT_COOKIE, '', {
    maxAge: -1,
  });
};

export const getCartId = async () => {
  const cookies = await nextCookies();
  return cookies.get('_medusa_cart_id')?.value;
};

export const setCartId = async (cartId: string) => {
  const cookies = await nextCookies();
  cookies.set('_medusa_cart_id', cartId, {
    maxAge: 60 * 60 * 24 * 7,
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
  });
};

export const removeCartId = async () => {
  const cookies = await nextCookies();
  cookies.set('_medusa_cart_id', '', {
    maxAge: -1,
  });
};


export const getStorefrontContext = async () => {
  const cookies = await nextCookies();
  return {
    organization_id: cookies.get('_fbm_org_id')?.value,
    storefront_id: cookies.get('_fbm_storefront_id')?.value,
  };
};

export const setStorefrontContext = async (ctx: { organization_id: string; storefront_id: string }) => {
  const cookies = await nextCookies();
  cookies.set('_fbm_org_id', ctx.organization_id, {
    maxAge: 60 * 60 * 24 * 30,
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
  });
  cookies.set('_fbm_storefront_id', ctx.storefront_id, {
    maxAge: 60 * 60 * 24 * 30,
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
  });
};
