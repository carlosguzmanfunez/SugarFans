import React from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { saveRefCode } from '../lib/rewards';

// /r/<creator profile id>: remembers who invited the visitor, then shows that creator.
const ReferralLink: React.FC = () => {
  const { id = '' } = useParams();
  if (id) saveRefCode(id);
  return <Navigate to={id ? `/creator/${id}` : '/'} replace />;
};

export default ReferralLink;
