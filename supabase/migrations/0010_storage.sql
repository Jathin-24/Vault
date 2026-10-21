-- ============================================================================
-- 0010_storage.sql
-- File bytes live in the private 'documents' bucket.
--
-- Rule: NO browser client ever touches Storage directly. There is no signed
-- URL feature in this product on purpose — a signed URL is a bearer token
-- that keeps working after access is revoked, which violates requirement 3.
-- Every byte flows through GET /api/documents/:id/download, which calls
-- tv_authorize_document_access() per request and then streams via the
-- service role.
--
-- Belt and braces: explicit deny-all policies for anon + authenticated, on
-- top of Storage's default-deny. (If the migration role lacks rights over
-- storage.objects in some project plans, the statement below fails loudly in
-- `npm run db:migrate`; the README fallback is Storage → Policies in the
-- dashboard. Default-deny still holds either way.)
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 26214400, null)
on conflict (id) do nothing;

do $$
begin
  create policy "documents_bucket_no_client_access"
    on storage.objects for all
    to anon, authenticated
    using (false)
    with check (false);
exception
  when insufficient_privilege then
    raise warning 'TrustVault: could not create storage deny policy (role lacks ownership of storage.objects). Bucket remains default-deny. Create it in Dashboard → Storage → policies if you want the explicit statement.';
end;
$$;
