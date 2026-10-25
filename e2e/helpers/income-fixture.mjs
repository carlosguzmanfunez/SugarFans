import {readFileSync} from 'node:fs';
import {financeFixture,CREATOR,ADMIN,OTHER} from './finance-fixture.mjs';
export {CREATOR,ADMIN,OTHER};
export const FAN='00000000-0000-0000-0000-000000000003';
export const INCOME_MIGRATION='20261023191322_income_event_reconciliation.sql';
export async function incomeFixture(){
 const f=await financeFixture({incidentMigration:true,recoveryMigration:true}),{db,q}=f;
 const source=n=>readFileSync('supabase/migrations/'+n,'utf8').replaceAll('\r\n','\n');
 await db.exec(`alter table transactions add column paypal_ref text,add column gateway_fee numeric default 5,add column service_fee numeric,add column tax_amount numeric,add column creator_name text,add column payer_id uuid,add column payer_name text,add column method_label text,add column reversed_by text;
 alter table transactions alter column id set default gen_random_uuid()::text;alter table transactions alter column creator_share set default .76;alter table transactions alter column created_at set default now();create unique index transaction_income_key on transactions(key);
 create table coin_purchases(id uuid default gen_random_uuid(),user_id uuid,price numeric,status text,coins bigint,paypal_ref text);
 create table vip_bookings(id uuid,status text,updated_at timestamptz,details jsonb);
 create table paypal_subscriptions(id text primary key,user_id uuid,creator_id text,amount numeric,starts_at timestamptz,status text default 'created',created_at timestamptz default now(),activated_at timestamptz);
 create table subscriptions(fan_id uuid,creator_id text,price numeric,since timestamptz,cancel_at timestamptz,paypal_subscription_id text,primary key(fan_id,creator_id));
 create table paypal_orders(id text primary key,user_id uuid,kind text,params jsonb,amount numeric,fee numeric,capture_id text,status text default 'created',created_at timestamptz default now(),completed_at timestamptz,error text);
 create function creator_display_name(p_creator text) returns text language sql as $$select name from public.profiles where creator_profile_id=p_creator limit 1$$;
 create function paypal_self_pay(p_user uuid,p_kind text,p_params jsonb,p_payer_email text) returns boolean language sql as $$select false$$;
 create function next_renewal(p_since timestamptz) returns timestamptz language sql as $$select p_since+interval '1 month'$$;
 create function paypal_fulfill(p_order_id text,p_user uuid,p_capture_id text,p_amount numeric) returns void language plpgsql as $$declare o public.paypal_orders;begin
  select * into o from public.paypal_orders where id=p_order_id for update;if o.status='completed' then return;end if;
  if o.user_id<>p_user or o.amount<>p_amount then raise exception 'Invalid capture';end if;
  insert into public.transactions(creator_profile_id,creator_name,amount,status,paypal_ref,key,kind,payer_id) values(o.params->>'creatorProfileId','Mariana',p_amount,'paid',p_capture_id,'capture:'||p_order_id,'tip',p_user);
  update public.paypal_orders set status='completed',capture_id=p_capture_id where id=p_order_id;end$$;`);
 for(const name of ['coin_balance','paypal_money_back'])await db.exec(source('20261010000001_refunds_disputes_self_pay.sql').match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`,'i'))[0]);
 for(const name of ['paypal_subscription_register','paypal_subscription_activate','paypal_subscription_payment','paypal_subscription_ended'])await db.exec(source('20261003000006_paypal_subscriptions.sql').match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`,'i'))[0]);
 await db.exec(source('20261023191316_partial_refund_accounting.sql'));
 try{await db.exec(source(INCOME_MIGRATION));}catch(e){await db.close();throw Error(e.message+' · '+(e.where??'')+' · position '+(e.position??''));}
 const reset=async()=>{
  await db.exec('reset role;truncate finance_private.income_action_checks,finance_private.income_actions,finance_private.income_proofs,finance_private.income_attempts,finance_private.income_resources,finance_private.income_disputes,finance_private.income_events,finance_private.refund_receipts,finance_private.refund_followups,finance_private.refund_events,coin_purchases,paypal_orders,paypal_subscriptions,subscriptions,vip_bookings');
  await f.reset();await q("insert into profiles values($1,null,'Fan','fan',true,false)",[FAN]);await q("insert into auth.users(id,email,email_confirmed_at) values($1,'fan@example.invalid',now())",[FAN]);
 };
 return {...f,reset,source};
}
