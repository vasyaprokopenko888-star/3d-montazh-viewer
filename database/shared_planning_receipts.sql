create table public.planning_receipts (
 board_id uuid not null references public.planning_boards(id),
 created_by uuid not null references auth.users(id),
 id text not null check (id ~ '^[A-Za-z0-9_-]{1,100}$'),
 receipt_date date not null,
 order_id text not null default '',
 order_title text not null default '',
 width integer not null check (width between 1 and 2800),
 height integer not null check (height between 1 and 2800),
 object_path text generated always as (board_id::text || '/' || created_by::text || '/' || id || '.jpg') stored,
 created_at timestamptz not null default now(),
 deleted_at timestamptz,
 primary key (board_id, created_by, id)
);
create index planning_receipts_board_date on public.planning_receipts (board_id, receipt_date, id);
create index planning_receipts_creator on public.planning_receipts (created_by);
alter table public.planning_receipts enable row level security;
revoke all on public.planning_receipts from anon, authenticated;
grant select, insert on public.planning_receipts to authenticated;
grant update (deleted_at) on public.planning_receipts to authenticated;
create policy receipts_member_read on public.planning_receipts for select to authenticated
 using (exists (select 1 from public.planning_members m where m.board_id = planning_receipts.board_id and m.user_id = (select auth.uid())));
create policy receipts_member_insert on public.planning_receipts for insert to authenticated
 with check (created_by = (select auth.uid()) and deleted_at is null and exists (select 1 from public.planning_members m where m.board_id = planning_receipts.board_id and m.user_id = (select auth.uid())));
create policy receipts_member_soft_delete on public.planning_receipts for update to authenticated
 using (exists (select 1 from public.planning_members m where m.board_id = planning_receipts.board_id and m.user_id = (select auth.uid())))
 with check (exists (select 1 from public.planning_members m where m.board_id = planning_receipts.board_id and m.user_id = (select auth.uid())));
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
 values ('planning-receipts','planning-receipts',false,15728640,array['image/jpeg']);
create policy receipts_storage_read on storage.objects for select to authenticated
 using (bucket_id = 'planning-receipts' and exists (select 1 from public.planning_members m where m.board_id::text = (storage.foldername(name))[1] and m.user_id = (select auth.uid())));
create policy receipts_storage_insert on storage.objects for insert to authenticated
 with check (bucket_id = 'planning-receipts' and (storage.foldername(name))[2] = (select auth.uid())::text and array_length(storage.foldername(name),1)=2 and storage.filename(name) ~ '^[A-Za-z0-9_-]{1,100}\.jpg$' and exists (select 1 from public.planning_members m where m.board_id::text = (storage.foldername(name))[1] and m.user_id = (select auth.uid())));
