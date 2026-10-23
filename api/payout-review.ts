// The calendar calls this review-only endpoint; enabling money needs a separate release.
import {scheduledReview} from './payout-job.js';
export const GET=scheduledReview;
