-- Run against the development database after the settlement migration.
-- All simulated live records and temporary settings are rolled back. No provider requests are made.
begin;
do $qa$
declare
 suffix text:=replace(gen_random_uuid()::text,'-',''); cat uuid:=gen_random_uuid(); product uuid:=gen_random_uuid();
 edition uuid:=gen_random_uuid(); test_order uuid:=gen_random_uuid(); live_order uuid:=gen_random_uuid(); early_order uuid:=gen_random_uuid();
 cancelled_order uuid:=gen_random_uuid(); snapshot_order uuid:=gen_random_uuid(); n integer; result jsonb; before_state jsonb; batch bigint[]; leases uuid[];
begin
 insert into public.categories(id,name) values(cat,'QA settlement '||suffix);
 insert into public.products(id,slug,name,description,category_id) values(product,'qa-'||suffix,'QA settlement fixture','Rollback-only test',cat);
 insert into public.variants(id,product_id,format,sku,price_minor) values(edition,product,'stl','QA-'||suffix,1000);
 insert into public.digital_assets(variant_id,path,filename,version,bytes,sha256)
 values(edition,suffix||'/one','qa.stl',1,1,repeat('1',64)),(edition,suffix||'/two','qa.stl',2,1,repeat('2',64));
 insert into public.orders(id,name,email,total_minor) values
 (test_order,'QA test capture','chromazen.zen+customer2@gmail.com',1000),
 (live_order,'QA verified capture','chromazen.zen+customer2@gmail.com',1000),
 (early_order,'QA out of order','chromazen.zen+customer2@gmail.com',1000),
 (cancelled_order,'QA cancelled capture','chromazen.zen+customer2@gmail.com',1000),
 (snapshot_order,'QA refunded snapshot','chromazen.zen+customer2@gmail.com',1000);
 insert into public.order_items(order_id,variant_id,product_name,sku,format,quantity,unit_minor)
 select id,edition,'QA settlement fixture','QA-'||suffix,'stl',1,1000 from public.orders
 where id in(test_order,live_order,early_order,cancelled_order,snapshot_order);
 begin perform public.record_gateway_capture('live',live_order,'pay_Disabled'||suffix,1000,'INR',0);
  raise exception 'Live gate accepted';
 exception when others then if sqlerrm<>'Live settlement is disabled' then raise;end if;end;
 perform public.record_gateway_capture('test',test_order,'pay_Test'||suffix,1000,'INR',0);
 perform public.record_gateway_capture('test',test_order,'pay_Test'||suffix,1000,'INR',0);
 if (select payment_status from public.orders where id=test_order)<>'unpaid'
 or exists(select 1 from public.order_downloads(test_order))
 or (select count(*) from private.test_payment_captures where order_id=test_order)<>1
 or (select count(*) from private.notifications where entity_id=test_order and event='payment.test_received')<>1 then raise exception 'Test isolation or idempotency failed';end if;
 perform public.record_gateway_refund('test','rfnd_Test'||suffix,'pay_Test'||suffix,1000,'INR',1000,1000);
 perform public.record_gateway_refund('test','rfnd_Test'||suffix,'pay_Test'||suffix,1000,'INR',1000,1000);
 if (select refunded_minor from private.test_payment_captures where order_id=test_order)<>1000
 or (select count(*) from private.gateway_refunds where payment_id='pay_Test'||suffix)<>1
 or (select count(*) from private.notifications where entity_id=test_order and event='payment.test_refunded')<>1 then raise exception 'Test refund duplicated';end if;
 update private.commerce_settings set live_enabled=true where singleton;
 perform public.record_gateway_capture('live',live_order,'pay_Live'||suffix,1000,'INR',0);
 perform public.record_gateway_capture('live',live_order,'pay_Live'||suffix,1000,'INR',0);
 if (select count(*) from public.order_downloads(live_order) where version=2)<>1 then raise exception 'Latest purchased version missing';end if;
 perform public.record_gateway_refund('live','rfnd_Part'||suffix,'pay_Live'||suffix,400,'INR',1000,400);
 if (select payment_status from public.orders where id=live_order)<>'partially_refunded'
 or (select count(*) from public.order_downloads(live_order))<>1 then raise exception 'Approved partial refund policy failed';end if;
 perform public.record_gateway_refund('live','rfnd_Full'||suffix,'pay_Live'||suffix,600,'INR',1000,1000);
 perform public.record_gateway_refund('live','rfnd_Full'||suffix,'pay_Live'||suffix,600,'INR',1000,1000);
 perform public.record_gateway_capture('live',live_order,'pay_Live'||suffix,1000,'INR',1000);
 if (select payment_status from public.orders where id=live_order)<>'refunded'
 or exists(select 1 from public.order_downloads(live_order)) then raise exception 'Full refund access not revoked';end if;
 perform public.record_gateway_refund('live','rfnd_Early'||suffix,'pay_Early'||suffix,1000,'INR',1000,1000);
 perform public.record_gateway_capture('live',early_order,'pay_Early'||suffix,1000,'INR',0);
 if exists(select 1 from public.order_downloads(early_order))
 or (select payment_status from public.orders where id=early_order)<>'refunded' then raise exception 'Out of order refund grants files';end if;
 perform public.record_gateway_capture('live',snapshot_order,'pay_Snapshot'||suffix,1000,'INR',1000);
 if exists(select 1 from public.order_downloads(snapshot_order)) then raise exception 'Authoritative refund snapshot ignored';end if;
 update public.orders set status='cancelled' where id=cancelled_order;
 result:=public.record_gateway_capture('live',cancelled_order,'pay_Cancelled'||suffix,1000,'INR',0);
 perform public.record_gateway_capture('live',cancelled_order,'pay_Cancelled'||suffix,1000,'INR',0);
 if result->>'review_required'<>'true' or exists(select 1 from public.order_downloads(cancelled_order))
 or (select count(*) from private.payment_reviews where order_id=cancelled_order)<>1
 or (select count(*) from private.notifications where entity_id=cancelled_order)<>1 then raise exception 'Cancelled capture review failed';end if;
 perform public.record_gateway_failure('test','pay_Failed'||suffix,1000,'INR');
 perform public.record_gateway_failure('test','pay_Failed'||suffix,1000,'INR');
 if(select count(*) from private.gateway_failures where payment_id='pay_Failed'||suffix)<>1 then raise exception 'Failed payment duplicates';end if;
 insert into private.notifications(entity_id,event) values(test_order,'order.submitted');
 if not exists(select 1 from private.notifications where entity_id=test_order and event='order.submitted' and status='pending'
 and recipient='chromazen.zen+customer2@gmail.com' and payload->>'amount_minor'='1000') then raise exception 'Notification snapshot missing';end if;
 update public.orders set email='outsider@example.invalid' where id=test_order;
 insert into private.notifications(entity_id,event) values(test_order,'order.processing');
 if not exists(select 1 from private.notifications where entity_id=test_order and event='order.processing' and status='skipped') then raise exception 'Test email escapes allowlist';end if;
 select array_agg(id),array_agg(lease_id) into batch,leases from public.claim_notifications();
 if coalesce(array_length(batch,1),0)=0 then raise exception 'No queue claim';end if;
 if exists(select 1 from public.claim_notifications() x where x.id=any(batch)) then raise exception 'Queue lease duplicated';end if;
 if public.finish_notification(batch[1],gen_random_uuid(),'delivered',null) then raise exception 'Wrong lease accepted';end if;
 if not public.finish_notification(batch[1],leases[1],'delivered',null)
 or not public.finish_notification(batch[1],leases[1],'delivered',null) then raise exception 'Delivery acknowledgement is not idempotent';end if;
 select id into n from private.notifications where id=any(batch) and status='sending' limit 1;
 if n is null then raise exception 'Missing interrupted-send fixture';end if;
 update private.notifications set claimed_at=now()-interval '11 minutes' where id=n;
 perform public.claim_notifications();
 if not exists(select 1 from private.notifications where id=n and status='unknown' and last_error='WORKER_INTERRUPTED') then
  raise exception 'Interrupted send was not retained for review';end if;
 if has_function_privilege('authenticated','public.record_gateway_capture(text,uuid,text,bigint,text,bigint)','execute')
 or has_function_privilege('anon','public.claim_notifications()','execute')
 or not has_function_privilege('service_role','public.claim_notifications()','execute')
 then raise exception 'Service routine privileges failed';end if;
 if public.notification_worker_access(repeat('0',64)) then raise exception 'Unconfigured worker allowed';end if;
 perform set_config('chroma.settlement_tests','passed',true);
end $qa$;
select current_setting('chroma.settlement_tests') as settlement_refunds_isolation_queue_security;
rollback;
