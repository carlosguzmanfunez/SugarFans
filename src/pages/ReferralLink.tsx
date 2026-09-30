import React from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { saveRefCode } from '../lib/rewards';

// /r/<creator profile id>: remembers who invited the visitor, then shows that creator.
// /r/<id>?as=creator is the link for inviting creators: it opens creator sign-up.
const ReferralLink: React.FC = () => {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  if (id) saveRefCode(id);
  if (!id) return <Navigate to="/" replace />;
  return <Navigate to={params.get('as') === 'creator' ? '/register?role=creator' : `/creator/${id}`} replace />;
};

export default ReferralLink;
