import React from 'react';
import { VIRTUAL_CURRENCY } from '../config/currency';

// The virtual currency's symbol, used next to every amount of it.
const CoinIcon: React.FC<{ size?: number; className?: string }> = ({ size = 16, className = '' }) => (
  <img
    src={VIRTUAL_CURRENCY.icon}
    alt=""
    aria-hidden="true"
    width={size}
    height={size}
    draggable={false}
    className={`inline-block shrink-0 align-[-0.15em] ${className}`}
  />
);

export default CoinIcon;
