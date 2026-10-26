-- Do not hide a new contradictory proof after a supervised decision. Keep its
-- original amount/credit, open a case and isolate only the affected creator.
do $$declare definition text;anchor text;begin
 definition:=replace(pg_get_functiondef('finance_private.collection_cost_plan(text,uuid)'::regprocedure),chr(13),'');
 anchor:='if d.id is null and last_issue is not null then';
 if position(anchor in definition)=0 then raise exception 'Revisar la detección de comprobantes contradictorios';end if;
 execute replace(definition,anchor,'if last_issue is not null then');

 definition:=replace(pg_get_functiondef('public.paypal_collection_cost_store(text,uuid,uuid,text,text,text,jsonb)'::regprocedure),chr(13),'');
 anchor:='insert into finance_private.collection_cost_queries(request_key,kind,source_id,source_hash,environment,sender,proof,result)values(p_key,p_kind,p_id,p_expected,p_environment,p_sender,p_proof,result);return result;';
 if position(anchor in definition)=0 then raise exception 'Revisar la conservación de comprobantes de costo';end if;
 execute replace(definition,anchor,$new$
 insert into finance_private.collection_cost_queries(request_key,kind,source_id,source_hash,environment,sender,proof,result)values(p_key,p_kind,p_id,p_expected,p_environment,p_sender,p_proof,result);
 if issue is not null and exists(select 1 from finance_private.collection_cost_resolutions where kind=p_kind and source_id=p_id)then
  perform finance_private.incident(null,'COLLECTION_COST_REVIEW',p_kind||'/'||p_id,'Un costo ya conciliado necesita revisión',issue);
  if p_kind='sale'and(select count(*)from public.profiles where creator_profile_id=ctx->>'creator'and role='creator')=1 then
   perform finance_private.place_hold((select id from public.profiles where creator_profile_id=ctx->>'creator'and role='creator'),
    'safety','collection-cost-proof/'||p_id,'Un comprobante posterior contradice el costo aprobado. Revisar sin volver a descontar ni liberar fondos.');
  end if;
 end if;return result;
 $new$);
end$$;
select pg_notify('pgrst','reload schema');
