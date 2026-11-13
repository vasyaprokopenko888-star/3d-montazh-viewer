# Shared receipts

The `shared_planning_receipts` migration was applied to the existing Supabase project on 2026-11-13. See `shared_planning_receipts.sql` for the exact schema.

Receipt images are immutable private JPEG objects in `planning-receipts`, keyed by board/user/receipt ID. Metadata uses the existing `planning_members` membership model. Both members can read and soft-delete receipts; only the authenticated creator can insert their own metadata and images. No public access or file overwrite is granted.

Legacy IndexedDB receipts stay on the original device. The explicit import operation preserves the local originals and uses stable IDs to avoid duplicates on retry. Deleted cloud records are retained as tombstones so importing again cannot resurrect them.

Deployment requires publishing `planner.html` and `planner-receipts.js` together. Database provisioning alone does not enable cloud receipts in the old page.
