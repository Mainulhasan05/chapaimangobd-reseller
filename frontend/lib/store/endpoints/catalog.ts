import type { AvgCostWhy, OnHandWhy } from '@/components/why';
import type {
  DeliveryZone,
  LandingContent,
  OrderItem,
  OwnerProduct,
  Source,
  SourceDetail,
  StockMovement,
  Supply,
  SupplyDetail,
} from '@/lib/types';
import { api, EFFECTS, LIST, listTags } from '../api';
import { qs } from '../base-query';
import { byQueryString } from './shared';

/**
 * What the owner sells and sells it with: products and their boxes' packing
 * recipes, sources (orchards), delivery zones, supplies, and the landing page.
 *
 * A product edit reaches the resellers' catalogs (`Catalog`); a supply count
 * reaches every packaging estimate (they provide the supply list's tag).
 */

/* ---------------------------------------------------------------- types */

/** Live products by default; `archived: 'only'` is the "পুরনো" filter, where restoring is. */
export type ProductsArgs = { archived?: 'only' };

/**
 * One box's stock: the count somebody just took (`set`) or a change to it
 * (`add`, negative to take some away). Exactly one of the two.
 */
export type VariantStockInput = { productId: string; variantId: string } & (
  | { set: number; add?: never }
  | { add: number; set?: never }
);

/** Live sources by default; `includeArchived` adds the archived ones, `archived: 'only'` is them alone. */
export type SourcesArgs = { includeArchived?: boolean; archived?: 'only' };

export type SourceInput = {
  name: string;
  address?: string;
  phone?: string;
  note?: string;
  /** False restores an archived source (PLAN-4 §4.1 item 10). */
  isArchived?: boolean;
};

/**
 * An order on a source's page, with the lines that came from that source
 * picked out by id on the server (PLAN-4 §4.1 item 10). Optional so an older
 * server still type checks; the screen then filters `items` by `source`.
 */
export type SourceOrder = SourceDetail['orders'][number] & { sourceItems?: OrderItem[] };

export type SourceDetailView = Omit<SourceDetail, 'orders'> & { orders: SourceOrder[] };

export type ZoneInput = { name: string; districts: string[]; charge: number; isActive: boolean };

/** `archivedOnly` is the archived filter on its own; `includeArchived` adds them beside the live ones. */
export type SuppliesArgs = {
  lowOnly?: boolean;
  includeArchived?: boolean;
  archivedOnly?: boolean;
  q?: string;
};

export type SuppliesList = {
  supplies: Supply[];
  totals: { items: number; value: number; lowCount: number; negativeCount: number };
};

/**
 * A movement as the detail page gets it: the code of the purchase or order it
 * links to, whether that purchase has since been cancelled, and who typed it
 * (null for a consumption, which nobody typed). PLAN-4 §4.1 item 9.
 */
export type SupplyMovement = StockMovement & {
  refCode?: string | null;
  purchaseCancelled?: boolean | null;
  createdBy?: { id: string; name: string } | null;
};

/** The detail with the working behind its two figures, for the "why?" sheets. */
export type SupplyView = Omit<SupplyDetail, 'movements'> & {
  movements: SupplyMovement[];
  provenance: { onHand: OnHandWhy; avgCost: AvgCostWhy };
};

export type SupplyInput = {
  nameBn: string;
  reorderLevel: number;
  note?: string;
  /** Only when creating: a unit cannot change once stock is counted in it. */
  unit?: string;
  /** Only when editing. */
  isArchived?: boolean;
};

export type LandingResponse = { landing: LandingContent };

/** What the landing form saves. Pictures and reviews upload through their own calls. */
export type LandingUpdate = Omit<LandingContent, 'heroImages' | 'reviews'>;

