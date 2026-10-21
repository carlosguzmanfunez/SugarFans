import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

export const ADMIN='00000000-0000-0000-0000-000000000090';
export const CREATOR='00000000-0000-0000-0000-000000000001';
export const OTHER='00000000-0000-0000-0000-000000000002';
export const FINANCE_MIGRATION='20261020032222_creator_ledger_batch_reservations.sql';
export const NOTIFICATION_MIGRATION='20261020231703_payout_notification_wording.sql';
export async function financeFixture({beforeMigration,notificationMigration=true,incidentMigration=process.env.TEST_INCIDENT_PROCEDURES==='1',feeResolutionMigration=process.env.TEST_FEE_RESOLUTION==='1'||incidentMigration,automationMigration=process.env.TEST_PAYOUT_OPERATIONS==='1'||feeResolutionMigration,capacityMigration=automationMigration}={}) {
 const db=new PGlite();const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
 const source=n=>readFileSync(resolve('supabase/migrations',n),'utf8');
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema security_private;create table security_private.owner_account(user_id uuid primary key);create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create or replace function pg_catalog.now() returns timestamptz language sql stable as $$select current_setting('test.clock')::timestamptz$$;
 create table profiles(id uuid primary key,creator_profile_id text,name text,role text,is_verified boolean,suspended boolean);
 create table payout_accounts(user_id uuid primary key,paypal_email text);
 create table account_restrictions(user_id uuid primary key,payouts_frozen boolean,suspended_until timestamptz);
 create table transactions(id text primary key,creator_profile_id text,amount numeric,creator_share numeric,status text,platform_covers boolean default false,created_at timestamptz);
 create table payouts(id uuid primary key default gen_random_uuid(),user_id uuid references profiles(id),creator_name text,amount numeric,fee numeric,net numeric,account_label text,available_before numeric,status text,paid_at timestamptz,requested_at timestamptz default now(),scheduled_for date,paypal_batch_id text,paypal_item_id text,error text);
 create function is_admin() returns boolean language sql stable security definer set search_path='' as $$select coalesce((select role='admin' from public.profiles where id=auth.uid()),false)$$;
 create function is_suspended(p_user uuid) returns boolean language sql stable as $$select suspended from public.profiles where id=p_user$$;
 create function payout_min(p_user uuid) returns numeric language sql stable as $$select 50::numeric$$;
 create function payout_fee_for(p_user uuid,p_amount numeric) returns numeric language sql immutable as $$select least(round(p_amount*.02,2),20)$$;
 create function payout_label(p_email text) returns text language sql immutable as $$select 'PayPal · '||left(p_email,2)||'•••'$$;`);
 const clock=at=>q("select set_config('test.clock',$1,false)",[at]);
 const auth=id=>q("select set_config('request.jwt.claim.sub',$1,false)",[id??'']);
 await clock('2026-10-19T12:00:00Z');await db.exec(source('20261019194731_earnings_calendar_26_25.sql'));
 await db.exec(source('20261019215002_disable_simulated_payout_fallback.sql'));
 await db.exec(source('20261003000007_paypal_payouts.sql').match(/create or replace function public\.paypal_payout_mark\([\s\S]*?\$\$;/i)[0]);
 await db.exec(source('20261019220609_payout_submission_recovery.sql'));await db.exec(source('20261020015716_payout_event_reconciliation.sql'));
 if(beforeMigration)await beforeMigration({db,q,clock,auth});
 try {await db.exec(source(FINANCE_MIGRATION));}catch(error){await db.close();throw error;}
 if(notificationMigration)await db.exec(source(NOTIFICATION_MIGRATION));
 if(automationMigration){await db.exec(source('20261021045607_payout_batch_executor_and_reconciliation.sql'));await db.exec(source('20261021050319_payout_owner_notification_authority.sql'));}
 if(feeResolutionMigration)await db.exec(source('20261021145039_payout_fee_resolution.sql'));
 if(incidentMigration){
  await db.exec("alter table transactions add column kind text not null default 'tip';alter table transactions add column key text;alter table account_restrictions add column updated_at timestamptz default now();alter table account_restrictions add column suspension_reason text;create table admin_actions(id uuid default gen_random_uuid(),admin_id uuid,admin_name text,user_id uuid,user_name text,action text,reason text,until timestamptz,created_at timestamptz default now())");
  await db.exec(source('20261020174153_owner_account_controls.sql').match(/create or replace function public\.admin_account_action\([\s\S]*?\$\$;/i)[0]);
  await db.exec(source('20261010000002_platform_covers_refunds.sql').match(/create or replace function public\.admin_cover_refund\([\s\S]*?\$\$;/i)[0].replace('id = p_transaction','id = p_transaction::text'));
  await db.exec(source('20261021164442_payout_incident_procedures.sql'));
 }
 if(capacityMigration)await db.exec(source('20261021191647_payout_provider_capacity.sql'));
 const reset=async()=>{
   const fees=feeResolutionMigration?'finance_fee_holds,finance_fee_reversals,finance_fee_resolutions,finance_private.fee_policy,':'';
   const operations=automationMigration?'finance_alert_tests,finance_alert_queue,finance_incidents,finance_job_runs,finance_execution_reservations,finance_funding_checks,finance_statement_lines,finance_statement_imports,finance_private.automation_settings,':'';
   const cases=incidentMigration?'finance_hold_releases,finance_case_actions,finance_payout_holds,admin_actions,':'';
   await db.exec('reset role;truncate '+(capacityMigration?'finance_private.provider_limits,':'')+cases+fees+operations+'auth.users,security_private.owner_account,finance_allocations,finance_source_revisions,finance_journal,finance_adjustments,finance_sources,finance_batch_items,finance_batches,paypal_payout_reconciliations,paypal_payout_events,paypal_payout_submissions,payouts,transactions,profiles,payout_accounts,account_restrictions');
   await q('update finance_private.settings set batch_handoff_enabled=false');
   await clock('2026-10-26T12:00:00Z');await auth(ADMIN);
   await q("insert into profiles values($1,null,'Administrador','admin',true,false),($2,'creator','Mariana','creator',true,false),($3,'other','Diego','creator',true,false)",[ADMIN,CREATOR,OTHER]);
   await q("insert into auth.users(id,email,email_confirmed_at) values($1,'admin@example.invalid',now()),($2,'creator@example.invalid',now()),($3,'other@example.invalid',now())",[ADMIN,CREATOR,OTHER]);
   await q("insert into payout_accounts values($1,'mariana@example.invalid'),($2,'diego@example.invalid')",[CREATOR,OTHER]);
   if(automationMigration)await q("insert into finance_private.automation_settings(id,environment,operator_user_id) values(true,'sandbox',$1)",[ADMIN]);
   if(feeResolutionMigration)await q('insert into finance_private.fee_policy(id) values(true)');
 };
 const sale=(id='sale',creator='creator',amount=200,share=.8,at='2026-10-20T12:00:00Z',status='paid')=>q('insert into transactions(id,creator_profile_id,amount,creator_share,created_at,status) values($1,$2,$3,$4,$5,$6)',[id,creator,amount,share,at,status]);
 const rpc=async(name,args=[]) => (await q(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) as v`,args))[0].v;
 return {db,q,clock,auth,reset,sale,rpc};
}
