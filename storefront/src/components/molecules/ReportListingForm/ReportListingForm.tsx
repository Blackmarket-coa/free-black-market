'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button, Textarea, Input } from '@/components/atoms';
import { SelectField } from '../SelectField/SelectField';
import { cn } from '@/lib/utils';
import { medusaFetch } from '@/lib/config';

/**
 * Report a listing.
 *
 * This form previously had no backend: `onSubmit` logged the form data to the
 * browser console and the view then told the reporter "We'll check the listing
 * ... and take the necessary action". The report never left the page, and the
 * only reason offered was a DMCA claim. Asserting that a notice was received
 * while discarding it is worse than having no form, so the success view is now
 * reachable only after the server has accepted the report.
 */

const reasonOptions = [
  { label: '', value: '', hidden: true },
  {
    label: 'Trademark, Copyright or DMCA Violation',
    value: 'trademark_copyright_dmca',
  },
  { label: 'Counterfeit or Replica', value: 'counterfeit' },
  { label: 'Prohibited Item', value: 'prohibited_item' },
  { label: 'Misleading or Inaccurate Listing', value: 'misleading_listing' },
  { label: 'Something Else', value: 'other' },
];

// Mirrors the server schema: a comment too short to act on is not a report.
const formSchema = z.object({
  reason: z.string().nonempty('Please select reason'),
  comment: z
    .string()
    .trim()
    .min(10, 'Please describe the problem in at least 10 characters'),
  reporter_email: z
    .string()
    .trim()
    .email('Enter a valid email address')
    .optional()
    .or(z.literal('')),
});

type FormData = z.infer<typeof formSchema>;

export const ReportListingForm = ({
  productId,
  onClose,
}: {
  productId: string;
  onClose: () => void;
}) => {
  const [state, setState] = useState<'idle' | 'submitting' | 'done'>('idle');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    clearErrors,
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: { reason: '', comment: '', reporter_email: '' },
  });

  const onSubmit = async (data: FormData) => {
    setState('submitting');
    setSubmitError(null);
    try {
      await medusaFetch<{ id: string; status: string }>(
        '/store/product-reports',
        {
          method: 'POST',
          body: {
            product_id: productId,
            reason: data.reason,
            comment: data.comment.trim(),
            reporter_email: data.reporter_email?.trim() || undefined,
          },
        }
      );
      setState('done');
    } catch {
      // Stay on the form. The reporter must not be told their report landed
      // when it did not — that is the defect this form is being fixed for.
      setState('idle');
      setSubmitError(
        'We could not submit your report. Please try again, and contact support if the problem continues.'
      );
    }
  };

  if (state === 'done') {
    return (
      <div className='text-center'>
        <div className='px-4 pb-5'>
          <h4 className='heading-lg uppercase'>Report received</h4>
          <p className='max-w-[466px] mx-auto mt-4 text-lg text-secondary'>
            We&apos;ve logged your report and it will be reviewed against our
            guidelines. If you gave us an email address we may contact you for
            more detail.
          </p>
        </div>

        <div className='border-t px-4 pt-5'>
          <Button className='w-full py-3 uppercase' onClick={onClose}>
            Got it
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <form onSubmit={handleSubmit(onSubmit)}>
        <div className='px-4 pb-5'>
          <label className='label-sm'>
            <p className={cn(errors?.reason && 'text-negative')}>Reason</p>
            <SelectField
              options={reasonOptions}
              {...register('reason')}
              selectOption={(value) => {
                setValue('reason', value);
                clearErrors('reason');
              }}
              className={cn(errors?.reason && 'border-negative')}
            />
            {errors?.reason && (
              <p className='label-sm text-negative'>{errors.reason.message}</p>
            )}
          </label>

          <label className='label-sm'>
            <p className={cn('mt-5', errors?.comment && 'text-negative')}>
              Comment
            </p>
            <Textarea
              rows={5}
              {...register('comment')}
              className={cn(errors.comment && 'border-negative')}
            />
            {errors?.comment && (
              <p className='label-sm text-negative'>{errors.comment.message}</p>
            )}
          </label>

          <label className='label-sm'>
            <p className={cn('mt-5', errors?.reporter_email && 'text-negative')}>
              Your email (optional)
            </p>
            <Input
              type='email'
              {...register('reporter_email')}
              className={cn(errors.reporter_email && 'border-negative')}
            />
            <p className='label-sm text-secondary mt-1'>
              Needed if we have to follow up — required for most copyright
              claims to be actionable.
            </p>
            {errors?.reporter_email && (
              <p className='label-sm text-negative'>
                {errors.reporter_email.message}
              </p>
            )}
          </label>

          {submitError && (
            <p className='label-sm text-negative mt-5'>{submitError}</p>
          )}
        </div>

        <div className='border-t px-4 pt-5'>
          <Button
            type='submit'
            disabled={state === 'submitting'}
            className='w-full py-3 uppercase'
          >
            {state === 'submitting' ? 'Sending…' : 'Report Listing'}
          </Button>
        </div>
      </form>
    </div>
  );
};
