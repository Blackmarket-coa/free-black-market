import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260706210814 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "request" ("id" text not null, "type" text not null, "data" jsonb not null default '{}', "submitter_id" text not null, "reviewer_id" text null, "reviewer_note" text null, "status" text check ("status" in ('pending', 'accepted', 'rejected', 'completed', 'cancelled')) not null default 'pending', "requester_id" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "request_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_request_deleted_at" ON "request" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_request_submitter_id" ON "request" ("submitter_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_request_status" ON "request" ("status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_request_type" ON "request" ("type") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "request" cascade;`);
  }

}
