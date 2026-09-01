import {
  ProductPostedDate,
  ProductReportButton,
  ProductTags,
} from '@/components/molecules';
import { HttpTypes } from '@medusajs/types';

export const ProductDetailsFooter = ({
  tags = [],
  posted,
  productId,
}: {
  tags?: HttpTypes.StoreProductTag[];
  posted: HttpTypes.StoreProduct['created_at'];
  productId: string;
}) => {
  return (
    <>
      <div className='p-4 border rounded-sm'>
        <ProductTags tags={tags} />
        <div className='flex justify-between items-center mt-4'>
          <ProductPostedDate posted={posted} />
          <ProductReportButton productId={productId} />
        </div>
      </div>
    </>
  );
};
