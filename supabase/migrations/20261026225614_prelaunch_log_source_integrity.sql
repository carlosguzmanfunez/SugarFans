-- Fans Reserve: prevent unauthenticated callers from spoofing incidents from
-- PayPal/API or email systems. Only the trusted service_role claim may mark
-- server-originated errors as "api" or "email". Browser error ingestion remains.
-- The source comes from a verified Supabase JWT / PostgREST request context.
CREATE OR REPLACE FUNCTION public.log_app_error(
 p_source text,p_message text,p_detail text DEFAULT ''::text,
 p_url text DEFAULT ''::text,p_user_agent text DEFAULT ''::text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
 v_source text := CASE WHEN p_source IN ('api','email')
                            AND current_setting('request.jwt.claim.role', true) = 'service_role'
                       THEN p_source ELSE 'web' END;
 v_message text := left(coalesce(nullif(btrim(p_message), ''), 'Error sin mensaje'), 500);
 v_hour timestamptz := date_trunc('hour', now());
 v_fp text;
BEGIN
 v_fp := md5(v_source || ':' || regexp_replace(v_message, '[0-9a-f]{8,}|[0-9]+', '#', 'gi'));
 UPDATE public.app_errors
    SET count = least(count+1,100000), last_seen = now()
    WHERE fingerprint = v_fp AND hour = v_hour;
 IF found THEN RETURN; END IF;
 DELETE FROM public.app_errors WHERE last_seen < now() - interval '30 days';
 IF (SELECT count(*) FROM public.app_errors WHERE hour = v_hour) >= 500 THEN RETURN; END IF;
 INSERT INTO public.app_errors(source,message,detail,url,user_agent,user_id,fingerprint,hour)
 VALUES(v_source,v_message,left(coalesce(p_detail,''),4000),
        left(coalesce(p_url,''),500),left(coalesce(p_user_agent,''),300),
        (SELECT auth.uid()),v_fp,v_hour)
 ON CONFLICT(fingerprint,hour) DO UPDATE SET
   count = least(public.app_errors.count+1,100000),
   last_seen = now();
END $function$;