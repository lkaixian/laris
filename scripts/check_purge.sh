#!/bin/bash
# Runs each retention-purge statement alone in a rolled-back transaction, so the one that fails shows its own error. Changes nothing.
q() { echo "--- $1"; psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "begin" -c "set local laris.tenant = '*'" -c "$2" -c "rollback" 2>&1 | grep -v "^BEGIN\|^SET\|^ROLLBACK"; }
q email_codes "delete from email_codes where coalesce(used_at, expires_at) < now() - interval '1 day'"
q invites "delete from invites where coalesce(accepted_at, expires_at) < now() - interval '30 days' and (status <> 'pending' or expires_at < now() - interval '30 days')"
q signups "select id, tenant_id from users u where not active and email_verified_at is null and created_at < now() - interval '7 days' and not exists (select 1 from users o where o.tenant_id=u.tenant_id and o.id<>u.id)"
q rfq_replies "update rfq_replies set message_text = null where message_text is not null and created_at < now() - interval '180 days'"
q listing_items "update listing_items set crop = ''::bytea where length(crop) > 0 and listing_id in (select id from listings where created_at < now() - interval '90 days')"
q listings "update listings set image = ''::bytea where length(image) > 0 and created_at < now() - interval '90 days'"