export const catalogApi = api.injectEndpoints({
  endpoints: (build) => ({
    /* ------------------------------------------------------------ products */

    // The whole catalog in one response; the screen filters it locally. No
    // argument is the live catalog, which is what every other screen wants.
    getProducts: build.query<{ products: OwnerProduct[] }, ProductsArgs | void>({
      query: (arg) => `/owner/products${qs(arg ?? undefined)}`,
      serializeQueryArgs: byQueryString,
      providesTags: (result) => listTags('Product', result?.products),
    }),

    // Multipart, because the pictures go up with the product.
    createProduct: build.mutation<{ product: OwnerProduct }, { formData: FormData }>({
      query: ({ formData }) => ({ url: '/owner/products', method: 'POST', formData }),
      invalidatesTags: (_result, error) => (error ? [] : EFFECTS.stock()),
    }),

    // Prices and boxes reach every reseller's catalog, so it moves with the list.
    updateProduct: build.mutation<{ product: OwnerProduct }, { id: string; formData: FormData }>({
      query: ({ id, formData }) => ({ url: `/owner/products/${id}`, method: 'PATCH', formData }),
      invalidatesTags: (_result, error, { id }) =>
        error ? [] : [...EFFECTS.stock(), { type: 'Product', id }],
    }),

    /*
     * One box's count, set or added to atomically. The answer is the whole
     * product, which is written into every cached product list at once, so the
     * card shows the new count as the sheet closes rather than after a refetch
     * of the catalog. Resellers' catalogs and the dashboard follow by tag.
     */
    setVariantStock: build.mutation<{ product: OwnerProduct }, VariantStockInput>({
      query: ({ productId, variantId, set, add }) => ({
        url: `/owner/products/${productId}/variants/${variantId}/stock`,
        method: 'PATCH',
        body: set !== undefined ? { set } : { add },
      }),
      onQueryStarted: async (_arg, { dispatch, getState, queryFulfilled }) => {
        try {
          const { data } = await queryFulfilled;
          catalogApi.util.selectCachedArgsForQuery(getState(), 'getProducts').forEach((args) => {
            dispatch(
              catalogApi.util.updateQueryData('getProducts', args, (draft) => {
                const index = draft.products.findIndex((p) => p.id === data.product.id);
                if (index >= 0) draft.products[index] = data.product;
              })
            );
          });
        } catch {
          // Shown by the caller.
        }
      },
      invalidatesTags: (_result, error) => (error ? [] : ['Catalog', 'Dashboard', 'Report']),
    }),

    // Archived, never deleted: orders and the pick list still name it.
    archiveProduct: build.mutation<{ product: OwnerProduct }, { id: string }>({
      query: ({ id }) => ({ url: `/owner/products/${id}`, method: 'DELETE' }),
      invalidatesTags: (_result, error, { id }) =>
        error ? [] : [...EFFECTS.stock(), { type: 'Product', id }],
    }),

    // Comes back switched off; selling it again is a separate decision.
    restoreProduct: build.mutation<{ product: OwnerProduct }, { id: string }>({
      query: ({ id }) => ({ url: `/owner/products/${id}/restore`, method: 'POST' }),
      invalidatesTags: (_result, error, { id }) =>
        error ? [] : [...EFFECTS.stock(), { type: 'Product', id }],
    }),

    // A recipe changes estimates (they provide the product list) and the supply's "used by".
    saveVariantPackaging: build.mutation<
      unknown,
      { productId: string; variantId: string; packaging: { supplyId: string; quantity: number }[] }
    >({
      query: ({ productId, variantId, packaging }) => ({
        url: `/owner/products/${productId}/variants/${variantId}/packaging`,
        method: 'PUT',
        body: { packaging },
      }),
      invalidatesTags: (_result, error, { productId }) =>
        error
          ? []
          : [{ type: 'Product', id: LIST }, { type: 'Product', id: productId }, 'Supply'],
    }),

    /* ------------------------------------------------------------- sources */

    // No argument is the live list, which is what the accept sheet offers.
    getSources: build.query<{ sources: Source[] }, SourcesArgs | void>({
      query: (arg) => `/owner/sources${qs(arg ?? undefined)}`,
      serializeQueryArgs: byQueryString,
      providesTags: (result) => listTags('Source', result?.sources),
    }),

    getSource: build.query<SourceDetailView, { id: string }>({
      query: ({ id }) => `/owner/sources/${id}`,
      providesTags: (_result, _error, { id }) => [{ type: 'Source', id }],
    }),

    createSource: build.mutation<{ source: Source }, SourceInput>({
      query: (body) => ({ url: '/owner/sources', method: 'POST', body }),
      invalidatesTags: (_result, error) => (error ? [] : [{ type: 'Source', id: LIST }]),
    }),

    updateSource: build.mutation<{ source: Source }, SourceInput & { id: string }>({
      query: ({ id, ...body }) => ({ url: `/owner/sources/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_result, error, { id }) =>
        error ? [] : [{ type: 'Source', id: LIST }, { type: 'Source', id }, 'Report'],
    }),

    archiveSource: build.mutation<unknown, { id: string }>({
      query: ({ id }) => ({ url: `/owner/sources/${id}`, method: 'DELETE' }),
      invalidatesTags: (_result, error, { id }) =>
        error ? [] : [{ type: 'Source', id: LIST }, { type: 'Source', id }, 'Report'],
    }),

    // The same PATCH as an edit, carrying only the flag; the server audits it.
    restoreSource: build.mutation<{ source: Source }, { id: string }>({
      query: ({ id }) => ({
        url: `/owner/sources/${id}`,
        method: 'PATCH',
        body: { isArchived: false },
      }),
      invalidatesTags: (_result, error, { id }) =>
        error ? [] : [{ type: 'Source', id: LIST }, { type: 'Source', id }, 'Report'],
    }),

    /* --------------------------------------------------------------- zones */

    getZones: build.query<{ zones: DeliveryZone[] }, void>({
      query: () => '/owner/delivery-zones',
      providesTags: (result) => listTags('Zone', result?.zones),
    }),

    // The public zone list (order forms, customer edit) provides the zone list tag too.
    createZone: build.mutation<{ zone: DeliveryZone }, ZoneInput>({
      query: (body) => ({ url: '/owner/delivery-zones', method: 'POST', body }),
      invalidatesTags: (_result, error) => (error ? [] : [{ type: 'Zone', id: LIST }]),
    }),

    updateZone: build.mutation<{ zone: DeliveryZone }, ZoneInput & { id: string }>({
      query: ({ id, ...body }) => ({ url: `/owner/delivery-zones/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_result, error, { id }) =>
        error ? [] : [{ type: 'Zone', id: LIST }, { type: 'Zone', id }],
    }),

    // Refused with ZONE_IN_USE while an order points at the zone; switching it off is the way then.
    deleteZone: build.mutation<{ deleted: boolean }, { id: string }>({
      query: ({ id }) => ({ url: `/owner/delivery-zones/${id}`, method: 'DELETE' }),
      invalidatesTags: (_result, error, { id }) =>
        error ? [] : [{ type: 'Zone', id: LIST }, { type: 'Zone', id }],
    }),

    /* ------------------------------------------------------------ supplies */

    // No argument is every live supply, which is what the purchase form and the recipe sheet want.
    getSupplies: build.query<SuppliesList, SuppliesArgs | void>({
      query: (arg) => `/owner/supplies${qs(arg ?? undefined)}`,
      serializeQueryArgs: byQueryString,
      providesTags: (result) => listTags('Supply', result?.supplies),
    }),

    getSupply: build.query<SupplyView, { id: string }>({
      query: ({ id }) => `/owner/supplies/${id}`,
      providesTags: (_result, _error, { id }) => [{ type: 'Supply', id }],
    }),

    // The dashboard counts supplies below their reorder level.
    createSupply: build.mutation<{ supply: Supply }, SupplyInput>({
      query: (body) => ({ url: '/owner/supplies', method: 'POST', body }),
      invalidatesTags: (_result, error) => (error ? [] : [{ type: 'Supply', id: LIST }, 'Dashboard']),
    }),

    updateSupply: build.mutation<{ supply: Supply }, SupplyInput & { id: string }>({
      query: ({ id, ...body }) => ({ url: `/owner/supplies/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_result, error, { id }) =>
        error ? [] : [{ type: 'Supply', id: LIST }, { type: 'Supply', id }, 'Dashboard'],
    }),

    // Archive and restore from a list or the detail page, without the rest of the edit form.
    setSupplyArchived: build.mutation<{ supply: Supply }, { id: string; isArchived: boolean }>({
      query: ({ id, isArchived }) => ({
        url: `/owner/supplies/${id}`,
        method: 'PATCH',
        body: { isArchived },
      }),
      invalidatesTags: (_result, error, { id }) =>
        error ? [] : [{ type: 'Supply', id: LIST }, { type: 'Supply', id }, 'Dashboard'],
    }),

    // `nonce` is held per open sheet, so a retry cannot post the same count twice.
    stockTakeSupply: build.mutation<
      { agreed: boolean },
      { id: string; counted: number; nonce: string; note?: string }
    >({
      query: ({ id, ...body }) => ({ url: `/owner/supplies/${id}/stock-take`, method: 'POST', body }),
      invalidatesTags: (_result, error, { id }) => (error ? [] : EFFECTS.supplies(id)),
    }),

    adjustSupply: build.mutation<
      unknown,
      { id: string; kind: string; quantity: number; nonce: string; note?: string }
    >({
      query: ({ id, ...body }) => ({ url: `/owner/supplies/${id}/adjust`, method: 'POST', body }),
      invalidatesTags: (_result, error, { id }) => (error ? [] : EFFECTS.supplies(id)),
    }),

    /* ------------------------------------------------------------- landing */

    getLanding: build.query<LandingResponse, void>({
      query: () => '/owner/landing',
      providesTags: ['Landing'],
    }),

    /*
     * Every landing write answers with the whole content, which becomes the
     * cached copy. Nothing else reads it on the client (the public pages render
     * on the server), so writing it through replaces a refetch.
     */
    updateLanding: build.mutation<LandingResponse, LandingUpdate>({
      query: (body) => ({ url: '/owner/landing', method: 'PATCH', body }),
      onQueryStarted: async (_arg, { dispatch, queryFulfilled }) => {
        try {
          const { data } = await queryFulfilled;
          dispatch(catalogApi.util.upsertQueryData('getLanding', undefined, data));
        } catch {
          // Shown by the caller.
        }
      },
    }),

    uploadLandingHeroImages: build.mutation<LandingResponse, { formData: FormData }>({
      query: ({ formData }) => ({ url: '/owner/landing/hero-images', method: 'POST', formData }),
      onQueryStarted: async (_arg, { dispatch, queryFulfilled }) => {
        try {
          const { data } = await queryFulfilled;
          dispatch(catalogApi.util.upsertQueryData('getLanding', undefined, data));
        } catch {
          // Shown by the caller.
        }
      },
    }),

    removeLandingHeroImage: build.mutation<LandingResponse, { imageId: string }>({
      query: ({ imageId }) => ({
        url: `/owner/landing/hero-images/${encodeURIComponent(imageId)}`,
        method: 'DELETE',
      }),
      onQueryStarted: async (_arg, { dispatch, queryFulfilled }) => {
        try {
          const { data } = await queryFulfilled;
          dispatch(catalogApi.util.upsertQueryData('getLanding', undefined, data));
        } catch {
          // Shown by the caller.
        }
      },
    }),

    addLandingReview: build.mutation<LandingResponse, { formData: FormData }>({
      query: ({ formData }) => ({ url: '/owner/landing/reviews', method: 'POST', formData }),
      onQueryStarted: async (_arg, { dispatch, queryFulfilled }) => {
        try {
          const { data } = await queryFulfilled;
          dispatch(catalogApi.util.upsertQueryData('getLanding', undefined, data));
        } catch {
          // Shown by the caller.
        }
      },
    }),

    removeLandingReview: build.mutation<LandingResponse, { reviewId: string }>({
      query: ({ reviewId }) => ({ url: `/owner/landing/reviews/${reviewId}`, method: 'DELETE' }),
      onQueryStarted: async (_arg, { dispatch, queryFulfilled }) => {
        try {
          const { data } = await queryFulfilled;
          dispatch(catalogApi.util.upsertQueryData('getLanding', undefined, data));
        } catch {
          // Shown by the caller.
        }
      },
    }),
  }),
});

export const {
  useGetProductsQuery,
  useCreateProductMutation,
  useUpdateProductMutation,
  useSetVariantStockMutation,
  useArchiveProductMutation,
  useRestoreProductMutation,
  useSaveVariantPackagingMutation,
  useGetSourcesQuery,
  useGetSourceQuery,
  useCreateSourceMutation,
  useUpdateSourceMutation,
  useArchiveSourceMutation,
  useRestoreSourceMutation,
  useGetZonesQuery,
  useCreateZoneMutation,
  useUpdateZoneMutation,
  useDeleteZoneMutation,
  useGetSuppliesQuery,
  useGetSupplyQuery,
  useCreateSupplyMutation,
  useUpdateSupplyMutation,
  useSetSupplyArchivedMutation,
  useStockTakeSupplyMutation,
  useAdjustSupplyMutation,
  useGetLandingQuery,
  useUpdateLandingMutation,
  useUploadLandingHeroImagesMutation,
  useRemoveLandingHeroImageMutation,
  useAddLandingReviewMutation,
  useRemoveLandingReviewMutation,
} = catalogApi;
