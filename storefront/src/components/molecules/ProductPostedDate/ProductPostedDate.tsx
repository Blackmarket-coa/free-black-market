import { formatDistanceToNow } from 'date-fns';

export const ProductPostedDate = async ({
  posted,
}: {
  posted: string | null | undefined;
}) => {
  // Guard against a missing/invalid date. `created_at` can be absent from the
  // product payload (the storefront's fields whitelist drops it), and
  // `new Date(undefined | '')` yields an Invalid Date whose serialization throws
  // `RangeError: Invalid time value`, 500-ing the whole product page during SSR.
  if (!posted) return null;
  const date = new Date(posted);
  if (Number.isNaN(date.getTime())) return null;

  const postedDate = formatDistanceToNow(date, { addSuffix: true });

  return (
    <p className='label-md text-secondary'>
      Posted: {postedDate}
    </p>
  );
};
