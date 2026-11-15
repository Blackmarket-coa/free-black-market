import { ProductPageAccordion } from '@/components/molecules';
import LocalizedClientLink from '@/components/molecules/LocalizedLink/LocalizedLink';
import { REFUNDS_POLICY_PATH } from '@/lib/constants/legal';

import { RETURNS_COPY, SHIPPING_COPY } from './copy';

export const ProductDetailsShipping = () => {
  return (
    <ProductPageAccordion
      heading='Shipping & Returns'
      defaultOpen={false}
    >
      <div className='product-details'>
        <ul>
          <li>{SHIPPING_COPY}</li>
          <li>
            {RETURNS_COPY}{' '}
            <LocalizedClientLink href={REFUNDS_POLICY_PATH} className='underline'>
              Read the Returns and Refunds policy
            </LocalizedClientLink>
            .
          </li>
        </ul>
      </div>
    </ProductPageAccordion>
  );
};
