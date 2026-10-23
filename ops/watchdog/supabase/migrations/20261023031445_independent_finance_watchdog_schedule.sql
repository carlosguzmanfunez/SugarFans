-- Separate monitor project only. Vault must already contain its scoped trigger.
create extension if not exists pg_net;
do $$begin
 if not exists(select 1 from vault.decrypted_secrets where name='finance_watchdog_trigger')then raise exception 'Configure the scoped watchdog trigger in Vault first';end if;
end$$;
select cron.schedule('finance-independent-watchdog','*/5 * * * *',$cron$
 select net.http_post(
  url:='https://pcxblbctafwmijfcwgdd.supabase.co/functions/v1/finance-watchdog',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='finance_watchdog_trigger')),
  body:='{}'::jsonb,timeout_milliseconds:=40000
 );
$cron$);
