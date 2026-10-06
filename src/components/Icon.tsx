import React from 'react';
import {
  ArrowRight, Ban, Bell, BellOff, Check, ChartLine, ChartPie, ChevronDown, CircleCheck, CircleHelp, CircleUser, Coins, Compass, DollarSign, Ellipsis,
  Flag, Gift, HandCoins, Heart, House, Image, Images, Link, LogOut, Menu, Pen, Plus, Settings, ShieldHalf, Star, Target, Ticket, Trophy, Unlock, User, Users,
  Wallet, X, type LucideIcon,
} from 'lucide-react';

// One icon family for the app chrome (tab bar, menus, panels): thin-stroke Lucide
// icons, named after the Font Awesome classes they replace so swapping one is a
// one-word change. Sized in em, so text-* classes keep controlling the size.
const ICONS: Record<string, LucideIcon> = {
  'fa-arrow-right': ArrowRight,
  'fa-arrow-right-from-bracket': LogOut,
  'fa-ban': Ban,
  'fa-bars': Menu,
  'fa-bell': Bell,
  'fa-bell-slash': BellOff,
  'fa-chart-line': ChartLine,
  'fa-chart-pie': ChartPie,
  'fa-check': Check,
  'fa-check-circle': CircleCheck,
  'fa-chevron-down': ChevronDown,
  'fa-circle-check': CircleCheck,
  'fa-circle-question': CircleHelp,
  'fa-circle-user': CircleUser,
  'fa-cog': Settings,
  'fa-coins': Coins,
  'fa-compass': Compass,
  'fa-dollar-sign': DollarSign,
  'fa-ellipsis': Ellipsis,
  'fa-flag': Flag,
  'fa-gear': Settings,
  'fa-gift': Gift,
  'fa-hand-holding-dollar': HandCoins,
  'fa-heart': Heart,
  'fa-house': House,
  'fa-image': Image,
  'fa-images': Images,
  'fa-link': Link,
  'fa-pen': Pen,
  'fa-plus': Plus,
  'fa-shield-halved': ShieldHalf,
  'fa-star': Star,
  'fa-bullseye': Target,
  'fa-ticket': Ticket,
  'fa-trophy': Trophy,
  'fa-unlock': Unlock,
  'fa-user': User,
  'fa-users': Users,
  'fa-wallet': Wallet,
  'fa-xmark': X,
};

export const hasIcon = (name: string) => name in ICONS;

const Icon: React.FC<{ name: string; className?: string; strokeWidth?: number }> = ({ name, className = '', strokeWidth = 1.9 }) => {
  const Svg = ICONS[name];
  // Unknown names still render, with the old icon font.
  if (!Svg) return <i aria-hidden="true" className={`fas ${name} ${className}`}></i>;
  return <Svg aria-hidden="true" width="1em" height="1em" strokeWidth={strokeWidth} className={`inline-block shrink-0 align-[-0.125em] ${className}`} />;
};

export default Icon;
