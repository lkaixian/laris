-- Permissions split into finer ones (src/perms.py). A role keeps exactly what it could do:
--   export_data      -> export_contacts, export_audit, export_documents
--   upload_documents -> also manage_catalog (catalog photos and categories used to ride on it)
-- Only stored lists are touched (system Staff with a NULL list uses the new defaults, which already match: catalog on, exports off).
UPDATE roles SET permissions = (SELECT array_agg(DISTINCT x) FROM unnest(permissions || ARRAY['export_contacts', 'export_audit', 'export_documents']) AS x WHERE x <> 'export_data')
  WHERE permissions IS NOT NULL AND 'export_data' = ANY(permissions);
UPDATE roles SET permissions = array_append(permissions, 'manage_catalog')
  WHERE permissions IS NOT NULL AND 'upload_documents' = ANY(permissions) AND NOT ('manage_catalog' = ANY(permissions));
