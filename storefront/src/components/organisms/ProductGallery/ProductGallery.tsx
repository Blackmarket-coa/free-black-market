import { GalleryCarousel } from '../GalleryCarousel/GalleryCarousel';
import { HttpTypes } from '@medusajs/types';

export const ProductGallery = ({
  images,
}: {
  images: HttpTypes.StoreProduct['images'];
}) => {
  return (
    <div>
      <GalleryCarousel images={images} />
    </div>
  );
};
